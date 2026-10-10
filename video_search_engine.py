import re
import json
import asyncio
from pathlib import Path
from telethon import TelegramClient

PLAYLIST_TOPICS = {
    "ict": {
        "title": "🏛️ Smart Money Concepts & ICT Masterclass",
        "keywords": ["ict", "smc", "order block", "liquidity", "fvg", "fair value gap", "breaker", "smart money"]
    },
    "smc": {
        "title": "🏛️ Smart Money Concepts & ICT Masterclass",
        "keywords": ["ict", "smc", "order block", "liquidity", "fvg", "fair value gap", "breaker", "smart money"]
    },
    "price_action": {
        "keywords": ["price action", "support", "resistance", "snr", "candlestick", "candle", "trendline"],
        "title": "📊 Naked Price Action & Chart Reading"
    },
    "scalping": {
        "keywords": ["scalp", "scalping", "intraday", "1m", "5m", "quick entry", "execution"],
        "title": "⚡ Precision Scalping & Intraday Execution"
    },
    "volume": {
        "keywords": ["volume", "profile", "poc", "value area", "auction", "market profile"],
        "title": "📈 Volume Profile & Auction Market Theory"
    },
    "algo": {
        "keywords": ["algo", "algorithmic", "python", "backtest", "automated", "bot", "rules"],
        "title": "🤖 Algorithmic & Quantitative Trading"
    }
}

def load_community_config():
    cfg_file = Path("community_channels.json")
    if cfg_file.exists():
        try:
            with open(cfg_file) as f:
                return json.load(f)
        except Exception:
            pass
    return {}

async def search_learning_videos(client, query, limit=5):
    """
    Searches across streamable videos in 'learning' matching query.
    Returns list of dicts: [{msg_id, title, channel_link, topics}]
    """
    cfg = load_community_config()
    learning_id = cfg.get("learning_id")

    if not learning_id:
        return []

    target_channel = await client.get_entity(learning_id)
    query_lower = query.lower().strip()
    q_words = [w for w in re.findall(r'\w+', query_lower) if len(w) > 2]
    matches = []

    # Iterate messages in learning channel (scanning up to 400 messages)
    async for msg in client.iter_messages(target_channel, limit=400):
        if not msg.video:
            continue

        text = msg.message or ""
        file_name = getattr(msg.file, 'name', '') or ""
        searchable_text = f"{text} {file_name}".lower()

        is_match = False
        if query_lower in searchable_text:
            is_match = True
        elif q_words and any(w in searchable_text for w in q_words):
            is_match = True

        if is_match:
            title = ""
            lines = text.splitlines()
            if lines and lines[0].strip():
                title = re.sub(r'[*_#`🎬]', '', lines[0]).strip()
            if not title and file_name:
                title = file_name.replace('_', ' ').replace('-', ' ')
                title = re.sub(r'\.\w+$', '', title)
            if not title:
                title = f"Trading Lesson (ID: {msg.id})"

            hashtags = re.findall(r'#\w+', text)
            tags_str = " ".join(hashtags[:3]) if hashtags else "#Trading"

            matches.append({
                "msg_id": msg.id,
                "title": title[:70],
                "tags": tags_str,
                "link": f"https://t.me/c/{abs(learning_id) % 10000000000}/{msg.id}"
            })

            if len(matches) >= limit:
                break

    return matches

async def get_curated_playlist(client, topic_key, limit=5):
    """
    Returns a curated playlist of videos from 'learning' for a specific trading style.
    """
    topic_info = PLAYLIST_TOPICS.get(topic_key.lower())
    if not topic_info:
        # Fallback to general SMC
        topic_info = PLAYLIST_TOPICS["ict"]

    keywords = topic_info["keywords"]
    cfg = load_community_config()
    learning_id = cfg.get("learning_id")
    if not learning_id:
        return topic_info["title"], []

    target_channel = await client.get_entity(learning_id)
    matches = []

    async for msg in client.iter_messages(target_channel, limit=300):
        if not msg.video:
            continue
        text = (msg.message or "").lower()
        if any(kw in text for kw in keywords):
            lines = (msg.message or "").splitlines()
            title = re.sub(r'[*_#`🎬]', '', lines[0]).strip() if lines else f"Lesson #{msg.id}"
            matches.append({
                "msg_id": msg.id,
                "title": title[:70],
                "link": f"https://t.me/c/{abs(learning_id) % 10000000000}/{msg.id}"
            })
            if len(matches) >= limit:
                break

    return topic_info["title"], matches
