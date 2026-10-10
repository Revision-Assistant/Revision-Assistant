import os
import sys
import json
import asyncio
from datetime import datetime, date, timedelta
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient, events
from telethon.sessions import StringSession

load_dotenv()
API_ID = int(os.getenv('API_ID'))
API_HASH = os.getenv('API_HASH')
BOT_TOKEN = os.getenv('BOT_TOKEN', '').strip()

PROGRESS_FILE = Path("user_progress.json")

# Complete 8-Week Structured Trading Curriculum (40 Daily Study Sessions)
CURRICULUM = {
    1: {
        "title": "Week 1: Foundations of Naked Price Action & Chart Reading",
        "days": [
            {
                "day": 1,
                "topic": "The Anatomy of Price Action & Market Flow",
                "course": "Nial Fuller / FOREX4NOOBS",
                "concepts": "Market cycles (Consolidation vs. Expansion), Highs & Lows, Stripping lagging indicators.",
                "exercise": "Open a Daily chart on EURUSD or Nifty 50. Mark the last 3 major swing highs and swing lows."
            },
            {
                "day": 2,
                "topic": "Support & Resistance Flips",
                "course": "Tradebysci Price Action Course",
                "concepts": "Prior resistance becoming new support, Horizontal vs. dynamic levels, Touch validation.",
                "exercise": "Find 2 instances where old resistance flipped into support on a 1-Hour chart."
            },
            {
                "day": 3,
                "topic": "Trendline Dynamics & Retests",
                "course": "Tradebysci & Nial Fuller",
                "concepts": "Drawing rule-based trendlines (at least 3 touches), valid break-and-retest patterns.",
                "exercise": "Draw an ascending trendline on a 4-Hour chart and identify the retest entry point."
            },
            {
                "day": 4,
                "topic": "Inside Bar Breakout Strategies",
                "course": "Nial Fuller Price Action",
                "concepts": "Inside Bar (Mother bar containment), volatility contraction, continuation triggers.",
                "exercise": "Identify an Inside Bar on the Daily chart and calculate breakout stop-loss placement."
            },
            {
                "day": 5,
                "topic": "Week 1 Review & Chart Auditing",
                "course": "Weekly Review",
                "concepts": "Synthesizing support/resistance flips, trendlines, and inside bars.",
                "exercise": "Create a trading watchlist of 3 assets with clean horizontal levels for next week."
            }
        ]
    },
    2: {
        "title": "Week 2: Advanced Candlestick Psychology & Reversals",
        "days": [
            {
                "day": 6,
                "topic": "Candlestick Anatomy & Liquidity Wicks",
                "course": "Candle King New Course (2025)",
                "concepts": "Wick-to-body ratios, rejection vs. exhaustion wicks, aggressive buyer/seller volume.",
                "exercise": "Find 3 candles with wicks at least 2x the body size at major daily support/resistance."
            },
            {
                "day": 7,
                "topic": "The Classic Pin Bar Strategy",
                "course": "Nial Fuller Price Action",
                "concepts": "Long-tailed pin bars, confluence with 21 EMA and horizontal levels, 50% retrace entry.",
                "exercise": "Measure a 50% Fibonacci retracement on a pin bar tail and set a limit entry on demo."
            },
            {
                "day": 8,
                "topic": "Fakey Pattern (False Breakouts)",
                "course": "Nial Fuller & Candle King",
                "concepts": "Trapped breakout traders, liquidity engineering, sharp rejection reversals.",
                "exercise": "Spot a false breakout of a key range high that closed back inside the range."
            },
            {
                "day": 9,
                "topic": "Multi-Candle Reversal Sequences",
                "course": "Candle King & FOREX4NOOBS",
                "concepts": "Engulfing bars, Morning/Evening Star patterns, momentum absorption.",
                "exercise": "Analyze an Engulfing bar on the 1-Hour chart and check if it took out previous liquidity."
            },
            {
                "day": 10,
                "topic": "Week 2 Review & Candlestick Quiz",
                "course": "Weekly Review",
                "concepts": "Combining pin bars, fakeys, and rejection wicks with key levels.",
                "exercise": "Take the /quiz command in the bot to test your pattern recognition."
            }
        ]
    },
    3: {
        "title": "Week 3: Market Structure & Auction Market Theory",
        "days": [
            {
                "day": 11,
                "topic": "Auction Market Theory Principles",
                "course": "Gova Trading Academy (GTA Professional)",
                "concepts": "Market purpose (facilitating trade), Balance vs. Imbalance, Price discovery.",
                "exercise": "Identify a 3-day balanced range and note the high-volume equilibrium price."
            },
            {
                "day": 12,
                "topic": "Multi-Timeframe Market Structure",
                "course": "Gova Trading Academy",
                "concepts": "Higher timeframe (HTF) trend vs. Lower timeframe (LTF) pullbacks, Break of Structure (BOS).",
                "exercise": "Mark 4-Hour trend direction, then drop to 15-Minute to spot pullbacks aligned with HTF."
            },
            {
                "day": 13,
                "topic": "Change of Character (CHoCH)",
                "course": "Gova Trading & Phantom Trading",
                "concepts": "First sign of trend shift, structural failure, internal vs. external CHoCH.",
                "exercise": "Find a CHoCH on the 15-minute timeframe following a 4-Hour support test."
            },
            {
                "day": 14,
                "topic": "Supply & Demand Zone Mapping",
                "course": "Gova Trading Academy",
                "concepts": "Fresh vs. tested zones, explosive departure candles, base consolidation.",
                "exercise": "Draw two fresh supply/demand zones on your chart that have not been re-tested yet."
            },
            {
                "day": 15,
                "topic": "Week 3 Practical Structure Audit",
                "course": "Weekly Review",
                "concepts": "Mapping full structure from Daily down to 15-minute chart.",
                "exercise": "Write down your HTF bias (Bullish/Bearish) for 2 currency pairs or indices."
            }
        ]
    },
    4: {
        "title": "Week 4: Smart Money Concepts (SMC) - Liquidity & Order Blocks",
        "days": [
            {
                "day": 16,
                "topic": "Institutional Liquidity Pools",
                "course": "Phantom Trading Mentorship (2022)",
                "concepts": "Buy-side liquidity (BSL) above equal highs, Sell-side liquidity (SSL) below equal lows.",
                "exercise": "Identify a double top or equal highs on a 1-Hour chart and mark the stop-loss cluster."
            },
            {
                "day": 17,
                "topic": "Liquidity Sweeps & Stop Hunts",
                "course": "Phantom Trading",
                "concepts": "Turtle Soup pattern, sweep and displace, liquidity collection before the true move.",
                "exercise": "Document a chart where price spiked above a major high by 5-10 pips and collapsed."
            },
            {
                "day": 18,
                "topic": "Institutional Order Blocks (OB)",
                "course": "Phantom Trading Mentorship",
                "concepts": "Valid OB criteria: Must create an imbalance (FVG) and break structure (BOS).",
                "exercise": "Find a pristine Bullish Order Block that broke a swing high with strong displacement."
            },
            {
                "day": 19,
                "topic": "Inducement & Minor Traps",
                "course": "Phantom Trading",
                "concepts": "Engineering liquidity before major zones, avoiding premature entries.",
                "exercise": "Locate an inducement high positioned right below an unmitigated supply zone."
            },
            {
                "day": 20,
                "topic": "Week 4 SMC Synthesis",
                "course": "Weekly Review",
                "concepts": "Liquidity sweep -> Displacement -> Order Block re-mitigation.",
                "exercise": "Backtest 5 historical SMC setups using TradingView bar replay."
            }
        ]
    },
    5: {
        "title": "Week 5: ICT Methodology - Fair Value Gaps & Timing",
        "days": [
            {
                "day": 21,
                "topic": "Fair Value Gaps (FVG) & Imbalances",
                "course": "ICT Complete Mentorship Repository",
                "concepts": "3-candle imbalance structure, Consequent Encroachment (50% of FVG), Rebalancing.",
                "exercise": "Measure a 50% midline of an FVG on the 15-minute chart and watch price react to it."
            },
            {
                "day": 22,
                "topic": "ICT Session Kill Zones",
                "course": "ICT Mentorship",
                "concepts": "London Open Kill Zone (02:00-05:00 EST), NY Open Kill Zone (07:00-10:00 EST).",
                "exercise": "Add session vertical lines to your chart and observe volatility expansion during NY Open."
            },
            {
                "day": 23,
                "topic": "The Judas Swing (London Trap)",
                "course": "ICT Mentorship",
                "concepts": "False move in pre-London session targeting Asian highs/lows before the true trend.",
                "exercise": "Identify an Asian range sweep followed by London session reversal."
            },
            {
                "day": 24,
                "topic": "Breaker Blocks & Mitigation Blocks",
                "course": "ICT Mentorship",
                "concepts": "Failed order blocks that become powerful support/resistance upon failure.",
                "exercise": "Find a Breaker Block where an old low was broken, swept, and flipped."
            },
            {
                "day": 25,
                "topic": "Week 5 ICT Trading Model Review",
                "course": "Weekly Review",
                "concepts": "Putting together Kill Zones, FVGs, and Liquidity targets.",
                "exercise": "Formulate your personal 1-page ICT trading checklist."
            }
        ]
    },
    6: {
        "title": "Week 6: Volume Profile & Footprint Execution",
        "days": [
            {
                "day": 26,
                "topic": "Volume Profile Foundations",
                "course": "Trader Dale Volume Profile Course",
                "concepts": "Point of Control (POC), Value Area High/Low (VAH/VAL), Volume vs. Time.",
                "exercise": "Plot a fixed range volume profile across a consolidation range and identify the POC."
            },
            {
                "day": 27,
                "topic": "High Volume Nodes vs. Low Volume Nodes",
                "course": "Trader Dale",
                "concepts": "HVN acting as magnetic price zones, LVN acting as rapid rejection areas.",
                "exercise": "Observe how quickly price slices through a Low Volume Node (LVN) on higher volume."
            },
            {
                "day": 28,
                "topic": "The Volume Accumulation Setup",
                "course": "Trader Dale",
                "concepts": "Heavy volume accumulation inside a tight range preceding a breakout re-test.",
                "exercise": "Set an alert at a strong POC level formed during a multi-hour accumulation."
            },
            {
                "day": 29,
                "topic": "Developing vs. Virgin POC Levels",
                "course": "Trader Dale & Tradepro Academy",
                "concepts": "Virgin POC (naked POC never revisited), high statistical re-test probability.",
                "exercise": "Find an unvisited Virgin POC from the previous week and mark it as a magnet target."
            },
            {
                "day": 30,
                "topic": "Week 6 Volume Profile Strategy Review",
                "course": "Weekly Review",
                "concepts": "Combining Price Action levels with Volume Profile POC confirmation.",
                "exercise": "Trade a demo setup using a POC confluence level."
            }
        ]
    },
    7: {
        "title": "Week 7: Depth of Market (DOM) & Order Flow Absorption",
        "days": [
            {
                "day": 31,
                "topic": "Depth of Market (DOM) Mechanics",
                "course": "Tradepro Academy - Futures Day Trading",
                "concepts": "Limit orders (liquidity providers) vs. Market orders (liquidity takers), Ladder reading.",
                "exercise": "Observe the DOM ladder during a news event or open to see bid/ask replenishment."
            },
            {
                "day": 32,
                "topic": "Delta Imbalance & Cumulative Delta (CVD)",
                "course": "Tradepro Academy & Gova Cluster Delta",
                "concepts": "Aggressive market buy vs. sell contracts, CVD trend divergences.",
                "exercise": "Spot a Delta Divergence: Price making a higher high while CVD makes a lower high."
            },
            {
                "day": 33,
                "topic": "Absorption at Key Institutional Extremes",
                "course": "Tradepro Academy Order Flow",
                "concepts": "Large market orders being soaked up by hidden passive limit orders without moving price.",
                "exercise": "Identify absorption at a major resistance level (high volume, zero upward progress)."
            },
            {
                "day": 34,
                "topic": "Footprint Cluster Delta Confirmations",
                "course": "Gova Trading Academy (Cluster Delta)",
                "concepts": "Footprint bar imbalance ratios (e.g. 300% bid/ask diagonal imbalance), Trapped traders.",
                "exercise": "Find trapped buyers at the top of a candle on a Footprint chart."
            },
            {
                "day": 35,
                "topic": "Week 7 Order Flow Integration",
                "course": "Weekly Review",
                "concepts": "Confirming SMC zones with Footprint Delta absorption.",
                "exercise": "Summarize how order flow removes guesswork from entry timing."
            }
        ]
    },
    8: {
        "title": "Week 8: Risk Management, Trading Psychology & Prop Evaluations",
        "days": [
            {
                "day": 36,
                "topic": "Strict Mathematical Risk Management",
                "course": "Photon Trading & Nial Fuller",
                "concepts": "The 1% Risk Rule, R-Multiples (1:2, 1:3), Asymmetric payoff profiles.",
                "exercise": "Calculate exact lot size for a $10,000 account with a 15-pip stop loss at 1% risk ($100)."
            },
            {
                "day": 37,
                "topic": "Drawdown Control & Passing Funded Prop Firms",
                "course": "Photon Trading - Zero To Funded",
                "concepts": "Trailing drawdowns, daily stop limit (stop trading after 2 consecutive losses), consistency.",
                "exercise": "Write down your maximum daily loss threshold and lock it in your rules."
            },
            {
                "day": 38,
                "topic": "Professional Trade Journaling & Analytics",
                "course": "Tradepro Academy (Review Course)",
                "concepts": "Documenting setup tag, RR, session, emotional state, and mistake attribution.",
                "exercise": "Create a Notion or Excel journal and log 3 recent trades with screenshots."
            },
            {
                "day": 39,
                "topic": "Trading Psychology & Emotional Discipline",
                "course": "Tradepro Academy (Trading Psychology)",
                "concepts": "FOMO, Revenge trading, Gambler's fallacy, Detachment from single trade outcomes.",
                "exercise": "Read the top 5 cognitive trading biases and identify your biggest personal pitfall."
            },
            {
                "day": 40,
                "topic": "Graduation: Your Comprehensive Trading Business Plan",
                "course": "Final Synthesis",
                "concepts": "Master Trading Plan: Timeframe, Sessions, Setup criteria, Risk rules, Routine.",
                "exercise": "Print or finalize your 1-page Trading Plan and commit to 30 days of disciplined execution!"
            }
        ]
    }
}

