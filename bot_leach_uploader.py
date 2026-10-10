import asyncio
import os
import json
import re
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession

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
    "Forex_Course_Free"
]

KEYWORDS = [
    "chart", "candlestick", "candle", "intraday", "scalping", 
    "price action", "smc", "ict", "order block", "liquidity", "fvg"
]

def generate_leach_caption(raw_title, channel_name, text=""):
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
        f"🎬 **{clean_title}** 🚀\n"
        f"📢 **Source:** @{channel_name}\n"
        f"🏷️ **Topics:** {tags_str}\n\n"
        f"📖 **Summary:** Practical high-probability trading breakdown covering institutional order flow, "
        f"liquidity engineering, and execution timing.\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📝 **Log Study:** Reply with your key takeaways or `[/watched]`\n"
        f"👉 **Actions:** [/watched] | [/not_watched] | [/today] | [/menu]"
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

    uploaded_count = 0
    print("[+] Searching source channels to leach 5 high-quality trading videos...")

    for ch in CHANNELS_TO_LEACH:
        if uploaded_count >= 5:
            break
        print(f"  -> Scanning @{ch}...")
        try:
            entity = await client.get_entity(ch)
            async for msg in client.iter_messages(entity, limit=40):
                is_video = bool(msg.video or (msg.media and hasattr(msg.media, 'document') and getattr(msg.media.document, 'mime_type', '').startswith('video/')))
                if not is_video:
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

                caption = generate_leach_caption(title, ch, msg.message or "")

                print(f"     [Leaching {uploaded_count+1}/5] Uploading '{title[:40]}' to channel...")
                await client.send_file(
                    target_channel,
                    msg.media,
                    caption=caption,
                    supports_streaming=True
                )
                tracked.append(msg_key)
                uploaded_count += 1
                await asyncio.sleep(1.0)
                if uploaded_count >= 5:
                    break
        except Exception as e:
            print(f"     ⚠️ Access note on @{ch}: {e}")

    with open(tracker_file, "w") as f:
        json.dump(tracked, f, indent=2)

    print(f"\n[+] Successfully leached and uploaded {uploaded_count} videos into the channel!")
    return uploaded_count

async def main():
    client = TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH)
    await client.connect()
    print("[+] Bot authenticated. Initiating 5-video leach...")
    # Upload 5 leached videos to 'today' so the user has immediate access to watch them!
    await leach_5_videos(client, TODAY_ID)
    await client.disconnect()

if __name__ == '__main__':
    asyncio.run(main())
