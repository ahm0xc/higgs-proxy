#!/usr/bin/env bash
#
# higgs-proxy upgrader for macOS and Linux.
#
# Stops the services, backs up the SQLite database, pulls the latest code from
# git, installs dependencies, applies new migrations, rebuilds the dashboard,
# and restarts everything.
#
# Usage:
#   ./upgrade.sh                 Upgrade from origin/main
#   ./upgrade.sh --branch dev    Upgrade from another branch
#
# The database backup is written to backups/ before migrations run. Only the
# ten most recent backups are kept.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT_DIR/apps/api"
WEB_DIR="$ROOT_DIR/apps/web"
BACKUP_DIR="$ROOT_DIR/backups"

BRANCH="main"
SERVICES_STOPPED=0
RESTARTED=0

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

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --branch)
        [ "$#" -ge 2 ] || err "--branch needs a value"
        BRANCH="$2"
        shift
        ;;
      --branch=*)
        BRANCH="${1#*=}"
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
}

on_error() {
  warn "Upgrade failed."

  if [ "$SERVICES_STOPPED" = "1" ] && [ "$RESTARTED" = "0" ]; then
    warn "Trying to bring the previous version back up..."
    "$ROOT_DIR/install.sh" --restart || true
  fi

  exit 1
}

trap on_error ERR

resolve_bun() {
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"

  command -v bun >/dev/null 2>&1 ||
    err "Bun was not found. Run ./install.sh first."

  BUN_BIN="$(command -v bun)"
}

database_path() {
  local db_env
  db_env="$(sed -n 's/^DB_FILE_NAME=//p' "$API_DIR/.env" 2>/dev/null | tail -n 1)"
  db_env="${db_env:-./db.sqlite}"

  case "$db_env" in
    /*) printf '%s' "$db_env" ;;
    *) printf '%s/%s' "$API_DIR" "$db_env" ;;
  esac
}

backup_database() {
  local db_path
  db_path="$(database_path)"

  if [ ! -f "$db_path" ]; then
    warn "No database found at $db_path; skipping backup."
    return 0
  fi

  mkdir -p "$BACKUP_DIR"
  local stamp backup
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup="$BACKUP_DIR/db-$stamp.sqlite"

  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$db_path" ".backup '$backup'" || cp "$db_path" "$backup"
  else
    cp "$db_path" "$backup"
  fi

  ok "Database backed up to $backup"

  # Keep only the ten newest backups.
  ls -1t "$BACKUP_DIR"/db-*.sqlite 2>/dev/null | tail -n +11 | while IFS= read -r old; do
    rm -f "$old"
  done
}

main() {
  parse_args "$@"

  [ -f "$ROOT_DIR/package.json" ] || err "Run this script from the higgs-proxy repository."
  [ -d "$ROOT_DIR/.git" ] || err "This directory is not a git clone; cannot upgrade."
  [ -x "$ROOT_DIR/install.sh" ] || err "install.sh not found next to upgrade.sh."

  printf '\n%s higgs-proxy upgrader%s\n\n' "$C_INFO" "$C_RESET"

  if [ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]; then
    git -C "$ROOT_DIR" status --short >&2
    err "The working tree has local changes. Commit or stash them, then rerun."
  fi

  resolve_bun

  info "Stopping services"
  "$ROOT_DIR/install.sh" --stop || warn "Services were not running."
  SERVICES_STOPPED=1

  backup_database

  info "Fetching $BRANCH"
  git -C "$ROOT_DIR" fetch --prune origin
  git -C "$ROOT_DIR" pull --ff-only origin "$BRANCH"

  info "Installing JavaScript dependencies"
  (cd "$ROOT_DIR" && "$BUN_BIN" install)

  info "Applying database migrations"
  (cd "$API_DIR" && "$BUN_BIN" run db:migrate)

  info "Building the web dashboard"
  (cd "$WEB_DIR" && "$BUN_BIN" run build)

  info "Restarting services"
  "$ROOT_DIR/install.sh" --restart
  RESTARTED=1

  printf '\n'
  printf '%s Upgrade complete%s (%s)\n' "$C_OK" "$C_RESET" "$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
  printf '\n'
  printf '  Backups : %s/\n' "$BACKUP_DIR"
  printf '  Logs    : %s/logs/\n' "$ROOT_DIR"
  printf '\n'
}

main "$@"
