#!/bin/sh
# Stops and removes the Lantern Server service. Your campaigns (data/) are kept.
set -eu
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo $0"; exit 1; }
systemctl disable --now lantern.service 2>/dev/null || true
rm -f /etc/systemd/system/lantern.service
systemctl daemon-reload
echo "Lantern Server is stopped and removed. Your campaigns are still in $(cd "$(dirname "$0")" && pwd)/data"
echo "A Cloudflare tunnel (if you set one up) is left alone: sudo cloudflared service uninstall"
