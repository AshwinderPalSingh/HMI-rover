# HMI Rover — Semantic Keep-Out Navigation

A ROS 2 Humble robot you can drive, map, label and command in plain language from a web operator console.
SLAM Toolbox and Nav2 handle mapping and navigation; a custom costmap layer turns phrases like
*"avoid the playground"* into live keep-out zones.

![Operator console: “avoid all houses” creates live keep-out zones](semantic_nav_hmi/docs/console.png)

## What's inside

| Package | What it is |
|---|---|
| [`semantic_nav_hmi`](semantic_nav_hmi/) | Operator console — React + TypeScript web app served by the robot |
| [`semantic_nav_bringup`](semantic_nav_bringup/) | Semantic nodes (label DB, intent parser, target resolver, dialogue manager, navigation executor), teleop guard, console server, launch |
| [`semantic_keepout_layer`](semantic_keepout_layer/) | Nav2 costmap plugin for runtime keep-out zones |
| [`semantic_nav_interfaces`](semantic_nav_interfaces/) | Messages and services |
| [`basic_mobile_robot`](basic_mobile_robot/) | Simulated robot, Gazebo world, map, Nav2 parameters |

## Quick start

```bash
mkdir -p ~/dev_ws/src && cd ~/dev_ws/src
git clone https://github.com/AshwinderPalSingh/HMI-rover.git .

cd semantic_nav_hmi && npm install && npm run build && cd ..        # operator console
cd ~/dev_ws && colcon build --symlink-install && source install/setup.bash
ros2 launch semantic_nav_bringup semantic_nav.launch.py              # add slam:=True to build a new map
```

Open **http://localhost:8080**.

Full documentation: [system & backend](semantic_nav_bringup/README.md) · [operator console](semantic_nav_hmi/README.md).
