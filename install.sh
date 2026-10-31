#!/usr/bin/env bash
#
# higgs-proxy installer for macOS and Linux.
#
# Sets up the API + web dashboard, configures the environment, applies database
# migrations, builds the frontend, and starts both processes in the background.
#
# Usage:
#   ./install.sh                     Interactive, prompts for public URLs
#   ./install.sh --yes               Accept defaults, never prompt
#   ./install.sh --web-url https://app.example.com \
#                --api-url https://api.example.com
#   ./install.sh --no-start          Set everything up but do not start
#   ./install.sh --restart           Restart the installed services
#   ./install.sh --stop              Stop the installed services
#
# Environment overrides: WEB_PORT, API_PORT, WEB_URL, API_URL, ASSUME_YES.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT_DIR/apps/api"
WEB_DIR="$ROOT_DIR/apps/web"
LOG_DIR="$ROOT_DIR/logs"
RUN_DIR="$ROOT_DIR/.run"
BACKUP_DIR="$ROOT_DIR/backups"
CONFIG_FILE="$ROOT_DIR/.install.conf"

WEB_PORT="${WEB_PORT:-5560}"
API_PORT="${API_PORT:-5561}"
WEB_URL="${WEB_URL:-}"
API_URL="${API_URL:-}"
ASSUME_YES="${ASSUME_YES:-0}"

WEB_PORT_EXPLICIT=0
API_PORT_EXPLICIT=0

NO_START=0
RESTART_ONLY=0
STOP_ONLY=0

OS=""
SERVICE_MODE="none"
ACTIVE_MODE="none"
BUN_BIN=""
NODE_BIN=""
NPM_BIN=""
HIGGSFIELD_BIN=""
SERVICE_PATH=""

if [ -t 1 ]; then
  C_RESET="$(printf '\033[0m')"
  C_INFO="$(printf '\033[36m')"
  C_OK="$(printf '\033[32m')"
  C_WARN="$(printf '\033[33m')"
  C_ERR="$(printf '\033[31m')"
else
  C_RESET=""
  C_INFO=""
  C_OK=""
  C_WARN=""
  C_ERR=""
fi

info() { printf '%s==>%s %s\n' "$C_INFO" "$C_RESET" "$*"; }
ok() { printf '%s  ok%s %s\n' "$C_OK" "$C_RESET" "$*"; }
warn() { printf '%s warn%s %s\n' "$C_WARN" "$C_RESET" "$*" >&2; }
err() { printf '%serror%s %s\n' "$C_ERR" "$C_RESET" "$*" >&2; exit 1; }

usage() {
  awk 'NR > 2 { if ($0 ~ /^set -euo pipefail/) exit; sub(/^# ?/, ""); print }' "$0"
  exit 0
}

confirm() {
  local prompt="$1"

  if [ "$ASSUME_YES" = "1" ]; then
    return 0
  fi

  if [ ! -t 0 ]; then
    return 1
  fi

  local reply
  read -r -p "$prompt [Y/n] " reply

  case "$reply" in
    "" | y | Y | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

ask() {
  local prompt="$1"
  local default="$2"

  if [ "$ASSUME_YES" = "1" ] || [ ! -t 0 ]; then
    printf '%s' "$default"
    return 0
  fi

  local reply
  read -r -p "$prompt [$default]: " reply
  printf '%s' "${reply:-$default}"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -y | --yes)
        ASSUME_YES=1
        ;;
      --web-url)
        [ "$#" -ge 2 ] || err "--web-url needs a value"
        WEB_URL="$2"
        shift
        ;;
      --web-url=*)
        WEB_URL="${1#*=}"
        ;;
      --api-url)
        [ "$#" -ge 2 ] || err "--api-url needs a value"
        API_URL="$2"
        shift
        ;;
      --api-url=*)
        API_URL="${1#*=}"
        ;;
      --web-port)
        [ "$#" -ge 2 ] || err "--web-port needs a value"
        WEB_PORT="$2"
        WEB_PORT_EXPLICIT=1
        shift
        ;;
      --web-port=*)
        WEB_PORT="${1#*=}"
        WEB_PORT_EXPLICIT=1
        ;;
      --api-port)
        [ "$#" -ge 2 ] || err "--api-port needs a value"
        API_PORT="$2"
        API_PORT_EXPLICIT=1
        shift
        ;;
      --api-port=*)
        API_PORT="${1#*=}"
        API_PORT_EXPLICIT=1
        ;;
      --no-start)
        NO_START=1
        ;;
      --restart)
        RESTART_ONLY=1
        ;;
      --stop)
        STOP_ONLY=1
        ;;
      -h | --help)
        usage
        ;;
      *)
        err "Unknown option: $1 (try --help)"
        ;;
    esac
    shift
  done

  case "$WEB_PORT" in "" | *[!0-9]*) err "Invalid web port: $WEB_PORT" ;; esac
  case "$API_PORT" in "" | *[!0-9]*) err "Invalid API port: $API_PORT" ;; esac

  WEB_URL="${WEB_URL%/}"
  API_URL="${API_URL%/}"
}

