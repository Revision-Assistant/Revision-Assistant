import os
import sys
import json
import asyncio
from datetime import datetime, date, timedelta
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient, events
from telethon.sessions import StringSession
import aiohttp
from aiohttp import web
from trading_ai_tutor import ask_trading_tutor
from video_search_engine import search_learning_videos, get_curated_playlist, PLAYLIST_TOPICS
from automated_course_harvester import run_autonomous_turbo_harvester
from goal_roadmap_engine import (
    render_master_dashboard,
    render_phase_post,
    get_current_phase,
    get_lesson_for_day
)
import daily_topic_curator as dtc

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

def load_community_config():
    cfg_file = Path("community_channels.json")
    cfg = {
        "learning_id": -1004300323085,
        "learning_link": "https://t.me/+TfOQpTVcZ6I2OTRl",
        "today_id": -1004450794887,
        "today_link": "https://t.me/+yOo23RcdbMJhYTU1",
        "yesterday_id": -1004425765502,
        "yesterday_link": "https://t.me/+YmLMLYqH9GM0MjU1"
    }
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                loaded = json.load(f)
                for k in ["learning_id", "today_id", "yesterday_id"]:
                    val = loaded.get(k)
                    if val:
                        if not str(val).startswith("-100"):
                            loaded[k] = int(f"-100{val}")
                        else:
                            loaded[k] = int(val)
                cfg.update(loaded)
        except Exception:
            pass
    return cfg

def get_catalog_video(day_num):
    cat_file = Path("learning_video_catalog.json")
    if cat_file.exists():
        try:
            with open(cat_file, "r") as f:
                vids = json.load(f)
                if vids:
                    idx = (day_num - 1) % len(vids)
                    return vids[idx]
        except Exception:
            pass
    return None

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
        "buffer_days": 0,
        "daily_journal": {},
        "backlog_items": [],
        "today_posted_day": None,
        "today_msg_id": None,
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
    return get_lesson_for_day(day_num)

async def sync_goal_dashboard_message(client, progress):
    cfg = load_community_config()
    goal_id = cfg.get("goal_id")
    dash_msg_id = cfg.get("goal_dashboard_msg_id")
    if not goal_id or not dash_msg_id:
        return
    try:
        goal_entity = await client.get_entity(goal_id)
        dash_text = render_master_dashboard(progress, cfg)
        await client.edit_message(goal_entity, dash_msg_id, dash_text, link_preview=False)
        print(f"[Goal Sync] Edited Master Dashboard in 'goal to achieve' (Msg {dash_msg_id})", flush=True)
    except Exception as e:
        if "MessageNotModified" in type(e).__name__:
            pass
        else:
            print(f"[Goal Sync Error]: {e}", flush=True)

def analyze_backlog(progress):
    start_date_str = progress.get("start_date")
    try:
        start_d = date.fromisoformat(start_date_str)
    except Exception:
        start_d = date.today()

    today_d = date.today()
    days_elapsed = (today_d - start_d).days + 1
    target_day = min(days_elapsed, 120)
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

async def post_today_lesson(client, progress):
    cfg = load_community_config()
    today_id = cfg.get("today_id")
    learning_id = cfg.get("learning_id")
    if not today_id:
        return None

    cur_day = progress.get("current_day", 1)
    if cur_day > 120:
        return None

    today_serials = progress.get("today_serials", {})
    # Check if already active in today with all 10 videos
    if progress.get("today_posted_day") == cur_day and len(today_serials) >= 10:
        return progress.get("today_msg_id")

    phase = get_current_phase(cur_day)
    curated_vids = dtc.get_curated_10_videos(cur_day)
    if not curated_vids:
        return None

    try:
        today_channel = await client.get_entity(today_id)
        learning_channel = await client.get_entity(learning_id) if learning_id else None

        primary_msg_id = None
        newly_posted = 0

        # Scan today_channel in case videos are already present
        if len(today_serials) < 10:
            try:
                async for m in client.iter_messages(today_channel, limit=25):
                    text = m.message or ""
                    match = re.search(r'\[Video #(\d+)\]', text)
                    if match:
                        s_found = match.group(1)
                        if s_found not in today_serials:
                            lines = text.splitlines()
                            v_title = lines[0] if lines else f"Video #{s_found}"
                            v_title = re.sub(r'[*_#`🎬🚀]', '', v_title).strip()
                            today_serials[s_found] = {
                                "msg_id": m.id,
                                "title": v_title,
                                "type": "curriculum" if s_found == "1" else "topic_deepdive",
                                "day": cur_day
                            }
                            if s_found == "1":
                                primary_msg_id = m.id
            except Exception as se:
                print(f"[!] Today channel scan note: {se}", flush=True)

        if len(today_serials) >= 10:
            progress["today_posted_day"] = cur_day
            progress["today_msg_id"] = today_serials.get("1", {}).get("msg_id", progress.get("today_msg_id"))
            progress["today_serials"] = today_serials
            save_progress(progress)
            return progress["today_msg_id"]

        for v in curated_vids:
            s_num = v["serial"]
            s_key = str(s_num)

            # If already present for cur_day, retain
            if s_key in today_serials and today_serials[s_key].get("day") == cur_day:
                if s_num == 1:
                    primary_msg_id = today_serials[s_key].get("msg_id")
                continue

            src_msg_id = v["msg_id"]
            source_media = None
            if learning_channel and src_msg_id:
                try:
                    src_msg = await client.get_messages(learning_channel, ids=src_msg_id)
                    if src_msg and src_msg.media:
                        source_media = src_msg.media
                except Exception as me:
                    print(f"[!] Source media note for serial {s_num}: {me}", flush=True)

            caption = dtc.format_video_caption(cur_day, v, phase["title"])

            if source_media:
                msg = await client.send_file(
                    today_channel,
                    source_media,
                    caption=caption,
                    supports_streaming=True
                )
            else:
                msg = await client.send_message(today_channel, caption)

            today_serials[s_key] = {
                "msg_id": msg.id,
                "title": v["title"],
                "type": "curriculum" if s_num == 1 else "topic_deepdive",
                "day": cur_day
            }
            newly_posted += 1

            if s_num == 1:
                primary_msg_id = msg.id
                try:
                    await client.pin_message(today_channel, msg.id, notify=False)
                except Exception:
                    pass

            await asyncio.sleep(0.8)

        progress["today_posted_day"] = cur_day
        progress["today_msg_id"] = primary_msg_id or progress.get("today_msg_id")
        progress["today_serials"] = today_serials
        save_progress(progress)
        print(f"[+] Posted/updated 10 daily videos for Day {cur_day} in 'today' channel ({newly_posted} newly sent)", flush=True)
        return progress["today_msg_id"]

    except Exception as e:
        print(f"[!] Error posting today's 10 videos: {e}", flush=True)
        return None

