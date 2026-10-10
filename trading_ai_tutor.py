import os
import re
import json
import asyncio
import aiohttp

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

# Built-in Institutional Trading Knowledge Base
KNOWLEDGE_BASE = {
    "order_block": {
        "keywords": ["order block", "ob", "breaker", "mitigation", "institutional order"],
        "title": "🏛️ Institutional Order Blocks (OB)",
        "summary": "An Order Block represents the footprint of institutional accumulation/distribution before an aggressive displacement.",
        "rules": [
            "1. **Displacement:** Must be followed by strong explosive expansion candles that break market structure (BOS).",
            "2. **Imbalance:** Look for an unfilled Fair Value Gap (FVG) right next to the order block candle.",
            "3. **Liquidity Sweep:** High-probability OBs sweep prior highs or lows before reversing.",
            "4. **Refinement:** Mark the 50% equilibrium (Mean Threshold) of the candle body for precision entry."
        ],
        "invalidation": "If price closes with full candle body through the 50% Mean Threshold, the block is invalidated or converted to a Breaker Block."
    },
    "fvg": {
        "keywords": ["fvg", "fair value gap", "imbalance", "bisi", "sibi", "inefficiency"],
        "title": "⚡ Fair Value Gaps (FVG) & Price Imbalance",
        "summary": "A 3-candle pattern where candle 2 expands aggressively, leaving a gap between the wick of candle 1 and candle 3.",
        "rules": [
            "1. **BISI (Buy-Side Imbalance Sell-Side Inefficiency):** Bullish FVG where only buyers were matched.",
            "2. **SIBI (Sell-Side Imbalance Buy-Side Inefficiency):** Bearish FVG where only sellers were matched.",
            "3. **Consequent Encroachment (CE):** The 50% midpoint of the gap acts as institutional magnetic support/resistance.",
            "4. **Inversion FVG:** If an FVG fails to hold price, it often flips into support/resistance in the opposite direction."
        ],
        "invalidation": "Full body candle close through the complete FVG range signals momentum continuation, not a retracement."
    },
    "liquidity": {
        "keywords": ["liquidity", "sweep", "stop hunt", "bsl", "ssl", "equal highs", "equal lows", "eqh", "eql"],
        "title": "🎯 Institutional Liquidity Sweeps & Pools",
        "summary": "Price only moves for two reasons: to rebalance an inefficiency (FVG) or to take out liquidity (stop-losses).",
        "rules": [
            "1. **Buy-Side Liquidity (BSL):** Resting stop-losses above swing highs and equal highs (EQH).",
            "2. **Sell-Side Liquidity (SSL):** Resting stop-losses below swing lows and equal lows (EQL).",
            "3. **The Sweep (Turtle Soup):** Price pierces the level with a wick, triggers breakout traders & stop orders, then reverses sharply.",
            "4. **Execution Timing:** Look for sweeps during London Open (07:00–09:00 GMT) or NY Open (13:00–15:00 GMT)."
        ],
        "invalidation": "If price breaks the liquidity level with strong displacement candle closes and creates fresh FVGs in the breakout direction, it is a trend continuation, not a sweep."
    },
    "structure": {
        "keywords": ["structure", "bos", "choch", "msb", "break of structure", "change of character"],
        "title": "📈 Market Structure: BOS vs. CHoCH",
        "summary": "Mapping market structure separates high-probability setups from low-quality chop.",
        "rules": [
            "1. **Break of Structure (BOS):** Continuation of the established trend (Higher High in uptrend, Lower Low in downtrend).",
            "2. **Change of Character (CHoCH):** First structural failure indicating a potential reversal (e.g. failing to make a higher high and breaking the previous higher low).",
            "3. **Multi-Timeframe Hierarchy:** HTF (Daily/4H) determines bias; LTF (15m/5m/1m) provides confirmation and precision entry.",
            "4. **Candle Body vs. Wick:** Trend continuation requires a candle *body* close beyond the swing point. A wick is merely liquidity collection."
        ],
        "invalidation": "A single LTF CHoCH against a strong HTF trend frequently turns out to be a pullback rather than a full trend reversal."
    },
    "price_action": {
        "keywords": ["support", "resistance", "snr", "flip", "trendline", "pin bar", "engulfing", "candle"],
        "title": "📊 Naked Price Action & SnR Flip Mechanics",
        "summary": "Trading pure price action by identifying where market participants validate key equilibrium levels.",
        "rules": [
            "1. **Role Reversal (SR Flip):** Old resistance becomes new support; old support becomes new resistance.",
            "2. **Freshness Rule:** The first and second re-tests of a clean horizontal level carry 80%+ higher probability than repeated bounces.",
            "3. **Rejection Signals:** Long wicks showing rejection of higher or lower prices (Pin Bar / Hammer) at key levels.",
            "4. **Consolidation Breakout:** Wait for clean retest after breakout before entering; never chase the breakout candle."
        ],
        "invalidation": "Choppy price action oscillating repeatedly through a level indicates the level has lost its institutional significance."
    },
    "volume_profile": {
        "keywords": ["volume", "profile", "poc", "value area", "vah", "val", "auction", "auction market"],
        "title": "📊 Auction Market Theory & Volume Profile",
        "summary": "Understanding where trade volume was negotiated to spot balance versus aggressive discovery.",
        "rules": [
            "1. **Point of Control (POC):** The single price level where the highest volume was transacted; acts as a high-volume magnet.",
            "2. **Value Area (VAH/VAL):** The range where 70% of total volume occurred.",
            "3. **Rotational Strategy:** In a balanced market, fade the boundaries (sell VAH, buy VAL) targeting POC.",
            "4. **Initiative Strategy:** When price breaks outside Value Area with high volume, trade in the direction of expansion."
        ],
        "invalidation": "Acceptance inside value (two consecutive candle opens/closes inside) cancels breakout expectations."
    },
    "risk": {
        "keywords": ["risk", "r:r", "lot size", "money management", "position size", "drawdown", "stop loss"],
        "title": "🛡️ Institutional Risk Management & Capital Preservation",
        "summary": "Professional trading is 90% risk management and execution discipline.",
        "rules": [
            "1. **The 1% Rule:** Never risk more than 1% to 1.5% of your total account equity on any single trade.",
            "2. **Minimum 1:2 R:R:** Every trade setup must offer at least 2R reward for each 1R risked to maintain positive expectancy.",
            "3. **Pre-Determined Stop Loss:** Place stop loss behind logical market structure (invalidation point), NEVER an arbitrary pip count.",
            "4. **Daily Loss Limit:** If you lose 2 consecutive trades in a single session, halt trading immediately and review your journal."
        ],
        "invalidation": "Moving a stop loss further away during an active trade is the #1 cause of catastrophic account blowups."
    }
}