detect_os() {
  case "$(uname -s)" in
    Darwin)
      OS="darwin"
      ;;
    Linux)
      OS="linux"
      ;;
    *)
      err "Unsupported operating system: $(uname -s). Only macOS and Linux are supported."
      ;;
  esac

  if [ "$OS" = "darwin" ] && [ "$(id -u)" -eq 0 ]; then
    err "Do not run this installer with sudo on macOS. Run it as your normal user."
  fi

  if [ "$OS" = "linux" ] && [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    warn "Running as root via sudo: files and services will be owned by root."
    warn "For a dedicated service account, run this installer as that user instead."
  fi
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    return 1
  fi
}

ensure_base_tools() {
  local missing=""

  for tool in git curl openssl tar; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing="$missing $tool"
    fi
  done

  if [ -n "$missing" ]; then
    case "$OS" in
      darwin)
        if command -v brew >/dev/null 2>&1; then
          info "Installing missing tools with Homebrew:$missing"
          # shellcheck disable=SC2086
          brew install $missing || err "Could not install:$missing"
        else
          err "Missing tools:$missing. Install Homebrew (https://brew.sh) or install them manually."
        fi
        ;;
      linux)
        if command -v apt-get >/dev/null 2>&1; then
          info "Installing missing tools with apt:$missing"
          as_root apt-get update -y
          # shellcheck disable=SC2086
          as_root apt-get install -y $missing || err "Could not install:$missing"
        elif command -v dnf >/dev/null 2>&1; then
          # shellcheck disable=SC2086
          as_root dnf install -y $missing || err "Could not install:$missing"
        elif command -v yum >/dev/null 2>&1; then
          # shellcheck disable=SC2086
          as_root yum install -y $missing || err "Could not install:$missing"
        elif command -v pacman >/dev/null 2>&1; then
          # shellcheck disable=SC2086
          as_root pacman -Sy --noconfirm $missing || err "Could not install:$missing"
        else
          err "Missing tools:$missing. Install them with your package manager."
        fi
        ;;
    esac
  fi

  ok "git, curl, openssl, tar"
}

ensure_node_npm() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    ok "Node.js $(node --version 2>/dev/null) and npm $(npm --version 2>/dev/null)"
  else
    warn "Node.js and/or npm not found. They are required by the Higgsfield CLI."

    if confirm "Install Node.js and npm now?"; then
      case "$OS" in
        darwin)
          if command -v brew >/dev/null 2>&1; then
            brew install node || warn "Homebrew could not install Node.js."
          else
            warn "Homebrew not found. Install Node.js 20+ from https://nodejs.org or via Homebrew."
          fi
          ;;
        linux)
          if command -v apt-get >/dev/null 2>&1; then
            as_root apt-get update -y || true
            as_root apt-get install -y nodejs npm || warn "apt could not install Node.js."
          elif command -v dnf >/dev/null 2>&1; then
            as_root dnf install -y nodejs npm || warn "dnf could not install Node.js."
          elif command -v yum >/dev/null 2>&1; then
            as_root yum install -y nodejs npm || warn "yum could not install Node.js."
          elif command -v pacman >/dev/null 2>&1; then
            as_root pacman -Sy --noconfirm nodejs npm || warn "pacman could not install Node.js."
          else
            warn "No supported package manager found. Install Node.js 20+ manually."
          fi
          ;;
      esac
    fi
  fi

  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')"

    if [ "${major:-0}" -lt 20 ] 2>/dev/null; then
      warn "Node.js $(node --version) is old. The Higgsfield CLI may need Node.js 20 or newer."
    fi
  fi
}