async def move_today_to_yesterday(client, progress, reason="manual"):
    cfg = load_community_config()
    today_id = cfg.get("today_id")
    yesterday_id = cfg.get("yesterday_id")
    today_link = cfg.get("today_link", "")

    if not today_id or not yesterday_id:
        return False

    posted_day = progress.get("today_posted_day", progress.get("current_day", 1))
    today_msg_id = progress.get("today_msg_id")

    week_num, week_title, lesson = get_lesson_by_day(posted_day)
    if not lesson:
        return False

    try:
        today_channel = await client.get_entity(today_id)
        yesterday_channel = await client.get_entity(yesterday_id)

        source_media = None
        if today_msg_id:
            try:
                t_msg = await client.get_messages(today_channel, ids=today_msg_id)
                if t_msg and t_msg.media:
                    source_media = t_msg.media
            except Exception:
                pass

        if not source_media:
            v_info = get_catalog_video(posted_day)
            learning_channel = await client.get_entity(cfg.get("learning_id"))
            if learning_channel and v_info:
                try:
                    src_msg = await client.get_messages(learning_channel, ids=v_info["id"])
                    if src_msg and src_msg.media:
                        source_media = src_msg.media
                except Exception:
                    pass

        y_caption = (
            f"⏳ **MISSED LESSON — DAY {posted_day}/40** (Catch-Up Backlog)\n"
            f"🏆 **{week_title}**\n\n"
            f"📖 **Topic:** {lesson['topic']}\n"
            f"🎓 **Source Course:** `{lesson['course']}`\n\n"
            f"🔍 **Key Concepts:**\n"
            f"• {lesson['concepts']}\n\n"
            f"📝 **Practical Chart Exercise:**\n"
            f"👉 {lesson['exercise']}\n\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🔄 **CATCH-UP INSTRUCTIONS:**\n"
            f"Reply to this video with your notes or `[/watched]` to clear this backlog item & protect your streak!\n\n"
            f"👉 Tap: [/watched] | [📅 Return to Active 'today']({today_link})"
        )

        if source_media:
            y_msg = await client.send_file(
                yesterday_channel,
                source_media,
                caption=y_caption,
                supports_streaming=True
            )
        else:
            y_msg = await client.send_message(yesterday_channel, y_caption)

        # Delete from 'today' so it is completely clean
        if today_msg_id:
            try:
                await client.delete_messages(today_channel, [today_msg_id])
            except Exception:
                pass

        today_str = date.today().isoformat()
        progress.setdefault("backlog_items", []).append({
            "day": posted_day,
            "topic": lesson["topic"],
            "yesterday_msg_id": y_msg.id,
            "moved_date": today_str
        })

        progress["current_day"] = posted_day + 1
        progress["today_posted_day"] = None
        progress["today_msg_id"] = None
        save_progress(progress)

        print(f"[+] Moved Day {posted_day} to 'yesterday' catch-up channel (Msg ID: {y_msg.id})", flush=True)

        # Post next lesson into 'today'
        await post_today_lesson(client, progress)
        return True

    except Exception as e:
        print(f"[!] Error moving to yesterday: {e}", flush=True)
        return False

async def complete_active_lesson(client, minutes=30, user_notes=""):
    progress = load_progress()
    cur_day = progress.get("current_day", 1)
    week_num, week_title, lesson = get_lesson_by_day(cur_day)
    topic_str = lesson["topic"] if lesson else f"Lesson {cur_day}"

    today_str = date.today().isoformat()
    last_date = progress.get("last_completed_date")

    already_done_today = any(
        j.get("date") == today_str for j in progress.get("daily_journal", {}).values()
    )
    is_buffer_hit = already_done_today

    if is_buffer_hit:
        progress["buffer_days"] = progress.get("buffer_days", 0) + 1
    else:
        if last_date:
            try:
                last_d = date.fromisoformat(last_date)
                delta = (date.today() - last_d).days
                if delta == 1:
                    progress["streak"] = progress.get("streak", 0) + 1
                elif delta > 1:
                    gap = delta - 1
                    cur_buf = progress.get("buffer_days", 0)
                    if cur_buf >= gap:
                        progress["buffer_days"] -= gap
                        progress["streak"] = progress.get("streak", 0) + 1
                    else:
                        progress["buffer_days"] = 0
                        progress["streak"] = 1
            except Exception:
                progress["streak"] = 1
        else:
            progress["streak"] = 1

    progress["best_streak"] = max(progress.get("best_streak", 0), progress["streak"])
    progress["last_completed_date"] = today_str
    progress["total_study_minutes"] = progress.get("total_study_minutes", 0) + minutes

    if cur_day not in progress.get("completed_days", []):
        progress.setdefault("completed_days", []).append(cur_day)

    journal_entry = {
        "day": cur_day,
        "topic": topic_str,
        "date": today_str,
        "minutes": minutes,
        "notes": user_notes if user_notes else "Completed lesson & chart study"
    }
    progress.setdefault("daily_journal", {})[f"day_{cur_day}"] = journal_entry

    cfg = load_community_config()
    today_id = cfg.get("today_id")
    if today_id and progress.get("today_msg_id"):
        try:
            today_channel = await client.get_entity(today_id)
            await client.unpin_message(today_channel, progress["today_msg_id"])
        except Exception:
            pass

    progress["current_day"] = cur_day + 1
    progress["today_posted_day"] = None
    progress["today_msg_id"] = None
    progress["today_serials"] = {}
    progress["completed_serials"] = []
    save_progress(progress)

    # Post next lesson immediately so user can binge-study!
    await post_today_lesson(client, progress)
    await sync_goal_dashboard_message(client, progress)

    total_h = progress["total_study_minutes"] // 60
    total_m = progress["total_study_minutes"] % 60
    streak_val = progress["streak"]
    buf_val = progress.get("buffer_days", 0)

    buf_banner = f"\n\n🛡️ **BUFFER ACCELERATOR ACTIVATED!** +1 Buffer Day banked!\nYou are now **{buf_val} day(s) ahead of schedule!**" if is_buffer_hit else ""

    response_text = (
        f"🎉 **DAY {cur_day} MARKED AS COMPLETED!** 👏\n"
        f"📖 **Topic:** {topic_str}\n"
        f"📝 **Journal Notes:** *{journal_entry['notes']}*\n\n"
        f"• **Session Time Logged:** +{minutes} mins\n"
        f"• **Total Time Invested:** {total_h} hrs {total_m} mins\n"
        f"🔥 **Current Streak:** {streak_val} days in a row!"
        f"{buf_banner}\n\n"
        f"🏆 **Next Lesson Unlocked:** Day {cur_day + 1} is now ready in [today]({cfg.get('today_link', '')})!\n\n"
        f"👉 **Actions:** [/today] | [/stats] | [/menu]"
    )
    return response_text

