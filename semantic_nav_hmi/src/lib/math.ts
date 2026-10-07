/**
 * Geometry primitives: quaternions, rigid transforms (for the TF tree),
 * 2D poses and polygons. All angles in radians, ROS conventions (REP-103).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Rigid transform T_parent_child: maps points expressed in child into parent. */
export interface Transform {
  t: Vec3;
  q: Quat;
}

export interface Pose2D {
  x: number;
  y: number;
  yaw: number;
}

export interface Point2 {
  x: number;
  y: number;
}

export const IDENTITY: Transform = Object.freeze({
  t: Object.freeze({ x: 0, y: 0, z: 0 }),
  q: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
}) as Transform;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Wrap to (-pi, pi]. */
export function normalizeAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function yawFromQuat(q: Quat): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

export function quatFromYaw(yaw: number): Quat {
  return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  if (n < 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

export function quatMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatConj(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Rotate vector v by unit quaternion q. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  // t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** a ∘ b — apply b first, then a (T_a_c = T_a_b ∘ T_b_c). */
export function compose(a: Transform, b: Transform): Transform {
  const r = quatRotate(a.q, b.t);
  return {
    t: { x: a.t.x + r.x, y: a.t.y + r.y, z: a.t.z + r.z },
    q: quatNormalize(quatMul(a.q, b.q)),
  };
}

export function invert(a: Transform): Transform {
  const qi = quatConj(a.q);
  const r = quatRotate(qi, a.t);
  return { t: { x: -r.x, y: -r.y, z: -r.z }, q: qi };
}

export function applyTransform(tf: Transform, p: Vec3): Vec3 {
  const r = quatRotate(tf.q, p);
  return { x: r.x + tf.t.x, y: r.y + tf.t.y, z: r.z + tf.t.z };
}

export function transformToPose2D(tf: Transform): Pose2D {
  return { x: tf.t.x, y: tf.t.y, yaw: yawFromQuat(tf.q) };
}

export function poseChanged(a: Pose2D | null, b: Pose2D | null, linTol = 1e-3, angTol = 1e-3): boolean {
  if (!a || !b) return a !== b;
  return (
    Math.abs(a.x - b.x) > linTol ||
    Math.abs(a.y - b.y) > linTol ||
    Math.abs(normalizeAngle(a.yaw - b.yaw)) > angTol
  );
}

/** Ray-casting point-in-polygon (same rule as the costmap layer). */
export function pointInPolygon(x: number, y: number, pts: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed area (shoelace); positive for counter-clockwise. */
export function polygonArea(pts: readonly Point2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return a / 2;
}

/** Area-weighted centroid; falls back to the vertex mean for degenerate polygons. */
export function polygonCentroid(pts: readonly Point2[]): Point2 {
  const area = polygonArea(pts);
  if (Math.abs(area) < 1e-9) {
    const n = Math.max(1, pts.length);
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / n,
      y: pts.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    cx += (pts[j].x + pts[i].x) * f;
    cy += (pts[j].y + pts[i].y) * f;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/**
 * Regular polygon around a point. With n=8 this matches the octagon the
 * navigation executor builds for "avoid <label>", so HMI-created zones and
 * voice-created zones are identical.
 */
export function circlePolygon(cx: number, cy: number, r: number, n = 8): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

export function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from p to segment ab. */
export function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True if segment p1-p2 properly crosses segment p3-p4. */
export function segmentsIntersect(p1: Point2, p2: Point2, p3: Point2, p4: Point2): boolean {
  const d = (a: Point2, b: Point2, c: Point2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** A polygon is simple if no two non-adjacent edges cross. */
export function isSimplePolygon(pts: readonly Point2[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(a1, a2, pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}
