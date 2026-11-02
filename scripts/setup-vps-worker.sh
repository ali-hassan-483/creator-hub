#!/usr/bin/env bash
# ==============================================================================
# Creator Hub — Dedicated Upload VPS Worker Setup Script
# Usage:
#   curl -sSL https://creatorhub.chickenkiller.com/scripts/setup-vps-worker.sh | bash -s -- --key <API_KEY> [--server <URL>]
# ==============================================================================

set -e

# Default values
CREATOR_HUB_URL="https://creatorhub.chickenkiller.com"
VPS_API_KEY=""

# Parse flags
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --key|-k) VPS_API_KEY="$2"; shift ;;
    --server|-s) CREATOR_HUB_URL="$2"; shift ;;
    *) echo "Unknown parameter passed: $1"; exit 1 ;;
  esac
  shift
done

if [ -z "$VPS_API_KEY" ]; then
  echo "❌ Error: Missing --key <API_KEY>"
  echo "Example: curl -sSL https://creatorhub.chickenkiller.com/scripts/setup-vps-worker.sh | bash -s -- --key vps_live_xxxxx"
  exit 1
fi

echo "=========================================================="
echo "🚀 Setting up Creator Hub Dedicated Upload Worker..."
echo "📡 Server: $CREATOR_HUB_URL"
echo "🔑 API Key: ${VPS_API_KEY:0:10}..."
echo "=========================================================="

# 1. Update package list & install essentials
echo "📦 Updating apt packages..."
apt-get update -y > /dev/null 2>&1 || true
apt-get install -y curl wget git sudo > /dev/null 2>&1 || true

# 2. Check Node.js version (need 18 or 20)
NODE_INSTALLED=false
if command -v node > /dev/null 2>&1; then
  NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
  if [ "$NODE_MAJOR" -ge 18 ]; then
    NODE_INSTALLED=true
    echo "✅ Node.js $(node -v) is already installed."
  fi
fi

if [ "$NODE_INSTALLED" = false ]; then
  echo "📥 Installing Node.js 20 LTS from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y nodejs > /dev/null 2>&1
  echo "✅ Node.js $(node -v) installed successfully."
fi

# 3. Install PM2 process manager
if ! command -v pm2 > /dev/null 2>&1; then
  echo "📦 Installing PM2 globally..."
  npm install -g pm2 > /dev/null 2>&1
  echo "✅ PM2 installed."
fi

# 4. Prepare worker directory
WORK_DIR="/opt/creator-hub-worker"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo "📥 Downloading worker daemon scripts..."
curl -sSL "${CREATOR_HUB_URL}/scripts/upload-worker.js" -o "$WORK_DIR/upload-worker.js"
curl -sSL "${CREATOR_HUB_URL}/scripts/whop-worker.py" -o "$WORK_DIR/whop-worker.py"

# Write .env configuration
cat <<EOF > "$WORK_DIR/.env"
CREATOR_HUB_URL=$CREATOR_HUB_URL
VPS_API_KEY=$VPS_API_KEY
POLL_INTERVAL_SEC=15
HEADLESS=true
EOF

# Install Python & Playwright for Whop Submitter if needed
if ! command -v python3 > /dev/null 2>&1; then
  apt-get install -y python3 python3-pip > /dev/null 2>&1 || true
fi
if command -v pip3 > /dev/null 2>&1; then
  pip3 install --break-system-packages playwright requests > /dev/null 2>&1 || pip3 install playwright requests > /dev/null 2>&1 || true
  playwright install --with-deps chromium > /dev/null 2>&1 || true
fi

# 5. Start / Restart with PM2
echo "🚀 Starting worker processes under PM2..."
pm2 stop creator-hub-worker > /dev/null 2>&1 || true
pm2 delete creator-hub-worker > /dev/null 2>&1 || true
pm2 start upload-worker.js --name creator-hub-worker --time

pm2 stop whop-worker > /dev/null 2>&1 || true
pm2 delete whop-worker > /dev/null 2>&1 || true
if command -v python3 > /dev/null 2>&1; then
  pm2 start "python3 whop-worker.py" --name whop-worker --time
fi

# Save PM2 state for automatic boot persistence
pm2 save > /dev/null 2>&1 || true
pm2 startup systemd -u root --hp /root > /dev/null 2>&1 || true

echo "=========================================================="
echo "🎉 SUCCESS: Creator Hub Upload & Whop Workers are active!"
echo "📋 Check status anytime with:  pm2 status"
echo "📜 View upload logs with:      pm2 logs creator-hub-worker"
echo "📜 View Whop logs with:        pm2 logs whop-worker"
echo "=========================================================="