async def complete_catchup_lesson(client, msg_id, minutes=30, user_notes=""):
    progress = load_progress()
    backlog_items = progress.get("backlog_items", [])
    matched_item = None
    for item in backlog_items:
        if item.get("yesterday_msg_id") == msg_id:
            matched_item = item
            break

    day_num = matched_item["day"] if matched_item else None
    topic_str = matched_item["topic"] if matched_item else "Catch-Up Lesson"

    today_str = date.today().isoformat()
    progress["total_study_minutes"] = progress.get("total_study_minutes", 0) + minutes

    if day_num and day_num not in progress.get("completed_days", []):
        progress.setdefault("completed_days", []).append(day_num)

    if matched_item:
        progress["backlog_items"].remove(matched_item)

    progress.setdefault("daily_journal", {})[f"day_{day_num if day_num else 'catchup'}"] = {
        "day": day_num,
        "topic": topic_str,
        "date": today_str,
        "minutes": minutes,
        "notes": user_notes if user_notes else "Catch-up study completed"
    }
    save_progress(progress)
    await sync_goal_dashboard_message(client, progress)

    cfg = load_community_config()
    yesterday_id = cfg.get("yesterday_id")
    if yesterday_id and msg_id:
        try:
            y_channel = await client.get_entity(yesterday_id)
            y_msg = await client.get_messages(y_channel, ids=msg_id)
            if y_msg and y_msg.message:
                new_text = y_msg.message + f"\n\n✅ **COMPLETED CATCH-UP** (Logged {today_str})"
                await client.edit_message(y_channel, msg_id, new_text)
        except Exception:
            pass

    rem_backlog = len(progress.get("backlog_items", []))
    status_str = f"Remaining Backlog in 'yesterday': **{rem_backlog} lesson(s)**" if rem_backlog > 0 else "🟢 **All catch-up lessons cleared!**"

    response_text = (
        f"🎉 **CATCH-UP LESSON COMPLETED!** 👏\n"
        f"📖 **Topic:** {topic_str}\n"
        f"📝 **Journal Notes:** *{user_notes if user_notes else 'Completed catch-up study'}*\n\n"
        f"🔥 **Streak Protected!** Momentum maintained!\n"
        f"• {status_str}\n\n"
        f"👉 Tap: [📅 Return to 'today']({cfg.get('today_link', '')}) | [/today] | [/menu]"
    )
    return response_text

def format_today_message(progress):
    day = progress.get("current_day", 1)
    if day > 120:
        return (
            "🎉 **CONGRATULATIONS! YOU HAVE GRADUATED THE 6-MONTH MASTER TRADING ROADMAP!** 🏆\n\n"
            "You have completed all 120 Sessions across Price Action, SMC, Session Execution, Volume Profile, Playbook Edge, and Prop Firm Funding!\n"
            "Use `/reset` if you would like to restart the study cycle."
        )

    week_num, week_title, lesson = get_lesson_by_day(day)
    if not lesson:
        return "No lesson found for today."

    phase = get_current_phase(day)
    streak = progress.get("streak", 0)
    streak_badge = f"🔥 Streak: **{streak} days**" if streak > 0 else "🌱 Start your streak today!"
    buf = progress.get("buffer_days", 0)
    buf_badge = f" | 🛡️ Buffer: **+{buf} days ahead**" if buf > 0 else ""

    cfg = load_community_config()
    today_link = cfg.get("today_link", "")
    yesterday_link = cfg.get("yesterday_link", "")
    goal_link = cfg.get("goal_link", "")
    goal_str = f"\n🎯 **Roadmap Target:** [{phase['title']}]({goal_link})\n" if goal_link else f"\n🎯 **Roadmap Target:** {phase['title']}\n"

    today_str = date.today().isoformat()
    journal = progress.get("daily_journal", {})
    today_entries = [j for j in journal.values() if j.get("date") == today_str]
    today_log_str = ""
    if today_entries:
        today_log_str = "\n📝 **Logged Today:**\n" + "\n".join([f"• Day {e.get('day')}: *{e.get('notes')}* ({e.get('minutes')}m)" for e in today_entries]) + "\n"

    b_items = progress.get("backlog_items", [])
    backlog_str = ""
    if b_items:
        backlog_str = f"\n⏳ **Catch-Up Backlog:** [{len(b_items)} Missed Lesson(s) in 'yesterday']({yesterday_link})\n"

    msg = (
        f"📅 **TODAY'S SCHEDULE — DAY {day}/120** ({streak_badge}{buf_badge})\n"
        f"🏆 **{phase['title']}**\n"
        f"📌 **{week_title}**\n\n"
        f"📖 **Topic:** {lesson['topic']}\n"
        f"🎓 **Source Course:** `{lesson['course']}`\n\n"
        f"🔍 **Key Concepts to Master:**\n"
        f"• {lesson['concepts']}\n\n"
        f"📝 **Practical Chart Exercise:**\n"
        f"👉 {lesson['exercise']}\n"
        f"{goal_str}"
        f"{today_log_str}"
        f"{backlog_str}\n"
        f"🎬 **Watch Video in 'today':** [Tap Here to Watch Lesson]({today_link})\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👉 **Actions:** [/log 1] | [/goal] | [/milestone] | [/ask] | [/not_watched] | [/menu]"
    )
    return msg

def format_backlog(progress):
    b = analyze_backlog(progress)
    backlog_count = b["backlog"]
    cfg = load_community_config()
    yesterday_link = cfg.get("yesterday_link", "")
    b_items = progress.get("backlog_items", [])

    if backlog_count <= 0 and not b_items:
        status_text = "🟢 **ON TRACK!** You are completely up to date with your curriculum."
        recovery_plan = "Keep up the momentum! Send `/today` to tackle your next lesson."
    else:
        status_text = f"🟡 **CATCH-UP PENDING:** You have **{max(backlog_count, len(b_items))} lesson(s) in backlog**."
        recovery_plan = (
            f"💡 **Catch-Up Hub:**\n"
            f"👉 [Click here to open 'yesterday' and clear missed lessons]({yesterday_link})\n"
            f"Watch and log them to restore your streak!"
        )

    msg = (
        f"📈 **BACKLOG & PACING ANALYSIS**\n\n"
        f"• **Days Since Starting:** {b['days_elapsed']} day(s)\n"
        f"• **Target Completed Lessons:** Day {b['target_day']}\n"
        f"• **Actual Completed Lessons:** {b['completed_count']}/40\n"
        f"• **Buffer Bank:** {progress.get('buffer_days', 0)} days ahead\n"
        f"• **Missed in 'yesterday':** {len(b_items)} lesson(s)\n"
        f"• **Status:** {status_text}\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"{recovery_plan}\n\n"
        f"👉 **Actions:** [/today] | [/suggest_20] | [/stats] | [/menu]"
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
            "2. **10 Mins:** Watch 1 video clip in your `today` channel for *" + lesson['topic'] + "*.\n"
            "3. **5 Mins:** Identify 1 quick screenshot on TradingView matching the setup.\n"
            "4. Send `/watched 20`."
        )
    elif minutes <= 45:
        mode = "🎯 **STANDARD FOCUS (30–45 Mins)**"
        plan = (
            "1. **15 Mins:** Watch the complete lesson in `today` on *" + lesson['topic'] + "*.\n"
            "2. **15 Mins:** Execute the practical exercise:\n"
            "   👉 *" + lesson['exercise'] + "*\n"
            "3. **10 Mins:** Save 2 clean chart annotations to your journal.\n"
            "4. Send `/watched 45`."
        )
    else:
        mode = "🧠 **DEEP IMMERSION (60+ Mins)**"
        plan = (
            "1. **25 Mins:** Full video module breakdown + take structured notes.\n"
            "2. **20 Mins:** Historical bar-replay backtesting on TradingView (test at least 5 setups).\n"
            "3. **15 Mins:** Live market markup on 3 different pairs/indices.\n"
            "4. **5 Mins:** Test your retention with `/quiz`.\n"
            "5. Send `/watched 60`."
        )

    msg = (
        f"{mode}\n"
        f"📅 **Custom Routine for Day {day}:** *{lesson['topic']}*\n\n"
        f"{plan}\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👉 **Actions:** [/watched] | [/not_watched] | [/stats] | [/menu]"
    )
    return msg

