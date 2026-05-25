#!/usr/bin/env bash
set -euo pipefail

STATUS_FILE="${CAPI_STATUS_FILE:-/tmp/capi/status.json}"
RUNTIME_URL="${CAPI_RUNTIME_URL:-http://127.0.0.1:5173}"
NAME="${NAME:-capi}"

hide_item() {
  sketchybar --set "$NAME" drawing=off
}

if [[ "${1:-}" == "--stop" ]]; then
  /usr/bin/curl -fsS -X DELETE "$RUNTIME_URL/captures" >/dev/null 2>&1 || true
  sketchybar --set "$NAME" icon="󰓛" label="Stopping" drawing=on
  exit 0
fi

if [[ ! -f "$STATUS_FILE" ]]; then
  hide_item
  exit 0
fi

state="$(/usr/bin/plutil -extract state raw "$STATUS_FILE" 2>/dev/null || echo idle)"
message="$(/usr/bin/plutil -extract message raw "$STATUS_FILE" 2>/dev/null || echo "")"

case "$state" in
  starting)
    sketchybar --set "$NAME" icon="󰐌" label="${message:-Starting}" drawing=on
    ;;
  recording)
    sketchybar --set "$NAME" icon="󰑊" label="${message:-Recording}" drawing=on
    ;;
  stopping)
    sketchybar --set "$NAME" icon="󰓛" label="${message:-Stopping}" drawing=on
    ;;
  *)
    hide_item
    ;;
esac