async def query_gemini_api(prompt, system_instruction=""):
    if not GEMINI_API_KEY:
        return None
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": prompt}]}
        ],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 800
        }
    }
    if system_instruction:
        payload["systemInstruction"] = {
            "parts": [{"text": system_instruction}]
        }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    candidates = data.get("candidates", [])
                    if candidates:
                        text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                        return text
    except Exception:
        pass
    return None

def build_expert_response(question, context_video=None):
    q_lower = question.lower()
    matched_topics = []

    for key, topic in KNOWLEDGE_BASE.items():
        if any(kw in q_lower for kw in topic["keywords"]):
            matched_topics.append(topic)

    # If no specific keyword matched, check for general setup or checklist
    is_checklist = any(k in q_lower for k in ["checklist", "rules", "how to enter", "entry", "strategy"])
    
    if not matched_topics:
        # Default to SMC + Price Action core
        if is_checklist:
            matched_topics = [KNOWLEDGE_BASE["order_block"], KNOWLEDGE_BASE["liquidity"]]
        else:
            matched_topics = [KNOWLEDGE_BASE["order_block"]]

    chosen = matched_topics[0]
    
    context_banner = ""
    if context_video:
        v_title = context_video.get("title", "Active Lesson")
        context_banner = (
            f"🎬 **Video Context:** *{v_title}*\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        )

    rules_str = "\n".join(chosen["rules"])
    
    response = (
        f"🤖 **TRADING MENTOR AI EXPLANATION** 🎓\n\n"
        f"{context_banner}"
        f"❓ **Your Question:** *\"{question}\"*\n\n"
        f"{chosen['title']}\n"
        f"📖 **Core Concept:** {chosen['summary']}\n\n"
        f"🎯 **Rules & Execution Criteria:**\n"
        f"{rules_str}\n\n"
        f"⚠️ **Invalidation Point:**\n"
        f"👉 {chosen['invalidation']}\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💡 **Mentor Advice:** Before placing capital on this setup, backtest at least 20 historical occurrences on TradingView and ensure multi-timeframe alignment (HTF bias -> LTF execution)!"
    )
    return response

async def ask_trading_tutor(question, context_video=None):
    """
    Answers a trading question using Gemini API if key is set,
    or falls back seamlessly to the built-in institutional knowledge base.
    """
    sys_instruction = (
        "You are an elite institutional trading mentor specializing in Smart Money Concepts (SMC), "
        "ICT, Naked Price Action, Auction Market Theory, and professional risk management. "
        "Provide direct, actionable, step-by-step guidance formatted with clean markdown, bullet points, "
        "and clear entry/invalidation rules. Keep your response concise, professional, and practical."
    )

    context_str = ""
    if context_video:
        context_str = f"Context from the video the student is watching: Title: {context_video.get('title', '')}, Concepts: {context_video.get('concepts', '')}. "

    full_prompt = f"{context_str}Student Question: {question}"

    if GEMINI_API_KEY:
        gemini_result = await query_gemini_api(full_prompt, sys_instruction)
        if gemini_result:
            header = "🤖 **TRADING MENTOR AI** 🎓\n\n"
            if context_video:
                header += f"🎬 **Video Context:** *{context_video.get('title', '')}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
            return header + gemini_result

    # Fallback to rich built-in institutional engine
    return build_expert_response(question, context_video)