ensure_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    info "Installing Bun"
    curl -fsSL https://bun.sh/install | bash ||
      err "Bun installation failed. See https://bun.sh/docs/installation"
  fi

  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"

  if ! command -v bun >/dev/null 2>&1 && [ -x "$BUN_INSTALL/bin/bun" ]; then
    export PATH="$BUN_INSTALL/bin:$PATH"
  fi

  command -v bun >/dev/null 2>&1 || err "Bun is installed but not on PATH. Add \"$BUN_INSTALL/bin\" to PATH and rerun."
  BUN_BIN="$(command -v bun)"
  ok "Bun $("$BUN_BIN" --version)"
}

ensure_higgsfield() {
  if command -v higgsfield >/dev/null 2>&1; then
    HIGGSFIELD_BIN="$(command -v higgsfield)"
    ok "Higgsfield CLI at $HIGGSFIELD_BIN"
  else
    warn "Higgsfield CLI not found."

    if command -v npm >/dev/null 2>&1 && confirm "Install the Higgsfield CLI globally with npm?"; then
      if ! npm install -g @higgsfield/cli; then
        warn "Global npm install failed; retrying with sudo."
        as_root "$(command -v npm)" install -g @higgsfield/cli || warn "Could not install the Higgsfield CLI."
      fi
    fi

    if command -v higgsfield >/dev/null 2>&1; then
      HIGGSFIELD_BIN="$(command -v higgsfield)"
      ok "Higgsfield CLI at $HIGGSFIELD_BIN"
    else
      warn "Continuing without the Higgsfield CLI. The dashboard will show 'CLI not installed'."
      warn "Install it later with: npm install -g @higgsfield/cli"
    fi
  fi

  if [ -n "$HIGGSFIELD_BIN" ]; then
    if ! "$HIGGSFIELD_BIN" auth token >/dev/null 2>&1; then
      warn "Higgsfield CLI is not signed in yet. Run: higgsfield auth login"
    else
      ok "Higgsfield CLI is signed in"
    fi
  fi
}

resolve_binaries() {
  BUN_BIN="$(command -v bun 2>/dev/null || true)"
  NODE_BIN="$(command -v node 2>/dev/null || true)"
  NPM_BIN="$(command -v npm 2>/dev/null || true)"
  HIGGSFIELD_BIN="$(command -v higgsfield 2>/dev/null || true)"

  [ -n "$BUN_BIN" ] || err "Bun is required but was not found on PATH."

  local dirs="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

  dirs="$(dirname "$BUN_BIN"):$dirs"

  if [ -n "$NODE_BIN" ]; then
    dirs="$(dirname "$NODE_BIN"):$dirs"
  fi

  if [ -n "$HIGGSFIELD_BIN" ]; then
    dirs="$(dirname "$HIGGSFIELD_BIN"):$dirs"
  fi

  SERVICE_PATH="$dirs"
}

get_env() {
  local file="$1"
  local key="$2"

  [ -f "$file" ] || return 0

  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

set_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  touch "$file"
  tmp="$(mktemp "${file}.XXXXXX")"

  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$file" >"$tmp"

  mv "$tmp" "$file"
}

set_env_if_empty() {
  local file="$1"
  local key="$2"
  local value="$3"

  if [ -z "$(get_env "$file" "$key")" ]; then
    set_env "$file" "$key" "$value"
  fi
}

