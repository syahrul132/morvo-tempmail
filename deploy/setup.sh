#!/bin/bash
set -e

# ============================================
# MORVO TempMail Express - VPS Setup Script
# ============================================
# Run this on a fresh Ubuntu 22.04+ VPS as root
# Usage: bash deploy/setup.sh

echo "🚀 MORVO TempMail - VPS Setup"
echo "=============================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# Check root
[ "$(id -u)" -eq 0 ] || err "Run as root: sudo bash deploy/setup.sh"

APP_DIR="/var/www/morvo-tempmail"
DATA_DIR="$APP_DIR/data"
LOG_DIR="/var/log/morvo"

# --- System Updates ---
log "Updating system packages..."
apt update -qq && apt upgrade -y -qq

# --- Node.js 22.x ---
if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    log "Node.js already installed: $NODE_VER"
else
    log "Installing Node.js 22.x..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt install -y nodejs
fi

# --- PM2 ---
if command -v pm2 &>/dev/null; then
    log "PM2 already installed"
else
    log "Installing PM2..."
    npm install -g pm2
fi

# --- Nginx ---
if command -v nginx &>/dev/null; then
    log "Nginx already installed"
else
    log "Installing Nginx..."
    apt install -y nginx
fi

# --- Certbot (SSL) ---
if command -v certbot &>/dev/null; then
    log "Certbot already installed"
else
    log "Installing Certbot..."
    apt install -y certbot python3-certbot-nginx
fi

# --- App directory ---
log "Setting up application..."
mkdir -p "$DATA_DIR"
mkdir -p "$LOG_DIR"

# --- Install dependencies ---
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund
log "Dependencies installed"

# --- Generate session secret ---
if grep -q "CHANGE_ME" "$APP_DIR/ecosystem.config.js" 2>/dev/null; then
    NEW_SECRET=$(openssl rand -hex 32)
    sed -i "s/CHANGE_ME_TO_A_RANDOM_SECRET_ON_NEW_VPS/$NEW_SECRET/" "$APP_DIR/ecosystem.config.js"
    log "Session secret generated"
fi

# --- Nginx config ---
log "Configuring Nginx..."
cp "$APP_DIR/deploy/nginx-morvo.conf" /etc/nginx/sites-available/morvo-tempmail
ln -sf /etc/nginx/sites-available/morvo-tempmail /etc/nginx/sites-enabled/morvo-tempmail
rm -f /etc/nginx/sites-enabled/default 2>/dev/null
nginx -t && log "Nginx config valid" || err "Nginx config invalid!"

# --- SSL Certificate ---
log "Requesting SSL certificate..."
warn "Make sure DNS records are pointing to this server first!"
echo ""
read -p "Press Enter to request SSL (or Ctrl+C to skip)... " 
certbot --nginx -d morvo.me -d www.morvo.me --non-interactive --agree-tos --email admin@morvo.me || warn "SSL setup failed - run manually later: certbot --nginx -d morvo.me"

# --- PM2 Startup ---
log "Configuring PM2 auto-startup..."
cd "$APP_DIR"

# Stop existing if running
pm2 delete morvo-tempmail 2>/dev/null || true

# Start with ecosystem config
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# --- Restart Nginx ---
systemctl restart nginx
log "Nginx restarted"

# --- Firewall ---
if command -v ufw &>/dev/null; then
    log "Configuring firewall..."
    ufw allow 22/tcp   # SSH
    ufw allow 25/tcp   # SMTP
    ufw allow 80/tcp   # HTTP
    ufw allow 443/tcp  # HTTPS
    ufw --force enable
    log "Firewall configured"
fi

# --- Health Check ---
sleep 2
if curl -sf http://localhost:3000/ > /dev/null; then
    log "App is running on port 3000!"
else
    warn "App might need a moment to start. Check: pm2 logs morvo-tempmail"
fi

echo ""
echo "=============================="
echo "✅ Setup complete!"
echo ""
echo "🌐 Site:    https://morvo.me"
echo "📧 SMTP:    port 25 (adzstore.my.id)"
echo "📊 PM2:     pm2 status"
echo "📋 Logs:    pm2 logs morvo-tempmail"
echo "🔧 Nginx:   /etc/nginx/sites-available/morvo-tempmail"
echo "💾 Data:    $DATA_DIR/db.json"
echo "=============================="
