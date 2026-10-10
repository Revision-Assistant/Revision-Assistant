# 🌐 Deploy Trading Mentor Bot Online (24/7 Free Cloud Hosting)

This guide shows how to deploy your **Trading Mentor Bot** online so it stays active 24/7 even when your PC is turned off.

---

## 🚀 Option 1: Free 24/7 Hosting on Render (Recommended)

1. **Push your code to GitHub:**
   - Create a private repository on GitHub (e.g. `telegram-trading-bot`).
   - Push this folder to your repository.
2. **Go to [Render.com](https://render.com):**
   - Sign up for free using your GitHub account.
   - Click **New +** -> **Background Worker**.
   - Select your GitHub repository.
3. **Configure Environment Variables:**
   - In Render's dashboard under **Environment**:
     - `API_ID`: Your Telegram API ID
     - `API_HASH`: Your Telegram API Hash
     - `BOT_TOKEN`: (Optional) Your `@BotFather` bot token if using a standalone bot.
4. **Deploy:**
   - Click **Create Background Worker**.
   - Render automatically reads the `Dockerfile` and runs `python trading_mentor_bot.py` 24/7 for free!

---

## ⚡ Option 2: 1-Click Deploy on Railway.app

1. Go to [Railway.app](https://railway.app).
2. Click **New Project** -> **Deploy from GitHub repo**.
3. Add your environment variables (`API_ID`, `API_HASH`, etc.).
4. Railway will automatically detect the `Procfile` and keep the bot running 24/7!

---

## 🖥️ Option 3: VPS / Linux Server (Systemd / Docker)

If you have a Linux VPS or cloud server:

```bash
# Run with Docker
docker build -t trading-bot .
docker run -d --restart always --name trading_mentor trading-bot
```