def format_stats(progress):
    completed = len(progress.get("completed_days", []))
    total = 120
    pct = int((completed / total) * 100)
    bars = int(pct / 10)
    bar_str = "█" * bars + "░" * (10 - bars)
    cur_day = progress.get("current_day", 1)
    phase = get_current_phase(cur_day)
    streak = progress.get("streak", 0)
    best_streak = progress.get("best_streak", 0)
    buf = progress.get("buffer_days", 0)
    total_mins = progress.get("total_study_minutes", 0)
    hours = total_mins // 60
    mins = total_mins % 60

    cfg = load_community_config()
    goal_link = cfg.get("goal_link", "")
    goal_str = f"• [🎯 6-Month Roadmap Dashboard]({goal_link})\n" if goal_link else ""

    b = analyze_backlog(progress)
    backlog_str = "🟢 On Track" if b["backlog"] <= 0 else f"🟡 {b['backlog']} Days Behind"
    remaining_days = max(120 - completed, 0)
    est_date = date.today() + timedelta(days=remaining_days)

    msg = (
        f"📊 **YOUR 6-MONTH MASTER STUDY DASHBOARD**\n\n"
        f"🏆 **Overall Progress:** `[{bar_str}]` **{pct}%**\n"
        f"• **Lessons Completed:** {completed}/{total}\n"
        f"• **Active Phase:** {phase['title']}\n"
        f"• **Current Active Day:** Day {cur_day} of 120\n\n"
        f"🔥 **Streaks & Habits:**\n"
        f"• **Current Streak:** {streak} days in a row\n"
        f"• **All-Time Best Streak:** {best_streak} days\n"
        f"• **Buffer Bank:** 🛡️ **+{buf} days ahead of schedule**\n\n"
        f"⏱️ **Total Time Invested:**\n"
        f"• **{hours} hrs {mins} mins** logged\n\n"
        f"📅 **Pacing & Schedule:**\n"
        f"• **Backlog Status:** {backlog_str}\n"
        f"• **Target Funded Trader Date:** {est_date.strftime('%B %d, %Y')}\n"
        f"{goal_str}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👉 **Console:** [/goal] | [/milestone] | [/today] | [/suggest_30] | [/menu]"
    )
    return msg

def format_menu(progress):
    day = progress.get("current_day", 1)
    streak = progress.get("streak", 0)
    streak_icon = "🔥" if streak > 0 else "🌱"
    buf = progress.get("buffer_days", 0)
    buf_str = f" | 🛡️ Buffer: +{buf}d" if buf > 0 else ""

    cfg = load_community_config()
    learning_link = cfg.get("learning_link", "")
    today_link = cfg.get("today_link", "")
    yesterday_link = cfg.get("yesterday_link", "")
    goal_link = cfg.get("goal_link", "")
    goal_line = f"│ • [🎯 'goal to achieve' 6-Month Roadmap]({goal_link})\n" if goal_link else ""

    return (
        f"🎛️ **TRADING MENTOR TOUCH CONSOLE** ({streak_icon} Day {day}/120 | Streak: {streak}d{buf_str})\n\n"
        f"Tap any command below for instant action:\n\n"
        f"┌── 🌐 **4-CHANNEL INSTITUTIONAL ECOSYSTEM** ──┐\n"
        f"{goal_line}"
        f"│ • [📅 'today' Active Daily Focus]({today_link})\n"
        f"│ • [⏳ 'yesterday' Catch-Up Backlog]({yesterday_link})\n"
        f"│ • [📚 'learning' Master Library]({learning_link})\n"
        f"└───────────────────────────────┘\n\n"
        f"┌── 🎯 **6-MONTH ROADMAP & GOALS** ────┐\n"
        f"│ • [/goal] — Live 6-Month Roadmap & Progress Bar\n"
        f"│ • [/milestone] — Active Month Syllabus Checklist\n"
        f"└───────────────────────────────┘\n\n"
        f"┌── 📅 **DAILY STUDY & ACTIONS** ───────┐\n"
        f"│ • [/log] — Active Videos & Serial Numbers\n"
        f"│ • [/log 1] — Quick Log Video #1 (Curriculum)\n"
        f"│ • [/log 2] — Quick Log Video #2 (+1 Buffer Day)\n"
        f"│ • [/today] — Today's Schedule & Active Lesson\n"
        f"│ • [/not_watched] — Move Unwatched to 'yesterday'\n"
        f"│ • [/leach_5] — Bot Leach 5 Fresh Videos\n"
        f"│ • [/suggest_30] — 30-Min Structured Routine\n"
        f"└───────────────────────────────┘\n\n"
        f"┌── 📊 **PROGRESS & HABITS** ──────────┐\n"
        f"│ • [/stats] — Progress Dashboard & Bar\n"
        f"│ • [/backlog] — Pacing Audit & Catch-Up Plan\n"
        f"│ • [/harvester_status] — Streamable Scraper Status\n"
        f"└───────────────────────────────┘\n\n"
        f"┌── 🤖 **AI TUTOR & VIDEO SEARCH** ────┐\n"
        f"│ • [/ask] — Ask Any Trading Question\n"
        f"│ • [/tutor] — Toggle 1-on-1 AI Coaching\n"
        f"│ • [/search] — Search 900+ Videos by Keyword\n"
        f"│ • [/playlist] — Curated Topic Catalogs\n"
        f"└───────────────────────────────┘\n\n"
        f"┌── 🧠 **MASTERY & TOOLS** ────────────┐\n"
        f"│ • [/quiz] — Multiple-Choice Trading Quiz\n"
        f"│ • [/roadmap] — 8-Week Curriculum Roadmap\n"
        f"│ • [/links] — 10 Google Drive Masterclasses\n"
        f"│ • [/remind_test] — Test Automated Alerts\n"
        f"└───────────────────────────────┘\n\n"
        f"💡 *Tip: Reply directly to any video in 'today' with a question to ask the AI Tutor!*"
    )

