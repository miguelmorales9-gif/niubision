#!/usr/bin/env bash
# Edit: app/styles.css + app/app.js + shell index.html, then run this (or npm run sync:html / npm run build).
# No bundler — classic script keeps function globals. This is a sync alias.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
bash "$root/scripts/sync-html.sh"