QUIZ_QUESTIONS = [
    {
        "q": "What is the primary characteristic of an institutional Order Block (OB)?",
        "options": [
            "A) It must have an RSI value below 30.",
            "B) It is the last opposing candle before an explosive move that breaks structure (BOS) and leaves an FVG.",
            "C) It is any pin bar on the 1-minute chart.",
            "D) It only occurs during the Asian session."
        ],
        "answer": "B",
        "explanation": "A valid institutional Order Block must cause a displacement that breaks market structure (BOS) and creates a Fair Value Gap (imbalance)."
    },
    {
        "q": "In Volume Profile analysis, what is the 'Point of Control' (POC)?",
        "options": [
            "A) The exact price level where the highest volume was traded during the selected period.",
            "B) The 50% Fibonacci retracement level.",
            "C) The highest price reached during the day.",
            "D) The opening price of the London Kill Zone."
        ],
        "answer": "A",
        "explanation": "POC (Point of Control) represents the single price level where the greatest volume was transacted, acting as a strong institutional magnet."
    },
    {
        "q": "What is an ICT 'Judas Swing'?",
        "options": [
            "A) A trailing stop-loss strategy.",
            "B) A false move in pre-session designed to engineer liquidity before the true session expansion begins.",
            "C) An indicator-based breakout crossover.",
            "D) When volume drops to zero during the weekend."
        ],
        "answer": "B",
        "explanation": "The Judas Swing is a deceptive pre-market or early-session move targeting retail stops before the true institutional trend unfolds."
    },
    {
        "q": "Why is Delta Divergence significant at key support/resistance levels?",
        "options": [
            "A) It proves the market is moving too fast.",
            "B) It indicates aggressive market orders are being absorbed by passive institutional limit orders, signaling a reversal.",
            "C) It means you should immediately double your position size.",
            "D) It only happens in cryptocurrency markets."
        ],
        "answer": "B",
        "explanation": "When price creates a new high/low but delta fails to confirm (or shows heavy opposite delta), it signals passive limit absorption and an impending reversal."
    }
]