def format_harvester_status():
    tracker_file = Path("harvested_tracker.json")
    t_data = {"harvested_messages": [], "last_run": None, "mega_uploaded": []}
    if tracker_file.exists():
        try:
            with open(tracker_file, "r") as f:
                t_data = json.load(f)
        except Exception:
            pass

    harvested_cnt = len(t_data.get("harvested_messages", []))
    last_run = t_data.get("last_run", "Not run yet")
    cfg = load_community_config()
    learning_link = cfg.get("learning_link", "")

    return (
        f"🔄 **AUTOMATED 3-DAY HARVESTER STATUS** ⚙️\n\n"
        f"• **Destination Channel:** [learning (Master Library)]({learning_link})\n"
        f"• **Refresh Cycle:** Every **72 Hours (3 Days)**\n"
        f"• **Total New Videos Harvested:** **{harvested_cnt} videos**\n"
        f"• **Last Scrape Execution:** `{last_run}`\n"
        f"• **Monitored Sources:** Top 9 trading channels + Account subscriptions\n"
        f"• **Encoding Mode:** FastStart MP4 (`+movflags +faststart`) + Thumbnails\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👉 **Actions:** [/menu] | [/today] | [/stats]"
    )

async def notification_daemon(client):
    print("[+] Background Notification Engine active.", flush=True)
    while True:
        try:
            now = datetime.now()
            today_str = date.today().isoformat()
            progress = load_progress()

            if progress.get("notifications_enabled", True):
                m_h = progress.get("morning_hour", 8)
                m_m = progress.get("morning_min", 30)
                if now.hour == m_h and now.minute == m_m and progress.get("last_morning_notif") != today_str:
                    # Check if previous day's video was left uncompleted in 'today' -> move to 'yesterday'
                    if progress.get("today_posted_day") and progress.get("today_posted_day") not in progress.get("completed_days", []):
                        await move_today_to_yesterday(client, progress, reason="rollover")
                    else:
                        await post_today_lesson(client, progress)

                    msg = (
                        "☀️ **GOOD MORNING! TIME FOR YOUR DAILY TRADING SESSION** 📈\n\n"
                        + format_today_message(progress)
                    )
                    try:
                        await client.send_message('me', msg, link_preview=False)
                        progress["last_morning_notif"] = today_str
                        save_progress(progress)
                        print(f"[Notif] Sent morning briefing for {today_str}", flush=True)
                    except Exception as e:
                        print(f"[Notif Error] Morning: {e}", flush=True)

                e_h = progress.get("evening_hour", 20)
                e_m = progress.get("evening_min", 30)
                if now.hour == e_h and now.minute == e_m and progress.get("last_evening_notif") != today_str:
                    cur_day = progress.get("current_day", 1)
                    if cur_day not in progress.get("completed_days", []):
                        cfg = load_community_config()
                        msg = (
                            f"🌙 **EVENING CHECK-IN — DON'T BREAK YOUR STREAK!** 🔥\n\n"
                            f"You haven't completed **Day {cur_day}** yet today.\n"
                            f"Take 15–20 minutes tonight to watch the video in [today]({cfg.get('today_link', '')})!\n\n"
                            f"👉 Reply to the video with your notes or send `[/watched 20]`,\n"
                            f"or tap `[/not_watched]` to move it to 'yesterday' catch-up."
                        )
                        try:
                            await client.send_message('me', msg, link_preview=False)
                            progress["last_evening_notif"] = today_str
                            save_progress(progress)
                            print(f"[Notif] Sent evening check-in for {today_str}", flush=True)
                        except Exception as e:
                            print(f"[Notif Error] Evening: {e}", flush=True)

            await asyncio.sleep(40)
        except Exception as err:
            print(f"[Daemon Exception]: {err}", flush=True)
            await asyncio.sleep(60)

async def render_keepalive_daemon():
    await asyncio.sleep(45)
    url = os.getenv("RENDER_EXTERNAL_URL", "https://trading-mentor-bot.onrender.com/health")
    print(f"[+] KeepAlive daemon running: self-pinging {url} every 10 mins to prevent sleep.", flush=True)
    while True:
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(url, timeout=15) as r:
                    print(f"[KeepAlive] Ping status {r.status} (awake)", flush=True)
        except Exception as e:
            print(f"[KeepAlive Note]: {e}", flush=True)
        await asyncio.sleep(600)

