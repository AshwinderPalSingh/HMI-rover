# Semantic Keep-Out Navigation System

A language-grounded robot navigation system built on **ROS 2 Humble** with **SLAM Toolbox**, **Nav2**, a custom
dynamic keep-out costmap layer, and a web **operator console**.

> **Drive → Map → Label → Command** — a full pipeline from SLAM exploration to natural-language-driven
> autonomous navigation with semantic keep-out zones.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Operator console (React + TypeScript, served by hmi_server :8080)    │
│  Camera · 2D map · Teleop · Labels · Keep-out zones · Commands       │
│  System health · Event log · STOP                                    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ WebSocket (rosbridge :9090, JSON + CBOR)
┌──────────────────────────────┼───────────────────────────────────────┐
│ ROS 2 Humble                 │                                       │
│  rosbridge_server ── rosapi (introspection)                          │
│      │                                                               │
│      ├─ /hmi/cmd_vel → teleop_guard (deadman, clamps) → /cmd_vel     │
│      │                                                               │
│  ┌─────────┐ ┌─────────────┐ ┌───────────┐ ┌──────────────────────┐  │
│  │ SLAM    │ │ Nav2 stack  │ │ Label DB  │ │ Intent parser        │  │
│  │ Toolbox │ │ (planner,   │ │ (SQLite)  │ │ (Gemini / rules)     │  │
│  │ or AMCL │ │  controller,│ │           │ │                      │  │
│  └─────────┘ │  recovery)  │ └───────────┘ └──────────┬───────────┘  │
│              └──────┬──────┘                          │              │
│  ┌──────────────────┴─────────────────┐  ┌────────────┴───────────┐  │
│  │ Global costmap                     │  │ Target resolver        │  │
│  │  static · obstacle ·               │  │ (sentence-transformers │  │
│  │  semantic_keepout_layer · inflation│  │  or substring match)   │  │
│  └────────────────────────────────────┘  └────────────────────────┘  │
│  ┌────────────────────┐  ┌───────────────────────────────────────┐   │
│  │ Dialogue manager   │  │ Navigation executor                   │   │
│  │ (disambiguation,   │  │ (Nav2 action client, keep-out zones)  │   │
│  │  timeout, preempt) │  │                                       │   │
│  └────────────────────┘  └───────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Type | Description |
|---------|------|-------------|
| `semantic_nav_interfaces` | ROS 2 (C++) | Custom msg/srv definitions |
| `semantic_keepout_layer` | ROS 2 (C++) | Nav2 costmap plugin — dynamic keep-out zones |
| `semantic_nav_bringup` | ROS 2 (Python) | Backend nodes, teleop guard, console server, launch files |
| `semantic_nav_hmi` | Web (React + TS) | Operator console — see [its README](../semantic_nav_hmi/README.md) |
| `basic_mobile_robot` | ROS 2 | Simulated robot, world, maps and Nav2 parameters |

## Quick Start

### Prerequisites

- ROS 2 Humble on Ubuntu 22.04 with Nav2, SLAM Toolbox, Gazebo classic
- `rosbridge_server` and `rosapi`: `sudo apt install ros-humble-rosbridge-suite`
- `compressed_image_transport` (camera in the console): `sudo apt install ros-humble-image-transport-plugins`
- Node.js 22 LTS (20.19+ builds the console; 22.12+ runs its unit tests)
- Optional, for smarter command understanding: `pip install google-genai sentence-transformers`
  plus a Gemini API key (see below). Without them the intent parser uses rules and the resolver uses
  substring matching — every command shown below still works.

### Build

```bash
cd ~/dev_ws/src/semantic_nav_hmi
npm install && npm run build          # operator console → dist/

cd ~/dev_ws
colcon build --symlink-install --packages-select \
  semantic_nav_interfaces semantic_keepout_layer semantic_nav_bringup
source install/setup.bash
```

### Run

```bash
ros2 launch semantic_nav_bringup semantic_nav.launch.py              # localization on the saved map
ros2 launch semantic_nav_bringup semantic_nav.launch.py slam:=True   # build a new map
```

Then open **http://localhost:8080** (or `http://<robot-ip>:8080` from another device on the network).

Launch arguments: `slam`, `use_sim_time`, `use_rviz` (default `True`), `headless` (no Gazebo window),
`rosbridge_port` (9090), `hmi_port` (8080).

### Gemini API key (optional, for LLM intent parsing)

