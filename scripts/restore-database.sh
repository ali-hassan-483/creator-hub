#!/bin/bash
set -e

if [ -z "$1" ]; then
    echo "Usage: ./scripts/restore-database.sh <path-to-backup.sql.gz>"
    echo "Available backups:"
    ls -lh ~/creator-hub/backups/*.sql.gz 2>/dev/null || echo "No backups found."
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "⚠️ Restoring database from $BACKUP_FILE..."
gunzip -c "$BACKUP_FILE" | docker exec -i cap_postgres psql -U postgres -d content_platform
echo "✅ Database restore completed successfully!"
