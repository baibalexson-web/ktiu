#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 24 LTS or newer: https://nodejs.org/en/download"
  exit 1
fi
node server.mjs --open