configure_env() {
  local api_env="$API_DIR/.env"
  local web_env="$WEB_DIR/.env"
  local secret
  local cli_path="${HIGGSFIELD_BIN:-higgsfield}"

  if [ -f "$api_env" ]; then
    info "Keeping existing apps/api/.env"
  else
    info "Creating apps/api/.env"
    cat >"$api_env" <<EOF
# Port the API listens on.
PORT=$API_PORT

# Comma-separated list of origins allowed to call the API from a browser.
CORS_ORIGINS=$WEB_URL

# Public origin of the API. Better Auth uses it for cookie/callback URLs.
BETTER_AUTH_URL=$API_URL

# Secret used to sign sessions.
BETTER_AUTH_SECRET=

# Path to the SQLite database file.
DB_FILE_NAME=./db.sqlite

# Path to the Higgsfield CLI binary.
HIGGSFIELD_CLI_PATH=$cli_path

# Timeout for each CLI command, in milliseconds.
HIGGSFIELD_CLI_TIMEOUT_MS=15000

# How long to cache the /status result, in milliseconds.
HIGGSFIELD_STATUS_CACHE_MS=10000
EOF
  fi

  set_env_if_empty "$api_env" PORT "$API_PORT"
  set_env_if_empty "$api_env" CORS_ORIGINS "$WEB_URL"
  set_env_if_empty "$api_env" BETTER_AUTH_URL "$API_URL"
  set_env_if_empty "$api_env" DB_FILE_NAME "./db.sqlite"
  set_env_if_empty "$api_env" HIGGSFIELD_CLI_PATH "$cli_path"
  set_env_if_empty "$api_env" HIGGSFIELD_CLI_TIMEOUT_MS "15000"
  set_env_if_empty "$api_env" HIGGSFIELD_STATUS_CACHE_MS "10000"

  secret="$(get_env "$api_env" BETTER_AUTH_SECRET)"

  if [ -z "$secret" ]; then
    info "Generating BETTER_AUTH_SECRET"
    secret="$(openssl rand -base64 32)"
    set_env "$api_env" BETTER_AUTH_SECRET "$secret"
  fi

  if [ -f "$web_env" ]; then
    info "Keeping existing apps/web/.env"
  else
    info "Creating apps/web/.env"
    cat >"$web_env" <<EOF
# Base URL of the Hono API. Baked into the bundle at build time.
VITE_API_URL=$API_URL
EOF
  fi

  set_env_if_empty "$web_env" VITE_API_URL "$API_URL"

  if [ -f "$API_DIR/.env.local" ]; then
    warn "apps/api/.env.local exists and overrides apps/api/.env. Remove it if it is a leftover from development."
  fi

  if [ -f "$WEB_DIR/.env.local" ]; then
    warn "apps/web/.env.local exists and overrides apps/web/.env. Remove it if it is a leftover from development."
  fi

  chmod 600 "$api_env" 2>/dev/null || true
  chmod 600 "$web_env" 2>/dev/null || true

  ok "Environment configured"

  printf 'WEB_PORT=%s\nAPI_PORT=%s\n' "$WEB_PORT" "$API_PORT" >"$CONFIG_FILE"
}

install_dependencies() {
  info "Installing JavaScript dependencies"
  (cd "$ROOT_DIR" && "$BUN_BIN" install) || err "bun install failed."
  ok "Dependencies installed"
}

run_migrations() {
  info "Applying database migrations"
  (cd "$API_DIR" && "$BUN_BIN" run db:migrate) ||
    err "Database migration failed. Check apps/api/.env (DB_FILE_NAME) and apps/api/drizzle/."
  ok "Database is up to date"
}

build_web() {
  info "Building the web dashboard"
  (cd "$WEB_DIR" && "$BUN_BIN" run build) || err "Web build failed."
  ok "Web dashboard built"
}

service_mode_for_host() {
  case "$OS" in
    darwin)
      SERVICE_MODE="launchd"
      ;;
    linux)
      if command -v systemctl >/dev/null 2>&1; then
        SERVICE_MODE="systemd"
      else
        SERVICE_MODE="nohup"
      fi
      ;;
  esac
}

systemd_vars() {
  if [ "$(id -u)" -eq 0 ]; then
    SYSTEMD_DIR="/etc/systemd/system"
    SYSTEMD_TARGET="multi-user.target"
    SYSTEMCTL_CMD="systemctl"
    SYSTEMD_SCOPE="system"
  else
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    SYSTEMD_TARGET="default.target"
    SYSTEMCTL_CMD="systemctl --user"
    SYSTEMD_SCOPE="user"
  fi
}

