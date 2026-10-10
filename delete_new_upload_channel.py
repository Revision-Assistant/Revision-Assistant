import asyncio
import os
import json
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.tl.functions.channels import DeleteChannelRequest

load_dotenv()
API_ID = int(os.getenv('API_ID'))
API_HASH = os.getenv('API_HASH')

async def main():
    with open("community_channels.json", "r") as f:
        cfg = json.load(f)

    channel_id = cfg.get("new_upload_id", -1004445573095)
    print(f"[*] Attempting to delete channel ID: {channel_id}")

    client = TelegramClient('session_name', API_ID, API_HASH)
    await client.connect()

    if not await client.is_user_authorized():
        print("[-] User not authorized.")
        await client.disconnect()
        return

    try:
        entity = await client.get_entity(channel_id)
        title = getattr(entity, 'title', str(channel_id))
        print(f"[+] Found channel: '{title}' (ID: {channel_id})")
        
        await client(DeleteChannelRequest(channel=entity))
        print(f"[+] Successfully deleted channel '{title}' (ID: {channel_id})!")
    except Exception as e:
        print(f"[!] Error deleting channel {channel_id}: {e}")
    finally:
        await client.disconnect()

    # Update community_channels.json
    cfg.pop("new_upload_id", None)
    cfg.pop("new_upload_link", None)
    with open("community_channels.json", "w") as f:
        json.dump(cfg, f, indent=2)
    print("[+] Updated community_channels.json (removed new_upload keys).")

if __name__ == '__main__':
    asyncio.run(main())
