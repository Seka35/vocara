#!/bin/bash

# =========================================================
# Vocara One-Click VPS Deployment Script
# Domain: vocara.cloud
# Internal App Port: 4892
# Nginx + Certbot SSL + Systemd Auto-Start
# =========================================================

set -e

DOMAIN="vocara.cloud"
PORT=4892
APP_DIR=$(pwd)
SERVICE_NAME="vocara"
ADMIN_EMAIL="admin@vocara.cloud"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}=========================================================${NC}"
echo -e "${CYAN}          🚀 Starting Vocara VPS Deployment              ${NC}"
echo -e "${CYAN}=========================================================${NC}"

# 1. Check Root Privileges
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ Please run this script with sudo or as root:${NC}"
  echo -e "   sudo bash deploy.sh"
  exit 1
fi

# 2. Update System & Install Required Packages
echo -e "${CYAN}[1/6] Installing system dependencies (Nginx, Certbot, Node.js)...${NC}"
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx curl git build-essential

if ! command -v node &> /dev/null; then
    echo -e "${CYAN}Installing Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# 3. Install Node.js Dependencies
echo -e "${CYAN}[2/6] Installing Node.js project packages...${NC}"
cd "$APP_DIR"
npm install --production

# Ensure uploads & downloads directories exist with full permissions
mkdir -p uploads/audio public/downloads
chmod -R 755 uploads public/downloads

# 4. Create Nginx Configuration
echo -e "${CYAN}[3/6] Configuring Nginx Reverse Proxy for ${DOMAIN} on port ${PORT}...${NC}"

NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"

cat <<EOF > "$NGINX_CONF"
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable Nginx Site
ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/${DOMAIN}"

# Remove default site if exists
if [ -f "/etc/nginx/sites-enabled/default" ]; then
    rm -f "/etc/nginx/sites-enabled/default"
fi

# Test Nginx Syntax & Reload
nginx -t
systemctl reload nginx

# 5. Create Systemd Service
echo -e "${CYAN}[4/6] Setting up Systemd background service (${SERVICE_NAME}.service)...${NC}"

SYSTEMD_CONF="/etc/systemd/system/${SERVICE_NAME}.service"

cat <<EOF > "$SYSTEMD_CONF"
[Unit]
Description=Vocara Sound Engraving & Scanner Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=$(which node) server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=${PORT}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

# 6. Obtain SSL Certificate via Certbot
echo -e "${CYAN}[5/6] Obtaining SSL Certificate via Certbot for ${DOMAIN}...${NC}"

if certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" --non-interactive --agree-tos --email "${ADMIN_EMAIL}" --redirect; then
    echo -e "${GREEN}✅ SSL Certificate successfully installed for ${DOMAIN} & www.${DOMAIN}!${NC}"
else
    echo -e "${RED}⚠️ Certbot automatic SSL setup encountered an issue. Ensure your DNS A records for ${DOMAIN} and www.${DOMAIN} point to this VPS IP address.${NC}"
    echo -e "You can retry SSL manually anytime with: sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
fi

# Final Check
echo -e "${GREEN}=========================================================${NC}"
echo -e "${GREEN}🎉 Vocara is fully deployed and active!${NC}"
echo -e "🔗 Web Domain: https://${DOMAIN}"
echo -e "⚡ Local Service Port: http://127.0.0.1:${PORT}"
echo -e "📊 Service Status: systemctl status ${SERVICE_NAME}"
echo -e "${GREEN}=========================================================${NC}"
