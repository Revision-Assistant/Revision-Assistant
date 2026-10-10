import asyncio
import os
import json
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

async def main():
    client = TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH)
    await client.connect()
    ch = await client.get_entity(TODAY_ID)

    # 1. Video #1 (Day 1 Lesson)
    cap_1 = (
        "🎬 **[Video #1] TODAY'S ACTIVE LESSON — DAY 1/40** 🚀\n"
        "🏆 **Week 1: Foundations of Naked Price Action & Chart Reading**\n\n"
        "📖 **Topic:** The Anatomy of Price Action & Market Flow\n"
        "🎓 **Source Course:** `Nial Fuller / FOREX4NOOBS`\n\n"
        "🔍 **Key Concepts to Master:**\n"
        "• Market cycles (Consolidation vs. Expansion), Highs & Lows, Stripping lagging indicators.\n\n"
        "📝 **Practical Chart Exercise:**\n"
        "👉 Open a Daily chart on EURUSD or Nifty 50. Mark the last 3 major swing highs and swing lows.\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "⚡ **QUICK SERIAL LOGGING:**\n"
        "👉 Send: `/log 1` (or `/log 1 <notes>`)\n"
        "• Or reply to this video with `[/watched]`\n"
        "• Not watching today? Tap: `[/not_watched]` (moves to 'yesterday')\n\n"
        "👉 **Actions:** [/log 1] | [/watched] | [/not_watched] | [/stats] | [/menu]"
    )
    try:
        await client.edit_message(ch, 18, cap_1)
        print("[+] Updated Caption for [Video #1] (Msg ID: 18)")
    except Exception as e:
        print(f"[!] Note on msg 18: {e}")

    # 2. Video #2 (TheAlchemistFX)
    cap_2 = (
        "🎬 **[Video #2] TheAlchemistFX Malaysian SnR 1on1 Session** 🚀\n"
        "📢 **Source:** @forex_ict_smc\n"
        "🏷️ **Topics:** #SupportResistance #PriceAction #MalaysianSnR\n\n"
        "📖 **Summary:** Masterclass on Malaysian Support & Resistance key levels, breakout confirmation, and order flow.\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "⚡ **QUICK SERIAL LOGGING:**\n"
        "👉 Send: `/log 2` (or `/log 2 <notes>`)\n"
        "🛡️ Watching this extra video banks **+1 Buffer Day** ahead of schedule!\n\n"
        "👉 **Actions:** [/log 2] | [/watched] | [/today] | [/menu]"
    )
    try:
        await client.edit_message(ch, 9, cap_2)
        print("[+] Updated Caption for [Video #2] (Msg ID: 9)")
    except Exception as e:
        print(f"[!] Note on msg 9: {e}")

    # 3. Video #3 (GMT Recording)
    cap_3 = (
        "🎬 **[Video #3] Institutional Liquidity & Execution Recording** 🚀\n"
        "📢 **Source:** @forex_ict_smc\n"
        "🏷️ **Topics:** #SmartMoneyConcepts #LiquiditySweeps #OrderBlocks\n\n"
        "📖 **Summary:** Live chart breakdown analyzing institutional stop-hunts, fair value gaps, and entry models.\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "⚡ **QUICK SERIAL LOGGING:**\n"
        "👉 Send: `/log 3` (or `/log 3 <notes>`)\n"
        "🛡️ Watching this extra video banks **+1 Buffer Day** ahead of schedule!\n\n"
        "👉 **Actions:** [/log 3] | [/watched] | [/today] | [/menu]"
    )
    try:
        await client.edit_message(ch, 10, cap_3)
        print("[+] Updated Caption for [Video #3] (Msg ID: 10)")
    except Exception as e:
        print(f"[!] Note on msg 10: {e}")

    # 4. Video #4 (Session 2 Gaps)
    cap_4 = (
        "🎬 **[Video #4] Session 2: Fair Value Gaps & Imbalances** 🚀\n"
        "📢 **Source:** @forex_ict_smc\n"
        "🏷️ **Topics:** #FVG #Imbalances #InstitutionalFlow\n\n"
        "📖 **Summary:** Complete session covering identifying, validating, and trading Fair Value Gaps (FVGs) and price imbalances.\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "⚡ **QUICK SERIAL LOGGING:**\n"
        "👉 Send: `/log 4` (or `/log 4 <notes>`)\n"
        "🛡️ Watching this extra video banks **+1 Buffer Day** ahead of schedule!\n\n"
        "👉 **Actions:** [/log 4] | [/watched] | [/today] | [/menu]"
    )
    try:
        await client.edit_message(ch, 11, cap_4)
        print("[+] Updated Caption for [Video #4] (Msg ID: 11)")
    except Exception as e:
        print(f"[!] Note on msg 11: {e}")

    # 5. Video #5 (Session 1 SnR)
    cap_5 = (
        "🎬 **[Video #5] Session 1: Precision Support & Resistance Mapping** 🚀\n"
        "📢 **Source:** @forex_ict_smc\n"
        "🏷️ **Topics:** #KeyLevels #SnR #MarketStructure\n\n"
        "📖 **Summary:** Foundational session on identifying institutional high-probability support and resistance zones.\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "⚡ **QUICK SERIAL LOGGING:**\n"
        "👉 Send: `/log 5` (or `/log 5 <notes>`)\n"
        "🛡️ Watching this extra video banks **+1 Buffer Day** ahead of schedule!\n\n"
        "👉 **Actions:** [/log 5] | [/watched] | [/today] | [/menu]"
    )
    try:
        await client.edit_message(ch, 12, cap_5)
        print("[+] Updated Caption for [Video #5] (Msg ID: 12)")
    except Exception as e:
        print(f"[!] Note on msg 12: {e}")

    # 6. Video #6 (Algo Trading Course)
    cap_6 = (
        "🎬 **[Video #6] Algorithmic Trading & Execution Framework** 🚀\n"
        "📢 **Source:** @forex_ict_smc\n"
        "🏷️ **Topics:** #AlgoTrading #QuantitativeRules #ExecutionTiming\n\n"
        "📖 **Summary:** Algorithmic architecture, rule-based execution discipline, and backtesting methodology.\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "⚡ **QUICK SERIAL LOGGING:**\n"
        "👉 Send: `/log 6` (or `/log 6 <notes>`)\n"
        "🛡️ Watching this extra video banks **+1 Buffer Day** ahead of schedule!\n\n"
        "👉 **Actions:** [/log 6] | [/watched] | [/today] | [/menu]"
    )
    try:
        await client.edit_message(ch, 13, cap_6)
        print("[+] Updated Caption for [Video #6] (Msg ID: 13)")
    except Exception as e:
        print(f"[!] Note on msg 13: {e}")

    await client.disconnect()
    print("[+] All captions updated with serial numbers & quick log instructions!")

if __name__ == '__main__':
    asyncio.run(main())
