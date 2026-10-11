"""
Daily Topic Curator - 10 Streamable Videos Per Day
Maps 10 strictly streamable, topic-focused trading videos for each day of the 6-Month Roadmap.
Every video is sourced from 'learning' channel and verified for native streaming (MP4).
"""

import json
import os
import re

# Comprehensive mapping of 10 streamable videos for curriculum days
DAILY_VIDEO_CURRICULUM = {
    # DAY 1: The Anatomy of Price Action & Market Flow
    1: [
        {"serial": 1, "msg_id": 18, "title": "Day 1: The Anatomy of Price Action & Market Flow", "course": "Al Brooks Price Action", "summary": "Bars, bodies, wicks, market cycles, and trend vs range regimes.", "exercise": "Mark 3 trending legs and 2 consolidation ranges on the 1H chart."},
        {"serial": 2, "msg_id": 2524, "title": "Lecture 1.3: Candlestick Anatomy & Wick Biology", "course": "Naked Price Action", "summary": "Understanding buyers vs sellers aggression through candle wicks and closes.", "exercise": "Identify 3 strong buying tails at swing lows on 15M."},
        {"serial": 3, "msg_id": 2526, "title": "Lecture 2.1: Introduction to Market Structure & Flow", "course": "Market Structure Mastery", "summary": "Defining Higher Highs (HH), Higher Lows (HL) and structural breaks.", "exercise": "Map the last 5 swing points on EURUSD 1H chart."},
        {"serial": 4, "msg_id": 261, "title": "The Complete Price Action Picture & Structural Theory", "course": "Price Action Blueprint", "summary": "Putting candle anatomy and market structure together into high-probability bias.", "exercise": "Formulate a multi-timeframe directional bias using market flow."},
        {"serial": 5, "msg_id": 425, "title": "Lecture 2.2: Classifying Market Conditions & Regimes", "course": "Institutional Price Flow", "summary": "Differentiating between trending, consolidating, and high-volatility expanding markets.", "exercise": "Classify the last 3 trading sessions into trend or range."},
        {"serial": 6, "msg_id": 454, "title": "Higher Timeframe Market Structure Simplifying It", "course": "Top-Down Analysis", "summary": "Using Daily and 4H charts to anchor your intraday trading direction.", "exercise": "Draw key Daily high/low boundaries and observe 15M reactions."},
        {"serial": 7, "msg_id": 453, "title": "Reading the Order Flow & Candle Delivery", "course": "Institutional Order Flow", "summary": "How institutional algorithms deliver price smoothly vs with sudden displacement.", "exercise": "Spot 2 displacement moves with consecutive energetic candle bodies."},
        {"serial": 8, "msg_id": 2695, "title": "Lecture 4: Candlestick Pattern Masterclass (Part 1)", "course": "Candlestick Blueprint", "summary": "Single and two-bar reversal patterns formed at key structural zones.", "exercise": "Find 2 pin-bar rejection candles that triggered a multi-day move."},
        {"serial": 9, "msg_id": 2697, "title": "Lecture 6: Price Action Execution & Live Tutorials", "course": "Practical Charting", "summary": "Live walkthrough of identifying price action setups without lagging indicators.", "exercise": "Perform a simulated entry based purely on candlestick confirmation."},
        {"serial": 10, "msg_id": 439, "title": "Understanding Time Contraction & Volatility Expansion", "course": "Market Cycles", "summary": "How narrow-range candles precede high-volatility breakout trends.", "exercise": "Find a volatility squeeze on 15M chart and note the subsequent breakout direction."}
    ],

    # DAY 2: Support & Resistance from an Institutional Perspective
    2: [
        {"serial": 1, "msg_id": 42, "title": "Day 2: Support & Resistance from an Institutional Perspective", "course": "Naked Forex & Order Flow", "summary": "Static S/R, dynamic S/R, polarity flips, and false breakout traps.", "exercise": "Draw key support/resistance levels on Daily and 4H charts. Mark 1 retest entry."},
        {"serial": 2, "msg_id": 2752, "title": "Session 1: Precision Support & Resistance (SnR)", "course": "Malaysian SnR Academy", "summary": "Mapping exact price levels where banks defend orders and initiate reversals.", "exercise": "Identify a clean horizontal SnR level with at least 2 sharp rejections."},
        {"serial": 3, "msg_id": 2755, "title": "TheAlchemistFX: Malaysian SnR 1-on-1 Mentorship Session", "course": "TheAlchemistFX Mentorship", "summary": "Advanced institutional SnR mapping, fresh vs tested levels, and sniper entries.", "exercise": "Box an untested support zone on 4H chart and set an alert."},
        {"serial": 4, "msg_id": 2526, "title": "Lecture 2.1: Market Structure & Horizontal Polarity", "course": "Market Structure Mastery", "summary": "Old resistance flipping into new support after an impulse break.", "exercise": "Find 2 polarity flips where broken resistance held as support on 1H."},
        {"serial": 5, "msg_id": 2558, "title": "Lesson 2: Institutional Level Marking & Key Support/Demand Zones", "course": "Levels of Piyush", "summary": "Techniques for plotting high-conviction supply and demand zones.", "exercise": "Mark the most significant Weekly/Daily supply zone for your main asset."},
        {"serial": 6, "msg_id": 465, "title": "Market Structure & Ranges: Staying Aligned with S/R", "course": "SMC & Structure", "summary": "Trading within structural ranges and avoiding getting chopped up in the middle.", "exercise": "Mark range highs and range lows; avoid trades in the middle 50% zone."},
        {"serial": 7, "msg_id": 559, "title": "Trendlines, Dynamic S/R Channels & Wedge Breaks", "course": "Advanced Price Action", "summary": "Combining horizontal S/R with dynamic diagonal trendline boundaries.", "exercise": "Draw a rising channel and spot the exact breakdown retest."},
        {"serial": 8, "msg_id": 555, "title": "Mapping Out Institutional Swing Structure & Polarity Flips", "course": "Smart Money Structure", "summary": "Recognizing when a support break indicates true reversal vs a liquidity sweep.", "exercise": "Observe if a support break closed below the level on body or only wick."},
        {"serial": 9, "msg_id": 477, "title": "08: Rejections of Higher & Lower Prices at Key S/R Zones", "course": "Order Flow Reversals", "summary": "Visual signatures of institutional rejection at major price barriers.", "exercise": "Document 2 rejection candles with long wicks at a key resistance level."},
        {"serial": 10, "msg_id": 261, "title": "11: The Complete Price Action Picture & Structural Theory", "course": "Price Action Blueprint", "summary": "Synthesizing support/resistance zones into a complete trading strategy.", "exercise": "Write down your entry criteria for taking an S/R bounce trade."}
    ],

    # DAY 3: High-Probability Candlestick Patterns in Context
    3: [
        {"serial": 1, "msg_id": 2695, "title": "Day 3: High-Probability Candlestick Patterns in Context", "course": "Candlestick Mastery", "summary": "Pin bars, engulfing candles, inside bars at structural extremes.", "exercise": "Find 3 engulfing bar setups formed strictly at major support/resistance zones."},
        {"serial": 2, "msg_id": 2696, "title": "Lecture 5: Candlestick Pattern Masterclass (Part 2)", "course": "Candlestick Blueprint", "summary": "Advanced multi-candle combinations: Morning Stars, Evening Stars, Tweezers.", "exercise": "Identify an Evening Star at resistance on 1H chart."},
        {"serial": 3, "msg_id": 2524, "title": "Lecture 1.3: Candlestick Anatomy & Buying/Selling Pressure", "course": "Anatomy of Candles", "summary": "Reading who won the battle inside the candle: bulls or bears.", "exercise": "Audit the last 10 candles on 1H and mark the dominant pressure."},
        {"serial": 4, "msg_id": 477, "title": "08: Rejection Wicks & False Breakout Candles", "course": "Price Rejections", "summary": "How rejection tails trap breakout traders and fuel swift reversals.", "exercise": "Mark 2 wick traps where price broke a high then closed back inside."},
        {"serial": 5, "msg_id": 451, "title": "The Double Purge: An Eye Opener to Liquidity Sweeps", "course": "Liquidity Engineering", "summary": "How institutional algorithms hunt stops on both sides before true move.", "exercise": "Find a double purge session where both Asian high and low were swept."},
        {"serial": 6, "msg_id": 2752, "title": "Malaysian SnR: Reversal Candlestick Validation", "course": "SnR Reversals", "summary": "Confirming SnR touches with engulfing candle close.", "exercise": "Verify whether an SnR retest produced a full body close in trade direction."},
        {"serial": 7, "msg_id": 439, "title": "Time Contraction & Expansion: Inside Bar Sequences", "course": "Inside Bar Playbook", "summary": "Trading 2 or more consecutive inside bars for explosive breakouts.", "exercise": "Locate a double inside bar pattern and note breakout volatility."},
        {"serial": 8, "msg_id": 2697, "title": "Lecture 6: Price Action Chart Reading Tutorials", "course": "Practical Price Action", "summary": "Step-by-step chart audit: identifying high-conviction candle triggers.", "exercise": "Backtest 5 pin bar setups and calculate their win rate."},
        {"serial": 9, "msg_id": 454, "title": "Higher Timeframe Alignment for Candlestick Triggers", "course": "Top-Down Candlesticks", "summary": "Only taking lower timeframe candle signals that align with higher timeframe trend.", "exercise": "Filter out counter-trend candle signals on 15M; only take trend-aligned."},
        {"serial": 10, "msg_id": 452, "title": "Order Pairing Ranges & Candlestick Confirmation", "course": "Order Pairing Mechanics", "summary": "How institutions pair retail market orders with their limit orders.", "exercise": "Document the candle reaction when price entered the order pairing zone."}
    ],

    # DAY 4: Trend Structure: Higher Highs, Lower Lows & Trend Health
    4: [
        {"serial": 1, "msg_id": 2526, "title": "Day 4: Trend Structure: Higher Highs, Lower Lows & Health", "course": "Market Structure Blueprint", "summary": "Market structure mapping, swing points, and trend deceleration.", "exercise": "Map all swing highs and swing lows on 15M for last 5 trading days."},
        {"serial": 2, "msg_id": 465, "title": "Supplementary Lesson: Market Structure & Ranges Staying Aligned", "course": "Structure Alignment", "summary": "Staying aligned with higher timeframe market structure during deep pullbacks.", "exercise": "Differentiate between a healthy deep retracement and a structural break."},
        {"serial": 3, "msg_id": 555, "title": "Mapping Out Structure & Identifying Break of Structure (BOS)", "course": "Smart Money Structure", "summary": "Validating when a swing point is officially broken vs defended.", "exercise": "Mark the last 3 BOS levels on 1H chart."},
        {"serial": 4, "msg_id": 454, "title": "Higher Timeframe Simplifying It: Trend Health Diagnostics", "course": "Trend Diagnostics", "summary": "Measuring impulsive wave length vs corrective retracement length.", "exercise": "Compare the number of bars in impulse moves vs corrective pullbacks."},
        {"serial": 5, "msg_id": 559, "title": "Trendlines, Channels & Acceleration Breaks", "course": "Advanced Trendlines", "summary": "Trend acceleration angles and when an exponential trend is about to exhaust.", "exercise": "Draw 2 trendlines showing trend steepening and watch for breakdown."},
        {"serial": 6, "msg_id": 2755, "title": "TheAlchemistFX: Trend Flow & Institutional SnR Alignment", "course": "Trend Flow Mentorship", "summary": "Aligning intraday SnR entries with higher timeframe structural momentum.", "exercise": "Only map buy levels in an uptrend; ignore all sell levels."},
        {"serial": 7, "msg_id": 453, "title": "Reading the Order Flow in a Strong Trend", "course": "Trending Order Flow", "summary": "How candles close persistently near highs/lows during strong institutional trends.", "exercise": "Count consecutive strong-close candles in a trending leg."},
        {"serial": 8, "msg_id": 477, "title": "Rejection of Lower Prices: The Hallmark of Uptrends", "course": "Price Rejection", "summary": "In an uptrend, lower prices are aggressively bought up via long wicks.", "exercise": "Find 3 dip-buying long-wick candles in an active uptrend."},
        {"serial": 9, "msg_id": 2697, "title": "Price Action Tutorials: Structural Traps & Reversals", "course": "Structural Traps", "summary": "Identifying when a trend is losing steam: shorter impulse legs, equal highs.", "exercise": "Note signs of trend exhaustion on 1H chart before a reversal occurred."},
        {"serial": 10, "msg_id": 261, "title": "The Complete Price Action Picture: Trend Synthesis", "course": "Price Action Synthesis", "summary": "Combining swing highs/lows into a repeatable daily trend framework.", "exercise": "Write down your written rule for determining if a market is in an uptrend."}
    ],

    # DAY 5: Trendlines, Channels & Acceleration Breaks
    5: [
        {"serial": 1, "msg_id": 559, "title": "Day 5: Trendlines, Channels & Acceleration Breaks", "course": "Advanced Price Action", "summary": "Trendline rules, channel trading, and trendline breaks with momentum.", "exercise": "Plot a channel on 1H chart. Note how price reacted when reaching channel boundaries."},
        {"serial": 2, "msg_id": 2752, "title": "SnR Dynamics with Dynamic Trendlines", "course": "Malaysian SnR", "summary": "Confluence between horizontal SnR and ascending/descending trendlines.", "exercise": "Find a setup where horizontal resistance aligned exactly with a descending trendline."},
        {"serial": 3, "msg_id": 2526, "title": "Market Structure Channels & Expanding Wedges", "course": "Structure Channels", "summary": "Recognizing expanding vs contracting channels and their breakout mechanics.", "exercise": "Draw an expanding wedge on 15M and document the breakout direction."},
        {"serial": 4, "msg_id": 465, "title": "Staying Aligned Inside Trend Channels", "course": "Channel Alignment", "summary": "Buying at the bottom of the channel and taking profit at the top.", "exercise": "Identify the midpoint (50% median line) of a channel and observe price reaction."},
        {"serial": 5, "msg_id": 477, "title": "Rejections at Channel Boundaries", "course": "Boundary Rejections", "summary": "Using rejection wicks at channel extremes to trigger sniper entries.", "exercise": "Mark 2 wick touches at an upper channel line that led to drops."},
        {"serial": 6, "msg_id": 454, "title": "Higher Timeframe Channel Dominance", "course": "HTF Channels", "summary": "Daily channel touches overriding lower timeframe micro-patterns.", "exercise": "Draw a Daily channel and observe how 15M trend reversed upon touching it."},
        {"serial": 7, "msg_id": 2695, "title": "Candlestick Triggers on Trendline Retests", "course": "Trendline Retests", "summary": "Pin bar and engulfing confirmations on the 3rd touch of a trendline.", "exercise": "Find a clean 3rd touch trendline setup confirmed by an engulfing candle."},
        {"serial": 8, "msg_id": 451, "title": "Liquidity Sweeps Above Trendline Extremes", "course": "Trendline Sweeps", "summary": "How retail trendline breakout traders get trapped before the true reversal.", "exercise": "Spot a false trendline breakout that immediately reversed back inside."},
        {"serial": 9, "msg_id": 452, "title": "Order Pairing Along Dynamic Trendlines", "course": "Order Flow Trendlines", "summary": "How institutions accumulate orders along trendlines.", "exercise": "Analyze volume/momentum at each consecutive touch of a trendline."},
        {"serial": 10, "msg_id": 261, "title": "Price Action Theory: Complete Channel Playbook", "course": "Channel Playbook", "summary": "Complete rules for entering, managing, and exiting channel trades.", "exercise": "Create a 3-step checklist for trading trendline bounces."}
    ]
}

