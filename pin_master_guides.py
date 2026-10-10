import asyncio
import os
import json
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession

load_dotenv()
API_ID = int(os.getenv('API_ID'))
API_HASH = os.getenv('API_HASH')
SESSION_STRING = os.getenv('SESSION_STRING', '')

def build_master_guide(cfg):
    TODAY_LINK = cfg.get("today_link", "https://t.me/+yOo23RcdbMJhYTU1")
    LEARNING_LINK = cfg.get("learning_link", "https://t.me/+TfOQpTVcZ6I2OTRl")
    YESTERDAY_LINK = cfg.get("yesterday_link", "https://t.me/+YmLMLYqH9GM0MjU1")
    GOAL_LINK = cfg.get("goal_link", "")

    goal_line = f"• [🎯 'goal to achieve' 6-Month Roadmap]({GOAL_LINK}) — Pinned Master Roadmap Dashboard (0–100%) & 6 Monthly Milestones.\n" if GOAL_LINK else ""

    return f"""🏛️ **TRADING MENTOR & LEARNING ECOSYSTEM — MASTER GUIDE** 🚀🎓

Welcome to your institutional trading academy and daily accountability system! Everything you need to achieve funded consistency is automated here 24/7.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 **THE 4-CHANNEL LEARNING ARCHITECTURE:**
{goal_line}• [📅 'today' Daily Classroom]({TODAY_LINK}) — Holds today's active lesson & streamable videos.
• [⏳ 'yesterday' Catch-Up Hub]({YESTERDAY_LINK}) — Missed lesson backlog with streak protection.
• [📚 'learning' Master Library]({LEARNING_LINK}) — Permanent archive with 1,149+ streamable courses.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 **1. 6-MONTH MASTER ROADMAP & MILESTONES:**
• The 6-Month Roadmap drives every single video posted to 'today':
  - Month 1: Naked Price Action & Market Structure (Days 1–20)
  - Month 2: Smart Money Concepts (SMC) & ICT Foundation (Days 21–40)
  - Month 3: Advanced Execution Models & Session Timing (Days 41–60)
  - Month 4: Auction Market Theory & Volume Profile (Days 61–80)
  - Month 5: Quantitative Playbook & 100-Trade Journal Backtesting (Days 81–100)
  - Month 6: Prop Firm Funded Evaluation ($50k–$100k) & Payouts (Days 101–120)
• `/goal` — Instant overview of roadmap progress bar & days remaining.
• `/milestone` — Detailed checklist of your active month's curriculum.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ **2. QUICK SERIAL VIDEO LOGGING (`/log`):**
Every video in 'today' is stamped with a serial number `[Video #1]`, `[Video #2]`, etc.
• `/log 1` — Log Video #1 (Daily Lesson), advances streak, and updates the pinned Dashboard in 'goal to achieve'!
• `/log 2` — Log Video #2 (Extra Video) and bank **`🛡️ +1 Buffer Day Ahead of Schedule`**!
• `/log 3` — Log Video #3 (Banks another Buffer Day)!
• `/log` — Displays active videos ready to log in 'today'.
• `/log 1 45 Notes here` — Log with custom study minutes and personal chart notes.
• *Or simply reply directly to any video with `[/watched]` or your notes!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ **3. HABIT STREAKS & BUFFER ACCELERATOR:**
• **Binge Studying:** Watching >1 video in a day banks Buffer Days (`🛡️ +X Days Ahead`).
• **Buffer Shield:** If you take a rest day, your Buffer Bank absorbs it automatically—protecting your streak!
• **Missed Days:** Lessons not watched automatically roll over to [⏳ 'yesterday']({YESTERDAY_LINK}). Replying with notes or `[/watched]` in 'yesterday' clears the backlog!

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 **4. AI TRADING TUTOR (`/ask` & `/tutor`):**
• **Ask Anything:** Send `/ask <question>` anywhere (e.g. `/ask How to confirm an order block before entering?`).
• **Video Thread Questions:** Reply directly to any video with a question (*"Why did price reverse here?"*); the AI analyzes the video context and explains the setup!
• **1-on-1 Coaching Mode:** Send `/tutor` in private chat with the bot to toggle continuous conversational mentorship (`/tutor off` to stop).

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 **5. VIDEO SEARCH & CURATED PLAYLISTS:**
• `/search ict` — Search 900+ library videos for ICT/SMC concepts.
• `/search order block` — Find Order Block & Order Flow masterclasses.
• `/search_send <query>` — Searches and forwards the top matching video directly to your chat!
• `/send <ID>` — Forwards any specific library video to your chat.
• `/playlist` — Browse curated strategy playlists (`ict`, `price_action`, `scalping`, `volume`, `algo`).

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 **6. QUICK TOUCH CONSOLE:**
• [/goal] — 6-Month Roadmap & live progress bar
• [/milestone] — Active monthly syllabus checklist
• [/today] — View today's lesson, schedule & notes
• [/stats] — Progress bar, hours logged, and streak metrics
• [/backlog] — Pacing audit & catch-up plan
• [/leach_5] — Bot leaches 5 fresh streamable videos into 'today'
• [/quiz] — Multiple-choice trading concept quiz
• [/menu] — Open the interactive touch console

✨ *Mastery is built one high-probability execution at a time!*
"""

async def pin_guides(client, cfg):
    guide = build_master_guide(cfg)

    for ch_name, key in [("today", "today_id"), ("learning", "learning_id"), ("yesterday", "yesterday_id")]:
        ch_id = cfg.get(key)
        if not ch_id:
            continue
        try:
            ch_entity = await client.get_entity(ch_id)
            msg = await client.send_message(ch_entity, guide, link_preview=False)
            await client.pin_message(ch_entity, msg.id, notify=False)
            print(f"[+] Pinned Master Guide in '{ch_name}' channel (Msg ID: {msg.id})")
        except Exception as e:
            print(f"[!] Error pinning in {ch_name}: {e}")

async def main():
    if not SESSION_STRING:
        print("[-] SESSION_STRING not found in .env")
        return

    with open("community_channels.json") as f:
        cfg = json.load(f)

    client = TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        print("[-] Client not authorized.")
        await client.disconnect()
        return

    await pin_guides(client, cfg)
    await client.disconnect()
    print("\n[+] Master Guide successfully updated and pinned across channels!")

if __name__ == '__main__':
    asyncio.run(main())
