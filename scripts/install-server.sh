#!/usr/bin/env bash
# Run from the project checkout as root on Debian/Ubuntu.
set -euo pipefail
umask 027
cd "$(dirname "$0")/.."
site_domain="${1:-frank.eben-cord.ru}"
site_port="${2:-443}"
if [[ ! "$site_port" =~ ^[0-9]+$ ]] || (( (site_port < 1024 && site_port != 443) || site_port > 65535)); then echo 'Invalid HTTPS port.' >&2; exit 1; fi
site_origin="https://$site_domain"
if [[ "$site_port" != 443 ]]; then site_origin+=":$site_port"; fi
if [[ "$EUID" -ne 0 ]]; then echo 'Run as root.' >&2; exit 1; fi
if [[ ! "$site_domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ || "$site_domain" != *.* ]]; then echo 'Invalid domain.' >&2; exit 1; fi
if ! command -v apt-get >/dev/null; then echo 'This installer supports Debian/Ubuntu with systemd.' >&2; exit 1; fi
command -v systemctl >/dev/null
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nodejs nginx certbot python3-certbot-nginx ca-certificates curl tar
node -e 'if(Number(process.versions.node.split(".")[0])<18){console.error("Node 18+ required");process.exit(1)}'
node --test tests/*.test.mjs
site_config="/etc/nginx/sites-available/booru-pocket.conf"
unit_file="/etc/systemd/system/booru-pocket.service"
if [[ -e "$site_config" ]] && ! grep -q '# Managed by Booru Pocket' "$site_config"; then echo 'Existing unmanaged nginx configuration; stopping.' >&2; exit 1; fi
if [[ -e "$unit_file" ]] && ! grep -q '# Managed by Booru Pocket' "$unit_file"; then echo 'Existing unmanaged systemd service; stopping.' >&2; exit 1; fi
# Preserve unrelated vhosts. Stop if this domain is already owned by another site.
for config in /etc/nginx/sites-enabled/*; do
 [[ -f "$config" ]] || continue
 if [[ "$(readlink -f "$config")" != "$site_config" ]] && grep -Eq "server_name[^;]*[[:space:]]${site_domain//./\\.}([[:space:];]|$)" "$config"; then
  echo "Domain already configured in $config. Review it before installing." >&2; exit 1
 fi
done
if ss -H -ltn 'sport = :18737' | grep -q . && ! systemctl is-active --quiet booru-pocket; then echo 'Port 18737 is in use by another service.' >&2; exit 1; fi
id booru-pocket >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin booru-pocket
release="/opt/booru-pocket/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$release" /var/backups/booru-pocket
cp -R web server "$release/"
chown -R root:booru-pocket "$release"
chmod -R u=rwX,g=rX,o= "$release"
chmod 755 /opt/booru-pocket /opt/booru-pocket/releases
backup="/var/backups/booru-pocket/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$backup"
[[ ! -f "$site_config" ]] || cp -a "$site_config" "$backup/nginx.conf"
[[ ! -f "$unit_file" ]] || cp -a "$unit_file" "$backup/service"
previous_release="$(readlink -f /opt/booru-pocket/current 2>/dev/null || true)"
printf '%s\n' "$previous_release" > "$backup/previous-release"
ln -s "$release" /opt/booru-pocket/current.next
mv -Tf /opt/booru-pocket/current.next /opt/booru-pocket/current
cat > "$unit_file" <<UNIT
# Managed by Booru Pocket
[Unit]
Description=Booru Pocket web and API gateway
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=booru-pocket
Group=booru-pocket
WorkingDirectory=/opt/booru-pocket/current
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=18737
Environment=PUBLIC_ORIGIN=$site_origin
ExecStart=/usr/bin/node /opt/booru-pocket/current/server/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
RestrictSUIDSGID=true
CapabilityBoundingSet=
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
# Serve certificate challenges on HTTP before enabling HTTPS.
mkdir -p /var/lib/booru-pocket/acme
chmod 755 /var/lib/booru-pocket /var/lib/booru-pocket/acme
cat > "$site_config" <<NGINX
# Managed by Booru Pocket
server {
    listen 80;
    server_name $site_domain;
    location ^~ /.well-known/acme-challenge/ { root /var/lib/booru-pocket/acme; }
    location / { return 301 $site_origin\$request_uri; }
}
NGINX
ln -sfn "$site_config" /etc/nginx/sites-enabled/booru-pocket.conf
nginx -t
systemctl daemon-reload
systemctl enable booru-pocket nginx
systemctl restart booru-pocket
for attempt in {1..15}; do
 if curl -fsS http://127.0.0.1:18737/healthz >/dev/null; then break; fi
 sleep 1
done
if ! curl -fsS http://127.0.0.1:18737/healthz; then
 systemctl status booru-pocket --no-pager || true
 journalctl -u booru-pocket -n 30 --no-pager || true
 exit 1
fi
systemctl reload nginx
# DNS A/AAAA must point here.
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
 ufw allow 80/tcp
 ufw allow "$site_port/tcp"
fi
certbot certonly --webroot -w /var/lib/booru-pocket/acme --cert-name "$site_domain" --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring -d "$site_domain" --deploy-hook 'systemctl reload nginx'
cat >> "$site_config" <<NGINX
server {
    listen $site_port ssl;
    server_name $site_domain;
    ssl_certificate /etc/letsencrypt/live/$site_domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$site_domain/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 16k;
    location / {
        proxy_pass http://127.0.0.1:18737;
        proxy_http_version 1.1;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 35s;
        proxy_send_timeout 15s;
    }
    location = /api/posts {
        access_log off;
        proxy_pass http://127.0.0.1:18737;
        proxy_http_version 1.1;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 35s;
        proxy_send_timeout 15s;
    }
}
NGINX
nginx -t
systemctl reload nginx
systemctl enable --now certbot.timer
curl -fsS "$site_origin/healthz"
printf '\nReady: %s/\nBackup: %s\n' "$site_origin" "$backup"
