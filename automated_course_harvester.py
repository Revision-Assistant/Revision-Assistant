import os
import sys
import json
import asyncio
import re
import shutil
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession
from mega.client import MegaNzClient
import aiohttp
import urllib3
import imageio_ffmpeg

load_dotenv()
API_ID = int(os.getenv('API_ID'))
API_HASH = os.getenv('API_HASH')
FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

TRACKER_FILE = Path("harvested_tracker.json")
CYCLE_INTERVAL_HOURS = 72  # Refresh every 3 days

CHANNELS_TO_MONITOR = [
    "ICT_CAPITAL",
    "ICT_GOAT",
    "cursos_trading_rank",
    "forexcourse1234",
    "trading_videos_courses_stock_4",
    "forex_ict_smc",
    "Trading_Tuts",
    "Forexfreecourses1",
    "free_tradingcourse_s"
]

KEYWORDS = [
    "chart", "charting", "candlestick", "candle", "intraday", 
    "scalping", "scalp", "price action", "smc", "ict", "order block", 
    "liquidity", "fvg", "breakout", "volume profile", "mentorship"
]

MEGA_FOLDERS = [
    {
        "name": "Trader Dale - Volume Profile Course",
        "url": "https://mega.nz/folder/pYhxVIrD#InRAy0COt34QBAUEVpeItA"
    },
    {
        "name": "Tradepro Academy - Futures & Order Flow",
        "url": "https://mega.nz/folder/lNB1RAxR#mf_HyBCtaBWzUV5AelLbiA"
    }
]

def load_community_config():
    cfg_file = Path("community_channels.json")
    cfg = {
        "learning_id": -1004300323085,
        "learning_link": "https://t.me/+TfOQpTVcZ6I2OTRl"
    }
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                loaded = json.load(f)
                val = loaded.get("learning_id")
                if val:
                    if not str(val).startswith("-100"):
                        loaded["learning_id"] = int(f"-100{val}")
                    else:
                        loaded["learning_id"] = int(val)
                cfg.update(loaded)
        except Exception:
            pass
    return cfg

def load_tracker():
    if TRACKER_FILE.exists():
        try:
            with open(TRACKER_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"harvested_messages": [], "last_run": None, "mega_uploaded": []}

def save_tracker(data):
    with open(TRACKER_FILE, "w") as f:
        json.dump(data, f, indent=2)

def generate_rich_caption(raw_title, channel_name="", text="", learning_link=""):
    clean_title = Path(raw_title).stem.replace("_", " ").replace("-", " ")
    clean_title = re.sub(r'\[.*?\]', '', clean_title).strip()
    if not clean_title or len(clean_title) < 3:
        clean_title = "High-Probability Trading Strategy Lesson"
    
    # Detect topics
    tags = []
    text_lower = (clean_title + " " + text).lower()
    if any(k in text_lower for k in ["candle", "candlestick"]):
        tags.append("#CandlestickPatterns")
    if any(k in text_lower for k in ["chart", "charting"]):
        tags.append("#ChartAnalysis")
    if any(k in text_lower for k in ["intraday", "scalp"]):
        tags.append("#IntradayTrading")
    if any(k in text_lower for k in ["smc", "ict", "order block", "liquidity", "fvg"]):
        tags.append("#SmartMoneyConcepts")
    if any(k in text_lower for k in ["volume", "profile", "delta", "dom", "footprint"]):
        tags.append("#OrderFlow")
    if not tags:
        tags = ["#PriceAction", "#TradingEducation"]

    tags_str = " ".join(tags)
    source_line = f"📢 **Source Channel:** @{channel_name}\n" if channel_name else ""
    bridge_link = learning_link or "https://t.me/+TfOQpTVcZ6I2OTRl"

    caption = (
        f"🎬 **{clean_title}**\n"
        f"{source_line}"
        f"🏷️ **Topics:** {tags_str}\n"
        f"📝 **Description:** Professional training lesson focusing on market structure, "
        f"institutional liquidity, and execution rules.\n"
        f"💡 **Format:** Native In-App Streamable Video\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"⏪ [Tap to Return to Core 'learning' Curriculum]({bridge_link})\n"
        f"👉 Log Session: [/watched] | Mentor Console: [/menu]"
    )
    return caption

