#!/bin/bash
# Shared settings for the end-to-end suite.
E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="${WS:-$(cd "$E2E_DIR/../../.." && pwd)}"   # workspace root, e.g. ~/dev_ws
ROS_DOMAIN_ID_E2E="${ROS_DOMAIN_ID_E2E:-77}"     # isolated from your normal ROS graph
export E2E_DIR WS ROS_DOMAIN_ID_E2E
