/** ROS names and interface types used by the console (single source of truth). */

export const TYPES = {
  twist: 'geometry_msgs/msg/Twist',
  string: 'std_msgs/msg/String',
  poseCov: 'geometry_msgs/msg/PoseWithCovarianceStamped',
  tf: 'tf2_msgs/msg/TFMessage',
  map: 'nav_msgs/msg/OccupancyGrid',
  odom: 'nav_msgs/msg/Odometry',
  path: 'nav_msgs/msg/Path',
  scan: 'sensor_msgs/msg/LaserScan',
  image: 'sensor_msgs/msg/CompressedImage',
  goalStatus: 'action_msgs/msg/GoalStatusArray',
  cancelGoal: 'action_msgs/srv/CancelGoal',
  navAction: 'nav2_msgs/action/NavigateToPose',
  navFeedback: 'nav2_msgs/action/NavigateToPose_FeedbackMessage',
  saveMap: 'nav2_msgs/srv/SaveMap',
  serializeMap: 'slam_toolbox/srv/SerializePoseGraph',
  labelArray: 'semantic_nav_interfaces/msg/LabelArray',
  zoneArray: 'semantic_nav_interfaces/msg/KeepoutZoneArray',
  dialogue: 'semantic_nav_interfaces/msg/DialogueEvent',
  addLabel: 'semantic_nav_interfaces/srv/AddLabel',
  updateLabel: 'semantic_nav_interfaces/srv/UpdateLabel',
  removeLabel: 'semantic_nav_interfaces/srv/RemoveLabel',
  getLabels: 'semantic_nav_interfaces/srv/GetLabels',
  addZone: 'semantic_nav_interfaces/srv/AddKeepoutZone',
  removeZone: 'semantic_nav_interfaces/srv/RemoveKeepoutZone',
  nodes: 'rosapi_msgs/srv/Nodes',
  getTime: 'rosapi_msgs/srv/GetTime',
} as const;

export const NAMES = {
  tf: '/tf',
  tfStatic: '/tf_static',
  baseCmdVel: '/cmd_vel',
  initialPose: '/initialpose',
  amclPose: '/amcl_pose',
  navAction: '/navigate_to_pose',
  navStatus: '/navigate_to_pose/_action/status',
  navFeedback: '/navigate_to_pose/_action/feedback',
  navCancel: '/navigate_to_pose/_action/cancel_goal',
  labelList: '/label_list',
  zoneList: '/keepout_zone_list',
  dialogue: '/dialogue_events',
  voice: '/voice_command',
  dialogueResponse: '/dialogue_response',
  addLabel: '/add_label',
  updateLabel: '/update_label',
  removeLabel: '/remove_label',
  getLabels: '/get_labels',
  addZone: '/add_keepout_zone',
  removeZone: '/remove_keepout_zone',
  serializeMap: '/slam_toolbox/serialize_map',
  saveMap: '/map_saver/save_map',
  nodes: '/rosapi/nodes',
  getTime: '/rosapi/get_time',
  /** loopback topic for measuring the real browser → rosbridge → DDS → browser round trip */
  ping: '/hmi/ping',
} as const;

/** Which node provides a service, for actionable error messages. */
export const PROVIDERS: Record<string, string> = {
  [NAMES.addLabel]: 'label_db_node',
  [NAMES.updateLabel]: 'label_db_node',
  [NAMES.removeLabel]: 'label_db_node',
  [NAMES.getLabels]: 'label_db_node',
  [NAMES.addZone]: 'the global costmap (semantic_keepout_layer)',
  [NAMES.removeZone]: 'the global costmap (semantic_keepout_layer)',
  [NAMES.navCancel]: 'Nav2 (bt_navigator)',
  [NAMES.navAction]: 'Nav2 (bt_navigator)',
  [NAMES.serializeMap]: 'slam_toolbox (launch with slam:=True)',
  [NAMES.saveMap]: 'map_saver_server (started with SLAM)',
  [NAMES.nodes]: 'rosapi',
  [NAMES.getTime]: 'rosapi',
};

/** Nodes the System panel checks for, grouped by subsystem. */
export const EXPECTED_NODES: { group: string; nodes: { name: string; label: string; optional?: boolean }[] }[] = [
  {
    group: 'Semantic stack',
    nodes: [
      { name: '/label_db_node', label: 'Label database' },
      { name: '/intent_parser_node', label: 'Intent parser' },
      { name: '/target_resolver_node', label: 'Target resolver' },
      { name: '/dialogue_manager_node', label: 'Dialogue manager' },
      { name: '/navigation_executor_node', label: 'Navigation executor' },
    ],
  },
  {
    group: 'Navigation',
    nodes: [
      { name: '/bt_navigator', label: 'BT navigator' },
      { name: '/planner_server', label: 'Planner' },
      { name: '/controller_server', label: 'Controller' },
      { name: '/global_costmap/global_costmap', label: 'Global costmap (keep-out layer)' },
      { name: '/amcl', label: 'AMCL localization', optional: true },
      { name: '/slam_toolbox', label: 'SLAM Toolbox', optional: true },
      { name: '/map_server', label: 'Map server', optional: true },
    ],
  },
  {
    group: 'Robot & bridge',
    nodes: [
      { name: '/ekf_filter_node', label: 'EKF odometry' },
      { name: '/robot_state_publisher', label: 'Robot state publisher' },
      { name: '/teleop_guard', label: 'Teleop guard (deadman)' },
      { name: '/rosbridge_websocket', label: 'rosbridge' },
      { name: '/rosapi', label: 'rosapi' },
    ],
  },
];
