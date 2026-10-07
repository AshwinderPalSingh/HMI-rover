# End-to-end tests

Drives the operator console in headless Chrome against the **real** stack — Gazebo, Nav2, AMCL/SLAM, the
keep-out layer, the semantic nodes, rosbridge — and checks both what the console shows and what reaches ROS
(`/cmd_vel`, the label database, `/keepout_zone_list`, the global costmap, Nav2 action status, saved map files).

The stack runs headless on an isolated ROS domain (77) with its own `HOME` under `e2e/home`, rosbridge on
:9097 and the console on :8097, so it never touches your label database or a system you have running.

## Run

```bash
cd ~/dev_ws/src/semantic_nav_hmi
npm run build                 # the tests use the built console (dist/)
cd e2e
npm install
npm run setup                 # downloads headless Chrome into ./browsers
./run_all.sh                  # ~20 min; prints PASS/FAIL per check and screenshots into ./shots
```

Requires the workspace to be built and the Python packages `numpy`, `opencv-python` and `Pillow`.
Chrome runs on the GPU through Vulkan when there is one, as the console's WebGL picture would in an operator's
browser; without a GPU the console falls back to a 2D canvas and the 3D-view prediction check is skipped.

## Suites

| Suite | Covers |
|---|---|
| `s01_open` | Connects via `/hmi-config.json`, localization, pose, live camera, guard detection, no console errors |
| `s02_teleop` | Keyboard and joystick drive, release, reverse, focus loss, and a renderer crash mid-drive (guard must stop the base) |
| `s05_reconnect_cbor` | Auto-reconnect, map over CBOR, auto-fit |
| `s06_labels` | Create (map click), duplicate-name guard, edit, delete — checked against `/get_labels` |
| `s07_nav` | Click-and-drag goal reaches its target, attribution, Cancel, STOP |
| `s08_zones` | Draw a keep-out polygon → snapshot topic → lethal in the global costmap → survives a costmap clear → goal inside is refused → removal frees the cells |
| `s09_commands` | Text commands through parser, resolver, dialogue manager and executor; disambiguation; STOP; "avoid all houses" / clear |
| `s10_settings` | Switching the camera topic in Settings; colour/orientation test pattern; AMCL pose estimate |
| `s11_responsive` | 1024×768, phone and 1920×1080 layouts without overflow |
| `s12_perf_a11y` | Main-thread load when idle and with live camera; accessible names on every control |
| `s13_slam` | SLAM detection, live map growth, saving the pose graph and occupancy grid |
| `s14_view_controls` | 3D view: fills the stage, scroll/drag/Shift-drag/middle-drag/right-drag, Q/E, follow-heading toggle without a jump, reset — each checked on `/viewer_camera/state` — and the picture answering the pointer within two display frames; digital zoom on another camera (test pattern); moving, resizing, persisting and swapping the picture-in-picture; map zoom |

Run a single suite against an already running stack: `./stack_start.sh`, then
`CHROME=… node browser.mjs &` and `node step.mjs s06_labels.mjs`; stop with `./stack_stop.sh`.
