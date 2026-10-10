"""
Populate 'goal to achieve' Channel
Creates or finds the channel 'goal to achieve', exports invite link,
posts the 8 Master Roadmap posts (Dashboard pinned, 6 monthly phases, Prop Firm Rules),
and updates community_channels.json with goal_id, goal_link, and goal_dashboard_msg_id.
"""

import asyncio
import os
import sys
import json
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.channels import CreateChannelRequest
from telethon.tl.functions.messages import ExportChatInviteRequest
from goal_roadmap_engine import (
    render_master_dashboard,
    render_phase_post,
    render_prop_firm_rules_post
)

load_dotenv()
API_ID = int(os.getenv('API_ID'))
API_HASH = os.getenv('API_HASH')
SESSION_STRING = os.getenv('SESSION_STRING', '')

async def main():
    if not SESSION_STRING:
        print("[-] SESSION_STRING not found in .env")
        return

    with open("community_channels.json", "r") as f:
        channels_cfg = json.load(f)

    with open("user_progress.json", "r") as f:
        progress_data = json.load(f)

    client = TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH)
    await client.connect()

    if not await client.is_user_authorized():
        print("[-] Client not authorized.")
        await client.disconnect()
        return

    me = await client.get_me()
    print(f"[+] Connected as: {me.first_name} (@{me.username})")

    # 1. Find or create 'goal to achieve' channel
    goal_channel = None
    async for d in client.iter_dialogs():
        if d.is_channel and "goal to achieve" in d.title.lower():
            goal_channel = d.entity
            print(f"[+] Found existing 'goal to achieve' channel: (ID: {goal_channel.id})")
            break

    if not goal_channel:
        print("[*] Creating channel 'goal to achieve'...")
        res = await client(CreateChannelRequest(
            title="goal to achieve",
            about="Official 6-Month Master Trading Roadmap & Target Milestones. Drives active daily video lessons in the 'today' channel.",
            megagroup=False
        ))
        goal_channel = res.chats[0]
        print(f"[+] Created 'goal to achieve' channel! (ID: {goal_channel.id})")

    # 2. Get invite link
    try:
        invite = await client(ExportChatInviteRequest(goal_channel))
        goal_link = invite.link
    except Exception:
        goal_link = f"https://t.me/c/{abs(goal_channel.id) % 10000000000}/1"

    full_id = goal_channel.id
    if not str(full_id).startswith("-100"):
        full_id = int(f"-100{full_id}")

    channels_cfg["goal_id"] = full_id
    channels_cfg["goal_link"] = goal_link

    # 3. Post Master Dashboard (Post 1) & Pin
    print("[*] Posting Master 6-Month Dashboard...")
    dash_text = render_master_dashboard(progress_data, channels_cfg)
    dash_msg = await client.send_message(goal_channel, dash_text, link_preview=False)
    await client.pin_message(goal_channel, dash_msg.id)
    print(f"[+] Master Dashboard posted & pinned! (Msg ID: {dash_msg.id})")

    channels_cfg["goal_dashboard_msg_id"] = dash_msg.id

    # 4. Post 6 Monthly Phase Posts
    for phase_num in range(1, 7):
        print(f"[*] Posting Month {phase_num} Milestone Guide...")
        phase_text = render_phase_post(phase_num, channels_cfg)
        await client.send_message(goal_channel, phase_text, link_preview=False)
        await asyncio.sleep(1)

    # 5. Post Prop Firm Rules Post
    print("[*] Posting Prop Firm Evaluation Playbook...")
    rules_text = render_prop_firm_rules_post()
    await client.send_message(goal_channel, rules_text, link_preview=False)

    # 6. Save updated channels config
    with open("community_channels.json", "w") as f:
        json.dump(channels_cfg, f, indent=2)

    print("\n[+] SUCCESS! All 8 Master Roadmap posts published to 'goal to achieve'.")
    print(f"• Channel ID: {full_id}")
    print(f"• Invite Link: {goal_link}")
    print(f"• Master Dashboard Msg ID: {dash_msg.id}")

    await client.disconnect()

if __name__ == '__main__':
    asyncio.run(main())