def load_progress():
    today_str = date.today().isoformat()
    defaults = {
        "current_day": 1,
        "completed_days": [],
        "start_date": today_str,
        "last_completed_date": None,
        "streak": 0,
        "best_streak": 0,
        "total_study_minutes": 0,
        "notifications_enabled": True,
        "morning_hour": 8,
        "morning_min": 30,
        "evening_hour": 20,
        "evening_min": 30,
        "last_morning_notif": None,
        "last_evening_notif": None,
        "quiz_idx": 0
    }
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE, "r") as f:
                data = json.load(f)
                for k, v in defaults.items():
                    if k not in data:
                        data[k] = v
                return data
        except Exception:
            pass
    return defaults

def save_progress(data):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(data, f, indent=2)

def get_lesson_by_day(day_num):
    for week_num, w_data in CURRICULUM.items():
        for d in w_data["days"]:
            if d["day"] == day_num:
                return week_num, w_data["title"], d
    return None, None, None

def analyze_backlog(progress):
    start_date_str = progress.get("start_date")
    try:
        start_d = date.fromisoformat(start_date_str)
    except Exception:
        start_d = date.today()

    today_d = date.today()
    days_elapsed = (today_d - start_d).days + 1
    # Cap target day at 40
    target_day = min(days_elapsed, 40)
    current_day = progress.get("current_day", 1)
    completed_count = len(progress.get("completed_days", []))

    backlog = target_day - completed_count
    return {
        "target_day": target_day,
        "current_day": current_day,
        "completed_count": completed_count,
        "backlog": backlog,
        "days_elapsed": days_elapsed
    }