async def main():
    sys.stdout.reconfigure(line_buffering=True)
    if sys.stdout.encoding != 'utf-8':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except AttributeError:
            pass

    print("[+] Starting Enhanced Trading Mentor Bot service...", flush=True)

    client_holder = {}

    try:
        async def handle_health(request):
            return web.Response(text="Trading Mentor Bot Online 24/7!")

        async def handle_status(request):
            try:
                c = client_holder.get("client")
                p = load_progress()
                is_conn = c.is_connected() if c else False
                is_auth = False
                user_name = "K.S. Tripathi"
                user_handle = "kst_personal"
                if c and is_conn:
                    try:
                        is_auth = await c.is_user_authorized()
                        if is_auth:
                            me_obj = await c.get_me()
                            user_name = getattr(me_obj, "first_name", user_name)
                            user_handle = getattr(me_obj, "username", user_handle)
                    except Exception:
                        pass
                return web.json_response({
                    "status": "online",
                    "connected": is_conn,
                    "authorized": is_auth,
                    "user": user_name,
                    "username": user_handle,
                    "current_day": p.get("current_day"),
                    "streak": p.get("streak"),
                    "buffer_days": p.get("buffer_days"),
                    "today_videos_count": len(p.get("today_serials", {}))
                })
            except Exception as e:
                return web.json_response({"status": "online", "error": str(e)})

        async def handle_progress(request):
            return web.json_response(load_progress())

        port = int(os.getenv("PORT", "10000"))
        app = web.Application()
        app.router.add_get('/', handle_health)
        app.router.add_get('/health', handle_health)
        app.router.add_get('/status', handle_status)
        app.router.add_get('/progress', handle_progress)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, '0.0.0.0', port)
        await site.start()
        print(f"[+] Health & telemetry HTTP server running on port {port} (Render compatible).", flush=True)
    except Exception as he:
        print(f"[!] Health-check server warning: {he}", flush=True)

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

    client_holder["client"] = client

    me = await client.get_me()
    print(f"[+] Bot active as: {getattr(me, 'first_name', '')} (@{getattr(me, 'username', 'N/A')})", flush=True)

    cfg = load_community_config()
    today_channel_id = cfg.get("today_id")
    yesterday_channel_id = cfg.get("yesterday_id")

    # Post Day 1 lesson immediately if needed
    init_progress = load_progress()
    await post_today_lesson(client, init_progress)

    # Start Background Notification Daemon
    asyncio.create_task(notification_daemon(client))

    # Start Autonomous Continuous Video Uploader Daemon inside the Bot
    asyncio.create_task(run_autonomous_turbo_harvester(client))

    # Start 24/7 Keep-Alive Self-Ping Daemon to prevent Render sleep
    asyncio.create_task(render_keepalive_daemon())

    @client.on(events.NewMessage(pattern=r'(?i)^/(start|help|menu)(?:@\w+)?(?:\s+.*)?$'))
    async def handle_menu(event):
        progress = load_progress()
        await event.respond(format_menu(progress), link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/goal(?:@\w+)?(?:\s+.*)?$'))
    async def handle_goal(event):
        progress = load_progress()
        cfg = load_community_config()
        msg = render_master_dashboard(progress, cfg)
        await event.respond(msg, link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/milestone(?:@\w+)?(?:\s+.*)?$'))
    async def handle_milestone(event):
        progress = load_progress()
        cfg = load_community_config()
        cur_day = progress.get("current_day", 1)
        phase = get_current_phase(cur_day)
        msg = render_phase_post(phase["month"], cfg)
        await event.respond(msg, link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/(today|schedule)(?:@\w+)?(?:\s+.*)?$'))
    async def handle_today(event):
        progress = load_progress()
        await post_today_lesson(client, progress)
        await event.respond(format_today_message(progress), link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/(not_watched|skip_to_yesterday)(?:@\w+)?(?:\s+.*)?$'))
    async def handle_not_watched(event):
        progress = load_progress()
        ok = await move_today_to_yesterday(client, progress, reason="manual")
        if ok:
            cur_p = load_progress()
            await event.respond(
                f"📦 **Lesson moved to 'yesterday' catch-up channel!**\n"
                f"• Cleaned 'today' channel and loaded Day {cur_p.get('current_day')}!\n\n"
                f"👉 Tap: [📅 Open 'today']({cfg.get('today_link', '')}) | [⏳ Open 'yesterday']({cfg.get('yesterday_link', '')}) | [/menu]",
                link_preview=False
            )
        else:
            await event.respond("⚠️ No active lesson in 'today' to move.")

    @client.on(events.NewMessage(pattern=r'(?i)^/suggest(?:_(\d+)|\s+(\d+))?(?:@\w+)?$'))
    async def handle_suggest(event):
        mins_str = event.pattern_match.group(1) or event.pattern_match.group(2)
        mins = int(mins_str) if mins_str else 30
        progress = load_progress()
        await event.respond(format_suggest(mins, progress), link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/backlog(?:@\w+)?(?:\s+.*)?$'))
    async def handle_backlog(event):
        progress = load_progress()
        await event.respond(format_backlog(progress), link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/stats(?:@\w+)?(?:\s+.*)?$'))
    async def handle_stats(event):
        progress = load_progress()
        await event.respond(format_stats(progress), link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/log(?:_([a-zA-Z0-9]+))?(?:@\w+)?(?:\s+(.*))?$'))
    async def handle_log(event):
        sub_arg = (event.pattern_match.group(1) or "").strip()
        main_arg = (event.pattern_match.group(2) or "").strip()
        raw_input = f"{sub_arg} {main_arg}".strip()

        progress = load_progress()
        today_serials = progress.get("today_serials", {})

        # If user just sent /log without args: list all active videos with serial numbers
        if not raw_input:
            cur_day = progress.get("current_day", 1)
            week_n, week_t, lesson = get_lesson_by_day(cur_day)
            cur_topic = lesson["topic"] if lesson else f"Day {cur_day} Lesson"

            completed_serials = set(progress.get("completed_serials", []))
            lines = [f"📋 **TODAY'S 10 VIDEOS (DAY {cur_day}: {cur_topic}):**\n"]

            digit_emojis = {1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣", 5: "5️⃣", 6: "6️⃣", 7: "7️⃣", 8: "8️⃣", 9: "9️⃣", 10: "🔟"}

            for s_int in range(1, 11):
                s_str = str(s_int)
                s_info = today_serials.get(s_str, {})
                title = s_info.get("title", f"Video #{s_int}")
                emoji = digit_emojis.get(s_int, f"[{s_int}]")
                is_done = s_int in completed_serials or (s_int == 1 and cur_day in progress.get("completed_days", []))
                status = "✅ Completed" if is_done else f"⏳ Ready ➔ `/log {s_int}`"
                role = "Core Curriculum" if s_int == 1 else "Topic Deep-Dive"
                lines.append(f"{emoji} **[#{s_int}] {title}** *({role})*\n    └ {status}")

            lines.append("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            lines.append("⚡ **EASY LOGGING BY SERIAL NUMBER:**")
            lines.append("• `/log 1` ➔ Log Core Curriculum (advances streak to next day)")
            lines.append("• `/log 2` .. `/log 10` ➔ Log Extra Video (+1 Buffer Day banked each!)")
            lines.append("• `/log <N> 45 <notes>` ➔ Log with custom minutes & notes!")
            lines.append(f"\n👉 Tap: [📅 Open 'today']({cfg.get('today_link', '')}) | [/stats] | [/goal] | [/menu]")

            await event.respond("\n".join(lines), link_preview=False)
            return

        tokens = raw_input.split()
        first_token = tokens[0]

        # Case 1: First token is a serial number (1..20)
        if first_token.isdigit() and int(first_token) <= 20:
            serial_num = int(first_token)
            rest = tokens[1:]

            mins = 45
            notes = ""
            if rest and rest[0].isdigit():
                mins = int(rest[0])
                notes = " ".join(rest[1:])
            elif rest:
                notes = " ".join(rest)

            # --- SERIAL #1: Active Curriculum Lesson ---
            if serial_num == 1:
                resp = await complete_active_lesson(client, minutes=mins, user_notes=notes)
                await event.respond(f"✅ **[VIDEO #1 LOGGED]**\n\n" + resp, link_preview=False)
                return

            # --- SERIAL #2..N: Extra Video in Today ---
            s_key = str(serial_num)
            s_info = today_serials.get(s_key, {"title": f"Video #{serial_num}"})
            v_title = s_info.get("title", f"Video #{serial_num}")

            if serial_num in progress.get("completed_serials", []):
                await event.respond(
                    f"ℹ️ **[Video #{serial_num}]** *{v_title}* was already logged today!\n"
                    f"Send `/log` to view other active videos ready to log.",
                    link_preview=False
                )
                return

            progress.setdefault("completed_serials", []).append(serial_num)
            progress["total_study_minutes"] = progress.get("total_study_minutes", 0) + mins
            progress["buffer_days"] = progress.get("buffer_days", 0) + 1
            cur_buf = progress["buffer_days"]

            today_str = date.today().isoformat()
            if progress.get("last_completed_date") != today_str:
                progress["streak"] = progress.get("streak", 0) + 1
                progress["best_streak"] = max(progress.get("best_streak", 0), progress["streak"])
                progress["last_completed_date"] = today_str

            progress.setdefault("daily_journal", {})[f"video_{serial_num}_{today_str}"] = {
                "serial": serial_num,
                "title": v_title,
                "date": today_str,
                "minutes": mins,
                "notes": notes if notes else f"Watched and studied Video #{serial_num}"
            }
            save_progress(progress)
            await sync_goal_dashboard_message(client, progress)

            total_h = progress["total_study_minutes"] // 60
            total_m = progress["total_study_minutes"] % 60
            done_count = len(progress.get("completed_serials", []))

            resp = (
                f"🎉 **[VIDEO #{serial_num}] LOGGED AS WATCHED!** 🏆\n\n"
                f"🎬 **Video:** {v_title}\n"
                f"⏱️ **Time Invested:** +{mins} mins (Total: {total_h}h {total_m}m)\n"
                f"🛡️ **BUFFER ACCELERATOR:** 🛡️ **+1 Buffer Day Banked!**\n"
                f"You are now **{cur_buf} day(s) ahead of schedule!**\n"
                f"🔥 **Habit Streak:** {progress['streak']} days active!\n"
                f"📊 **Today's Progress:** {done_count}/10 videos completed!\n"
                f"📝 **Journal Entry:** *{notes if notes else 'Completed study session'}*\n\n"
                f"✨ *Great job! Send `/log` to see your live 10-video checklist.*"
            )
            await event.respond(resp, link_preview=False)
            return

        # Case 2: User specified study minutes (e.g. /log 30 or /log 60)
        if first_token.isdigit() and int(first_token) > 20:
            mins = int(first_token)
            progress["total_study_minutes"] = progress.get("total_study_minutes", 0) + mins
            save_progress(progress)
            total_h = progress["total_study_minutes"] // 60
            total_m = progress["total_study_minutes"] % 60
            await event.respond(
                f"⏱️ **LOGGED {mins} MINUTES OF STUDY TIME!** 👏\n\n"
                f"• **Total Time Invested:** {total_h} hrs {total_m} mins\n\n"
                f"💡 *Tip: To log a specific video, use `/log 1`, `/log 2`, etc. Send `/log` to view list.*",
                link_preview=False
            )
            return

        await event.respond(
            f"⚠️ Unknown serial number `{first_token}`. Send `/log` to see active video numbers (e.g. `/log 1`, `/log 2`)."
        )

    @client.on(events.NewMessage(pattern=r'(?i)^/harvester_status(?:@\w+)?(?:\s+.*)?$'))
    async def handle_harvester(event):
        await event.respond(format_harvester_status(), link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/(complete|watched|done)(?:@\w+)?(?:\s+(\d+))?$'))
    async def handle_complete_cmd(event):
        mins_str = event.pattern_match.group(2)
        mins = int(mins_str) if mins_str else 30
        reply_msg = await event.get_reply_message()
        user_notes = ""
        if reply_msg and reply_msg.message:
            user_notes = reply_msg.message[:100]

        # Check if replying in yesterday channel
        chat_id = event.chat_id
        if yesterday_channel_id and (chat_id == yesterday_channel_id or chat_id == -1000000000000 - yesterday_channel_id):
            if reply_msg:
                resp = await complete_catchup_lesson(client, reply_msg.id, mins, user_notes)
                await event.respond(resp, link_preview=False)
                return

        resp = await complete_active_lesson(client, mins, user_notes)
        await event.respond(resp, link_preview=False)

    # Monitor channel message replies in 'today' and 'yesterday'
    @client.on(events.NewMessage(chats=[today_channel_id, yesterday_channel_id]))
    async def handle_channel_replies(event):
        text = event.raw_text.strip()
        if text.startswith('/'):
            return # Handled by command regexes

        reply_msg = await event.get_reply_message()
        if not reply_msg:
            return

        chat_id = event.chat_id
        if today_channel_id and (chat_id == today_channel_id or chat_id == -1000000000000 - today_channel_id):
            if "not_watched" in text.lower():
                progress = load_progress()
                await move_today_to_yesterday(client, progress, reason="manual")
                await event.respond("📦 Moved to 'yesterday' catch-up channel! 'today' refreshed!")
            elif "?" in text or any(w in text.lower().split() for w in ["what", "how", "why", "explain", "where", "can", "when"]):
                # User asked a question on the video: AI Tutor responds!
                v_ctx = {"title": reply_msg.message[:80] if reply_msg.message else "Active Video"}
                ans = await ask_trading_tutor(text, context_video=v_ctx)
                await event.reply(ans, link_preview=False)
            else:
                resp = await complete_active_lesson(client, minutes=30, user_notes=text)
                await event.respond(resp, link_preview=False)

        elif yesterday_channel_id and (chat_id == yesterday_channel_id or chat_id == -1000000000000 - yesterday_channel_id):
            if "?" in text or any(w in text.lower().split() for w in ["what", "how", "why", "explain", "where", "can", "when"]):
                v_ctx = {"title": reply_msg.message[:80] if reply_msg.message else "Catch-Up Video"}
                ans = await ask_trading_tutor(text, context_video=v_ctx)
                await event.reply(ans, link_preview=False)
            else:
                resp = await complete_catchup_lesson(client, reply_msg.id, minutes=30, user_notes=text)
                await event.respond(resp, link_preview=False)

    # 1-on-1 Conversational AI Tutor in Private Chat
    @client.on(events.NewMessage)
    async def handle_private_tutor(event):
        if not event.is_private:
            return
        text = (event.raw_text or "").strip()
        if not text or text.startswith('/'):
            return
        progress = load_progress()
        if progress.get("tutor_mode", False):
            reply_msg = await event.get_reply_message()
            v_ctx = None
            if reply_msg and reply_msg.message:
                v_ctx = {"title": reply_msg.message[:80]}
            ans = await ask_trading_tutor(text, context_video=v_ctx)
            await event.reply(ans, link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/(tutor|mentor)(?:@\w+)?(?:\s+(on|off|stop))?$'))
    async def handle_tutor_mode(event):
        arg = (event.pattern_match.group(2) or "").lower().strip()
        progress = load_progress()
        if arg in ["off", "stop"]:
            progress["tutor_mode"] = False
            save_progress(progress)
            await event.respond("⏹️ **1-on-1 AI Tutor Mode Turned OFF.**\nSend `/tutor` anytime to reactivate coaching.")
            return

        progress["tutor_mode"] = True
        save_progress(progress)
        await event.respond(
            "🎓 **1-ON-1 AI TRADING MENTOR MODE ACTIVATED!** 🤖🚀\n\n"
            "I am now listening to all your trading questions. Just send any message or question directly in this chat to receive instant institutional breakdowns, execution rules, and setup checklists!\n\n"
            "• Ask about Order Blocks, FVGs, Liquidity Sweeps, Market Structure, or Risk Management.\n"
            "• Send `/tutor off` anytime to return to standard command mode."
        )

    @client.on(events.NewMessage(pattern=r'(?i)^/ask(?:@\w+)?(?:\s+(.+))?$'))
    async def handle_ask(event):
        question = (event.pattern_match.group(1) or "").strip()
        if not question:
            await event.respond(
                "❓ **HOW TO USE AI TRADING TUTOR:**\n\n"
                "Send `/ask <your question>` or reply directly to any video in 'today' with your question!\n\n"
                "**Examples:**\n"
                "• `/ask How do I confirm an order block before entering?`\n"
                "• `/ask Explain difference between BOS and CHoCH`\n"
                "• `/ask What is a Judas Swing during London open?`\n"
                "• `/ask Give me a high-probability SMC trade checklist`\n\n"
                "💡 *Or send `/tutor` to toggle continuous 1-on-1 coaching mode!*"
            )
            return

        reply_msg = await event.get_reply_message()
        v_ctx = None
        if reply_msg and reply_msg.message:
            v_ctx = {"title": reply_msg.message[:80]}

        ans = await ask_trading_tutor(question, context_video=v_ctx)
        await event.respond(ans, link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/search(?:@\w+)?(?:\s+(.+))?$'))
    async def handle_search(event):
        query = (event.pattern_match.group(1) or "").strip()
        if not query:
            await event.respond(
                "🔍 **VIDEO LIBRARY SEARCH:**\n\n"
                "Search over 900+ streamable trading videos in 'learning' by keyword!\n\n"
                "**Examples:**\n"
                "• `/search ict` — Find ICT & Smart Money Concept videos\n"
                "• `/search order block` — Find Order Block masterclasses\n"
                "• `/search scalping` — Find fast intraday execution lessons\n"
                "• `/search price action` — Find support/resistance & chart reading\n\n"
                "👉 Or send `/playlist` to view curated topic catalogs!"
            )
            return

        await event.respond(f"🔍 Searching 900+ library videos for *'{query}'*...")
        matches = await search_learning_videos(client, query, limit=5)
        if not matches:
            await event.respond(f"❌ No matching videos found for *'{query}'*. Try a broader term like `smc`, `price action`, `candle`, or send `/playlist`.")
            return

        lines = [f"🎬 **TOP SEARCH MATCHES FOR:** *'{query}'*\n"]
        for idx, m in enumerate(matches, 1):
            lines.append(f"{idx}️⃣ [{m['title']}]({m['link']})")
            lines.append(f"   🏷️ {m['tags']} | [Forward: `/send_{m['msg_id']}`]")

        lines.append("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        lines.append("💡 **Actions:**")
        lines.append(f"• Tap any title link to watch inline in 'learning'")
        lines.append(f"• Send `/send <ID>` to forward the video directly to your chat")
        lines.append(f"• Send `/search_send {query}` to automatically forward the #1 match!")

        await event.respond("\n".join(lines), link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/search_send(?:@\w+)?(?:\s+(.+))?$'))
    async def handle_search_send(event):
        query = (event.pattern_match.group(1) or "").strip()
        if not query:
            await event.respond("⚠️ Please specify what to search & forward. Example: `/search_send ict order block`")
            return
        matches = await search_learning_videos(client, query, limit=1)
        if not matches:
            await event.respond(f"❌ No matching videos found for *'{query}'*.")
            return
        m = matches[0]
        learning_id = cfg.get("learning_id")
        try:
            learning_channel = await client.get_entity(learning_id)
            await client.forward_messages(event.chat_id, m["msg_id"], learning_channel)
        except Exception as e:
            await event.respond(f"⚠️ Forward error: {e}")

    @client.on(events.NewMessage(pattern=r'(?i)^/send(?:_(\d+)|\s+(\d+))(?:@\w+)?$'))
    async def handle_send(event):
        mid_str = event.pattern_match.group(1) or event.pattern_match.group(2)
        if not mid_str:
            return
        msg_id = int(mid_str)
        learning_id = cfg.get("learning_id")
        try:
            learning_channel = await client.get_entity(learning_id)
            await client.forward_messages(event.chat_id, msg_id, learning_channel)
        except Exception as e:
            await event.respond(f"⚠️ Could not forward video {msg_id}: {e}")

    @client.on(events.NewMessage(pattern=r'(?i)^/(playlist|topics)(?:@\w+)?(?:\s+([a-zA-Z_]+))?$'))
    async def handle_playlist(event):
        topic = (event.pattern_match.group(2) or "").strip().lower()
        if not topic:
            await event.respond(
                "📂 **CURATED TRADING TOPIC CATALOGS:**\n\n"
                "Explore curated playlists of streamable videos in 'learning':\n\n"
                "• `/playlist ict` — Smart Money Concepts, Order Blocks, Liquidity Sweeps\n"
                "• `/playlist price_action` — Naked Support/Resistance, Trendlines, Candlesticks\n"
                "• `/playlist scalping` — Precision Scalping & Fast Intraday Timing\n"
                "• `/playlist volume` — Volume Profile, Auction Market Theory, POC\n"
                "• `/playlist algo` — Algorithmic, Quantitative & Python Backtesting\n\n"
                "👉 Tap any command above to load that topic's playlist!"
            )
            return

        title, matches = await get_curated_playlist(client, topic, limit=5)
        if not matches:
            await event.respond(f"⚠️ No videos found for playlist topic `{topic}`.")
            return

        lines = [f"{title} 🎬\n"]
        for idx, m in enumerate(matches, 1):
            lines.append(f"{idx}️⃣ [{m['title']}]({m['link']})")
            lines.append(f"   👉 Forward to chat: `/send_{m['msg_id']}`")

        lines.append("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        lines.append(f"👉 Tap any video above to open in 'learning' or send `/send <ID>`!")
        await event.respond("\n".join(lines), link_preview=False)


    @client.on(events.NewMessage(pattern=r'(?i)^/remind(?:_([a-zA-Z]+)|\s+([a-zA-Z]+))?(?:@\w+)?$'))
    async def handle_remind(event):
        action = event.pattern_match.group(1) or event.pattern_match.group(2)
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

    @client.on(events.NewMessage(pattern=r'(?i)^/leach(?:_(\d+)|\s+(\d+))?(?:@\w+)?$'))
    async def handle_leach(event):
        c_str = event.pattern_match.group(1) or event.pattern_match.group(2)
        count = int(c_str) if c_str else 5
        await event.respond(f"⏳ **BOT LEACH ACTIVE:** Searching monitored channels to extract and upload {count} videos into 'today'...", link_preview=False)
        from bot_leach_uploader import leach_5_videos
        cfg = load_community_config()
        up = await leach_5_videos(client, cfg.get("today_id"))
        await event.respond(f"✅ **BOT LEACH COMPLETE:** Successfully extracted and uploaded {up} streamable trading videos into [today]({cfg.get('today_link', '')})!", link_preview=False)

    @client.on(events.NewMessage(pattern=r'(?i)^/roadmap(?:@\w+)?(?:\s+.*)?$'))
    async def handle_roadmap(event):
        msg = "🗺️ **8-WEEK TRADING CURRICULUM ROADMAP**\n\n"
        for w_num, w_data in CURRICULUM.items():
            days_range = f"Days {w_data['days'][0]['day']}–{w_data['days'][-1]['day']}"
            msg += f"• **Week {w_num} ({days_range}):** {w_data['title'].replace(f'Week {w_num}: ', '')}\n"
        msg += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nSend `/week <1-8>` for daily breakdowns or `/today` for your active lesson!"
        await event.respond(msg)

    @client.on(events.NewMessage(pattern=r'(?i)^/week(?:@\w+)?(?:\s+(\d+))?$'))
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

    @client.on(events.NewMessage(pattern=r'(?i)^/quiz(?:@\w+)?(?:\s+.*)?$'))
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

    @client.on(events.NewMessage(pattern=r'(?i)^/links(?:@\w+)?(?:\s+.*)?$'))
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

    @client.on(events.NewMessage(pattern=r'(?i)^/reset(?:@\w+)?(?:\s+.*)?$'))
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
    while True:
        try:
            await client.run_until_disconnected()
            break
        except Exception as e:
            print(f"[!] Update warning: {e}. Auto-reconnecting in 3s...", flush=True)
            await asyncio.sleep(3)
            try:
                if not client.is_connected():
                    await client.connect()
            except Exception as ce:
                print(f"[!] Reconnect error: {ce}", flush=True)

if __name__ == '__main__':
    asyncio.run(main())
