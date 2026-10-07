# semantic_nav_gazebo

Gazebo classic plugins for the operator console.

## `libviewer_camera_plugin.so` — orbit camera for the 3D view

A model plugin for a gravity-free, kinematic model that carries a camera sensor (`viewer_camera` in
`basic_mobile_robot/worlds/basic_mobile_bot_world/smalltown.world`). Every physics step it places the camera on
a sphere around a target point near the robot, looking at it — the Gazebo GUI's orbit view, but following the
robot. Moving it inside the physics loop keeps it locked to the robot with no judder, as if it were mounted on it.

| ROS interface | Type | |
|---|---|---|
| `command` | `semantic_nav_interfaces/ViewerCamera` | New view: azimuth, elevation, distance, target offset, follow heading. `distance <= 0` resets to the default view |
| `state` | `semantic_nav_interfaces/ViewerCameraState` (transient local) | Current view, stamped with the simulation time it took effect, plus the camera's field of view and the robot's size |

The target offset is relative to the ground point under the robot (the bottom of its collision bounding box), so
`z` is the height above the ground, also on slopes. With `follow_heading` the view turns with the robot through a
short lag (`heading_lag`); without it the view keeps a world-fixed orientation. Switching re-expresses the view so
the picture does not jump.

```xml
<model name="viewer_camera">
  <link name="link">
    <gravity>0</gravity>
    <kinematic>1</kinematic>
    <sensor name="viewer_camera" type="camera"> … gazebo_ros_camera … </sensor>
  </link>
  <plugin name="viewer_camera_controller" filename="libviewer_camera_plugin.so">
    <ros><namespace>/viewer_camera</namespace></ros>
    <target>basic_mobile_bot</target>            <!-- model to follow -->
    <azimuth>0</azimuth>                         <!-- default view -->
    <elevation>0.3</elevation>
    <distance>2.8</distance>
    <offset>0 0 0.8</offset>
    <follow_heading>true</follow_heading>
    <heading_lag>0.12</heading_lag>              <!-- s -->
  </plugin>
</model>
```

The plugin is found through `LD_LIBRARY_PATH` once the workspace is sourced (and through the `gazebo_ros`
`plugin_path` export).