def format_today_message(progress):
    day = progress.get("current_day", 1)
    if day > 40:
        return (
            "🎉 **CONGRATULATIONS! YOU HAVE GRADUATED THE 8-WEEK TRADING MASTER CURRICULUM!** 🎉\n\n"
            "You have mastered Price Action, Candlestick Psychology, SMC, Volume Profile, and Order Flow.\n"
            "Use `/reset` if you would like to restart the study cycle."
        )

    week_num, week_title, lesson = get_lesson_by_day(day)
    if not lesson:
        return "No lesson found for today."

    streak = progress.get("streak", 0)
    streak_badge = f"🔥 Streak: **{streak} days**" if streak > 0 else "🌱 Start your streak today!"

    msg = (
        f"📅 **TODAY'S SCHEDULE — DAY {day}/40** ({streak_badge})\n"
        f"🏆 **{week_title}**\n\n"
        f"📖 **Topic:** {lesson['topic']}\n"
        f"🎓 **Source Course:** `{lesson['course']}`\n\n"
        f"🔍 **Key Concepts to Master:**\n"
        f"• {lesson['concepts']}\n\n"
        f"📝 **Practical Chart Exercise:**\n"
        f"👉 {lesson['exercise']}\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"⏱️ Need a personalized routine? Try `/suggest 30` or `/suggest 60`\n"
        f"✅ Finished? Send `/complete` to record your progress and keep your streak!"
    )
    return msg

