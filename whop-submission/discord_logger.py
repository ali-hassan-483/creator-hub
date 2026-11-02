import os
import json
import requests
from config import DISCORD_WEBHOOK_URL

def send_failure_alert(row_idx: int, campaign_name: str, video_title: str, error_message: str, screenshot_path: str = None):
    """Sends a failure notification to Discord webhook, including screenshot if available."""
    if not DISCORD_WEBHOOK_URL:
        print("[Discord] Webhook URL not set. Skipping notification.")
        return

    # Truncate error message if too long for Discord field (max 1024 chars)
    error_summary = str(error_message)[:1000]
    if len(str(error_message)) > 1000:
        error_summary += "..."

    payload = {
        "embeds": [{
            "title": "❌ Whop Submission Failed",
            "color": 15548997,  # Red/Orange-red
            "fields": [
                {"name": "Row", "value": str(row_idx), "inline": True},
                {"name": "Campaign Name", "value": str(campaign_name), "inline": True},
                {"name": "Video Title", "value": str(video_title), "inline": False},
                {"name": "Error Details", "value": error_summary, "inline": False}
            ],
            "footer": {"text": "Whop Submission Automator"}
        }]
    }

    try:
        if screenshot_path and os.path.exists(screenshot_path):
            payload["embeds"][0]["image"] = {"url": "attachment://screenshot.png"}
            with open(screenshot_path, "rb") as f:
                files = {
                    "file": ("screenshot.png", f, "image/png"),
                    "payload_json": (None, json.dumps(payload), "application/json")
                }
                res = requests.post(DISCORD_WEBHOOK_URL, files=files)
        else:
            res = requests.post(DISCORD_WEBHOOK_URL, json=payload)
        
        if res.status_code not in (200, 204):
            print(f"[Discord] Failed to send webhook, status: {res.status_code}, response: {res.text}")
    except Exception as e:
        print(f"[Discord] Error sending webhook: {e}")


def send_summary_report(total: int, successful: int, failed: int, failed_details: list = None):
    """Sends a final summary report to Discord at the end of the sheet run."""
    if not DISCORD_WEBHOOK_URL:
        print("[Discord] Webhook URL not set. Skipping summary.")
        return

    # Embed color: Green if all succeeded, Orange/Red if there were failures, Grey if nothing processed
    if total == 0:
        color = 9807270  # Grey
    elif failed == 0:
        color = 5763719  # Green
    else:
        color = 15844367  # Gold/Orange

    payload = {
        "embeds": [{
            "title": "📊 Whop Submission Run Completed",
            "color": color,
            "fields": [
                {"name": "Total Processed", "value": str(total), "inline": True},
                {"name": "Successful", "value": str(successful), "inline": True},
                {"name": "Failed", "value": str(failed), "inline": True}
            ],
            "footer": {"text": "Whop Submission Automator"}
        }]
    }

    if failed_details:
        lines = []
        for row, camp, err in failed_details:
            lines.append(f"• **Row {row}** ({camp}): {str(err)[:80]}")
        
        payload["embeds"][0]["fields"].append({
            "name": "Failure Log Summary",
            "value": "\n".join(lines)[:1024],
            "inline": False
        })

    try:
        res = requests.post(DISCORD_WEBHOOK_URL, json=payload)
        if res.status_code not in (200, 204):
            print(f"[Discord] Failed to send summary, status: {res.status_code}, response: {res.text}")
    except Exception as e:
        print(f"[Discord] Error sending summary: {e}")
