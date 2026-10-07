#!/bin/bash
# Launch the whole system headless on an isolated ROS domain (rosbridge :9097, console :8097).
# HOME points into e2e/home so the label database and logs never touch your real ones.
source "$(dirname "$0")/env.sh"
mkdir -p "$E2E_DIR/home/.gazebo"
[ -e "$E2E_DIR/home/.gazebo/models" ] || ln -s "$HOME/.gazebo/models" "$E2E_DIR/home/.gazebo/models" 2>/dev/null
python3 "$E2E_DIR/seed_labels.py" "$E2E_DIR/home/.semantic_nav/labels.db" >/dev/null
[ -f "$E2E_DIR/launch.log" ] && mv "$E2E_DIR/launch.log" "$E2E_DIR/launch.prev.log"
(
  export HOME="$E2E_DIR/home" ROS_DOMAIN_ID="$ROS_DOMAIN_ID_E2E" GAZEBO_MASTER_URI=http://localhost:11399 ROS_LOG_DIR="$E2E_DIR/home/.ros/log"
  source /opt/ros/humble/setup.bash
  source "$WS/install/setup.bash"
  exec setsid ros2 launch semantic_nav_bringup semantic_nav.launch.py \
    use_rviz:=False headless:=True rosbridge_port:=9097 hmi_port:=8097 slam:="${SLAM:-False}"
) > "$E2E_DIR/launch.log" 2>&1 < /dev/null &
for _ in $(seq 1 90); do
  grep -q "Managed nodes are active" "$E2E_DIR/launch.log" 2>/dev/null && grep -q "Operator console" "$E2E_DIR/launch.log" && break
  sleep 1
done
grep -E "Rosbridge WebSocket server started|Operator console|Managed nodes are active" "$E2E_DIR/launch.log" | head -3
