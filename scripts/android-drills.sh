#!/usr/bin/env bash
# Phase 3 failure drills on a connected emulator/phone with the local API running and a local
# QA release build installed (APP_VARIANT=local). Each drill sets up a real-world failure,
# runs a Maestro flow from apps/mobile/.maestro/drills, and checks the database so an order
# is never lost or duplicated.
#
#   ANDROID_SERIAL=emulator-5554 scripts/android-drills.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
serial="${ANDROID_SERIAL:-emulator-5554}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
adb="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb -s $serial"
flows="$root/apps/mobile/.maestro/drills"
database="$(grep -E '^DATABASE_URL=' "$root/apps/api/.env" | cut -d= -f2-)"
sql() { LC_ALL=en_US.UTF-8 psql "$database" -Atc "$1"; }
phone="98887$(printf '%05d' $((RANDOM % 100000)))"
proxy_pid=""
results=()

start_proxy() {
  [[ -n "$proxy_pid" ]] && kill "$proxy_pid" 2>/dev/null && wait "$proxy_pid" 2>/dev/null || true
  node "$root/scripts/android-proxy.mjs" --port 4001 "$@" >"$root/.local/android-proxy.log" 2>&1 &
  proxy_pid=$!
  sleep 1
  $adb reverse tcp:4000 tcp:4001 >/dev/null
}
drill() { curl -s -X POST http://127.0.0.1:4001/__drill -d "$1" >/dev/null; }
step=0
run() {
  step=$((step + 1))
  maestro --device "$serial" test -e PHONE="$phone" "$flows/$1.yaml" \
    >"$root/.local/android/drill-$(printf '%02d' $step)-$1.log" 2>&1
}
orders() { sql "select count(*) from \"Order\" o join \"User\" u on u.id = o.\"userId\" where u.phone = '+91$phone'"; }
record() { results+=("$1|$2"); echo "$1: $2"; }
cleanup() {
  [[ -n "$proxy_pid" ]] && kill "$proxy_pid" 2>/dev/null || true
  $adb shell settings put system font_scale 1.0 || true
  $adb reverse tcp:4000 tcp:4000 >/dev/null || true
}
trap cleanup EXIT

mkdir -p "$root/.local/android"
start_proxy
run 00-customer || { record "setup customer" "FAILED (see .local/android/drill-01-00-customer.log)"; exit 1; }

# 1. The reply to Place order is lost after the shop's server created the order.
run 10-to-review
drill '{"dropNextPost":"/api/v1/orders"}'
if run 11-place-unconfirmed && run 12-check-result && [[ "$(orders)" == "1" ]]; then
  record "Lost reply to Place order" "pass · one order"
else record "Lost reply to Place order" "FAILED · orders=$(orders)"; fi

# 2. No network at all when Place order is tapped, then the connection returns.
run 10-to-review
drill '{"offline":true}'
run 11-place-unconfirmed || true
drill '{"offline":false}'
if run 12-check-result && [[ "$(orders)" == "2" ]]; then
  record "Offline at Place order" "pass · one more order"
else record "Offline at Place order" "FAILED · orders=$(orders)"; fi

# 3. The app is killed straight after Place order.
run 10-to-review
if run 20-kill-while-placing && [[ "$(orders)" == "3" ]]; then
  record "App killed while placing" "pass · one more order"
else record "App killed while placing" "FAILED · orders=$(orders)"; fi

# 4. Slow 2G-like connection (600 ms per reply, about 40 kbps).
start_proxy --delay 600 --kbps 40
started=$(date +%s)
if run 30-slow-network; then
  record "Slow 2G network" "pass · browse to product in $(($(date +%s) - started))s"
else record "Slow 2G network" "FAILED"; fi
start_proxy

# 5. The server ends the session while the app is open.
run 40a-session-open
sql "delete from \"Session\" where \"userId\" = (select id from \"User\" where phone = '+91$phone')" >/dev/null
if run 40b-session-ended; then record "Session ended on the server" "pass"
else record "Session ended on the server" "FAILED"; fi

# 6. Microphone permission refused.
$adb shell pm revoke in.shivcement.store android.permission.RECORD_AUDIO 2>/dev/null || true
if run 50-mic-denied; then record "Microphone refused" "pass · typing still works"
else record "Microphone refused" "FAILED"; fi

# 7. Largest system font size.
$adb shell settings put system font_scale 1.3
if run 60-large-text; then record "Largest font (1.3×)" "pass · main actions visible"
else record "Largest font (1.3×)" "FAILED"; fi
$adb shell settings put system font_scale 1.0

# 8. The shop requires a newer app version.
start_proxy --min-version 99.0.0
if run 70-forced-update; then record "Forced update" "pass"
else record "Forced update" "FAILED"; fi
start_proxy

# 9. Android Back button.
if run 80-back-button; then record "Back button" "pass"
else record "Back button" "FAILED"; fi

# 10. TalkBack basics on the main screens: spoken names and 48dp touch targets.
for screen in home materials product basket account; do
  run "90-a11y-$screen"
  if node "$root/scripts/android-a11y-audit.mjs" --name "$screen" --serial "$serial" >/dev/null; then
    record "Accessibility: $screen" "pass"
  else record "Accessibility: $screen" "FAILED (.local/android/a11y-$screen.json)"; fi
done

echo
printf '%s\n' "${results[@]}" >"$root/.local/android/drills.txt"
if printf '%s\n' "${results[@]}" | grep -q FAILED; then exit 1; fi
