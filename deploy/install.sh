#!/usr/bin/env bash
# Journey Simulator — one-command installer for a fresh Ubuntu 22.04/24.04 server.
#
#   curl -fsSL https://raw.githubusercontent.com/niharsayshell/journey-simulator/main/deploy/install.sh | sudo bash
#
# Optional: use your own domain (point its DNS A record, and demo.<domain>, at this server first):
#   curl -fsSL .../install.sh | sudo DOMAIN=qa.example.com bash
#
# Re-running the command updates the installation to the latest code; data is kept.
set -euo pipefail

# The update below replaces this file on disk; run from a private copy so bash
# never reads a half-replaced script.
if [ -z "${JS_REEXEC:-}" ] && [ -f "${BASH_SOURCE[0]:-}" ]; then
  tmp=$(mktemp)
  cp "${BASH_SOURCE[0]}" "$tmp"
  JS_REEXEC=1 exec bash "$tmp" "$@"
fi

REPO_URL="${REPO_URL:-https://github.com/niharsayshell/journey-simulator.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/journey-simulator}"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Please run as root (put 'sudo' in front of 'bash')."

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
[ "$MEM_MB" -ge 3500 ] || fail "This server has ${MEM_MB} MB of memory; at least 4 GB is required."

say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -o DPkg::Lock::Timeout=600) # waits if automatic updates are running
"${APT[@]}" update -qq
"${APT[@]}" install -y -qq git curl openssl ca-certificates >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# Building the web app needs extra memory on small servers.
if [ "$(swapon --show | wc -l)" -eq 0 ] && [ ! -f /swapfile ]; then
  say "Adding 2 GB of swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Downloading Journey Simulator"
if [ -d "$INSTALL_DIR/.git" ]; then
  BEFORE=$(git -C "$INSTALL_DIR" rev-parse HEAD)
  git -C "$INSTALL_DIR" fetch -q origin "$BRANCH"
  git -C "$INSTALL_DIR" reset -q --hard "origin/$BRANCH"
  if [ "${AUTO_UPDATE:-0}" = 1 ] && [ "$BEFORE" = "$(git -C "$INSTALL_DIR" rev-parse HEAD)" ]; then
    echo "$(date -Is) no new version"; exit 0
  fi
else
  git clone -q --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

ENV_FILE=deploy/.env.prod
if [ ! -f "$ENV_FILE" ]; then
  say "Generating configuration and secrets"
  if [ -n "${DOMAIN:-}" ]; then
    APP_HOST="$DOMAIN"
  else
    PUBLIC_IP=$(curl -4 -fsS https://api.ipify.org || curl -4 -fsS https://ifconfig.me) || fail "Could not detect this server's public IP address."
    APP_HOST="$(echo "$PUBLIC_IP" | tr . -).sslip.io"
  fi
  umask 077
  cat > "$ENV_FILE" <<CFG
APP_HOST=$APP_HOST
POSTGRES_PASSWORD=$(openssl rand -hex 24)
ENCRYPTION_KEY=$(openssl rand -base64 32)
WORKER_CONCURRENCY=2
CFG
fi
APP_HOST=$(grep '^APP_HOST=' "$ENV_FILE" | cut -d= -f2)

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
fi

# Nightly automatic update at 03:30 server time (only rebuilds when a new version was pushed).
# Disable with:  rm /etc/cron.d/journey-simulator-update   (or install with NO_AUTO_UPDATE=1)
if [ "${NO_AUTO_UPDATE:-0}" != 1 ]; then
  echo "30 3 * * * root AUTO_UPDATE=1 bash $INSTALL_DIR/deploy/install.sh >> /var/log/journey-update.log 2>&1" > /etc/cron.d/journey-simulator-update
  chmod 644 /etc/cron.d/journey-simulator-update
fi

COMPOSE=(docker compose --project-name journey -f deploy/docker-compose.prod.yml --env-file "$ENV_FILE")

say "Building the application (this takes 5-10 minutes the first time)"
"${COMPOSE[@]}" build migrate worker

say "Starting services"
"${COMPOSE[@]}" up -d --remove-orphans

say "Waiting for the application and its HTTPS certificate"
for i in $(seq 1 180); do
  if curl -fsS "https://$APP_HOST/api/v1/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 5
done

if [ "${READY:-0}" = 1 ]; then
  cat <<DONE

==============================================================
  Journey Simulator is live!

  Open:        https://$APP_HOST
  Demo shop:   https://demo.$APP_HOST

  1. Open the first link and click "Create an account".
     The FIRST account becomes the administrator; sign-up then closes.
  2. To try the demo, authorize the website  demo.$APP_HOST  (scheme https).
  3. Test proxy for trying the proxy feature: host  test-proxy  port  8899

  New versions install automatically every night at 03:30 (server time).
==============================================================
DONE
else
  echo
  echo "The services started but https://$APP_HOST is not answering yet."
  echo "Wait a few minutes and open it in your browser. To see what is happening, run:"
  echo "  cd $INSTALL_DIR && ${COMPOSE[*]} ps"
  echo "  cd $INSTALL_DIR && ${COMPOSE[*]} logs --tail=50"
  exit 1
fi
