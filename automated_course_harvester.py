import os
import sys
import json
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import DocumentAttributeVideo

load_dotenv()
API_ID = int(os.getenv('API_ID'))
API_HASH = os.getenv('API_HASH')

TRACKER_FILE = Path("harvested_tracker.json")

# Core Channels to Monitor
CHANNELS_TO_MONITOR = [
    "ICT_CAPITAL",
    "ICT_GOAT",
    "cursos_trading_rank",
    "forexcourse1234",
    "trading_videos_courses_stock_4",
    "forex_ict_smc",
    "Trading_Tuts",
    "Forexfreecourses1",
    "free_tradingcourse_s",
    "Price_Action_Courses",
    "Hunt_The_Chart_(SMC)",
    "Forex_Course_Free",
    "Smart_Money_Courses",
    "The_Indian_Trader_Free_Courses",
    "Technical_Analysis_Stock_Market",
    "TRADING_TUTORIALS",
    "BANKNIFTY_STOCK_MARKET",
    "ICT_leaked_courses",
    "FOREX_ICT_SMC_free_courses"
]

KEYWORDS = [
    "chart", "charting", "candlestick", "candle", "intraday", 
    "scalping", "scalp", "price action", "smc", "ict", "order block", 
    "liquidity", "fvg", "breakout", "volume profile", "mentorship", "strategy"
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
    return {"harvested_messages": [], "last_run": None}

def save_tracker(data):
    with open(TRACKER_FILE, "w") as f:
        json.dump(data, f, indent=2)

def is_strictly_streamable_video(msg):
    """
    Returns True ONLY if the message contains a native, streamable video.
    Filters out PDFs, ZIP archives, generic docs, images, and audio.
    """
    if not msg:
        return False
    if msg.video:
        return True
    if hasattr(msg, 'media') and hasattr(msg.media, 'document'):
        doc = msg.media.document
        mime = getattr(doc, 'mime_type', '').lower()
        if mime.startswith('video/'):
            for attr in getattr(doc, 'attributes', []):
                if isinstance(attr, DocumentAttributeVideo):
                    return True
    return False

async def harvest_single_channel_turbo(client, ch_name, entity, target_channel, tracker, sem):
    """
    Scans a channel and forwards strictly streamable video batches at maximum throughput.
    """
    async with sem:
        total_channel_harvested = 0
        try:
            print(f"⚡ [Turbo Stream] Scanning @{ch_name} for streamable videos...", flush=True)
            batch = []
            keys_batch = []

            # Deep scan up to 500 messages
            async for msg in client.iter_messages(entity, limit=500):
                msg_key = f"{ch_name}_{msg.id}"
                if msg_key in tracker.get("harvested_messages", []):
                    continue

                if not is_strictly_streamable_video(msg):
                    continue

                text = (msg.message or "").lower()
                matches = any(k in text for k in KEYWORDS)
                if matches or len(text) < 50:
                    batch.append(msg.id)
                    keys_batch.append(msg_key)

                    # Maximum throughput batch: 25 streamable videos per API call
                    if len(batch) >= 25:
                        try:
                            await client.forward_messages(target_channel, batch, entity)
                            tracker.setdefault("harvested_messages", []).extend(keys_batch)
                            total_channel_harvested += len(batch)
                            print(f"  🚀 [Turbo Batch] Forwarded {len(batch)} streamable videos from @{ch_name} (Channel Total: {total_channel_harvested})", flush=True)
                            save_tracker(tracker)
                            batch = []
                            keys_batch = []
                            await asyncio.sleep(0.1)
                        except Exception:
                            for bid, bkey in zip(batch, keys_batch):
                                try:
                                    await client.forward_messages(target_channel, bid, entity)
                                    tracker.setdefault("harvested_messages", []).append(bkey)
                                    total_channel_harvested += 1
                                    await asyncio.sleep(0.05)
                                except Exception:
                                    pass
                            save_tracker(tracker)
                            batch = []
                            keys_batch = []

            # Forward remaining in final batch
            if batch:
                try:
                    await client.forward_messages(target_channel, batch, entity)
                    tracker.setdefault("harvested_messages", []).extend(keys_batch)
                    total_channel_harvested += len(batch)
                    print(f"  🚀 [Final Batch] Forwarded {len(batch)} streamable videos from @{ch_name} (Channel Total: {total_channel_harvested})", flush=True)
                    save_tracker(tracker)
                except Exception:
                    for bid, bkey in zip(batch, keys_batch):
                        try:
                            await client.forward_messages(target_channel, bid, entity)
                            tracker.setdefault("harvested_messages", []).append(bkey)
                            total_channel_harvested += 1
                            await asyncio.sleep(0.05)
                        except Exception:
                            pass
                    save_tracker(tracker)

        except Exception as e:
            print(f"  ⚠️ Access note on @{ch_name}: {e}", flush=True)

        return total_channel_harvested

async def main():
    sys.stdout.reconfigure(line_buffering=True)
    if sys.stdout.encoding != 'utf-8':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except AttributeError:
            pass

    print("="*65, flush=True)
    print("🚀 TURBO-SPEED STREAMABLE VIDEO HARVESTER BOT ACTIVE", flush=True)
    print("⚡ Mode: Streamable-Only Filter | Concurrency: 6 Channels | Batch: 25", flush=True)
    print("="*65, flush=True)

    session_string = os.getenv('SESSION_STRING', '').strip()
    if not session_string:
        print("[-] SESSION_STRING missing in .env", flush=True)
        sys.exit(1)

    tg_client = TelegramClient(StringSession(session_string), API_ID, API_HASH)
    await tg_client.connect()

    if not await tg_client.is_user_authorized():
        print("[-] Telegram user not authorized.", flush=True)
        await tg_client.disconnect()
        sys.exit(1)

    community_cfg = load_community_config()
    learning_id = community_cfg["learning_id"]

    try:
        target_channel = await tg_client.get_entity(learning_id)
        print(f"[+] Master 'learning' library connected (ID: {target_channel.id})\n", flush=True)
    except Exception as e:
        print(f"[!] Error accessing learning channel: {e}", flush=True)
        await tg_client.disconnect()
        sys.exit(1)

    # 6 parallel channels simultaneously for maximum rate
    sem = asyncio.Semaphore(6)

    while True:
        try:
            cycle_start = datetime.now()
            tracker = load_tracker()
            print(f"\n⚡ [TURBO CYCLE START] Scanning channels at {cycle_start.strftime('%Y-%m-%d %H:%M:%S')}...", flush=True)

            all_targets = []
            for ch_name in CHANNELS_TO_MONITOR:
                try:
                    ent = await tg_client.get_entity(ch_name)
                    all_targets.append((ch_name, ent))
                except Exception:
                    pass

            try:
                async for d in tg_client.iter_dialogs():
                    if d.is_channel or d.is_group:
                        t_lower = d.name.lower()
                        if any(k in t_lower for k in ["trading", "forex", "crypto", "stock", "course", "ict", "smc", "price action"]):
                            if "learning" not in t_lower and "today" not in t_lower and "yesterday" not in t_lower:
                                ch_title = d.name.replace(" ", "_")
                                if not any(t[0] == ch_title for t in all_targets):
                                    all_targets.append((ch_title, d.entity))
            except Exception:
                pass

            print(f"[+] Found {len(all_targets)} source channels. Launching parallel batch stream...", flush=True)

            tasks = [
                harvest_single_channel_turbo(tg_client, ch_name, entity, target_channel, tracker, sem)
                for ch_name, entity in all_targets
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            total_new = sum(r for r in results if isinstance(r, int))
            tracker["last_run"] = cycle_start.isoformat()
            save_tracker(tracker)

            print(f"\n🎉 [PASS COMPLETE] Added {total_new} streamable videos in this pass!", flush=True)
            print(f"⏳ Sleeping 15 seconds before next scan pass...\n", flush=True)
            await asyncio.sleep(15)

        except Exception as cycle_err:
            print(f"[!] Harvester cycle notice: {cycle_err}. Reconnecting in 10s...", flush=True)
            await asyncio.sleep(10)
            try:
                if not tg_client.is_connected():
                    await tg_client.connect()
            except Exception:
                pass

if __name__ == '__main__':
    asyncio.run(main())
