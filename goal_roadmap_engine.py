"""
Goal Roadmap Engine - 6-Month Institutional Trader Transformation
Drives active video curriculums in 'today' and updates the pinned Master Dashboard in 'goal to achieve'.
"""

import json
import os

ROADMAP_PHASES = {
    1: {
        "month": 1,
        "title": "Month 1: Naked Price Action & Market Structure",
        "days": (1, 20),
        "target": "Master high-timeframe trend definition, liquidity pivots, and candlestick mechanics without lagging indicators.",
        "milestones": [
            "Identify structural Market Flow (HH/HL in uptrend, LH/LL in downtrend)",
            "Map Key HTF Support & Resistance on Daily / 4H charts",
            "Differentiate between Impulse legs and Corrective retracements",
            "Recognize Candlestick Exhaustion vs. Momentum Engulfing patterns",
            "Establish multi-timeframe top-down bias (Weekly -> Daily -> 15M)"
        ],
        "exit_criteria": "Accurately predict trend continuations vs. reversals on 20 raw historical charts."
    },
    2: {
        "month": 2,
        "title": "Month 2: Smart Money Concepts (SMC) & ICT Foundation",
        "days": (21, 40),
        "target": "Uncover institutional algorithms, smart money manipulation, and high-probability liquidity pools.",
        "milestones": [
            "Pinpoint Bullish & Bearish Order Blocks (OB) and mitigation zones",
            "Map Fair Value Gaps (FVG), Imbalances (BISI/SIBI), and Volume Imbalances",
            "Detect Break of Structure (BOS) vs. Change of Character (CHoCH)",
            "Identify Buy-Side Liquidity (BSL) & Sell-Side Liquidity (SSL) raid zones",
            "Calculate Premium vs. Discount pricing using Institutional Fibonacci (0.618 - 0.79 OTE)"
        ],
        "exit_criteria": "Spot liquidity sweeps and valid Order Block entries with tight stop-losses across 15 real market setups."
    },
    3: {
        "month": 3,
        "title": "Month 3: Advanced Execution Models & Session Timing",
        "days": (41, 60),
        "target": "Sync execution with institutional algorithms using Time and Price Theory across global sessions.",
        "milestones": [
            "Master London Open (02:00 - 05:00 EST) and New York AM (08:30 - 11:00 EST) Killzones",
            "Execute the ICT 2022 Model & Silver Bullet framework (10:00 - 11:00 AM NY)",
            "Trade the Asian Range Judas Swing (Liquidity trap before true trend)",
            "Apply Lower Timeframe (1M/5M) confirmation entries inside HTF Points of Interest (POI)",
            "Formulate precise Take-Profit targeting Internal vs. External range liquidity"
        ],
        "exit_criteria": "Achieve a minimum 2:1 Reward-to-Risk ratio across 20 forward-tested Killzone setups."
    },
    4: {
        "month": 4,
        "title": "Month 4: Auction Market Theory & Volume Profile",
        "days": (61, 80),
        "target": "Read the institutional auction, volume distribution, and order book absorption.",
        "milestones": [
            "Analyze Volume Profile: Point of Control (POC), Value Area High (VAH) & Value Area Low (VAL)",
            "Identify Volume Nodes (HVN = value acceptance, LVN = price rejection)",
            "Track Cumulative Volume Delta (CVD) divergence to spot hidden institutional accumulation",
            "Detect absorption vs. exhaustion around key institutional supply/demand zones",
            "Combine SMC market structure with Volume Profile confluence for high-conviction entries"
        ],
        "exit_criteria": "Filter out 80% of false breakouts using Volume Profile Value Area acceptance/rejection."
    },
    5: {
        "month": 5,
        "title": "Month 5: Quantitative Playbook & Systematic Backtesting",
        "days": (81, 100),
        "target": "Build an asymmetric mathematical edge with strict risk parameters and 100 logged backtests.",
        "milestones": [
            "Codify a written 1-page Trading Plan: setup checklist, entry trigger, stop-loss, profit-target",
            "Enforce strict 0.5% - 1.0% maximum risk per trade with position sizing calculators",
            "Execute and journal 100 backtested trades with win rate, profit factor, and max drawdown data",
            "Calculate mathematical expectancy: (Win Rate * Avg Win) - (Loss Rate * Avg Loss)",
            "Master psychological drawdown discipline and emotional neutrality during losing streaks"
        ],
        "exit_criteria": "A fully backtested 100-trade journal showing positive expectancy and max drawdown under 6%."
    },
    6: {
        "month": 6,
        "title": "Month 6: Prop Firm Funded Evaluation ($50k-$100k) & Capital Scaling",
        "days": (101, 120),
        "target": "Pass $50,000 - $100,000 Prop Firm Challenge (FTMO / MFF / FundedNext) and secure consistent payouts.",
        "milestones": [
            "Execute Prop Firm Phase 1 Challenge: 8% - 10% profit target with 0 rule violations",
            "Defend Max Daily Loss limit (5%) and Overall Max Drawdown limit (10%) with absolute discipline",
            "Pass Prop Firm Phase 2 Verification: 5% profit target with steady risk scaling",
            "Unlock Live Funded Trader Account and formulate capital preservation scaling roadmap",
            "Receive first official trader payout and build long-term institutional wealth"
        ],
        "exit_criteria": "Certificate of passing evaluation challenge and funded live trading account credential."
    }
}

