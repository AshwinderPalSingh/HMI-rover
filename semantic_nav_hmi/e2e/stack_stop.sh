#!/bin/bash
# Stop only processes started by stack_start.sh (matched by their isolated ROS domain and HOME).
source "$(dirname "$0")/env.sh"
mine() {
  for p in $(ls /proc | grep -E '^[0-9]+$'); do
    e=/proc/$p/environ; [ -r "$e" ] || continue
    if tr '\0' '\n' < "$e" 2>/dev/null | grep -qx "ROS_DOMAIN_ID=$ROS_DOMAIN_ID_E2E" &&
       tr '\0' '\n' < "$e" 2>/dev/null | grep -qx "HOME=$E2E_DIR/home"; then echo "$p"; fi
  done
}
for p in $(mine); do kill -INT "$p" 2>/dev/null; done; sleep 6
for p in $(mine); do kill -KILL "$p" 2>/dev/null; done; sleep 1
echo "test stack stopped ($(mine | wc -w) processes left)"
