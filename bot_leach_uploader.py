import asyncio
import os
import json
import re
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import DocumentAttributeVideo

load_dotenv()
API_ID = int(os.getenv('API_ID'))
API_HASH = os.getenv('API_HASH')
SESSION_STRING = os.getenv('SESSION_STRING')

with open("community_channels.json") as f:
    cfg = json.load(f)

TODAY_ID = cfg["today_id"]
LEARNING_ID = cfg["learning_id"]

CHANNELS_TO_LEACH = [
    "ICT_CAPITAL",
    "ICT_GOAT",
    "forexcourse1234",
    "forex_ict_smc",
    "Price_Action_Courses",
    "Hunt_The_Chart_(SMC)",
    "Forex_Course_Free",
    "Smart_Money_Courses"
]

def is_strictly_streamable_video(msg):
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

def generate_leach_caption(raw_title, channel_name, serial_num, text=""):
    clean_title = raw_title.replace("_", " ").replace("-", " ")
    clean_title = re.sub(r'\[.*?\]', '', clean_title).strip()
    if not clean_title or len(clean_title) < 4:
        clean_title = "High-Probability Market Setup & Structure"

    tags = []
    text_lower = (clean_title + " " + text).lower()
    if any(k in text_lower for k in ["candle", "candlestick"]):
        tags.append("#CandlestickPatterns")
    if any(k in text_lower for k in ["chart", "charting"]):
        tags.append("#ChartAnalysis")
    if any(k in text_lower for k in ["smc", "ict", "order block", "liquidity", "fvg"]):
        tags.append("#SmartMoneyConcepts")
    if any(k in text_lower for k in ["scalp", "intraday"]):
        tags.append("#Scalping")
    if not tags:
        tags = ["#PriceAction", "#TradingStrategy"]

    tags_str = " ".join(tags)

    return (
        f"🎬 **[Video #{serial_num}] {clean_title}** 🚀\n"
        f"📢 **Source:** @{channel_name}\n"
        f"🏷️ **Topics:** {tags_str}\n\n"
        f"📖 **Summary:** Practical high-probability trading breakdown covering institutional order flow, "
        f"liquidity engineering, and execution timing.\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"⚡ **QUICK SERIAL LOGGING:**\n"
        f"👉 Send: `/log {serial_num}` (or `/log {serial_num} <notes>`)\n"
        f"🛡️ Watching this extra video banks **+1 Buffer Day** ahead of schedule!\n\n"
        f"👉 **Actions:** [/log {serial_num}] | [/watched] | [/today] | [/menu]"
    )

async def leach_5_videos(client, target_channel_id):
    target_channel = await client.get_entity(target_channel_id)
    print(f"[+] Connected to destination channel: {getattr(target_channel, 'title', target_channel_id)}")
    
    tracker_file = "leached_tracker.json"
    tracked = []
    if os.path.exists(tracker_file):
        try:
            with open(tracker_file) as f:
                tracked = json.load(f)
        except Exception:
            pass

    progress_file = Path("user_progress.json")
    progress = {}
    if progress_file.exists():
        try:
            with open(progress_file) as pf:
                progress = json.load(pf)
        except Exception:
            pass

    serials_dict = progress.get("today_serials", {})
    existing_serials = [int(k) for k in serials_dict.keys() if str(k).isdigit()]
    current_max_serial = max(existing_serials) if existing_serials else 1

    uploaded_count = 0
    print("[+] Searching source channels to leach 5 streamable trading videos...")

    for ch in CHANNELS_TO_LEACH:
        if uploaded_count >= 5:
            break
        print(f"  -> Scanning @{ch}...")
        try:
            entity = await client.get_entity(ch)
            async for msg in client.iter_messages(entity, limit=50):
                if not is_strictly_streamable_video(msg):
                    continue

                msg_key = f"{ch}_{msg.id}"
                if msg_key in tracked:
                    continue

                title = ""
                if msg.file and msg.file.name:
                    title = msg.file.name
                elif msg.message:
                    title = msg.message.splitlines()[0][:60]
                else:
                    title = f"Trading Lesson from {ch}"

                current_max_serial += 1
                serial_num = current_max_serial
                caption = generate_leach_caption(title, ch, serial_num, msg.message or "")

                print(f"     [Leaching {uploaded_count+1}/5] Uploading [Video #{serial_num}] '{title[:40]}' to channel...")
                uploaded_msg = await client.send_file(
                    target_channel,
                    msg.media,
                    caption=caption,
                    supports_streaming=True
                )
                tracked.append(msg_key)
                uploaded_count += 1

                # Register in today_serials
                serials_dict[str(serial_num)] = {
                    "msg_id": uploaded_msg.id,
                    "title": title[:60],
                    "type": "extra"
                }

                await asyncio.sleep(0.8)
                if uploaded_count >= 5:
                    break
        except Exception as e:
            print(f"     ⚠️ Access note on @{ch}: {e}")

    with open(tracker_file, "w") as f:
        json.dump(tracked, f, indent=2)

    progress["today_serials"] = serials_dict
    with open(progress_file, "w") as pf:
        json.dump(progress, pf, indent=2)

    print(f"\n[+] Successfully leached and uploaded {uploaded_count} streamable videos with serial numbers!")
    return uploaded_count

async def main():
    client = TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH)
    await client.connect()
    print("[+] Bot authenticated. Initiating 5 streamable video leach...")
    await leach_5_videos(client, TODAY_ID)
    await client.disconnect()

if __name__ == '__main__':
    asyncio.run(main())