def format_backlog(progress):
    b = analyze_backlog(progress)
    backlog_count = b["backlog"]

    if backlog_count <= 0:
        status_text = "🟢 **ON TRACK!** You are completely up to date with your curriculum."
        recovery_plan = "Keep up the momentum! Send `/today` to tackle your next lesson."
    elif backlog_count <= 2:
        status_text = f"🟡 **MINOR BACKLOG:** You are **{backlog_count} day(s) behind** schedule."
        recovery_plan = (
            f"💡 **Recovery Plan:** Complete 1 lesson today and 1 extra lesson this weekend "
            f"to return to full pace within 3 days."
        )
    else:
        status_text = f"🔴 **HIGH BACKLOG:** You are **{backlog_count} days behind** schedule."
        recovery_plan = (
            f"💡 **Recovery Catch-Up Sprint:**\n"
            f"• Use `/suggest 20` to complete quick high-yield sprint sessions.\n"
            f"• Aim to complete **1.5 to 2 lessons per day** over the next week to clear your backlog."
        )

    msg = (
        f"📈 **BACKLOG & PACING ANALYSIS**\n\n"
        f"• **Days Since Starting:** {b['days_elapsed']} day(s)\n"
        f"• **Target Completed Lessons:** Day {b['target_day']}\n"
        f"• **Actual Completed Lessons:** {b['completed_count']}/40\n"
        f"• **Status:** {status_text}\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"{recovery_plan}\n\n"
        f"⚡ *Log your study time using* `/log <minutes>` *(e.g. `/log 45`)*"
    )
    return msg

def format_suggest(minutes, progress):
    day = progress.get("current_day", 1)
    week_num, week_title, lesson = get_lesson_by_day(day)
    if not lesson:
        return "You have completed all lessons! Send `/reset` to restart."

    if minutes <= 20:
        mode = "⚡ **SPRINT MODE (15–20 Mins)**"
        plan = (
            "1. **5 Mins:** Read the core concepts: *" + lesson['concepts'] + "*\n"
            "2. **10 Mins:** Watch 1 video clip in your `learning` channel for *" + lesson['topic'] + "*.\n"
            "3. **5 Mins:** Identify 1 quick screenshot on TradingView matching the setup.\n"
            "4. Send `/complete` and `/log 20`."
        )
    elif minutes <= 45:
        mode = "🎯 **STANDARD FOCUS (30–45 Mins)**"
        plan = (
            "1. **15 Mins:** Watch the complete lesson in `learning` on *" + lesson['topic'] + "*.\n"
            "2. **15 Mins:** Execute the practical exercise:\n"
            "   👉 *" + lesson['exercise'] + "*\n"
            "3. **10 Mins:** Save 2 clean chart annotations to your journal.\n"
            "4. Send `/complete` and `/log 40`."
        )
    else:
        mode = "🧠 **DEEP IMMERSION (60+ Mins)**"
        plan = (
            "1. **25 Mins:** Full video module breakdown + take structured notes.\n"
            "2. **20 Mins:** Historical bar-replay backtesting on TradingView (test at least 5 setups).\n"
            "3. **15 Mins:** Live market markup on 3 different pairs/indices.\n"
            "4. **5 Mins:** Test your retention with `/quiz`.\n"
            "5. Send `/complete` and `/log 60`."
        )

    msg = (
        f"{mode}\n"
        f"📅 **Custom Routine for Day {day}:** *{lesson['topic']}*\n\n"
        f"{plan}\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🔥 *Focus is your ultimate market edge!*"
    )
    return msg

def format_stats(progress):
    completed = len(progress.get("completed_days", []))
    total = 40
    pct = int((completed / total) * 100)
    bars = int(pct / 10)
    bar_str = "█" * bars + "░" * (10 - bars)
    cur_day = progress.get("current_day", 1)
    streak = progress.get("streak", 0)
    best_streak = progress.get("best_streak", 0)
    total_mins = progress.get("total_study_minutes", 0)
    hours = total_mins // 60
    mins = total_mins % 60

    b = analyze_backlog(progress)
    backlog_str = "🟢 On Track" if b["backlog"] <= 0 else f"🟡 {b['backlog']} Days Behind"

    # Estimated graduation
    remaining_days = max(40 - completed, 0)
    est_date = date.today() + timedelta(days=remaining_days)

    msg = (
        f"📊 **YOUR COMPLETE TRADING STUDY DASHBOARD**\n\n"
        f"🏆 **Overall Progress:** `[{bar_str}]` **{pct}%**\n"
        f"• **Lessons Completed:** {completed}/{total}\n"
        f"• **Current Active Day:** Day {cur_day}\n\n"
        f"🔥 **Streaks & Habits:**\n"
        f"• **Current Streak:** {streak} days in a row\n"
        f"• **All-Time Best Streak:** {best_streak} days\n\n"
        f"⏱️ **Total Time Invested:**\n"
        f"• **{hours} hrs {mins} mins** logged\n\n"
        f"📅 **Pacing & Schedule:**\n"
        f"• **Backlog Status:** {backlog_str}\n"
        f"• **Target Graduation Date:** {est_date.strftime('%B %d, %Y')}\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💡 *Commands:* `/today` | `/suggest 30` | `/backlog` | `/log 45` | `/quiz`"
    )
    return msg

