/**
 * TypeScript shapes of the ROS 2 messages the console uses, mirroring the
 * .msg/.srv definitions (semantic_nav_interfaces, nav2_msgs, action_msgs, ...).
 *
 * Binary arrays arrive as typed arrays when a subscription uses CBOR
 * (rosbridge tags int8[]/float32[]/uint8[]), and as plain arrays with JSON —
 * consumers accept both via ArrayLike.
 */

export interface Time {
  sec: number;
  nanosec: number;
}

export interface Header {
  stamp: Time;
  frame_id: string;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Pose {
  position: Vector3;
  orientation: Quaternion;
}

export interface PoseStamped {
  header: Header;
  pose: Pose;
}

export interface PoseWithCovarianceStamped {
  header: Header;
  pose: { pose: Pose; covariance: ArrayLike<number> };
}

export interface Twist {
  linear: Vector3;
  angular: Vector3;
}

export interface TransformStamped {
  header: Header;
  child_frame_id: string;
  transform: { translation: Vector3; rotation: Quaternion };
}

export interface TFMessage {
  transforms: TransformStamped[];
}

export interface MapMetaData {
  map_load_time: Time;
  resolution: number;
  width: number;
  height: number;
  origin: Pose;
}

export interface OccupancyGrid {
  header: Header;
  info: MapMetaData;
  data: ArrayLike<number>;
}

export interface Odometry {
  header: Header;
  child_frame_id: string;
  pose: { pose: Pose; covariance: ArrayLike<number> };
  twist: { twist: Twist; covariance: ArrayLike<number> };
}

export interface LaserScan {
  header: Header;
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  time_increment: number;
  scan_time: number;
  range_min: number;
  range_max: number;
  ranges: ArrayLike<number>;
  intensities: ArrayLike<number>;
}

export interface Path {
  header: Header;
  poses: PoseStamped[];
}

export interface CompressedImage {
  header: Header;
  format: string;
  /** Uint8Array with CBOR, base64 string with JSON */
  data: Uint8Array | string | number[];
}

export interface StringMsg {
  data: string;
}

export interface Point32 {
  x: number;
  y: number;
  z: number;
}

// ── action_msgs ──────────────────────────────────────────────

export interface GoalInfo {
  /** uint8[16]: Uint8Array (CBOR), number[] or base64 string (JSON) */
  goal_id: { uuid: Uint8Array | number[] | string };
  stamp: Time;
}

export interface GoalStatus {
  goal_info: GoalInfo;
  status: number;
}

export interface GoalStatusArray {
  status_list: GoalStatus[];
}

export const GOAL_STATUS = {
  UNKNOWN: 0,
  ACCEPTED: 1,
  EXECUTING: 2,
  CANCELING: 3,
  SUCCEEDED: 4,
  CANCELED: 5,
  ABORTED: 6,
} as const;

export interface CancelGoalResponse {
  return_code: number;
  goals_canceling: GoalInfo[];
}

// ── nav2_msgs ────────────────────────────────────────────────

export interface Duration {
  sec: number;
  nanosec: number;
}

export interface NavigateToPoseFeedback {
  current_pose: PoseStamped;
  navigation_time: Duration;
  estimated_time_remaining: Duration;
  number_of_recoveries: number;
  distance_remaining: number;
}

/** /navigate_to_pose/_action/feedback carries the goal id alongside the feedback. */
export interface NavigateToPoseFeedbackMessage {
  goal_id: { uuid: Uint8Array | number[] | string };
  feedback: NavigateToPoseFeedback;
}

export interface NavigateToPoseGoal {
  pose: PoseStamped;
  behavior_tree: string;
}

// ── semantic_nav_interfaces ─────────────────────────────────

export type LabelGeometryType = 'point_radius' | 'polygon';

export interface LabelGeometry {
  type: LabelGeometryType | string;
  x: number;
  y: number;
  radius: number;
  polygon_points: Vector3[];
}

export interface LabelEntry {
  label_id: string;
  display_name: string;
  aliases: string[];
  semantic_type: string;
  geometry: LabelGeometry;
  map_version: string;
  created_at: Time;
}

export interface LabelArray {
  header: Header;
  labels: LabelEntry[];
}

export interface KeepoutZone {
  zone_id: string;
  zone_group_id: string;
  reason: string;
  polygon: { points: Point32[] };
  duration: 'session' | 'permanent' | 'one_shot' | string;
  ttl_seconds: number;
  is_active: boolean;
}

export interface KeepoutZoneArray {
  header: Header;
  zones: KeepoutZone[];
}

export type DialogueEventType =
  | 'question'
  | 'timeout'
  | 'resolved'
  | 'cancelled'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed';

export interface DialogueEvent {
  event_type: DialogueEventType | string;
  message: string;
  options: string[];
  intent_id: string;
  timestamp: Time;
}

export interface MutationResponse {
  success: boolean;
  message: string;
}

export interface AddLabelResponse extends MutationResponse {
  label_id: string;
}

export interface GetLabelsResponse extends MutationResponse {
  labels: LabelEntry[];
}

export interface AddKeepoutZoneResponse extends MutationResponse {
  zone_id: string;
}

export interface RemoveZoneGroupResponse extends MutationResponse {
  zones_removed: number;
}

// ── rosapi ───────────────────────────────────────────────────

export interface NodesResponse {
  nodes: string[];
}

export interface GetTimeResponse {
  time: Time;
}

export function stampToMs(t: Time | undefined): number {
  return t ? t.sec * 1000 + t.nanosec / 1e6 : 0;
}