write_systemd_units() {
  systemd_vars
  mkdir -p "$SYSTEMD_DIR" "$LOG_DIR"

  cat >"$SYSTEMD_DIR/higgs-proxy-api.service" <<EOF
[Unit]
Description=higgs-proxy API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$API_DIR
Environment="NODE_ENV=production"
Environment="PATH=$SERVICE_PATH"
ExecStart=$BUN_BIN run $API_DIR/src/index.ts
Restart=always
RestartSec=3
StandardOutput=append:$LOG_DIR/api.log
StandardError=append:$LOG_DIR/api.log

[Install]
WantedBy=$SYSTEMD_TARGET
EOF

  cat >"$SYSTEMD_DIR/higgs-proxy-web.service" <<EOF
[Unit]
Description=higgs-proxy web dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$WEB_DIR
Environment="NODE_ENV=production"
Environment="PATH=$SERVICE_PATH"
Environment="PORT=$WEB_PORT"
Environment="HOST=0.0.0.0"
ExecStart=$BUN_BIN run $WEB_DIR/scripts/serve.ts
Restart=always
RestartSec=3
StandardOutput=append:$LOG_DIR/web.log
StandardError=append:$LOG_DIR/web.log

[Install]
WantedBy=$SYSTEMD_TARGET
EOF

  if [ "$SYSTEMD_SCOPE" = "user" ]; then
    warn "Installed user-level systemd units. They run while you are logged in;"
    warn "to keep them running after logout use: loginctl enable-linger $USER"
  fi
}

# shellcheck disable=SC2086
systemctl_cmd() {
  $SYSTEMCTL_CMD "$@"
}

start_systemd_services() {
  write_systemd_units

  if systemctl_cmd daemon-reload &&
    systemctl_cmd enable higgs-proxy-api.service higgs-proxy-web.service >/dev/null 2>&1 &&
    systemctl_cmd restart higgs-proxy-api.service higgs-proxy-web.service; then
    ok "Services started with systemd ($SYSTEMD_SCOPE)"
    return 0
  fi

  warn "systemd could not start the services; falling back to background processes."
  warn "If you are not logged in, user units also need: loginctl enable-linger $USER"
  ACTIVE_MODE="nohup"
  start_nohup_services
}

stop_systemd_services() {
  systemd_vars 2>/dev/null || true
  [ -n "${SYSTEMCTL_CMD:-}" ] || return 0
  systemctl_cmd stop higgs-proxy-api.service higgs-proxy-web.service >/dev/null 2>&1 || true
}

launchd_plist_dir() {
  printf '%s' "$HOME/Library/LaunchAgents"
}

write_launchd_plists() {
  local dir
  dir="$(launchd_plist_dir)"
  mkdir -p "$dir" "$LOG_DIR"

  cat >"$dir/com.higgsproxy.api.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.higgsproxy.api</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN_BIN</string>
    <string>run</string>
    <string>$API_DIR/src/index.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$API_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PATH</key>
    <string>$SERVICE_PATH</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>3</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/api.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/api.log</string>
</dict>
</plist>
EOF

  cat >"$dir/com.higgsproxy.web.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.higgsproxy.web</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN_BIN</string>
    <string>run</string>
    <string>$WEB_DIR/scripts/serve.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$WEB_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PATH</key>
    <string>$SERVICE_PATH</string>
    <key>PORT</key>
    <string>$WEB_PORT</string>
    <key>HOST</key>
    <string>0.0.0.0</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>3</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/web.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/web.log</string>
</dict>
</plist>
EOF
}

launchd_bootout() {
  local label="$1"
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 ||
    launchctl remove "$label" >/dev/null 2>&1 ||
    true
}

launchd_bootstrap() {
  local label="$1"
  local plist="$2"

  launchctl bootstrap "gui/$(id -u)" "$plist" >/dev/null 2>&1 ||
    launchctl load -w "$plist" >/dev/null 2>&1 ||
    return 1
}