async def notification_daemon(client):
    """
    Background loop that sends morning study briefing and evening backlog nudge.
    """
    print("[+] Background Notification Engine active.", flush=True)
    while True:
        try:
            now = datetime.now()
            today_str = date.today().isoformat()
            progress = load_progress()

            if progress.get("notifications_enabled", True):
                # 1. Morning Daily Briefing (08:30 AM)
                m_h = progress.get("morning_hour", 8)
                m_m = progress.get("morning_min", 30)
                if now.hour == m_h and now.minute == m_m and progress.get("last_morning_notif") != today_str:
                    msg = (
                        "☀️ **GOOD MORNING! TIME FOR YOUR DAILY TRADING SESSION** 📈\n\n"
                        + format_today_message(progress)
                    )
                    try:
                        await client.send_message('me', msg)
                        progress["last_morning_notif"] = today_str
                        save_progress(progress)
                        print(f"[Notif] Sent morning briefing for {today_str}", flush=True)
                    except Exception as e:
                        print(f"[Notif Error] Morning: {e}", flush=True)

                # 2. Evening Check-in & Backlog Nudge (20:30 PM)
                e_h = progress.get("evening_hour", 20)
                e_m = progress.get("evening_min", 30)
                if now.hour == e_h and now.minute == e_m and progress.get("last_evening_notif") != today_str:
                    cur_day = progress.get("current_day", 1)
                    if cur_day not in progress.get("completed_days", []):
                        b_info = analyze_backlog(progress)
                        msg = (
                            f"🌙 **EVENING CHECK-IN — DON'T BREAK YOUR STREAK!** 🔥\n\n"
                            f"You haven't completed **Day {cur_day}** yet today.\n"
                            f"Take 15–20 minutes tonight to keep your momentum going!\n\n"
                            f"👉 Send `/suggest 20` for a fast 20-minute evening session,\n"
                            f"or send `/complete` if you already finished your chart study."
                        )
                        try:
                            await client.send_message('me', msg)
                            progress["last_evening_notif"] = today_str
                            save_progress(progress)
                            print(f"[Notif] Sent evening check-in for {today_str}", flush=True)
                        except Exception as e:
                            print(f"[Notif Error] Evening: {e}", flush=True)

            await asyncio.sleep(40) # Check every 40 seconds
        except Exception as err:
            print(f"[Daemon Exception]: {err}", flush=True)
            await asyncio.sleep(60)