1. Create a key at [Google AI Studio → API keys](https://aistudio.google.com/apikey) (free tier available).
2. `pip install google-genai`
3. Export it in the shell that runs the launch file — **never put it in the YAML** (this repository is public):

```bash
echo 'export GEMINI_API_KEY="your-key"' >> ~/.bashrc && source ~/.bashrc
```

The intent parser logs `Intent Parser ready (LLM: gemini-3.5-flash-lite)` when it is active. Without a key, or
if a request fails or times out (8 s), it answers with the rule-based parser.

## Usage Workflow

### 1. Drive & map (Drive / Map modes)
Drive with the joystick or **WASD / arrow keys** (hold to drive, release to stop). With `slam:=True`, SLAM Toolbox
builds the map live in the console.

### 2. Save the map (Map mode)
Choose a name and a directory on the robot and click **Save map** — the console saves both the SLAM pose graph
and the occupancy grid (`.yaml` + `.pgm`). Relaunch with `map:=<path>.yaml` to localize on it.

### 3. Label the map (Label mode)
Click the map to place a label: name, aliases, type (house, park, road, building, landmark, zone, other) and radius.
Labels can be edited, deleted, sent as navigation goals or turned into keep-out zones from the list or the map.

### 4. Command the robot (Command mode)
Type or speak:
- *"Go to Ash's house"* → NavigateToPose
- *"Avoid the playground"* → dynamic keep-out zone
- *"Avoid all houses"* → keep-out zone for every label of that type
- *"It's okay to go near all houses"* → clears that group of zones
- *"Cancel"* / *"Stop"* → cancels navigation

Ambiguous targets come back as a question with clickable answers. Click-and-drag on the map sends a goal with
a heading; **K** draws a keep-out polygon; **Space** is STOP.

## Key Features

### Dynamic Keep-out Zones
The `SemanticKeepoutLayer` costmap plugin:
- Adds/removes zones at runtime via ROS 2 services
- Publishes the full set of zones on `/keepout_zone_list` (latched) on every change
- **Robot-inside-zone safety**: if the robot is inside a newly added zone, cells are INSCRIBED (not LETHAL) until it exits
- **Zone groups**: batch add/remove for category commands ("avoid all houses")
- **TTL support**: session, permanent, and one-shot zones with auto-expiry
- Zones survive Nav2 costmap clears (the default behavior tree clears the global costmap after a planning
  failure), and removed zones are re-costed so their cells free up immediately

### LLM Intent Parsing
Natural language → structured JSON via Gemini (`google-genai` SDK, `gemini-3.5-flash-lite` by default):
- Constrained system prompt ensures structured output
- Rule-based fallback when no API key (articles and "all/every" are normalised, like the LLM examples)
- The LLM does linguistic parsing only, never resolves locations

### Embedding-Based Target Resolution
`sentence-transformers` (all-MiniLM-L6-v2) cosine similarity:
- Matches user targets against label names + aliases
- **Similarity margin rule**: if `score(top1) - score(top2) < ε`, flags as ambiguous → disambiguation dialogue
- Category targets accept plurals ("houses" → type `house`)

### Dialogue Manager
- Follow-up questions (shown in the console and spoken) when ambiguous
- 15-second timeout with 1 reprompt before cancelling
- **Preemption policy**: `navigate_to` during navigation → REJECT ("say cancel first");
  `avoid_zone` during navigation → ALLOW (costmap-only, triggers replan)

### Operator Console
See [semantic_nav_hmi/README.md](../semantic_nav_hmi/README.md): camera, live map with laser/path/zones,
map tools, navigation progress for any goal, label and zone management, voice, system health, event log,
keyboard shortcuts, responsive down to phones. Teleop is protected by `teleop_guard`, which stops the base
if the browser's command stream drops.

## Interfaces added for the console

| Name | Kind | Purpose |
|---|---|---|
| `/label_list` | `semantic_nav_interfaces/LabelArray`, latched | Full label snapshot on every change (resolver and executor use it too) |
| `/keepout_zone_list` | `semantic_nav_interfaces/KeepoutZoneArray`, latched | Full keep-out zone snapshot |
| `/hmi/cmd_vel` | `geometry_msgs/Twist` | Console teleop → `teleop_guard` → `/cmd_vel` |
| `teleop_guard` | node | Forwards and clamps teleop; publishes zero if the stream stops for 0.5 s |
| `hmi_server` | node | Serves `semantic_nav_hmi/dist` and `/hmi-config.json` |
| `rosapi` | node | Node/topic introspection for the console's System panel |

The original per-entry `/labels` and `/keepout_zones` topics are still published.

## Coordinate Transform

> ROS occupancy grids are row-0-at-bottom-left; screens are row-0-at-top-left.

The console draws the grid through a Y-up world transform, so cells are never flipped by hand:
`screen = centre + ppm · (x − cx, −(y − cy))`.

## Configuration

All tunable backend parameters are in `config/semantic_nav_params.yaml`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `gemini_api_key` | `""` | Fallback only — prefer the `GEMINI_API_KEY` environment variable |
| `model_name` | `gemini-3.5-flash-lite` | LLM model for intent parsing |
| `request_timeout` | `8.0` | Seconds before falling back to rule-based parsing |
| `epsilon` | `0.05` | Similarity margin for ambiguity |
| `disambiguation_timeout` | `15.0` | Seconds before timeout |
| `max_reprompts` | `1` | Max re-asks before cancelling |
| `db_path` | `~/.semantic_nav/labels.db` | SQLite database path (`~` is expanded) |

## Known Limitations

1. **Single robot only** — no multi-robot support
2. **2D maps only** — no 3D costmap/voxel layer integration
3. **No persistent keep-out zones** — zones are lost when the costmap node restarts
4. **LLM latency** — Gemini API calls add ~200-500 ms to command processing
5. **Embedding model size** — `all-MiniLM-L6-v2` requires ~80 MB download on first run
6. **Simulated base braking** — the diff-drive plugin's `max_wheel_acceleration: 1.0` means ~1.8 s / 0.2 m to stop
   from full speed; `robot_radius: 0.75` in the Nav2 params is about twice the robot's real half-width

## Future Work

- [ ] Polygon drawing for label regions (keep-out polygons are supported)
- [x] Navigation progress with ETA
- [ ] Map version tracking with stale-label detection
- [ ] Multi-floor support
- [ ] Persistent keep-out zone storage
- [ ] Offline LLM mode (Ollama/llama.cpp)
- [x] Camera feed in the web UI