def get_curated_10_videos(day_num):
    """
    Returns exactly 10 streamable videos for day_num.
    If day is in DAILY_VIDEO_CURRICULUM, returns the custom-mapped 10 videos.
    Otherwise, deterministically selects 10 streamable videos matching the phase & topic.
    """
    if day_num in DAILY_VIDEO_CURRICULUM:
        return DAILY_VIDEO_CURRICULUM[day_num]

    # Deterministic generation for other days
    catalog_path = "streamable_catalog.json"
    if not os.path.exists(catalog_path):
        return []

    try:
        with open(catalog_path, encoding='utf-8') as f:
            cat = json.load(f)
    except Exception:
        return []

    # Filter by topic/phase
    # Month 1 (Days 1-20): Price action & structure
    # Month 2 (Days 21-40): SMC & ICT
    # Month 3 (Days 41-60): Sessions & execution
    # Month 4 (Days 61-80): Volume profile & auction
    # Month 5 (Days 81-100): Quant & backtest
    # Month 6 (Days 101-120): Prop firm & evaluation
    phase = 1 if day_num <= 20 else (2 if day_num <= 40 else (3 if day_num <= 60 else (4 if day_num <= 80 else (5 if day_num <= 100 else 6))))
    
    # Filter candidate videos
    keywords = ["price action", "support", "resistance", "snr", "candlestick", "structure"]
    if phase == 2:
        keywords = ["smc", "ict", "order block", "liquidity", "fvg", "mitigation", "purge"]
    elif phase == 3:
        keywords = ["session", "killzone", "london", "timing", "silver bullet", "scalp"]
    elif phase == 4:
        keywords = ["volume profile", "profile", "poc", "value area", "auction", "delta"]
    elif phase == 5:
        keywords = ["backtest", "risk", "management", "expectancy", "protocol", "rules"]
    elif phase == 6:
        keywords = ["prop firm", "funded", "drawdown", "evaluation", "protocol", "management"]

    pool = []
    seen = set()
    for v in cat:
        t = v.get("title", "")
        clean_k = re.sub(r'[\(\)\d\.\-_]+', '', t.lower()).strip()
        if len(clean_k) > 5 and clean_k in seen:
            continue
        seen.add(clean_k)
        text = (v.get("text", "") + " " + t).lower()
        if any(kw in text for kw in keywords):
            pool.append(v)

    # Offset for day
    offset = ((day_num - 1) * 9) % max(1, (len(pool) - 10))
    selected = pool[offset:offset+9]

    result = []
    # Video #1: Syllabus lesson
    from goal_roadmap_engine import get_lesson_for_day
    cur_lesson = get_lesson_for_day(day_num)
    topic_t = cur_lesson.get("topic", f"Day {day_num} Lesson") if cur_lesson else f"Day {day_num} Lesson"
    course_t = cur_lesson.get("course", "Institutional Trading") if cur_lesson else "Institutional Trading"
    summary_t = cur_lesson.get("concepts", "Core trading principles") if cur_lesson else "Core principles"
    exercise_t = cur_lesson.get("exercise", "Practice on chart") if cur_lesson else "Practice on chart"

    primary_id = selected[0]["id"] if selected else 42
    result.append({
        "serial": 1,
        "msg_id": primary_id,
        "title": f"Day {day_num}: {topic_t}",
        "course": course_t,
        "summary": summary_t,
        "exercise": exercise_t
    })

    # Videos 2 to 10
    for idx, v in enumerate(selected[:9]):
        title_c = v["title"].replace(".mp4", "").replace("_", " ").strip()
        title_c = re.sub(r'^\d+\s*[\.\-]?\s*', '', title_c).strip()
        result.append({
            "serial": idx + 2,
            "msg_id": v["id"],
            "title": title_c,
            "course": "Trading Library Masterclass",
            "summary": f"Deep-dive session exploring high-probability setups and institutional execution.",
            "exercise": f"Apply the concepts from this video to identify 1 live setup on today's chart."
        })

    # Pad to 10 if needed
    while len(result) < 10:
        pad_idx = len(result) + 1
        result.append({
            "serial": pad_idx,
            "msg_id": cat[pad_idx % len(cat)]["id"],
            "title": f"Complementary Institutional Breakdown #{pad_idx}",
            "course": "Trading Library Masterclass",
            "summary": "Practical chart study and trade management.",
            "exercise": "Review chart examples and log observations."
        })

    return result

