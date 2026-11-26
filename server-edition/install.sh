#!/bin/sh
# Lantern Server for Linux: run with sudo from the unzipped folder (move it somewhere permanent first,
# e.g. /opt/lantern-server). Installs a systemd service that starts at boot and restarts itself,
# saves the settings in lantern.json, and can connect your own address through a Cloudflare Tunnel.
#   sudo ./install.sh            install, or change settings
#   sudo ./uninstall.sh          stop and remove the service (campaigns are kept)
set -eu
ROOT=$(cd "$(dirname "$0")" && pwd)
CFG="$ROOT/lantern.json"
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo $0"; exit 1; }

echo; echo "  Lantern Server"; echo "  =============="; echo
id lantern >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin lantern

if [ ! -f "$CFG" ]; then
  echo "Pick a GM password. You type it once, the first time you open Lantern, to make your own admin account."
  while :; do
    printf 'GM password (8 or more characters): '; stty -echo; read -r PW; stty echo; echo
    printf 'Type it again: '; stty -echo; read -r PW2; stty echo; echo
    [ "${#PW}" -ge 8 ] || { echo "That needs to be at least 8 characters."; continue; }
    [ "$PW" = "$PW2" ] || { echo "Those didn't match."; continue; }
    break
  done
  printf 'Port [3000]: '; read -r PORT; PORT=${PORT:-3000}
  "$ROOT/node/bin/node" -e 'process.stdout.write(JSON.stringify({ port: +process.argv[1], dataDir: "data", accounts: true, backupDays: 14, gmPassword: process.argv[2] }, null, 2))' "$PORT" "$PW" > "$CFG"
else
  echo "Found your settings from last time (lantern.json)."
  PORT=$("$ROOT/node/bin/node" -p 'require(process.argv[1]).port || 3000' "$CFG")
fi
mkdir -p "$ROOT/data"
chown -R lantern:lantern "$ROOT"   # it updates itself, so the service owns its folder
chmod 600 "$CFG"

cat > /etc/systemd/system/lantern.service <<UNIT
[Unit]
Description=Lantern Server (Lantern VTT, always on)
After=network-online.target
Wants=network-online.target

[Service]
User=lantern
WorkingDirectory=$ROOT
ExecStart=$ROOT/node/bin/node $ROOT/start.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now lantern.service
systemctl restart lantern.service
command -v ufw >/dev/null 2>&1 && ufw status | grep -q active && ufw allow "$PORT/tcp" >/dev/null || true

i=0; until curl -fs "http://localhost:$PORT/api/auth/status" >/dev/null 2>&1 || [ $i -ge 120 ]; do sleep 1; i=$((i+1)); done
if [ $i -lt 120 ]; then echo "Lantern Server is running: http://localhost:$PORT"; else echo "It isn't answering yet: see journalctl -u lantern"; fi

echo; echo "Your own web address (e.g. https://lanternrpg.party):"
echo "In Cloudflare: Zero Trust > Networks > Tunnels > Create a tunnel > Cloudflared. Copy the long token,"
echo "and under Public hostname add your domain with Service HTTP, URL localhost:$PORT."
printf 'Paste the tunnel token (or press Enter to skip): '; read -r TOKEN
if [ -n "${TOKEN:-}" ]; then
  TOKEN=$(echo "$TOKEN" | awk '{print $NF}')
  if ! command -v cloudflared >/dev/null 2>&1; then
    ARCH=$(uname -m); case "$ARCH" in aarch64|arm64) A=arm64;; *) A=amd64;; esac
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$A" -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
  fi
  cloudflared service uninstall >/dev/null 2>&1 || true
  cloudflared service install "$TOKEN" && echo "The tunnel is installed. Give it a minute, then open your address."
  "$ROOT/node/bin/node" -e 'const f=process.argv[1],c=require(f);c.quickTunnel=false;require("fs").writeFileSync(f,JSON.stringify(c,null,2))' "$CFG"
  systemctl restart lantern.service
elif ! systemctl is-active --quiet cloudflared 2>/dev/null; then
  echo "No domain yet? Lantern can use a free temporary address (https://something-random.trycloudflare.com)"
  echo "until you have one. It changes whenever the server restarts."
  printf 'Use a temporary address for now? [Y/n]: '; read -r Q
  case "${Q:-Y}" in [Yy]*) QT=true;; *) QT=false;; esac
  "$ROOT/node/bin/node" -e 'const f=process.argv[1],c=require(f);c.quickTunnel=process.argv[2]==="true";require("fs").writeFileSync(f,JSON.stringify(c,null,2))' "$CFG" "$QT"
  rm -f "$ROOT/data/temporary-address.txt"
  systemctl restart lantern.service
  if [ "$QT" = true ]; then
    i=0; until [ -f "$ROOT/data/temporary-address.txt" ] || [ $i -ge 60 ]; do sleep 1; i=$((i+1)); done
    [ -f "$ROOT/data/temporary-address.txt" ] && echo "Your temporary address: $(cat "$ROOT/data/temporary-address.txt")" || echo "Cloudflare hasn't answered yet: see People > This server."
  fi
fi
echo; echo "Open it, type the GM password once, and make your admin account. Updates: People > This server."