def process_video_streamable(input_path: Path, output_dir: Path):
    stem = input_path.stem
    output_mp4 = output_dir / f"{stem}_streamable.mp4"
    thumb_jpg = output_dir / f"{stem}_thumb.jpg"
    ext = input_path.suffix.lower()

    if ext == '.avi':
        cmd = [
            FFMPEG_EXE, "-y", "-i", str(input_path),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(output_mp4)
        ]
    else:
        cmd = [
            FFMPEG_EXE, "-y", "-i", str(input_path),
            "-c", "copy",
            "-movflags", "+faststart",
            str(output_mp4)
        ]

    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=240)
        if not output_mp4.exists() or output_mp4.stat().st_size == 0:
            output_mp4 = input_path
    except Exception:
        output_mp4 = input_path

    try:
        thumb_cmd = [
            FFMPEG_EXE, "-y", "-ss", "00:00:03", "-i", str(input_path),
            "-vframes", "1", "-q:v", "3",
            str(thumb_jpg)
        ]
        subprocess.run(thumb_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    except Exception:
        pass

    return output_mp4, thumb_jpg if thumb_jpg.exists() else None

async def harvest_telegram_channels(client, target_channel, tracker, learning_link):
    print("\n[+] Scanning monitored trading channels for new streamable videos...", flush=True)
    new_items = 0

    # 1. Gather all target channel entities (Curated + Discovered from dialogs)
    all_targets = []
    for ch_name in CHANNELS_TO_MONITOR:
        try:
            ent = await client.get_entity(ch_name)
            all_targets.append((ch_name, ent))
        except Exception:
            pass

    # Discover trading channels in user's account
    try:
        async for d in client.iter_dialogs():
            if (d.is_channel or d.is_group):
                t_lower = d.name.lower()
                if any(k in t_lower for k in ["trading", "forex", "crypto", "stock", "course", "ict", "smc", "price action"]):
                    if "learning" not in t_lower:
                        ch_title = d.name.replace(" ", "_")
                        all_targets.append((ch_title, d.entity))
    except Exception as e:
        print(f"[!] Channel discovery note: {e}", flush=True)

    print(f"[+] Total target trading channels to search: {len(all_targets)}", flush=True)

    for ch_name, entity in all_targets:
        print(f"  -> Searching in @{ch_name}...", flush=True)
        try:
            async for msg in client.iter_messages(entity, limit=120):
                msg_key = f"{ch_name}_{msg.id}"
                if msg_key in tracker.get("harvested_messages", []):
                    continue

                text = (msg.message or "").lower()
                is_video = bool(msg.video or (msg.media and hasattr(msg.media, 'document') and getattr(msg.media.document, 'mime_type', '').startswith('video/')))

                matches = any(k in text for k in KEYWORDS)
                if is_video and (matches or len(text) < 40):
                    try:
                        title_guess = ""
                        if msg.file and msg.file.name:
                            title_guess = msg.file.name
                        elif msg.message:
                            title_guess = msg.message.splitlines()[0][:60]
                        else:
                            title_guess = f"Trading Lesson from {ch_name}"

                        caption = generate_rich_caption(title_guess, ch_name, text, learning_link)
                        
                        # Forward/Send file with streamable support at max rate
                        await client.send_file(
                            target_channel,
                            msg.media,
                            caption=caption,
                            supports_streaming=True
                        )
                        tracker.setdefault("harvested_messages", []).append(msg_key)
                        save_tracker(tracker)
                        new_items += 1
                        print(f"     ✅ Harvested streamable video {msg.id} from @{ch_name} (Total: {new_items})", flush=True)
                        await asyncio.sleep(0.8)
                        if new_items >= 150:
                            break
                    except Exception as fe:
                        pass
            if new_items >= 150:
                break
        except Exception as e:
            print(f"     ⚠️ Access note on @{ch_name}: {e}", flush=True)

    print(f"[+] Telegram harvesting finished. Added {new_items} fresh streamable videos.", flush=True)
    return new_items

async def harvest_mega_with_limit_handling(tg_client, target_channel, mega_client, tracker, learning_link):
    print("\n[+] Checking Mega queues with automatic quota & limit management...", flush=True)
    temp_dir = Path("temp_auto_harvester")
    os.makedirs(temp_dir, exist_ok=True)

    for folder in MEGA_FOLDERS:
        f_name = folder["name"]
        f_url = folder["url"]
        print(f"  -> Processing Mega queue for: {f_name}...", flush=True)

        try:
            handle, key, _ = mega_client.parse_folder_url(f_url)
            filesystem = await mega_client.get_public_filesystem(handle, key)
            files = list(filesystem.files)
            files.sort(key=lambda x: x.attributes.name)

            for file_node in files:
                file_id = str(file_node.id)
                fname = file_node.attributes.name
                ext = Path(fname).suffix.lower()

                if file_id in tracker.get("mega_uploaded", []):
                    continue
                if ext not in {'.mp4', '.avi', '.mkv', '.pdf', '.zip'}:
                    continue

                print(f"     [Mega] Downloading: '{fname}'...", flush=True)
                item_dir = temp_dir / file_id
                os.makedirs(item_dir, exist_ok=True)

                try:
                    async with asyncio.timeout(600):
                        await mega_client.download_public_folder(
                            handle, key, output_dir=str(item_dir), root_id=file_node.id
                        )

                    # Locate file
                    local_f = None
                    for root, _, fs in os.walk(item_dir):
                        for f in fs:
                            if f == fname:
                                local_f = Path(root) / f
                                break
                    if not local_f:
                        for root, _, fs in os.walk(item_dir):
                            if fs:
                                local_f = Path(root) / fs[0]
                                break

                    if local_f and local_f.exists():
                        is_video = ext in {'.mp4', '.avi', '.mkv'}
                        thumb = None
                        final_f = local_f
                        if is_video:
                            final_f, thumb = await asyncio.to_thread(process_video_streamable, local_f, item_dir)

                        caption = generate_rich_caption(fname, "Mega Archive", "", learning_link)
                        await tg_client.send_file(
                            target_channel,
                            final_f,
                            caption=caption,
                            thumb=thumb,
                            supports_streaming=is_video
                        )
                        tracker.setdefault("mega_uploaded", []).append(file_id)
                        save_tracker(tracker)
                        print(f"     ✅ Uploaded: '{fname}' with streamable format & rich description!", flush=True)
                        await asyncio.sleep(2.0)
                    else:
                        print(f"     ⚠️ File missing after download.", flush=True)

                except Exception as de:
                    err_str = str(de)
                    if "509" in err_str or "Bandwidth Limit" in err_str:
                        print(f"\n[🛑 MEGA QUOTA HIT] 509 Bandwidth limit exceeded. Entering intelligent cooldown...", flush=True)
                        print(f"[Mega Cooldown] The harvester will pause Mega downloads and retry in next cycle.\n", flush=True)
                        shutil.rmtree(item_dir, ignore_errors=True)
                        return # Gracefully pause Mega for this round
                    else:
                        print(f"     ⚠️ Download error: {de}", flush=True)
                finally:
                    shutil.rmtree(item_dir, ignore_errors=True)

        except Exception as fe:
            print(f"  -> Folder error ({f_name}): {fe}", flush=True)

    shutil.rmtree(temp_dir, ignore_errors=True)

async def main():
    sys.stdout.reconfigure(line_buffering=True)
    if sys.stdout.encoding != 'utf-8':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except AttributeError:
            pass

    print("="*65, flush=True)
    print("🤖 AUTOMATED COURSE HARVESTER & STREAMABLE UPLOADER BOT ACTIVE", flush=True)
    print(f"🔄 Automated Refresh Cycle: Every {CYCLE_INTERVAL_HOURS} Hours (3 Days)", flush=True)
    print("="*65, flush=True)

    session_string = os.getenv('SESSION_STRING', '').strip()
    if session_string:
        tg_client = TelegramClient(StringSession(session_string), API_ID, API_HASH)
        await tg_client.connect()
    else:
        tg_client = TelegramClient('session_name', API_ID, API_HASH)
        await tg_client.connect()

    if not await tg_client.is_user_authorized():
        print("Error: Account not authorized.", flush=True)
        sys.exit(1)

    community_cfg = load_community_config()
    learning_id = community_cfg["learning_id"]
    learning_link = community_cfg["learning_link"]

    try:
        target_channel = await tg_client.get_entity(learning_id)
        print(f"[+] Master 'learning' library connected (ID: {target_channel.id})\n", flush=True)
    except Exception as e:
        print(f"Error fetching 'learning' channel: {e}", flush=True)
        await tg_client.disconnect()
        sys.exit(1)

    while True:
        cycle_start = datetime.now()
        tracker = load_tracker()
        print(f"\n🚀 [CYCLE START] Beginning scheduled refresh at {cycle_start.strftime('%Y-%m-%d %H:%M:%S')}...", flush=True)

        # 1. Harvest native streamable videos from Telegram channels
        await harvest_telegram_channels(tg_client, target_channel, tracker, learning_link)

        # 2. Process Mega queues with intelligent 509 quota handling
        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as session:
            mega_client = MegaNzClient(session=session)
            await mega_client.login()
            await harvest_mega_with_limit_handling(tg_client, target_channel, mega_client, tracker, learning_link)

        tracker["last_run"] = cycle_start.isoformat()
        save_tracker(tracker)

        next_run = cycle_start + timedelta(hours=CYCLE_INTERVAL_HOURS)
        print(f"\n✨ [CYCLE FINISHED] 'new upload learning' refreshed with streamable videos & descriptions!", flush=True)
        print(f"⏳ Next scheduled refresh will run at: {next_run.strftime('%Y-%m-%d %H:%M:%S')} (in 3 days).", flush=True)
        print(f"Sleeping until next scheduled window...", flush=True)

        await asyncio.sleep(CYCLE_INTERVAL_HOURS * 3600)

if __name__ == '__main__':
    asyncio.run(main())
