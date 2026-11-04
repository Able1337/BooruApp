#!/usr/bin/env bash
set -euo pipefail
umask 027
[[ "$EUID" -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
site_ip=109.120.140.198
config=/etc/nginx/sites-available/booru-pocket-ip.conf
if [[ -e "$config" ]] && ! grep -q '# Managed by Booru Pocket IP' "$config"; then echo 'Unmanaged IP vhost exists; stopping.' >&2;exit 1;fi
mkdir -p /var/lib/booru-pocket/acme
chmod 755 /var/lib/booru-pocket /var/lib/booru-pocket/acme
if [[ -f "$config" ]]; then cp -a "$config" "/var/backups/booru-pocket/ip-nginx-$(date -u +%Y%m%dT%H%M%SZ).conf";fi
cat > "$config" <<NGINX
# Managed by Booru Pocket IP
server {
    listen 80;
    server_name $site_ip;
    location ^~ /.well-known/acme-challenge/ { root /var/lib/booru-pocket/acme; }
    location / { return 301 https://$site_ip\$request_uri; }
}
NGINX
ln -sfn "$config" /etc/nginx/sites-enabled/booru-pocket-ip.conf
nginx -t
systemctl reload nginx
# Keep the distro Certbot for domain certificates; use an isolated modern client for IPs.
export DEBIAN_FRONTEND=noninteractive
apt-get install -y python3-venv
if [[ ! -x /opt/booru-certbot/bin/certbot ]]; then
 python3 -m venv /opt/booru-certbot
 /opt/booru-certbot/bin/pip install 'certbot==5.9.0'
fi
/opt/booru-certbot/bin/certbot certonly --webroot -w /var/lib/booru-pocket/acme --ip-address "$site_ip" --preferred-profile shortlived --cert-name booru-ip --config-dir /etc/letsencrypt-booru-ip --work-dir /var/lib/letsencrypt-booru-ip --logs-dir /var/log/letsencrypt-booru-ip --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring --deploy-hook 'systemctl reload nginx'
cat >> "$config" <<NGINX
server {
    # Browsers connecting to an IP do not send a DNS SNI name.
    listen 443 ssl default_server;
    server_name $site_ip;
    ssl_certificate /etc/letsencrypt-booru-ip/live/booru-ip/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt-booru-ip/live/booru-ip/privkey.pem;
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
cat > /etc/systemd/system/booru-ip-certificate-renew.service <<'UNIT'
[Unit]
Description=Renew Booru Pocket short-lived IP certificate
After=network-online.target
[Service]
Type=oneshot
ExecStart=/opt/booru-certbot/bin/certbot renew --quiet --no-random-sleep-on-renew --config-dir /etc/letsencrypt-booru-ip --work-dir /var/lib/letsencrypt-booru-ip --logs-dir /var/log/letsencrypt-booru-ip
UNIT
cat > /etc/systemd/system/booru-ip-certificate-renew.timer <<'UNIT'
[Unit]
Description=Check Booru Pocket IP certificate every four hours
[Timer]
OnCalendar=*-*-* 00/4:00:00
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now booru-ip-certificate-renew.timer
curl -fsS "https://$site_ip/healthz"
printf '\nIP HTTPS ready: https://%s/\n' "$site_ip"
