#!/bin/bash
set -e

echo "🧹 [Storage Cleanup] Cleaning up old campaign storage and temporary files..."

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Clean old campaigns storage
if [ -d "storage/campaigns" ]; then
    rm -rf storage/campaigns/*
    echo "✅ Cleaned storage/campaigns/"
fi

# Clean temp work dirs
if [ -d "tmp" ]; then
    rm -rf tmp/*
    echo "✅ Cleaned tmp/"
fi

mkdir -p storage/campaigns tmp/automation

echo "💾 Current available disk space on VPS:"
df -h /