start_launchd_services() {
  local dir
  dir="$(launchd_plist_dir)"
  write_launchd_plists

  launchd_bootout com.higgsproxy.api
  launchd_bootout com.higgsproxy.web

  if launchd_bootstrap com.higgsproxy.api "$dir/com.higgsproxy.api.plist" &&
    launchd_bootstrap com.higgsproxy.web "$dir/com.higgsproxy.web.plist"; then
    ok "Services started with launchd"
    return 0
  fi

  warn "launchd could not start the services (no GUI session?); falling back to background processes."
  ACTIVE_MODE="nohup"
  start_nohup_services
}

stop_launchd_services() {
  launchd_bootout com.higgsproxy.api
  launchd_bootout com.higgsproxy.web
}

pid_is_running() {
  local pidfile="$1"

  [ -f "$pidfile" ] || return 1
  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

start_nohup_services() {
  mkdir -p "$RUN_DIR" "$LOG_DIR"

  if pid_is_running "$RUN_DIR/api.pid"; then
    ok "API already running (pid $(cat "$RUN_DIR/api.pid"))"
  else
    (
      cd "$API_DIR"
      nohup env PATH="$SERVICE_PATH" NODE_ENV=production \
        "$BUN_BIN" run "$API_DIR/src/index.ts" >>"$LOG_DIR/api.log" 2>&1 &
      echo $! >"$RUN_DIR/api.pid"
    )
  fi

  if pid_is_running "$RUN_DIR/web.pid"; then
    ok "Web already running (pid $(cat "$RUN_DIR/web.pid"))"
  else
    (
      cd "$WEB_DIR"
      nohup env PATH="$SERVICE_PATH" NODE_ENV=production PORT="$WEB_PORT" HOST="0.0.0.0" \
        "$BUN_BIN" run "$WEB_DIR/scripts/serve.ts" >>"$LOG_DIR/web.log" 2>&1 &
      echo $! >"$RUN_DIR/web.pid"
    )
  fi

  ok "Services started in the background (no service manager found)"
}

stop_nohup_services() {
  local name pidfile pid
  for name in api web; do
    pidfile="$RUN_DIR/$name.pid"
    if pid_is_running "$pidfile"; then
      pid="$(cat "$pidfile")"
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$pidfile"
  done
}

stop_services() {
  info "Stopping higgs-proxy"
  case "$SERVICE_MODE" in
    systemd) stop_systemd_services ;;
    launchd) stop_launchd_services ;;
    *) ;;
  esac

  # Also stop anything left over from a nohup fallback.
  stop_nohup_services
  ok "Stopped"
}

start_services() {
  ACTIVE_MODE="$SERVICE_MODE"
  case "$SERVICE_MODE" in
    systemd) start_systemd_services ;;
    launchd) start_launchd_services ;;
    *) start_nohup_services ;;
  esac
}

wait_for_url() {
  local url="$1"
  local name="$2"
  local attempt

  for attempt in $(seq 1 40); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      ok "$name is responding at $url"
      return 0
    fi
    sleep 0.5
  done

  warn "$name did not respond at $url within 20 seconds."
  warn "Check the logs in $LOG_DIR."
  return 1
}

