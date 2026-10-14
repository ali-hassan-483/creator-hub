#!/bin/bash
# VPS Deployment Script
# Run this on your Linux VPS to deploy or update the Creator Hub platform

set -e

echo "🚀 Deploying Creator Hub Content Platform..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found. Copy .env.example to .env and configure secrets first."
    exit 1
fi

# Pull latest changes if git is initialized
if [ -d .git ]; then
    echo "📥 Pulling latest git changes..."
    git pull origin main || true
fi

# Stop existing containers & build
echo "📦 Building & starting containers..."
docker compose down
docker compose build --no-cache
docker compose up -d

# Run Prisma DB Migrations / Push
echo "🗄 Updating database schema..."
sleep 5
docker compose exec web npx prisma db push

# Seed Admin Account
echo "👤 Ensuring admin account exists..."
docker compose exec web npm run db:seed

echo "✅ Deployment completed successfully!"
echo "🌐 Your website is now live on your VPS."