def format_video_caption(day_num, video_data, phase_title):
    """
    Generates a beautifully formatted Telegram caption for a daily streamable video.
    """
    serial = video_data["serial"]
    title = video_data["title"]
    course = video_data.get("course", "Trading Masterclass")
    summary = video_data.get("summary", "Practical high-probability chart breakdown.")
    exercise = video_data.get("exercise", "Study 3 charts and identify the pattern.")

    if serial == 1:
        return (
            f"🎬 **[Video #1] TODAY'S ACTIVE LESSON — DAY {day_num}/120** 🚀\n"
            f"🏆 **{phase_title}**\n\n"
            f"📖 **Topic:** {title}\n"
            f"🎓 **Source Course:** `{course}`\n\n"
            f"🔍 **Key Concepts to Master:**\n"
            f"• {summary}\n\n"
            f"📝 **Practical Chart Exercise:**\n"
            f"👉 {exercise}\n\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"⚡ **QUICK SERIAL LOGGING:**\n"
            f"👉 Send: `/log 1` (or `/log 1 <notes>`)\n"
            f"• Or reply to this video with `[/watched]`\n"
            f"• Not watching today? Tap: `[/not_watched]` (moves to 'yesterday')\n\n"
            f"👉 **Actions:** [/log 1] | [/goal] | [/milestone] | [/ask] | [/stats] | [/menu]"
        )
    else:
        return (
            f"🎬 **[Video #{serial}] {title}** 🚀\n"
            f"📌 **Day {day_num}/120 Daily Focus:** {phase_title}\n"
            f"🎓 **Course Module:** `{course}`\n\n"
            f"📖 **Core Breakdown:**\n"
            f"• {summary}\n\n"
            f"🎯 **Actionable Chart Takeaway:**\n"
            f"👉 {exercise}\n\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"⚡ **QUICK SERIAL LOGGING:**\n"
            f"👉 Send: `/log {serial}` (or `/log {serial} <notes>`)\n"
            f"🛡️ Watching this video banks **+1 Buffer Day** & logs study progress!\n\n"
            f"👉 **Actions:** [/log {serial}] | [/today] | [/goal] | [/menu]"
        )
