#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

export ENGLISH_FLOW_RENDER_EXPORT=1

node scripts/sync-ngsl-packs.mjs
timeout --signal=TERM --kill-after=10s 3m node_modules/.bin/vinext build
node scripts/validate-render.mjs
