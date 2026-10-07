#!/bin/bash
# Full end-to-end run against the real stack. Usage: ./run_all.sh [suite ...]
source "$(dirname "$0")/env.sh"
cd "$E2E_DIR"
mkdir -p shots
CHROME=$(ls -d browsers/chrome-headless-shell/linux-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | head -1)
[ -x "$CHROME" ] || { echo "Run 'npm run setup' first (downloads headless Chrome into ./browsers)"; exit 1; }
[ -f "$WS/src/semantic_nav_hmi/dist/index.html" ] || { echo "Build the console first: (cd .. && npm run build)"; exit 1; }
export CHROME
node browser.mjs > browser.log 2>&1 &
BROWSER=$!
trap 'kill $BROWSER 2>/dev/null; ./stack_stop.sh >/dev/null' EXIT
sleep 3

FAILED=0
run() {
  out=$(timeout 400 node step.mjs "$1.mjs" 2>&1)
  echo "$out" | grep -E "^(PASS|FAIL)" | sed "s/^/[$1] /" | cut -c1-160
  summary=$(echo "$out" | grep -E "checks passed|STEP THREW" | tail -1)
  echo "[$1] $summary"
  echo "$summary" | grep -qE "^([0-9]+)/\1 checks passed" || FAILED=1
}
pattern() {
  (export HOME="$E2E_DIR/home" ROS_DOMAIN_ID="$ROS_DOMAIN_ID_E2E"; source /opt/ros/humble/setup.bash; source "$WS/install/setup.bash"
   exec python3 test_pattern.py) > pattern.log 2>&1 &
  PATTERN=$!
}

echo "== localization (AMCL) =="; ./stack_stop.sh >/dev/null; ./stack_start.sh >/dev/null; sleep 12
for s in s01_open s02_teleop s05_reconnect_cbor s06_labels s08_zones s09_commands; do run $s; done
pattern; sleep 3; run s10_settings; run s14_view_controls; kill $PATTERN 2>/dev/null
run s11_responsive; run s12_perf_a11y

echo "== navigation (fresh stack, robot at spawn) =="; ./stack_stop.sh >/dev/null; ./stack_start.sh >/dev/null; sleep 12
run s07_nav

echo "== SLAM =="; rm -f e2e_map.*; ./stack_stop.sh >/dev/null; SLAM=True ./stack_start.sh >/dev/null; sleep 12
run s13_slam

[ $FAILED = 0 ] && echo "ALL SUITES PASSED" || echo "SOME CHECKS FAILED"
exit $FAILED