async def main():
    sys.stdout.reconfigure(line_buffering=True)
    if sys.stdout.encoding != 'utf-8':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except AttributeError:
            pass

    print("[+] Starting Enhanced Trading Mentor Bot service...", flush=True)

    session_string = os.getenv('SESSION_STRING', '').strip()
    if BOT_TOKEN:
        print("[+] Running as Dedicated Telegram Bot via BOT_TOKEN...", flush=True)
        client = TelegramClient('bot_session', API_ID, API_HASH).start(bot_token=BOT_TOKEN)
    elif session_string:
        print("[+] Running as Cloud Assistant Bot via SESSION_STRING...", flush=True)
        client = TelegramClient(StringSession(session_string), API_ID, API_HASH)
        await client.connect()
    else:
        print("[+] Running as Personal Assistant Bot on your account...", flush=True)
        client = TelegramClient('session_name', API_ID, API_HASH)
        await client.connect()
        if not await client.is_user_authorized():
            print("Error: Account not authorized.", flush=True)
            sys.exit(1)

    me = await client.get_me()
    print(f"[+] Bot active as: {getattr(me, 'first_name', '')} (@{getattr(me, 'username', 'N/A')})", flush=True)

    # Start Background Notification Daemon
    asyncio.create_task(notification_daemon(client))

    @client.on(events.NewMessage(pattern=r'^/(start|help)$'))
    async def handle_start(event):
        help_text = (
            "🤖 **WELCOME TO YOUR ADVANCED TRADING MENTOR BOT!** 📈\n\n"
            "I will track your learning progress, analyze backlogs, trigger smart study notifications, "
            "and suggest custom daily routines based on your available time.\n\n"
            "📌 **Core Commands:**\n"
            "• `/today` or `/schedule` – Today's lesson & chart assignment\n"
            "• `/suggest <mins>` – Custom plan for your available time (e.g. `/suggest 30`)\n"
            "• `/complete` – Mark lesson finished & increment streak\n"
            "• `/backlog` – Analyze your study pace vs. target schedule\n"
            "• `/stats` – View streaks, hours logged & progress bar\n"
            "• `/log <mins>` – Log study time (e.g. `/log 45`)\n"
            "• `/roadmap` – View full 8-week curriculum breakdown\n"
            "• `/week <1-8>` – View daily plan for any week\n"
            "• `/quiz` – Test your knowledge with a trading quiz\n"
            "• `/remind <on|off|test>` – Control automated daily notifications\n"
            "• `/links` – Direct access to all Google Drive masterclasses\n"
            "• `/reset` – Restart schedule from Day 1\n\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "🚀 *Send* `/today` *or* `/suggest 30` *to begin!*"
        )
        await event.respond(help_text)

    @client.on(events.NewMessage(pattern=r'^/(today|schedule)$'))
    async def handle_today(event):
        progress = load_progress()
        await event.respond(format_today_message(progress))

    @client.on(events.NewMessage(pattern=r'^/suggest(?:\s+(\d+))?$'))
    async def handle_suggest(event):
        mins_str = event.pattern_match.group(1)
        mins = int(mins_str) if mins_str else 30
        progress = load_progress()
        await event.respond(format_suggest(mins, progress))

    @client.on(events.NewMessage(pattern=r'^/backlog$'))
    async def handle_backlog(event):
        progress = load_progress()
        await event.respond(format_backlog(progress))

    @client.on(events.NewMessage(pattern=r'^/stats$'))
    async def handle_stats(event):
        progress = load_progress()
        await event.respond(format_stats(progress))

    @client.on(events.NewMessage(pattern=r'^/log(?:\s+(\d+))?$'))
    async def handle_log(event):
        mins_str = event.pattern_match.group(1)
        if not mins_str:
            await event.respond("⚠️ Please specify minutes studied. Example: `/log 45`")
            return
        mins = int(mins_str)
        progress = load_progress()
        progress["total_study_minutes"] = progress.get("total_study_minutes", 0) + mins
        save_progress(progress)
        total_h = progress["total_study_minutes"] // 60
        total_m = progress["total_study_minutes"] % 60
        await event.respond(
            f"⏱️ **LOGGED {mins} MINUTES OF STUDY TIME!** 👏\n\n"
            f"• **Total Time Invested:** {total_h} hrs {total_m} mins\n"
            f"Send `/stats` to view your updated dashboard."
        )

    @client.on(events.NewMessage(pattern=r'^/complete$'))
    async def handle_complete(event):
        progress = load_progress()
        cur_day = progress.get("current_day", 1)
        today_str = date.today().isoformat()
        last_date = progress.get("last_completed_date")

        # Update streak
        if last_date:
            try:
                last_d = date.fromisoformat(last_date)
                delta = (date.today() - last_d).days
                if delta == 1:
                    progress["streak"] = progress.get("streak", 0) + 1
                elif delta > 1:
                    progress["streak"] = 1
            except Exception:
                progress["streak"] = 1
        else:
            progress["streak"] = 1

        progress["best_streak"] = max(progress.get("best_streak", 0), progress["streak"])
        progress["last_completed_date"] = today_str

        if cur_day not in progress.get("completed_days", []):
            progress.setdefault("completed_days", []).append(cur_day)

        progress["current_day"] = cur_day + 1
        save_progress(progress)

        await event.respond(
            f"🎉 **DAY {cur_day} MARKED AS COMPLETED!**\n\n"
            f"🔥 **Current Streak:** {progress['streak']} days in a row!\n"
            f"🏆 **Next Lesson:** Day {cur_day + 1}\n\n"
            f"Send `/today` to preview tomorrow's study topic, or `/stats` for full analytics!"
        )

    @client.on(events.NewMessage(pattern=r'^(?:/(?:watched|done)|watched|done)(?:\s+(\d+))?$'))
    async def handle_watched(event):
        mins_str = event.pattern_match.group(1)
        mins = int(mins_str) if mins_str else 30
        
        reply_msg = await event.get_reply_message()
        video_title = ""
        if reply_msg:
            if reply_msg.file and reply_msg.file.name:
                video_title = reply_msg.file.name
            elif reply_msg.message:
                video_title = reply_msg.message.splitlines()[0][:50]
        
        progress = load_progress()
        cur_day = progress.get("current_day", 1)
        today_str = date.today().isoformat()
        last_date = progress.get("last_completed_date")

        # Update streak
        if last_date:
            try:
                last_d = date.fromisoformat(last_date)
                delta = (date.today() - last_d).days
                if delta == 1:
                    progress["streak"] = progress.get("streak", 0) + 1
                elif delta > 1:
                    progress["streak"] = 1
            except Exception:
                progress["streak"] = 1
        else:
            progress["streak"] = 1

        progress["best_streak"] = max(progress.get("best_streak", 0), progress["streak"])
        progress["last_completed_date"] = today_str
        progress["total_study_minutes"] = progress.get("total_study_minutes", 0) + mins

        if cur_day not in progress.get("completed_days", []):
            progress.setdefault("completed_days", []).append(cur_day)

        progress["current_day"] = cur_day + 1
        save_progress(progress)

        target_note = f"for **{video_title}** " if video_title else ""
        total_h = progress["total_study_minutes"] // 60
        total_m = progress["total_study_minutes"] % 60

        await event.respond(
            f"🎬 **VIDEO WATCH LOGGED {target_note}!** 👏\n\n"
            f"• **Session Time Logged:** +{mins} mins\n"
            f"• **Total Time Invested:** {total_h} hrs {total_m} mins\n"
            f"• **Day {cur_day} Completed!** 🔥 Streak: **{progress['streak']} days**\n"
            f"• **Advanced To:** Day {cur_day + 1}\n\n"
            f"Send `/today` to preview your next lesson, or `/stats` for full analytics!"
        )

    @client.on(events.NewMessage(pattern=r'^/remind(?:\s+(on|off|test))?$'))
    async def handle_remind(event):
        action = event.pattern_match.group(1)
        progress = load_progress()
        if not action or action == 'test':
            # Send immediate test notification
            test_msg = (
                "🔔 **TEST NOTIFICATION TRIGGERED!**\n\n"
                "Your automated notification engine is running perfectly!\n"
                f"• Morning Daily Briefing: **{progress.get('morning_hour', 8):02d}:{progress.get('morning_min', 30):02d} AM**\n"
                f"• Evening Backlog Alert: **{progress.get('evening_hour', 20):02d}:{progress.get('evening_min', 30):02d} PM**\n\n"
                "Send `/remind off` to disable or `/remind on` to enable."
            )
            await event.respond(test_msg)
        elif action == 'on':
            progress["notifications_enabled"] = True
            save_progress(progress)
            await event.respond("🔔 **Notifications Enabled!** You will receive morning briefings and evening check-ins.")
        elif action == 'off':
            progress["notifications_enabled"] = False
            save_progress(progress)
            await event.respond("🔕 **Notifications Disabled.** You can re-enable anytime with `/remind on`.")

    @client.on(events.NewMessage(pattern=r'^/roadmap$'))
    async def handle_roadmap(event):
        msg = "🗺️ **8-WEEK TRADING CURRICULUM ROADMAP**\n\n"
        for w_num, w_data in CURRICULUM.items():
            days_range = f"Days {w_data['days'][0]['day']}–{w_data['days'][-1]['day']}"
            msg += f"• **Week {w_num} ({days_range}):** {w_data['title'].replace(f'Week {w_num}: ', '')}\n"
        msg += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nSend `/week <1-8>` for daily breakdowns or `/today` for your active lesson!"
        await event.respond(msg)

    @client.on(events.NewMessage(pattern=r'^/week(?:\s+(\d+))?$'))
    async def handle_week(event):
        match = event.pattern_match.group(1)
        if not match or int(match) not in CURRICULUM:
            await event.respond("⚠️ Please specify a week number from 1 to 8. Example: `/week 2`")
            return

        w_num = int(match)
        w_data = CURRICULUM[w_num]
        msg = f"📅 **{w_data['title']}**\n\n"
        for d in w_data["days"]:
            msg += (
                f"🔹 **Day {d['day']}: {d['topic']}**\n"
                f"   • *Course:* `{d['course']}`\n"
                f"   • *Concepts:* {d['concepts']}\n"
                f"   • *Task:* {d['exercise']}\n\n"
            )
        msg += "━━━━━━━━━━━━━━━━━━━━━━━━━━━\nSend `/today` to work on your current lesson!"
        await event.respond(msg)

    @client.on(events.NewMessage(pattern=r'^/quiz$'))
    async def handle_quiz(event):
        progress = load_progress()
        q_idx = progress.get("quiz_idx", 0) % len(QUIZ_QUESTIONS)
        q_data = QUIZ_QUESTIONS[q_idx]
        progress["quiz_idx"] = q_idx + 1
        save_progress(progress)

        opts_text = "\n".join(q_data["options"])
        msg = (
            f"🧠 **TRADING QUIZ CHALLENGE #{q_idx + 1}**\n\n"
            f"❓ **Question:**\n{q_data['q']}\n\n"
            f"{opts_text}\n\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"||**Correct Answer:** {q_data['answer']}\n"
            f"💡 **Explanation:** {q_data['explanation']}||"
        )
        await event.respond(msg)

    @client.on(events.NewMessage(pattern=r'^/links$'))
    async def handle_links(event):
        msg = (
            "📂 **DIRECT NON-MEGA COURSE ACCESS:**\n\n"
            "• 🕯️ [Candle King 2025 (Candlestick)](https://drive.google.com/drive/folders/1TW8vzuWlOwnpYkPOQ5zBo65biW7Fhjx2)\n"
            "• 📊 [Gova Trading Academy (Price Action)](https://drive.google.com/drive/folders/1zCglrhs0qqg0jWRZGu5_YkRfmIwVzKNo)\n"
            "• 🏛️ [Phantom Trading Mentorship (SMC)](https://drive.google.com/drive/folders/1fJne9loYHS608c562a9x-8RsmbO8TwSh?usp=sharing)\n"
            "• 🚀 [Photon Trading (Zero To Funded)](https://drive.google.com/drive/folders/1TCrxmsXLmBZ1U7W7GxvqCnYrlns30XAP)\n"
            "• 🧠 [ICT Complete Repository](https://drive.google.com/drive/folders/1R_zqEVNVI5o4Zmy5V5Z9D4LxN5gX20mL)\n"
            "• 🎯 [Precision Markets (Scalping)](https://drive.google.com/drive/folders/1DtCsbC0adPONd7utJqUkdfiNsImS772p?usp=sharing)\n"
            "• 💻 [Python for Finance (Udemy)](https://drive.google.com/drive/u/0/folders/1T4FMqAmZ1KfK_f8TsdZdHREEG8Z6U8Nl)\n"
        )
        await event.respond(msg)

    @client.on(events.NewMessage(pattern=r'^/reset$'))
    async def handle_reset(event):
        today_str = date.today().isoformat()
        save_progress({
            "current_day": 1,
            "completed_days": [],
            "start_date": today_str,
            "last_completed_date": None,
            "streak": 0,
            "best_streak": 0,
            "total_study_minutes": 0,
            "notifications_enabled": True,
            "quiz_idx": 0
        })
        await event.respond("🔄 Your study schedule has been reset back to **Day 1**! Send `/today` to begin.")

    print("[+] Enhanced Trading Mentor Bot is listening for commands...", flush=True)
    await client.run_until_disconnected()

if __name__ == '__main__':
    asyncio.run(main())
