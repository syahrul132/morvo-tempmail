#!/bin/bash
set -e

# ============================================
# MORVO TempMail - Restore / Migrate Script
# ============================================
# Run this on the NEW VPS after transferring the backup
#
# Usage:
#   1. scp morvo-full-backup-*.tar.gz root@NEW_VPS:/tmp/
#   2. On new VPS: bash deploy/restore.sh /tmp/morvo-full-backup-*.tar.gz

APP_DIR="/var/www/morvo-tempmail"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

BACKUP_FILE="$1"
[ -n "$BACKUP_FILE" ] || err "Usage: bash deploy/restore.sh /path/to/backup.tar.gz"
[ -f "$BACKUP_FILE" ] || err "File not found: $BACKUP_FILE"

echo "🔄 MORVO TempMail - Restore from Backup"
echo "========================================"

# Extract to temp
TEMP_DIR=$(mktemp -d)
log "Extracting backup..."
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# Find the extracted directory (morvo-backup-*)
EXTRACTED=$(find "$TEMP_DIR" -maxdepth 1 -type d | tail -1)

# Create app dir
mkdir -p "$APP_DIR/data"
mkdir -p /var/log/morvo

# Copy everything
log "Restoring application files..."
cp -r "$EXTRACTED/src" "$APP_DIR/"
cp -r "$EXTRACTED/public" "$APP_DIR/"
cp -r "$EXTRACTED/api" "$APP_DIR/"
cp -r "$EXTRACTED/scripts" "$APP_DIR/"
cp -r "$EXTRACTED/test" "$APP_DIR/"
cp -r "$EXTRACTED/deploy" "$APP_DIR/"

# Database (merge — don't overwrite if existing has newer data)
if [ -f "$EXTRACTED/data/db.json" ]; then
    if [ -f "$APP_DIR/data/db.json" ]; then
        EXISTING_SIZE=$(stat -c%s "$APP_DIR/data/db.json")
        BACKUP_SIZE=$(stat -c%s "$EXTRACTED/data/db.json")
        if [ "$BACKUP_SIZE" -gt "$EXISTING_SIZE" ]; then
            cp "$EXTRACTED/data/db.json" "$APP_DIR/data/db.json"
            log "Database restored (backup was larger)"
        else
            warn "Keeping existing database (it's larger/newer)"
        fi
    else
        cp "$EXTRACTED/data/db.json" "$APP_DIR/data/db.json"
        log "Database restored"
    fi
fi

cp "$EXTRACTED/package.json" "$APP_DIR/"
cp "$EXTRACTED/package-lock.json" "$APP_DIR/"
cp "$EXTRACTED/.gitignore" "$APP_DIR/"
cp "$EXTRACTED/.npmrc" "$APP_DIR/"
cp "$EXTRACTED/vercel.json" "$APP_DIR/"
cp "$EXTRACTED/ecosystem.config.js" "$APP_DIR/"
cp "$EXTRACTED/README.md" "$APP_DIR/"

# Restore nginx config
if [ -f "$EXTRACTED/etc-nginx/morvo-tempmail" ]; then
    cp "$EXTRACTED/etc-nginx/morvo-tempmail" /etc/nginx/sites-available/morvo-tempmail
    ln -sf /etc/nginx/sites-available/morvo-tempmail /etc/nginx/sites-enabled/morvo-tempmail
    log "Nginx config restored"
fi

# Cleanup
rm -rf "$TEMP_DIR"

# Install deps & start
cd "$APP_DIR"
log "Installing dependencies..."
npm install --omit=dev --no-audit --no-fund

log "Starting application..."
pm2 delete morvo-tempmail 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

# SSL & Nginx
log "Restarting Nginx..."
nginx -t && systemctl restart nginx

echo ""
echo "========================================"
echo "✅ Restore complete!"
echo ""
echo "⚠️  NEXT STEPS:"
echo "  1. Update DNS records to point to this server"
echo "  2. Run: certbot --nginx -d morvo.me -d www.morvo.me"
echo "  3. Update SESSION_SECRET in ecosystem.config.js"
echo "  4. Verify: curl -k https://morvo.me/"
echo "========================================"
