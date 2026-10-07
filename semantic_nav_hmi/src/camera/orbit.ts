/**
 * Orbit-camera math for the 3D view — the console side of semantic_nav_gazebo's
 * viewer camera plugin, which places the Gazebo camera from these same parameters.
 *
 * Coordinates are in the view's frame: the robot's when the view turns with the
 * robot, the world's otherwise. Origin at the robot, x forward, z up, ground at z = 0.
 * The camera always looks at the target (`offset`) from `distance` away, at
 * `azimuth` around it and `elevation` above the horizontal.
 *
 * Image points are normalised: x 0..1 across, y 0..1 down the picture.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** semantic_nav_interfaces/msg/ViewerCamera */
export interface OrbitView {
  azimuth: number;
  elevation: number;
  distance: number;
  offset: Vec3;
  follow_heading: boolean;
  horizontal_fov: number;
}

/** Keep the camera at least this high above the ground (m). */
const MIN_CAMERA_HEIGHT = 0.1;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** The plugin's limits, plus: never put the camera under the ground. */
export function clampView(v: OrbitView): OrbitView {
  const distance = clamp(v.distance, 0.4, 60);
  const offset = { x: clamp(v.offset.x, -80, 80), y: clamp(v.offset.y, -80, 80), z: clamp(v.offset.z, -5, 20) };
  const lowest = Math.max(-0.1, Math.asin(clamp((MIN_CAMERA_HEIGHT - offset.z) / distance, -1, 1)));
  return {
    ...v,
    azimuth: wrapAngle(v.azimuth),
    elevation: clamp(v.elevation, Math.min(lowest, 1.5), 1.5),
    distance,
    offset,
  };
}

interface Basis {
  pos: Vec3;
  fwd: Vec3;
  right: Vec3;
  up: Vec3;
}

export function cameraBasis(v: OrbitView): Basis {
  const ca = Math.cos(v.azimuth);
  const sa = Math.sin(v.azimuth);
  const ce = Math.cos(v.elevation);
  const se = Math.sin(v.elevation);
  const fwd = { x: ce * ca, y: ce * sa, z: -se };
  return {
    fwd,
    right: { x: sa, y: -ca, z: 0 },
    up: { x: se * ca, y: se * sa, z: ce },
    pos: { x: v.offset.x - v.distance * fwd.x, y: v.offset.y - v.distance * fwd.y, z: v.offset.z - v.distance * fwd.z },
  };
}

/**
 * Where the ray through image point `at` crosses the horizontal plane at height `h`, or
 * null when it never does in front of the camera or lands further than `maxRange` away.
 * `aspect` = image width / height.
 */
export function rayAtHeight(v: OrbitView, at: Pt, aspect: number, h: number, maxRange = Math.max(30, 8 * v.distance)): Vec3 | null {
  const b = cameraBasis(v);
  const t = Math.tan(v.horizontal_fov / 2);
  const xn = (2 * at.x - 1) * t;
  const yn = ((1 - 2 * at.y) * t) / aspect;
  const d = {
    x: b.fwd.x + xn * b.right.x + yn * b.up.x,
    y: b.fwd.y + xn * b.right.y + yn * b.up.y,
    z: b.fwd.z + xn * b.right.z + yn * b.up.z,
  };
  if (Math.abs(d.z) < 1e-6) return null;
  const s = (h - b.pos.z) / d.z;
  if (s <= 0) return null;
  const p = { x: b.pos.x + s * d.x, y: b.pos.y + s * d.y, z: h };
  return Math.hypot(p.x - b.pos.x, p.y - b.pos.y, p.z - b.pos.z) > maxRange ? null : p;
}

/** The ground point under image point `at` (null over the sky or too far away). */
export function groundPoint(v: OrbitView, at: Pt, aspect: number, maxRange?: number): Vec3 | null {
  return rayAtHeight(v, at, aspect, 0, maxRange);
}

