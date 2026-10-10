import asyncio
import os
import json
from dotenv import load_dotenv
from telethon import TelegramClient

load_dotenv()
API_ID = int(os.getenv('API_ID'))
API_HASH = os.getenv('API_HASH')

with open("community_channels.json", "r") as f:
    cfg = json.load(f)

TODAY_ID = cfg["today_id"]
LEARNING_LINK = cfg["learning_link"]
YESTERDAY_LINK = cfg.get("yesterday_link", "")

PIN_GUIDE = f"""📅 **WELCOME TO YOUR DAILY STUDY CHANNEL ('today')** 🎓🚀

This channel is your dedicated daily classroom. Every day, your personal Trading Mentor Bot posts the exact lesson video you need to study for the day, along with its core concept breakdown and practical chart exercise.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 **HOW TO LOG WHAT YOU STUDIED TODAY:**
1. Watch today's active lesson video below.
2. Reply directly to the video with:
   • Your key takeaways & notes (e.g., *"Understood how price sweeps buy-side liquidity before reversing at the order block"*)
   • OR simply reply with `[/watched]` (or `[/watched 45]` to log 45 minutes).
3. The bot instantly:
   ✅ Records your topic, time, and notes to your daily study journal.
   🔥 Increments your habit streak!
   🛡️ **Buffer Accelerator:** If you study more than 1 lesson in a day, the bot automatically posts the next lesson video and banks a +1 Buffer Day ahead of schedule!

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 **CONNECTED CHANNELS:**
• [📚 Core 'learning' Master Library]({LEARNING_LINK})
• [⏳ Catch-Up 'yesterday' Hub]({YESTERDAY_LINK})

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 **MENTOR TOUCH COMMANDS:**
• [/today] — View today's lesson & active progress
• [/stats] — Check your habit streak & buffer bank
• [/menu] — Open your interactive control console

✨ *Mastery is built one day at a time!*
"""

async def main():
    client = TelegramClient('session_name', API_ID, API_HASH)
    await client.connect()
    channel = await client.get_entity(TODAY_ID)
    msg = await client.send_message(channel, PIN_GUIDE, link_preview=False)
    await client.pin_message(channel, msg.id, notify=True)
    print(f"[+] Pinned Clean Master Guide in 'today' channel (Message ID: {msg.id})")
    await client.disconnect()

if __name__ == '__main__':
    asyncio.run(main())
