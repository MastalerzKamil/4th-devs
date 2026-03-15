#!/usr/bin/env bash
# Run from repo root. Requires: agent already running (npm run lesson5:agent in another terminal).
set -e
BASE="${1:-http://127.0.0.1:3000}"
TOKEN="${2:-0f47acce-3aa7-4b58-9389-21b2940ecc70}"

echo "=== Health ==="
curl -s "$BASE/health" | jq -c .

echo ""
echo "=== Railway agent (one shot) ==="
curl -s "$BASE/api/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agent":"railway","input":"Aktywuj trasę X-01 i podaj flagę."}' | jq -c '{ status: .data.status, output_types: [.data.output[]?.type], first_text: .data.output[0].text[:200] }'