/** Image point of a 3D point (null when behind the camera). */
export function project(v: OrbitView, p: Vec3, aspect: number): Pt | null {
  const b = cameraBasis(v);
  const r = { x: p.x - b.pos.x, y: p.y - b.pos.y, z: p.z - b.pos.z };
  const depth = r.x * b.fwd.x + r.y * b.fwd.y + r.z * b.fwd.z;
  if (depth <= 1e-6) return null;
  const t = Math.tan(v.horizontal_fov / 2);
  const xn = (r.x * b.right.x + r.y * b.right.y + r.z * b.right.z) / depth;
  const yn = (r.x * b.up.x + r.y * b.up.y + r.z * b.up.z) / depth;
  return { x: (xn / t + 1) / 2, y: (1 - (yn * aspect) / t) / 2 };
}

/**
 * Drag the scene from image point `from` to `to`, starting from view `v0`: the ground
 * point that was under `from` ends up under `to` (Gazebo's left-drag pan). Returns
 * null while the pointer is above the horizon, so the view holds still there.
 */
export function panView(v0: OrbitView, from: Pt, to: Pt, aspect: number): OrbitView | null {
  const a = groundPoint(v0, from, aspect);
  let dx: number;
  let dy: number;
  if (a) {
    const b = groundPoint(v0, to, aspect, 3 * Math.max(30, 8 * v0.distance));
    if (!b) return null;
    dx = a.x - b.x;
    dy = a.y - b.y;
  } else {
    // grabbed the sky: slide along the ground, scaled to the target's distance
    const k = 2 * v0.distance * Math.tan(v0.horizontal_fov / 2);
    const across = (to.x - from.x) * k;
    const along = ((to.y - from.y) * k) / aspect / Math.max(Math.sin(v0.elevation), 0.25);
    const ca = Math.cos(v0.azimuth);
    const sa = Math.sin(v0.azimuth);
    dx = -across * sa + along * ca;
    dy = across * ca + along * sa;
  }
  return clampView({ ...v0, offset: { x: v0.offset.x + dx, y: v0.offset.y + dy, z: v0.offset.z } });
}

/** Orbit around the target: `dAz` around the vertical, `dEl` up/down (rad). */
export function orbitView(v0: OrbitView, dAz: number, dEl: number): OrbitView {
  return clampView({ ...v0, azimuth: v0.azimuth + dAz, elevation: v0.elevation + dEl });
}

/**
 * Dolly by `factor` (< 1 moves closer) toward what is under image point `at`.
 *
 * The camera slides along the pointer's ray, so whatever is under the pointer — at any
 * depth — stays there. The anchor on that ray is taken at the target's height, which
 * keeps the target (the orbit pivot) at the same height while zooming. Over the sky, or
 * with `at` null, it zooms toward the view centre.
 */
export function zoomView(v0: OrbitView, factor: number, at: Pt | null, aspect: number): OrbitView {
  const distance = clamp(v0.distance * factor, 0.4, 60);
  const s = distance / v0.distance;
  const p = at ? rayAtHeight(v0, at, aspect, v0.offset.z, Math.max(30, 10 * v0.distance)) : null;
  const offset = p ? { x: p.x + s * (v0.offset.x - p.x), y: p.y + s * (v0.offset.y - p.y), z: v0.offset.z } : v0.offset;
  return clampView({ ...v0, distance, offset });
}

/** In-between view, `k` from 0 (a) to 1 (b): shortest turn, distance on a log scale. */
export function lerpView(a: OrbitView, b: OrbitView, k: number): OrbitView {
  return {
    ...b,
    azimuth: wrapAngle(a.azimuth + wrapAngle(b.azimuth - a.azimuth) * k),
    elevation: a.elevation + (b.elevation - a.elevation) * k,
    distance: a.distance * Math.pow(b.distance / a.distance, k),
    offset: {
      x: a.offset.x + (b.offset.x - a.offset.x) * k,
      y: a.offset.y + (b.offset.y - a.offset.y) * k,
      z: a.offset.z + (b.offset.z - a.offset.z) * k,
    },
  };
}

export function sameView(a: OrbitView, b: OrbitView, eps = 1e-4): boolean {
  return (
    a.follow_heading === b.follow_heading &&
    Math.abs(wrapAngle(a.azimuth - b.azimuth)) < eps &&
    Math.abs(a.elevation - b.elevation) < eps &&
    Math.abs(a.distance - b.distance) < eps &&
    Math.abs(a.offset.x - b.offset.x) < eps &&
    Math.abs(a.offset.y - b.offset.y) < eps &&
    Math.abs(a.offset.z - b.offset.z) < eps
  );
}
