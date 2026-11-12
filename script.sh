#!/bin/bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Você precisa de superpoderes (root) pra rodar este script"
  echo "Execute: sudo ./script.sh"
  exit 1
fi

APP_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ ! -f "${APP_DIR}/package.json" ]; then
  command -v git >/dev/null 2>&1 || apt-get update -qq
  command -v git >/dev/null 2>&1 || apt-get install -y git ca-certificates curl
  APP_DIR="$(mktemp -d /tmp/setup-termui.XXXXXX)"
  git clone --depth 1 https://github.com/paulovisam/setup.git "$APP_DIR"
fi

REAL_USER="${SUDO_USER:-${USER:-root}}"
if [ -z "$REAL_USER" ] || [ "$REAL_USER" = "root" ]; then
  REAL_HOME=/root
else
  REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
  REAL_HOME="${REAL_HOME:-/home/$REAL_USER}"
fi

export BUN_INSTALL="$REAL_HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  if [ "$REAL_USER" = "root" ]; then
    curl -fsSL https://bun.sh/install | bash
  else
    sudo -u "$REAL_USER" -H env HOME="$REAL_HOME" bash -lc 'curl -fsSL https://bun.sh/install | bash'
  fi
fi

cd "$APP_DIR"
BUN_BIN="$(command -v bun)"
if [ "$REAL_USER" = "root" ]; then
  "$BUN_BIN" install
else
  sudo -u "$REAL_USER" -H env HOME="$REAL_HOME" PATH="$BUN_INSTALL/bin:$PATH" "$BUN_BIN" install
fi
exec "$BUN_BIN" src/index.tsx