print_summary() {
  local db_file
  db_file="$(get_env "$API_DIR/.env" DB_FILE_NAME)"
  db_file="${db_file:-./db.sqlite}"

  case "$db_file" in
    /*) ;;
    *) db_file="$API_DIR/$db_file" ;;
  esac

  db_file="${db_file//\/.\//\/}"

  printf '\n'
  printf '%s higgs-proxy is ready%s\n' "$C_OK" "$C_RESET"
  printf '\n'
  printf '  Dashboard : %s\n' "$WEB_URL"
  printf '  API       : %s\n' "$API_URL"
  printf '  First run : %s/setup\n' "$WEB_URL"
  printf '\n'
  printf '  Logs      : %s/\n' "$LOG_DIR"
  printf '  Database  : %s\n' "$db_file"
  printf '\n'
  printf '  Next: open the dashboard, create the first admin account on the\n'
  printf '  setup screen, and make sure the Higgsfield CLI is signed in:\n'
  printf '      higgsfield auth login\n'
  printf '\n'

  case "$ACTIVE_MODE" in
    systemd)
      if [ "$SYSTEMD_SCOPE" = "system" ]; then
        printf '  Manage: systemctl {status,restart,stop} higgs-proxy-api higgs-proxy-web\n'
      else
        printf '  Manage: systemctl --user {status,restart,stop} higgs-proxy-api higgs-proxy-web\n'
      fi
      ;;
    launchd)
      printf '  Manage: launchctl kickstart -k gui/%s/com.higgsproxy.api\n' "$(id -u)"
      printf '          launchctl kickstart -k gui/%s/com.higgsproxy.web\n' "$(id -u)"
      ;;
    *)
      printf '  Manage: ./install.sh --restart | ./install.sh --stop\n'
      ;;
  esac

  printf '  Upgrade: ./upgrade.sh\n'
  printf '\n'
  printf '  Reverse proxy, TLS, and DNS are not managed by this installer.\n'
  printf '  See README.md for Nginx/Caddy/Cloudflare notes.\n'
  printf '\n'
}

load_install_config() {
  [ -f "$CONFIG_FILE" ] || return 0

  if [ "$WEB_PORT_EXPLICIT" = "0" ]; then
    local saved_web_port
    saved_web_port="$(sed -n 's/^WEB_PORT=//p' "$CONFIG_FILE" 2>/dev/null | tail -n 1)"
    case "${saved_web_port:-}" in
      "" | *[!0-9]*) ;;
      *) WEB_PORT="$saved_web_port" ;;
    esac
  fi

  if [ "$API_PORT_EXPLICIT" = "0" ]; then
    local saved_api_port
    saved_api_port="$(get_env "$API_DIR/.env" PORT)"
    [ -n "$saved_api_port" ] || saved_api_port="$(sed -n 's/^API_PORT=//p' "$CONFIG_FILE" 2>/dev/null | tail -n 1)"
    case "${saved_api_port:-}" in
      "" | *[!0-9]*) ;;
      *) API_PORT="$saved_api_port" ;;
    esac
  fi
}

main() {
  parse_args "$@"
  detect_os
  service_mode_for_host
  load_install_config

  if [ "$RESTART_ONLY" = "1" ]; then
    resolve_binaries
    start_services
    wait_for_url "http://127.0.0.1:$API_PORT/setup-status" "API" || true
    wait_for_url "http://127.0.0.1:$WEB_PORT/" "Web dashboard" || true
    exit 0
  fi

  if [ "$STOP_ONLY" = "1" ]; then
    stop_services
    exit 0
  fi

  [ -f "$ROOT_DIR/package.json" ] || err "Run this script from the higgs-proxy repository."

  printf '\n%s higgs-proxy installer%s\n\n' "$C_INFO" "$C_RESET"

  ensure_base_tools
  ensure_node_npm
  ensure_bun
  ensure_higgsfield
  resolve_binaries

  if [ -z "$WEB_URL" ]; then
    WEB_URL="$(ask "Public URL of the web dashboard" "http://localhost:$WEB_PORT")"
  fi

  if [ -z "$API_URL" ]; then
    API_URL="$(ask "Public URL of the API" "http://localhost:$API_PORT")"
  fi

  WEB_URL="${WEB_URL%/}"
  API_URL="${API_URL%/}"

  [ -n "$WEB_URL" ] || err "The web URL cannot be empty."
  [ -n "$API_URL" ] || err "The API URL cannot be empty."

  info "Web URL: $WEB_URL"
  info "API URL: $API_URL"

  install_dependencies
  configure_env
  run_migrations
  build_web

  if [ "$NO_START" = "1" ]; then
    printf '\n'
    ok "Setup complete. Services were not started (--no-start)."
    printf '\nStart later with:\n    ./install.sh --restart\n\n'
    exit 0
  fi

  start_services
  wait_for_url "http://127.0.0.1:$API_PORT/setup-status" "API" || true
  wait_for_url "http://127.0.0.1:$WEB_PORT/" "Web dashboard" || true

  print_summary
}

main "$@"