# Detailed 120-Day Day-by-Day Syllabus Structure
ROADMAP_CURRICULUM_DAYS = {
    # Month 1: Naked Price Action (Days 1-20)
    1: {"topic": "The Anatomy of Price Action & Market Flow", "course": "Al Brooks Price Action Mastery", "concepts": "Bars, bodies, wicks, market cycles, trending vs ranging regimes", "exercise": "Identify and mark 3 clean trending legs and 2 consolidation ranges on the 1H chart."},
    2: {"topic": "Support & Resistance from an Institutional Perspective", "course": "Naked Forex & Order Flow", "concepts": "Static S/R, dynamic S/R, polarity flips, false breakout traps", "exercise": "Draw key support/resistance levels on Daily and 4H charts. Mark 1 retest entry."},
    3: {"topic": "High-Probability Candlestick Patterns in Context", "course": "Mastering Price Action Trading", "concepts": "Pin bars, engulfing candles, inside bars at structural extremes", "exercise": "Find 3 engulfing bar setups that formed strictly at major support/resistance zones."},
    4: {"topic": "Trend Structure: Higher Highs, Lower Lows & Trend Health", "course": "Price Action Blueprint", "concepts": "Market structure mapping, swing points, trend deceleration", "exercise": "Map all swing highs and swing lows on the 15M chart for the last 5 trading days."},
    5: {"topic": "Trendlines, Channels & Acceleration Breaks", "course": "Advanced Price Action", "concepts": "Trendline rules, channel trading, trendline breaks with momentum", "exercise": "Plot a channel on 1H chart. Note how price reacted when reaching the upper vs lower channel lines."},
    6: {"topic": "Chart Patterns: Double Tops/Bottoms & Neckline Breaks", "course": "Naked Forex", "concepts": "M and W patterns, liquidity above equal highs/lows, neckline retests", "exercise": "Identify 2 double tops and analyze whether volume/momentum confirmed the reversal."},
    7: {"topic": "Head & Shoulders, Quasimodo & Structural Reversals", "course": "Chart Pattern Mastery", "concepts": "H&S mechanics, left shoulder liquidity, Quasimodo entry points", "exercise": "Find 1 Quasimodo setup where the prior higher low was breached before entry."},
    8: {"topic": "Triangles, Wedges & Flags: Compression & Expansion", "course": "Price Action Blueprint", "concepts": "Volatility contraction patterns, bull/bear flags, breakout vs fakeout", "exercise": "Locate 1 bull flag on 15M and measure whether the breakout matched the flagpole distance."},
    9: {"topic": "Multi-Timeframe Analysis: Top-Down Bias (D -> 4H -> 15M)", "course": "Institutional Price Flow", "concepts": "Higher timeframe dominance, drill-down alignment, entry triggers", "exercise": "Establish Daily trend bias, 4H key zone, and execute simulated entry on 15M trigger."},
    10: {"topic": "Week 2 Review & 10-Chart Price Action Audit", "course": "Price Action Intensive", "concepts": "Consolidating Weeks 1-2 concepts, pattern recognition speed", "exercise": "Audit 10 historical chart setups without indicators and log win/loss probabilities."},
    11: {"topic": "Candlestick Biology: Wick Traps & Exhaustion Tails", "course": "Al Brooks Price Action", "concepts": "Long upper/lower shadows, rejection candles, absorption tails", "exercise": "Mark 5 long-wick rejection candles on 1H and document the following 3-candle reactions."},
    12: {"topic": "Breakouts: True Momentum vs. Liquidity Grab Traps", "course": "Naked Forex", "concepts": "Acceptance vs rejection, candle closes beyond levels, false breakout volume", "exercise": "Find 2 false breakouts and note where liquidity was trapped for counter-trend traders."},
    13: {"topic": "Dynamic S/R: Moving Average Bounces vs. Naked Pullbacks", "course": "Price Action Mastery", "concepts": "20 EMA dynamic confluence, mean reversion, trend continuation pullbacks", "exercise": "Test price reaction at 20 EMA pullbacks during strong trending sessions on 15M."},
    14: {"topic": "Market Regimes: Fast Trend, Slow Channel, Trading Range", "course": "Market Dynamics", "concepts": "Classifying market state before picking strategy, adapting risk rules", "exercise": "Classify the last 3 trading days into fast trend, broad channel, or tight range."},
    15: {"topic": "Volume Spread Basics: Effort vs. Result on Candles", "course": "Volume Spread Analysis", "concepts": "High volume narrow spread, ultra-high volume stopping action", "exercise": "Find a candle with abnormally large volume but small body; explain what happened."},
    16: {"topic": "Impulse Legs vs. Corrective Pullbacks: Speed & Angle", "course": "Advanced Price Action", "concepts": "Angular momentum, shallow vs deep retracements, exhaustion legs", "exercise": "Compare the angle of attack between an impulsive rally and its pullback."},
    17: {"topic": "Internal Range S/R vs External Extremes", "course": "Institutional Price Flow", "concepts": "Micro structure vs macro structure, session highs/lows", "exercise": "Mark Asian high/low and examine how London Open interacted with them."},
    18: {"topic": "Candlestick Confirmation: 2-Bar and 3-Bar Reversal Signals", "course": "Price Action Blueprint", "concepts": "Morning/Evening stars, tweezer tops/bottoms, railroad tracks", "exercise": "Find 2 railroad track candle setups at key swing points on 1H."},
    19: {"topic": "Pre-Market Preparation & Daily Chart Roadmap", "course": "Professional Routine", "concepts": "Marking levels before the bell, creating If-Then trade scenarios", "exercise": "Prepare a full pre-market watchlist of 3 assets with entry/stop/target plans."},
    20: {"topic": "Month 1 Graduation: 20-Setup Naked Chart Blind Test", "course": "Price Action Examination", "concepts": "Phase 1 synthesis: Trend, Level, Signal, Execution", "exercise": "Backtest 20 consecutive days of chart data using pure price action and compute R:R."},

    # Month 2: Smart Money Concepts (SMC) & ICT Foundation (Days 21-40)
    21: {"topic": "Order Blocks (OB): Bullish & Bearish Institutional Footprints", "course": "ICT Smart Money Masterclass", "concepts": "Last down/up candle before expansion, institutional buy/sell programs", "exercise": "Identify and box 3 valid Order Blocks that caused an immediate displacement."},
    22: {"topic": "Order Block Mitigation & Breaker Blocks", "course": "SMC Complete Guide", "concepts": "Unmitigated OBs, failed OB becoming Breaker Block, mitigation entries", "exercise": "Find 1 Breaker Block where an old failed OB flipped into a powerful support zone."},
    23: {"topic": "Fair Value Gaps (FVG) & Market Imbalances (BISI / SIBI)", "course": "ICT Core Concepts", "concepts": "3-candle imbalance pattern, inefficient price delivery, magnetic FVG retests", "exercise": "Mark 3 unfilled FVGs on the 15M chart and observe price behavior upon arrival."},
    24: {"topic": "Volume Imbalance & Opening Gaps", "course": "ICT 2022 Mentorship", "concepts": "Gaps between candle bodies, wick overlap gaps, institutional delivery", "exercise": "Locate 2 Volume Imbalances on 1H chart and note if price used them as support."},
    25: {"topic": "Break of Structure (BOS) vs. Change of Character (CHoCH)", "course": "Smart Money Concepts", "concepts": "Trend continuation (BOS) vs structural reversal (CHoCH), body vs wick breaks", "exercise": "Label every BOS and CHoCH on the 15M chart over a 48-hour trading window."},
    26: {"topic": "Internal vs External Range Liquidity & Market Flow", "course": "ICT Mentorship", "concepts": "Expansion from internal liquidity (FVG/OB) to external liquidity (Highs/Lows)", "exercise": "Trace price movement from an internal FVG target to external swing high liquidity."},
    27: {"topic": "Buy-Side Liquidity (BSL) & Sell-Side Liquidity (SSL) Pools", "course": "Institutional Liquidity", "concepts": "Equal Highs (EQH), Equal Lows (EQL), retail stop-loss clusters", "exercise": "Highlight 3 obvious EQH/EQL clusters where retail liquidity is pooled."},
    28: {"topic": "Liquidity Sweeps, Stop Runs & Turtle Soups", "course": "ICT Advanced Models", "concepts": "False breakout raid, wick sweep followed by rapid displacement", "exercise": "Document 2 Turtle Soup setups where old highs were swept by 5-10 pips before reversing."},
    29: {"topic": "Premium vs. Discount Pricing & Optimal Trade Entry (OTE)", "course": "ICT Fibonacci Mastery", "concepts": "Equilibrium (50%), Premium (above 50%), Discount (below 50%), 0.618-0.79 OTE", "exercise": "Apply the OTE Fib from swing low to high. Only take long setups in Discount."},
    30: {"topic": "SMC Week 6 Synthesis: OB + FVG + Liquidity Sweep Confluence", "course": "SMC Intensive", "concepts": "Stacking institutional confluences for 1:3+ Reward-to-Risk entries", "exercise": "Find 2 trade setups exhibiting OB, FVG, and liquidity raid confluence."},
    31: {"topic": "Inducement: The Retail Trap before True Institutional Entry", "course": "Smart Money Mastery", "concepts": "Minor swing highs/lows created to lure early retail entries", "exercise": "Identify an Inducement high that was swept right into a higher-timeframe Order Block."},
    32: {"topic": "Rejection Blocks: Wick-based Institutional Pricing", "course": "ICT Advanced", "concepts": "Trading long wicks as institutional rejection points", "exercise": "Box the upper 50% wick of a long-tail candle as a Rejection Block entry level."},
    33: {"topic": "Propulsion Blocks & Vacuum Blocks", "course": "ICT Institutional Mechanics", "concepts": "High-velocity momentum continuation from prior mitigated blocks", "exercise": "Spot a Propulsion Block that immediately pushed price into new highs."},
    34: {"topic": "Liquidity Voids: The Fast Runway & Rapid Repair", "course": "ICT Price Action", "concepts": "Consecutive large-range candles and how price returns to balance them", "exercise": "Identify a Liquidity Void on 1H and document how long price took to repair it."},
    35: {"topic": "Displacement: The Non-Negotiable Institutional Signature", "course": "Smart Money Blueprint", "concepts": "Energetic, long-bodied candles with imbalances proving bank participation", "exercise": "Review 5 reversals and verify whether displacement was present before entry."},
    36: {"topic": "Order Flow: Bullish & Bearish Chain of Mitigation", "course": "Institutional Order Flow", "concepts": "Consecutive OB mitigation validating sustained institutional trends", "exercise": "Map an intact Bearish Order Flow chain where every pullback mitigated the prior OB."},
    37: {"topic": "SMT Divergence (Smart Money Tool): Correlated Asset Cracks", "course": "ICT Intermarket Analysis", "concepts": "NQ making new high while ES fails to make new high (non-confirmation)", "exercise": "Compare ES and NQ charts at a key reversal point to spot SMT Divergence."},
    38: {"topic": "DXY Dollar Index Relationship & Currency Bias", "course": "Intermarket Forex", "concepts": "Dollar strength/weakness inverse correlation with EUR/USD and Gold", "exercise": "Overlay DXY with EUR/USD. Note how DXY liquidity sweeps trigger EUR moves."},
    39: {"topic": "Multi-Timeframe SMC: 4H POI to 1M ChOCH Entry Engine", "course": "SMC Precision Execution", "concepts": "Refining large 4H zones into sniper 1M/5M entries with 5-pip stop-losses", "exercise": "Take a 4H Order Block and drill down to 1M to capture the exact CHoCH entry."},
    40: {"topic": "Month 2 Graduation: Complete SMC Setup Validation Audit", "course": "SMC Examination", "concepts": "Phase 2 synthesis: Liquidity -> Sweep -> Displacement -> FVG/OB -> Entry", "exercise": "Execute 10 simulated SMC setups and document precision entry criteria."},

    # Month 3: Advanced Execution Models & Session Timing (Days 41-60)
    41: {"topic": "Time and Price Theory: The Algorithmic Clock", "course": "ICT Algorithmic Delivery", "concepts": "Why time is more important than price; algorithmic reset windows", "exercise": "Track price velocity at 00:00 NY, 02:00 NY, 08:30 NY, and 10:00 NY."},
    42: {"topic": "The Asian Range: High/Low Baseline & Liquidity Staging", "course": "Session Trading Mastery", "concepts": "20:00 - 00:00 EST Asian range boundaries, volatility compression", "exercise": "Box Asian session high and low across 5 trading days; observe breakout rates."},
    43: {"topic": "London Open Killzone (02:00 - 05:00 EST): The True Trend Maker", "course": "London Killzone Playbook", "concepts": "London manipulation, London high/low of the day, Judas swing", "exercise": "Document 3 London Open sessions where the low of the day was formed between 02:00-03:30."},
    44: {"topic": "The Judas Swing: The Ultimate False Breakout Blueprint", "course": "ICT Precision", "concepts": "Engineered false move against HTF bias to grab liquidity before real trend", "exercise": "Identify a Judas swing raid on the Asian High followed by an immediate reversal."},
    45: {"topic": "New York AM Killzone (08:30 - 11:00 EST): Macro Releases & Expansions", "course": "New York Killzone Playbook", "concepts": "08:30 news volatility, New York trend continuation vs reversal", "exercise": "Observe price reaction 5 minutes before and after 08:30 EST economic release."},
    46: {"topic": "ICT 2022 Mentorship Model: The Flagship Scalping Engine", "course": "ICT 2022 Mentorship", "concepts": "1. Liquidity Run -> 2. Market Structure Shift -> 3. FVG -> 4. OTE Entry", "exercise": "Execute 5 forward tests of the ICT 2022 Model during NY AM session."},
    47: {"topic": "The Silver Bullet Model: 10:00 - 11:00 AM NY Scalping", "course": "ICT Silver Bullet Blueprint", "concepts": "Fixed 1-hour execution window, first FVG formed after liquidity raid", "exercise": "Trade the 10:00-11:00 AM NY window exclusively for 3 days and record results."},
    48: {"topic": "London Close Killzone (10:00 - 12:00 EST): Profit Taking & Retracement", "course": "Session Dynamics", "concepts": "European desk close, liquidity drain, trend stalling and mean-reversion", "exercise": "Observe how trends stall and retrace into Equilibrium between 10:30 and 11:30 EST."},
    49: {"topic": "Daily Profiles: Classic Expansion vs Range vs Consolidate & Reversal", "course": "ICT Daily Bias", "concepts": "Open-High-Low-Close (OHLC) daily bar formation, Power of 3 (AMD)", "exercise": "Predict whether tomorrow will be an Accumulation-Manipulation-Distribution day."},
    50: {"topic": "Power of 3 (AMD): Accumulation, Manipulation, Distribution", "course": "Institutional AMD Framework", "concepts": "Asian accumulation, London manipulation, New York distribution", "exercise": "Annotate the AMD phases on yesterday's 15M chart for EUR/USD or Gold."},
    51: {"topic": "Weekly Profiles: Tuesday Low of Week vs Wednesday Midweek Reversal", "course": "ICT Weekly Delivery", "concepts": "Standard weekly expansion cycle, high/low of week timing", "exercise": "Review 4 weeks of charts and verify which day of the week formed the weekly high/low."},
    52: {"topic": "Economic Calendar Impact: High Impact News Execution Protocol", "course": "Macro Event Trading", "concepts": "CPI, NFP, FOMC, PPI; pre-news defense, post-news continuation", "exercise": "Log market reaction to a major news release; verify which liquidity pool was raided."},
    53: {"topic": "Lower Timeframe Precision: 1-Minute Sniper Entry Refinement", "course": "Sniper Execution", "concepts": "1M FVG inside 15M Order Block, micro CHoCH confirmation", "exercise": "Refine a 15M setup down to a 1M entry with an 8-pip stop loss."},
    54: {"topic": "Stop Loss Placement: Institutional Invalidation Points", "course": "Risk Management", "concepts": "Never use arbitrary pip stops; place stops beyond structural invalidation OBs", "exercise": "Set stop-losses strictly behind the candle that initiated displacement on 5 trades."},
    55: {"topic": "Partial Take-Profits & Trailing Stops: The Pay-Yourself Rule", "course": "Trade Management", "concepts": "Taking 50% off at internal liquidity, moving to break-even safely", "exercise": "Simulate taking partial profit at 1:2 R:R and letting the runner target external liquidity."},
    56: {"topic": "The Retracement Entry vs. The Breakout Continuation Model", "course": "Execution Models", "concepts": "Choosing between buying deep discounts vs trading momentum expansions", "exercise": "Compare the win rate and R:R of 5 limit pullback entries vs 5 market break entries."},
    57: {"topic": "Trade Management During Live Volatility", "course": "Live Tape Reading", "concepts": "Managing emotions when price consolidates near stop-loss or target", "exercise": "Practice hands-off trade management: place TP and SL, then step away from screen."},
    58: {"topic": "Session Scalping Playbook: 10-15 Pip Daily Consistency Model", "course": "Intraday Scalping", "concepts": "Targeting high-probability 15 pips per day with fixed risk", "exercise": "Execute 3 scalping setups aiming for fixed 15 pips during NY Open."},
    59: {"topic": "Developing Your Personal Execution Checklist", "course": "Trading Plan Mastery", "concepts": "The 5-point non-negotiable rule filter before entering any position", "exercise": "Write down your 5-point entry checklist and print/save it next to your charts."},
    60: {"topic": "Month 3 Graduation: Live Forward-Testing Session Simulation", "course": "Execution Examination", "concepts": "Phase 3 synthesis: Algorithmic Timing + Silver Bullet + ICT 2022", "exercise": "Forward test 10 live market sessions and achieve minimum 2:1 R:R overall."},

    # Month 4: Auction Market Theory & Volume Profile (Days 61-80)
    61: {"topic": "Auction Market Theory: How Financial Markets Really Operate", "course": "Auction Market Mastery", "concepts": "Buyers and sellers seeking fair value, price discovery, market efficiency", "exercise": "Explain why price moved away from an old balance area in today's session."},
    62: {"topic": "Volume Profile Basics: Visible Range vs Fixed Range Profile", "course": "Volume Profile Blueprint", "concepts": "VPVR, FRVP, horizontal volume distribution vs vertical bar volume", "exercise": "Apply Fixed Range Volume Profile over the last major impulse swing."},
    63: {"topic": "Point of Control (POC): The Institutional Magnet", "course": "Volume Profile Advanced", "concepts": "Highest volume price level, Naked POCs (untested POCs as magnets)", "exercise": "Mark all Naked POCs from the last 5 trading days; observe how price reacts upon retest."},
    64: {"topic": "Value Area High (VAH) & Value Area Low (VAL): 70% Rule", "course": "Market Profile Mechanics", "concepts": "Value Area boundaries, 1-standard deviation volume containment", "exercise": "Observe if price spends 70% of the session trading inside yesterday's Value Area."},
    65: {"topic": "High Volume Nodes (HVN) vs. Low Volume Nodes (LVN)", "course": "Volume Profile Intensive", "concepts": "HVN = acceptance/chop, LVN = price rejection/fast travel zones", "exercise": "Identify an LVN and note how price sliced through it with high velocity."},
    66: {"topic": "Market Profile / TPO Charts: Letters, Singles & Poor Highs/Lows", "course": "TPO Market Profile", "concepts": "Time-Price-Opportunity charts, single prints, excess vs poor extremes", "exercise": "Locate a poor high on a TPO chart and explain why it must be repaired."},
    67: {"topic": "The 80% Rule in Auction Market Theory", "course": "Volume Profile Strategies", "concepts": "If price opens outside Value Area and moves inside for two 30-min bars, 80% chance to reach opposite VA", "exercise": "Backtest 5 instances of the 80% Value Area Rule on 30M charts."},
    68: {"topic": "Volume Profile + SMC Confluence: POC Alignment with Order Blocks", "course": "Institutional Confluence", "concepts": "When an ICT Order Block overlaps directly with a High Volume Node / POC", "exercise": "Find 2 setups where an unmitigated Order Block coincided precisely with a Naked POC."},
    69: {"topic": "Cumulative Volume Delta (CVD): Buyers vs Sellers Market Orders", "course": "Order Flow & Delta", "concepts": "Delta = aggressive buy volume - aggressive sell volume, delta trends", "exercise": "Monitor CVD during a breakout to verify whether aggressive buyers are supporting it."},
    70: {"topic": "CVD Divergence: The Hidden Institutional Absorption Footprint", "course": "Advanced Delta Analysis", "concepts": "Price making higher highs while CVD makes lower highs (passive sellers absorbing)", "exercise": "Document 2 instances of CVD Divergence preceding a market reversal."},
    71: {"topic": "Footprint Charts & Bid/Ask Imbalance", "course": "Footprint Order Flow", "concepts": "Inside-the-bar trade data, stacked buying/selling imbalances (300%+)", "exercise": "Observe a stacked selling imbalance at the top of a resistance swing."},
    72: {"topic": "Absorption vs. Exhaustion at Key Support/Resistance", "course": "Order Flow Mechanics", "concepts": "High volume with no price movement (absorption) vs vanishing volume (exhaustion)", "exercise": "Classify a failed breakout as either limit absorption or aggressive exhaustion."},
    73: {"topic": "Developing Value vs. Fixed Daily Value", "course": "Volume Profile Mastery", "concepts": "Real-time value migration during trending sessions", "exercise": "Track how the Value Area migrated higher during a strong bull day."},
    74: {"topic": "Open Types: Open Drive, Open Test-Drive, Open Rejection-Reverse", "course": "Auction Market Strategy", "concepts": "Opening 15-minute classification determines the entire day's gameplan", "exercise": "Classify today's market open into one of the 4 classic Open Types."},
    75: {"topic": "Trading the Value Area Edge: VAH/VAL Mean Reversion Models", "course": "Volume Profile Trading", "concepts": "Fade setups at Value Area extremes back to the Point of Control", "exercise": "Simulate 3 mean-reversion trades taking profit strictly at the POC."},
    76: {"topic": "Breakout of Value: Acceptance Outside the Value Area", "course": "Volume Profile Momentum", "concepts": "Initiative buyers establishing value higher, expanding into new ranges", "exercise": "Identify a Value Area breakout where two 30-min candles closed above VAH."},
    77: {"topic": "Composite Volume Profile: Multi-Week Balance Zones", "course": "Macro Auction Theory", "concepts": "Viewing 30-day and 90-day balance profiles for HTF targets", "exercise": "Plot a 30-day composite profile on Daily chart and mark the macro POC."},
    78: {"topic": "Combining VWAP (Volume-Weighted Average Price) with Volume Profile", "course": "VWAP Institutional Trading", "concepts": "Daily VWAP, standard deviation bands (+1, +2), VWAP slope", "exercise": "Test buying pullbacks to the VWAP line during an upward value migration day."},
    79: {"topic": "Order Flow Scalping Checklist: The Final Entry Trigger", "course": "Precision Order Flow", "concepts": "Confirming SMC setups with order book absorption and delta flip", "exercise": "Synthesize SMC + Volume Profile + Delta into a 3-step confirmation rule."},
    80: {"topic": "Month 4 Graduation: Auction Market Strategy Comprehensive Exam", "course": "Volume Examination", "concepts": "Phase 4 synthesis: VPVR + POC + CVD Divergence + Absorption", "exercise": "Execute 10 simulated trades using Auction Market Theory and log accuracy."},

    # Month 5: Quantitative Playbook & Systematic Backtesting (Days 81-100)
    81: {"topic": "The Mathematical Edge: Expectancy & Risk of Ruin", "course": "Quantitative Trading Edge", "concepts": "Expectancy formula: (Win Rate * Avg Win) - (Loss Rate * Avg Loss), edge verification", "exercise": "Calculate your mathematical expectancy based on your last 30 practice trades."},
    82: {"topic": "Asymmetric Risk-Reward: Why 1:3 R:R Beats 80% Win Rate", "course": "Institutional Money Management", "concepts": "The power of asymmetric payoff; making money even with 40% win rate", "exercise": "Model a 100-trade sequence with 40% win rate and 1:3 R:R. Calculate net return."},
    83: {"topic": "Position Sizing & Fixed Fractional Risk Modeling", "course": "Risk Management", "concepts": "Risking exactly 0.5% - 1.0% per trade; calculating lot size from stop pips", "exercise": "Calculate the exact lot size for EUR/USD with $50,000 balance, 0.75% risk, 14-pip stop."},
    84: {"topic": "The 1-Page Written Trading Plan: Your Institutional Charter", "course": "Professional Trading Business", "concepts": "Codifying instruments, sessions, setup criteria, entry, SL, TP, daily max loss", "exercise": "Draft your complete 1-page Trading Plan document and sign it."},
    85: {"topic": "Trade Journal Architecture: What Professional Traders Track", "course": "Performance Analytics", "concepts": "Setup type, R-multiple captured, emotional state, execution mistakes, MAE/MFE", "exercise": "Create your spreadsheet/notion trading journal with all mandatory metric columns."},
    86: {"topic": "Backtesting Framework: Manual Bar-by-Bar Replay Simulation", "course": "Systematic Backtesting", "concepts": "Using TradingView Bar Replay without hindsight bias, strict journaling", "exercise": "Backtest 10 trades of your primary setup using bar replay mode."},
    87: {"topic": "Backtesting Batch 1: Trades 1–25 (Logging Baseline Metrics)", "course": "Backtesting Lab", "concepts": "Executing trades 1-25 with exact rules, no deviations", "exercise": "Log 25 backtested trades; record win rate, average win, average loss."},
    88: {"topic": "Backtesting Batch 2: Trades 26–50 (Refining Invalidation Points)", "course": "Backtesting Lab", "concepts": "Analyzing losing trades; identifying avoidable early stops", "exercise": "Log trades 26-50; observe if refined stop loss improves profit factor."},
    89: {"topic": "Backtesting Batch 3: Trades 51–75 (Testing Different Profit Targets)", "course": "Backtesting Lab", "concepts": "Comparing 1:2 fixed target vs trailing stops vs external liquidity targets", "exercise": "Log trades 51-75; compare net profit of fixed 1:2 R:R vs trailing runner."},
    90: {"topic": "Backtesting Batch 4: Trades 76–100 (Final 100-Trade Dataset)", "course": "Backtesting Lab", "concepts": "Completing the full 100-trade empirical statistical sample", "exercise": "Complete trades 76-100; compute cumulative return, win rate, and max drawdown."},
    91: {"topic": "Analyzing Your 100-Trade Data: MAE, MFE & Profit Factor", "course": "Quantitative Analytics", "concepts": "Maximum Adverse Excursion, Maximum Favorable Excursion, optimizing stops", "exercise": "Analyze MAE of all losing trades: were stops too tight or entries too early?"},
    92: {"topic": "The Psychology of Drawdown: Surviving 5 Consecutive Losses", "course": "Trading Psychology Mastery", "concepts": "Statistical certainty of loss clusters; emotional resilience, revenge trading prevention", "exercise": "Simulate a 5-loss losing streak in your calculator. Verify account drawdown is under 5%."},
    93: {"topic": "FOMO & Patience: The Art of Waiting for A+ Setups", "course": "Trader Discipline", "concepts": "Protecting mental capital; why sitting on your hands is an active trade", "exercise": "Spend an entire live session without taking a trade if no A+ setup triggers."},
    94: {"topic": "Pre-Trade Mental Priming & Post-Trade Decompression", "course": "Performance Psychology", "concepts": "Athletic routine for traders: breathing, visualization, objective journaling", "exercise": "Implement a 10-minute pre-market routine and 5-minute post-market review."},
    95: {"topic": "Managing Greed: Why Overleveraging Destroys Edge", "course": "Capital Preservation", "concepts": "Gambler's ruin paradox; the compounding miracle of small consistent wins", "exercise": "Calculate compound growth of 3% monthly return on $100k account over 3 years."},
    96: {"topic": "Eliminating Common Execution Errors: The 7 Deadly Trading Sins", "course": "Professional Mastery", "concepts": "Moving stops, widening risk, taking random trades, trading off-session", "exercise": "Audit your journal for any rule violations in the last 20 trades. Penalize errors."},
    97: {"topic": "Building a Daily Routine Schedule: Time Blocking for Success", "course": "Elite Trader Habits", "concepts": "Balancing chart study, exercise, rest, journaling, backtesting", "exercise": "Block out your weekly calendar with dedicated trading and study time slots."},
    98: {"topic": "Accountability & Peer Review: The 1-on-1 AI Tutor Audit", "course": "Trading Mentorship", "concepts": "Using `/tutor` and `/ask` to critique setups and analyze rationale", "exercise": "Run a 1-on-1 session with the AI Tutor reviewing your worst losing trade."},
    99: {"topic": "The 100-Trade Playbook Final Audit & Verification", "course": "Playbook Finalization", "concepts": "Locking in the exact strategy to use for Prop Firm Evaluation", "exercise": "Present your completed 100-trade verified playbook with positive expectancy."},
    100: {"topic": "Month 5 Graduation: The Institutional Trading License", "course": "Systematic Examination", "concepts": "Phase 5 synthesis: Playbook + Journal + Statistical Edge + Iron Discipline", "exercise": "Formally declare readiness to begin the Prop Firm Evaluation Challenge."},

    # Month 6: Prop Firm Funded Evaluation ($50k-$100k) & Capital Scaling (Days 101-120)
    101: {"topic": "Prop Firm Landscape: FTMO, FundedNext, MFF & Rule Matrix", "course": "Prop Firm Masterclass", "concepts": "Evaluation models (1-step vs 2-step), profit splits, drawdown calculations", "exercise": "Compare rules across top 3 prop firms and select the optimal evaluation model."},
    102: {"topic": "The Two Numbers That Matter: Max Daily Loss (5%) & Max Total Loss (10%)", "course": "Prop Firm Defense", "concepts": "Balance-based vs equity-based drawdown; avoiding accidental breaches", "exercise": "Calculate the exact dollar loss limit for each day on a $50,000 account ($2,500 daily)."},
    103: {"topic": "Phase 1 Strategy: How to Hit 8%-10% Without Rushing", "course": "Challenge Strategy", "concepts": "Pacing: 4-6 winning trades over 20 trading days is all you need", "exercise": "Plan out a 20-day challenge schedule targeting 0.5% net profit per day."},
    104: {"topic": "Risk Calibration for Evaluations: The 0.5% Rule", "course": "Prop Firm Money Management", "concepts": "Why risking 0.5% gives you 10 consecutive losses before hitting daily limit", "exercise": "Set your position sizing calculator strictly to 0.5% risk for all challenge trades."},
    105: {"topic": "News Trading Defense: High Impact News Restrictions", "course": "Prop Firm Rules", "concepts": "2-minute news rule, slippage traps, protecting profits during economic releases", "exercise": "Identify all news events for the upcoming week and mark 'no-trade' windows."},
    106: {"topic": "Weekend Holding Rules & Overnight Financing Fees", "course": "Prop Firm Compliance", "concepts": "Managing open swing positions, weekend gap risk, prop firm holding rules", "exercise": "Verify whether your chosen challenge allows weekend crypto/forex holding."},
    107: {"topic": "Consistency Rules & Lot Size Uniformity", "course": "Prop Firm Compliance", "concepts": "Avoiding 50% single-day profit rule violations; keeping lot sizes consistent", "exercise": "Verify your strategy produces distributed profits across multiple trading days."},
    108: {"topic": "Executing Phase 1 Simulation: Day 1–5 (Defending Starting Capital)", "course": "Live Challenge Lab", "concepts": "Prioritizing capital preservation over profit during the first 5 challenge days", "exercise": "Simulate Phase 1 Days 1-5; goal is 0 rule violations and steady equity curve."},
    109: {"topic": "Executing Phase 1 Simulation: Day 6–10 (Securing the First R-Multiples)", "course": "Live Challenge Lab", "concepts": "Targeting 3% - 4% equity buffer to trade stress-free", "exercise": "Simulate Phase 1 Days 6-10; execute only A+ setups with 1:2 minimum R:R."},
    110: {"topic": "Executing Phase 1 Simulation: Day 11–15 (Reaching 8% Profit Target)", "course": "Live Challenge Lab", "concepts": "Scaling back risk when near target; never risking profits on reckless trades", "exercise": "Simulate reaching the 8% target; calculate final challenge metrics."},
    111: {"topic": "Phase 2 Verification Blueprint: Lower Target (5%), Zero Rush", "course": "Phase 2 Strategy", "concepts": "Phase 2 psychology: avoiding the overconfidence trap, steady execution", "exercise": "Formulate your Phase 2 risk plan (lowering risk to 0.4% per trade)."},
    112: {"topic": "Executing Phase 2 Simulation: Day 16–20 (Securing Funded Account)", "course": "Verification Lab", "concepts": "Clinical execution, passing Phase 2 verification, receiving funded credentials", "exercise": "Simulate Phase 2 completion; log certified passing scorecard."},
    113: {"topic": "The Live Funded Account: Transitioning from Demo to Real Capital", "course": "Funded Trader Mindset", "concepts": "Managing psychological pressure when real money is on the line", "exercise": "Write down a commitment contract: trade the funded account exactly like the demo."},
    114: {"topic": "The First 30 Days Funded: Capital Preservation Above All", "course": "Funded Trader Management", "concepts": "Goal is securing the first payout, not doubling the account", "exercise": "Plan your first month funded schedule: target 3% - 5% profit to lock in first payout."},
    115: {"topic": "The First Payout Protocol: Locking in Profit Splits (80% - 90%)", "course": "Capital Realization", "concepts": "Requesting payout, receiving bank/crypto transfer, rewarding yourself", "exercise": "Calculate your payout split on a 4% monthly gain ($50k * 4% * 80% = $1,600)."},
    116: {"topic": "Capital Scaling Plans: Growing to $200k, $500k, $1,000,000 Allocation", "course": "Institutional Scaling", "concepts": "How prop firms scale funded accounts by 25% every 4 months of consistency", "exercise": "Map out your 2-year capital scaling trajectory from $50k to $500k allocation."},
    117: {"topic": "Multi-Account Portfolio Management: Trade Copiers & Diversification", "course": "Portfolio Trading", "concepts": "Running trade copiers across 2-3 prop firms to manage $200k+ total capital", "exercise": "Research trade copier architecture and latency management across broker servers."},
    118: {"topic": "Tax Structure, Business Incorporation & Professional Trading Setup", "course": "Trader Business Management", "concepts": "Treating trading as a legitimate LLC/business, tax deductions, accounting", "exercise": "Outline business expenses: hardware, software, subscriptions, education."},
    119: {"topic": "Lifelong Mastery: Continuing the Daily Habit Loop Forever", "course": "The Master Trader", "concepts": "Maintaining humility, continuous market adaptation, lifelong learning", "exercise": "Write your 5-year trader vision: where will your trading business be in 2031?"},
    120: {"topic": "GRAND GRADUATION: The 6-Month Master Trader Transformation Complete", "course": "Institutional Graduation", "concepts": "Full transformation: Naked Price Action -> SMC -> Killzones -> Auction -> Edge -> Funded", "exercise": "Review Day 1 journal vs Day 120 journal. Celebrate your institutional discipline! 🏆"}
}

