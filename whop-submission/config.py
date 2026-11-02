import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
ENV_PATH = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=ENV_PATH)

def get_env_bool(key: str, default: bool) -> bool:
    val = os.environ.get(key, str(default)).strip().lower()
    return val in ("true", "1", "yes", "y")

# Google Sheets configuration
SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID")
GOOGLE_SERVICE_ACCOUNT_FILE = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "service_account.json")

# Discord Webhook configuration
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

# Browser Configuration
HEADLESS = get_env_bool("HEADLESS", True)

# Paths
BASE_DIR = Path(__file__).parent
AUTH_STATE_PATH = BASE_DIR / "auth_state.json"
SERVICE_ACCOUNT_PATH = BASE_DIR / GOOGLE_SERVICE_ACCOUNT_FILE

def validate_config():
    errors = []
    if not SPREADSHEET_ID:
        errors.append("SPREADSHEET_ID environment variable is missing.")
    if not DISCORD_WEBHOOK_URL:
        errors.append("DISCORD_WEBHOOK_URL environment variable is missing.")
    
    if errors:
        raise ValueError("\n".join(errors))
