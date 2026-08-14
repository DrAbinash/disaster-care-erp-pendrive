#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PENDRIVE_ROOT="$PWD"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8898}"
echo "CARE Ultra-Emergency Billing (USB)  http://127.0.0.1:${PORT}"
if [[ -x ./runtime/node ]]; then
  exec ./runtime/node ./app/server.mjs
fi
exec node ./app/server.mjs
