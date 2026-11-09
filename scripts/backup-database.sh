#!/bin/bash
set -e

BACKUP_DIR="${HOME}/creator-hub/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/creatorhub_backup_${TIMESTAMP}.sql.gz"

echo "📦 [Backup] Starting daily database backup at $(date)..."

# Dump PostgreSQL using docker exec into gzip
docker exec -t cap_postgres pg_dump -U postgres -d content_platform | gzip > "$BACKUP_FILE"

if [ -s "$BACKUP_FILE" ]; then
    echo "✅ [Backup] Backup successful: $(du -h "$BACKUP_FILE" | cut -f1) saved to $BACKUP_FILE"
else
    echo "❌ [Backup] Backup failed or file is empty!"
    rm -f "$BACKUP_FILE"
    exit 1
fi

# Keep only the last 14 days of backups to save disk space
find "$BACKUP_DIR" -type f -name "creatorhub_backup_*.sql.gz" -mtime +14 -delete
echo "🧹 [Backup] Cleaned up backups older than 14 days."