def get_lesson_for_day(day_num: int):
    """Returns (week_num, week_title, lesson_dict) for any day 1 to 120."""
    day_num = max(1, min(120, day_num))
    phase = get_current_phase(day_num)
    week_num = ((day_num - 1) // 5) + 1
    week_title = f"{phase['title']} • Week {week_num}"
    
    lesson = ROADMAP_CURRICULUM_DAYS.get(day_num)
    if not lesson:
        lesson = {
            "topic": f"Mastery & Application Session {day_num}",
            "course": "Institutional Trading Masterclass",
            "concepts": phase["target"],
            "exercise": f"Review 5 charts applying {phase['title']} concepts."
        }
    return week_num, week_title, lesson

def get_current_phase(current_day: int) -> dict:
    for p_id, p in ROADMAP_PHASES.items():
        if p["days"][0] <= current_day <= p["days"][1]:
            return p
    return ROADMAP_PHASES[6]

def make_progress_bar(current_day: int, total_days: int = 120, bar_length: int = 18) -> str:
    pct = min(1.0, max(0.0, current_day / total_days))
    filled = int(round(bar_length * pct))
    bar = "█" * filled + "░" * (bar_length - filled)
    return f"[{bar}] {pct * 100:.1f}%"

def render_master_dashboard(progress_data: dict, channels_cfg: dict) -> str:
    curr_day = progress_data.get("current_day", 1)
    streak = progress_data.get("streak", 0)
    best_streak = progress_data.get("best_streak", 0)
    buffer_days = progress_data.get("buffer_days", 0)
    completed = len(progress_data.get("completed_days", []))
    
    phase = get_current_phase(curr_day)
    prog_bar = make_progress_bar(curr_day, 120, 16)
    
    today_link = channels_cfg.get("today_link", "https://t.me/+yOo23RcdbMJhYTU1")
    yesterday_link = channels_cfg.get("yesterday_link", "https://t.me/+YmLMLYqH9GM0MjU1")
    learning_link = channels_cfg.get("learning_link", "https://t.me/+TfOQpTVcZ6I2OTRl")
    
    msg = (
        "╔══════════════════════════════════════╗\n"
        "║  🏆 6-MONTH MASTER TRADING ROADMAP   ║\n"
        "║      TARGET: $50,000 - $100,000      ║\n"
        "║      PROP FIRM FUNDED TRADER         ║\n"
        "╚══════════════════════════════════════╝\n\n"
        f"🎯 **OVERALL ROADMAP PROGRESS**\n"
        f"`{prog_bar}` • **Day {curr_day} of 120**\n"
        f"• Completed Sessions: **{completed} / 120**\n"
        f"• Daily Streak: **{streak} Days** 🔥 (Best: {best_streak})\n"
        f"• Buffer Days Banked: **{buffer_days} Days** 🛡️\n\n"
        "───────────────────────────────\n"
        f"📍 **CURRENT ACTIVE PHASE: Month {phase['month']}**\n"
        f"⚡ **{phase['title']}**\n"
        f"🎯 *Target*: {phase['target']}\n"
        f"📅 *Pacing*: Days {phase['days'][0]} – {phase['days'][1]} (Day {curr_day} Active)\n\n"
        "───────────────────────────────\n"
        "🧭 **4-CHANNEL COMMAND CENTER**\n"
        f"1️⃣ [📅 Today Channel]({today_link}) ➔ Watch Today's Active Lesson (Day {curr_day})\n"
        f"2️⃣ [⏪ Yesterday Channel]({yesterday_link}) ➔ Catch-Up on Unwatched Lessons\n"
        f"3️⃣ [📚 Learning Vault]({learning_link}) ➔ 1,140+ Streamable Video Archive\n"
        f"4️⃣ [🎯 Goal Channel] ➔ Live 6-Month Roadmap & Milestones (Here)\n\n"
        "───────────────────────────────\n"
        "⚡ **LIVE BOT COMMANDS (In Chat / Comments)**\n"
        "• `/goal` ➔ Instant roadmap & progress bar status\n"
        "• `/milestone` ➔ View current month's syllabus checklist\n"
        "• `/log <N>` ➔ Log completed video serial number (Updates this dashboard)\n"
        "• `/ask <question>` ➔ Ask AI Trading Mentor institutional insights\n"
        "• `/tutor` ➔ Interactive 1-on-1 trading coaching session\n"
        "• `/search <query>` ➔ Search 670+ video lessons instantly\n\n"
        "📌 *This dashboard updates live each time you complete a lesson! Stay disciplined.*"
    )
    return msg

def render_phase_post(phase_num: int, channels_cfg: dict) -> str:
    p = ROADMAP_PHASES[phase_num]
    today_link = channels_cfg.get("today_link", "https://t.me/+yOo23RcdbMJhYTU1")
    
    milestone_bullets = "\n".join([f"  ✅ `[ ]` {m}" for m in p["milestones"]])
    
    msg = (
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📌 **PHASE {phase_num}: {p['title'].upper()}**\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"📅 **Timeframe**: Days {p['days'][0]} – {p['days'][1]} (Weeks {((phase_num-1)*4)+1} – {phase_num*4})\n"
        f"🎯 **Core Mission**:\n{p['target']}\n\n"
        f"📋 **Milestone Checklist**:\n"
        f"{milestone_bullets}\n\n"
        f"🏁 **Phase Graduation Criteria**:\n"
        f"👉 *{p['exit_criteria']}*\n\n"
        f"🎬 **Video Stream Link**: Daily curated lessons are posted to [📅 Today Channel]({today_link}).\n"
        f"Log completion daily with `/log <N>` to advance your roadmap!"
    )
    return msg

def render_prop_firm_rules_post() -> str:
    msg = (
        "╔══════════════════════════════════════╗\n"
        "║  🛡️ PROP FIRM EVALUATION PLAYBOOK    ║\n"
        "║     $50k - $100k CHALLENGE RULES     ║\n"
        "╚══════════════════════════════════════╝\n\n"
        "Prop firms do not test how much money you can make; they test whether you can **manage risk without blowing up**.\n\n"
        "🔴 **NON-NEGOTIABLE RISK RULES**:\n"
        "1. **Max Daily Loss Limit: 5%**\n"
        "   - Never risk more than 1% per day (maximum 2 trades of 0.5% each).\n"
        "   - If down -1.5% in a day, STOP trading immediately. Close terminal.\n\n"
        "2. **Overall Max Drawdown: 10%**\n"
        "   - Account equity must NEVER dip below 90% of starting balance.\n"
        "   - Calculate position size precisely before entering any order.\n\n"
        "3. **Profit Target: Phase 1 (8%), Phase 2 (5%)**\n"
        "   - Take high-probability A+ setups only with minimum 1:2 R:R.\n"
        "   - 4-5 solid winning trades are enough to pass without rushing.\n\n"
        "4. **News & Weekend Holding Protocol**\n"
        "   - Flatten all intraday positions 10 minutes prior to High-Impact News (CPI, NFP, FOMC).\n"
        "   - No holding positions over the weekend.\n\n"
        "🧠 **THE PROFESSIONAL MINDSET**:\n"
        "• *Losses are just the cost of doing business. Trade the system, not the PnL.*\n"
        "• Complete the 120-Day syllabus before taking your first real evaluation!"
    )
    return msg
