/**
 * Integration layer: wires the ROS graph to the console state and exposes the
 * operator commands (navigate, stop, labels, keep-out zones, voice commands,
 * map saving). Components import commands from here; they never talk to
 * roslib directly.
 */

import { circlePolygon, quatFromYaw, transformToPose2D, poseChanged, yawFromQuat, type Point2 } from '../lib/math';
import { fmtMeters } from '../lib/format';
import { decodeOccupancy } from '../map/occupancy';
import { live, liveChanged, resetLive } from '../state/live';
import {
  app,
  IDLE_NAV,
  notify,
  type AppState,
  type Label,
  type LabelDraft,
  type LocalizationMode,
  type NavTarget,
  type Zone,
  type ZoneDraft,
} from '../state/store';
import { urlOverride } from '../state/settings';
import { LATCHED, RosBridge, RosError, defaultRosbridgeUrl } from './bridge';
import { NAMES, PROVIDERS, TYPES } from './names';
import { isActiveStatus, isTerminalStatus, phaseFromStatus, pickCurrentGoal, uuidToHex } from './navstate';
import { stripSlash } from './tf';
import type * as T from './types';

export const bridge = new RosBridge();

// ═══════════════════════════════════════════════════════════════════════
// Error wording
// ═══════════════════════════════════════════════════════════════════════

export function explain(err: unknown, service?: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const provider = service ? PROVIDERS[service] : undefined;
  if (err instanceof RosError && err.kind === 'offline') return 'Not connected to the robot';
  if (service && /does not exist|not available|unavailable|no such service|not advertised/i.test(msg)) {
    return `${service} is not available — is ${provider ?? 'its node'} running?`;
  }
  if (err instanceof RosError && err.kind === 'timeout') {
    return `${service ?? 'The request'} timed out — ${provider ?? 'the node'} may be busy or not running`;
  }
  return msg;
}

// ═══════════════════════════════════════════════════════════════════════
// Startup & connection
// ═══════════════════════════════════════════════════════════════════════

let autoUrl = defaultRosbridgeUrl(9090);
let started = false;
let failStreak = 0;

async function fetchRosbridgePort(): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch('./hmi-config.json', { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return 9090;
    const cfg = (await res.json()) as { rosbridgePort?: unknown };
    const port = Number(cfg.rosbridgePort);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : 9090;
  } catch {
    return 9090;
  } finally {
    clearTimeout(timer);
  }
}

export function effectiveUrl(): string {
  return urlOverride() ?? (app().settings.rosbridgeUrl.trim() || autoUrl);
}

export function autoRosbridgeUrl(): string {
  return autoUrl;
}

export async function startRos(): Promise<void> {
  if (started) return;
  started = true;
  autoUrl = defaultRosbridgeUrl(await fetchRosbridgePort());

  bridge.onState.on((state) => {
    app().patch({
      link: {
        ...app().link,
        state,
        url: bridge.url,
        lastError: bridge.lastError,
        nextRetryAt: bridge.nextRetryAt,
        connectedAt: bridge.connectedAt,
        latencyMs: state === 'connected' ? app().link.latencyMs : null,
      },
    });
    if (state === 'reconnecting' && !bridge.connectedAt) {
      failStreak++;
      if (failStreak === 1 || failStreak % 10 === 0) {
        app().pushLog('warn', 'Link', `Cannot reach rosbridge at ${bridge.url}${bridge.lastError ? ` (${bridge.lastError})` : ''} — retrying`);
      }
    }
  });

  bridge.onConnect.on(() => {
    failStreak = 0;
    navPrimed = false;
    navPrimeUntil = performance.now() + 2000;
    armMapFallback();
    notify('success', 'Link', 'Connected to robot', bridge.url);
    startPolling();
    // Fallback for a backend without the /label_list snapshot topic
    setTimeout(() => {
      if (bridge.connected && !app().labelsSynced) void refreshLabels(true);
    }, 2500);
  });

  bridge.onDisconnect.on(() => {
    stopPolling();
    resetLive();
    lastPose = null;
    app().patch({
      labelsSynced: false,
      zonesSynced: false,
      velocity: null,
      nodes: null,
      guardOnline: null,
      poseStale: true,
    });
    notify('error', 'Link', 'Connection to robot lost', 'Reconnecting automatically. The robot keeps executing any active navigation goal.');
  });

  registerPublishers();
  registerSubscriptions();
  setInterval(updatePose, 100);
  bridge.start(effectiveUrl());
}

/** Re-open the link (e.g. after the URL setting changed). */
export function reconnect(): void {
  bridge.reconnectNow(effectiveUrl());
}

/** Topics or frames changed in Settings: rebuild subscriptions and publishers. */
export function applyTopicSettings(): void {
  unregisterSubscriptions();
  registerPublishers();
  registerSubscriptions();
}

// ═══════════════════════════════════════════════════════════════════════
// Subscriptions
// ═══════════════════════════════════════════════════════════════════════

let subs: (() => void)[] = [];

function registerPublishers(): void {
  const t = app().settings.topics;
  bridge.advertise(t.cmdVel, TYPES.twist);
  bridge.advertise(NAMES.baseCmdVel, TYPES.twist);
  bridge.advertise(NAMES.voice, TYPES.string);
  bridge.advertise(NAMES.dialogueResponse, TYPES.string);
  bridge.advertise(NAMES.initialPose, TYPES.poseCov);
  bridge.advertise(NAMES.ping, TYPES.string);
}

function registerSubscriptions(): void {
  const t = app().settings.topics;
  subs = [
    bridge.subscribe<T.TFMessage>(NAMES.tf, TYPES.tf, (m) => onTf(m, false), { compression: 'cbor' }),
    bridge.subscribe<T.TFMessage>(NAMES.tfStatic, TYPES.tf, (m) => onTf(m, true), {
      compression: 'cbor',
      qos: { ...LATCHED, depth: 100 },
    }),
    subscribeMap(mapEncoding),
    bridge.subscribe<T.Odometry>(t.odom, TYPES.odom, onOdom, { compression: 'cbor', throttleMs: 100, queueLength: 1 }),
    bridge.subscribe<T.LaserScan>(t.scan, TYPES.scan, onScan, { compression: 'cbor', throttleMs: 150, queueLength: 1 }),
    bridge.subscribe<T.Path>(t.plan, TYPES.path, onPlan, { compression: 'cbor', throttleMs: 250, queueLength: 1 }),
    bridge.subscribe<T.PoseWithCovarianceStamped>(NAMES.amclPose, TYPES.poseCov, onAmclPose, { qos: LATCHED }),
    bridge.subscribe<T.GoalStatusArray>(NAMES.navStatus, TYPES.goalStatus, onNavStatus, { qos: LATCHED }),
    bridge.subscribe<T.NavigateToPoseFeedbackMessage>(NAMES.navFeedback, TYPES.navFeedback, onNavFeedback, {
      throttleMs: 200,
      queueLength: 1,
    }),
    bridge.subscribe<T.LabelArray>(NAMES.labelList, TYPES.labelArray, onLabelList, { qos: LATCHED }),
    bridge.subscribe<T.KeepoutZoneArray>(NAMES.zoneList, TYPES.zoneArray, onZoneList, { qos: LATCHED }),
    bridge.subscribe<T.DialogueEvent>(NAMES.dialogue, TYPES.dialogue, onDialogue),
    bridge.subscribe<T.StringMsg>(NAMES.ping, TYPES.string, onPing),
  ];
}

function unregisterSubscriptions(): void {
  for (const off of subs) off();
  subs = [];
}

// ── map transport ──────────────────────────────────────────────────────
// CBOR moves the map as one binary frame (fast). rosbridge fragments any
// message above its max_message_size (default 1 MB) and cannot fragment CBOR,
// so a large map is dropped silently. If no map arrives over CBOR, fall back to
// JSON, which fragments fine (slower to parse, but it works everywhere).
let mapEncoding: 'cbor' | 'none' = 'cbor';
let mapSub: (() => void) | null = null;
let mapSeenThisLink = false;
let mapFallbackTimer: ReturnType<typeof setTimeout> | null = null;

function subscribeMap(encoding: 'cbor' | 'none'): () => void {
  const off = bridge.subscribe<T.OccupancyGrid>(app().settings.topics.map, TYPES.map, (m) => {
    mapSeenThisLink = true;
    onMap(m);
  }, {
    compression: encoding,
    qos: LATCHED,
    queueLength: 1,
  });
  mapSub = off;
  return () => {
    off();
    if (mapSub === off) mapSub = null;
  };
}

function armMapFallback(): void {
  mapSeenThisLink = false;
  if (mapFallbackTimer) clearTimeout(mapFallbackTimer);
  if (mapEncoding !== 'cbor') return;
  mapFallbackTimer = setTimeout(async () => {
    if (!bridge.connected || mapSeenThisLink) return;
    // Only fall back if somebody actually publishes a map
    try {
      const res = await bridge.call<{ topic: string }, { publishers: string[] }>(
        '/rosapi/publishers',
        'rosapi_msgs/srv/Publishers',
        { topic: app().settings.topics.map },
        4000,
      );
      if (!res.publishers?.length || mapSeenThisLink) return;
    } catch {
      /* rosapi missing: try the fallback anyway */
    }
    mapEncoding = 'none';
    const old = mapSub;
    const idx = old ? subs.indexOf(old) : -1;
    old?.();
    const fresh = subscribeMap('none');
    if (idx >= 0) subs[idx] = fresh;
    else subs.push(fresh);
    app().pushLog(
      'warn',
      'Map',
      "No map over CBOR — rosbridge's max_message_size is probably smaller than the map. Using JSON (slower); set max_message_size >= 20000000 on rosbridge_websocket.",
    );
  }, 12000);
}

// ── TF & pose ───────────────────────────────────────────────────────────

let tfDirty = false;

function onTf(msg: T.TFMessage, isStatic: boolean): void {
  live.tf.ingest(msg, isStatic);
  tfDirty = true;
  liveChanged.emit('tf');
}

let lastPose: { x: number; y: number; yaw: number } | null = null;
let amclSeenAt = 0;

function localizationMode(inMap: boolean, any: boolean): LocalizationMode {
  if (!any) return 'none';
  if (!inMap) return 'odom';
  const nodes = app().nodes;
  if (nodes?.includes('/slam_toolbox')) return 'slam';
  if (nodes?.includes('/amcl') || Date.now() - amclSeenAt < 60000) return 'amcl';
  return 'map';
}

/** 10 Hz: derive the robot pose for the React side (canvas reads TF directly). */
function updatePose(): void {
  const s = app();
  const f = s.settings.frames;
  let frame = f.map;
  let res = live.tf.lookup(f.map, f.base);
  if (!res) {
    frame = f.odom;
    res = live.tf.lookup(f.odom, f.base);
  }
  const pose = res ? transformToPose2D(res.tf) : null;
  const stale = res ? res.age > 1500 : s.link.state !== 'connected';
  const mode = localizationMode(!!res && frame === f.map, !!res);

  const p: Partial<AppState> = {};
  if (tfDirty || poseChanged(lastPose, pose)) {
    if (poseChanged(lastPose, pose)) {
      p.pose = pose;
      lastPose = pose;
    }
    tfDirty = false;
  }
  if (s.poseFrame !== (res ? frame : null)) p.poseFrame = res ? frame : null;
  if (s.poseStale !== stale) p.poseStale = stale;
  if (s.localization.mode !== mode) {
    p.localization = { ...s.localization, mode };
    if (s.link.state === 'connected' && s.localization.mode !== 'none') {
      const words: Record<LocalizationMode, string> = {
        amcl: 'Localized (AMCL)',
        slam: 'Localized (SLAM)',
        map: 'Localized in map frame',
        odom: 'Not localized — showing odometry frame',
        none: 'No transform to the robot base',
      };
      s.pushLog(mode === 'odom' || mode === 'none' ? 'warn' : 'info', 'Localization', words[mode]);
    }
  }
  if (Object.keys(p).length) s.patch(p);
}

function fixedFrame(): string {
  const f = app().settings.frames;
  if (live.map) return live.map.frame;
  return live.tf.lookup(f.map, f.base) ? f.map : f.odom;
}

// ── Map ─────────────────────────────────────────────────────────────────

function onMap(msg: T.OccupancyGrid): void {
  const { width, height, resolution, origin } = msg.info;
  if (!width || !height || !resolution) return;
  const first = !live.map;
  const { pixels, known, knownCells } = decodeOccupancy(msg.data, width, height);
  const image = live.map && live.map.width === width && live.map.height === height ? live.map.image : document.createElement('canvas');
  image.width = width;
  image.height = height;
  const ctx = image.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  const frame = stripSlash(msg.header.frame_id) || app().settings.frames.map;
  const originPose = { x: origin.position.x, y: origin.position.y, yaw: yawFromQuat(origin.orientation) };
  let knownBounds = null;
  if (knownCells) {
    // Rotate the cell-box corners by the origin yaw (normally 0)
    const c = Math.cos(originPose.yaw);
    const sn = Math.sin(originPose.yaw);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [col, row] of [
      [knownCells.minCol, knownCells.minRow],
      [knownCells.maxCol + 1, knownCells.minRow],
      [knownCells.minCol, knownCells.maxRow + 1],
      [knownCells.maxCol + 1, knownCells.maxRow + 1],
    ]) {
      const lx = col * resolution;
      const ly = row * resolution;
      xs.push(originPose.x + c * lx - sn * ly);
      ys.push(originPose.y + sn * lx + c * ly);
    }
    knownBounds = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  live.map = { image, width, height, resolution, origin: originPose, frame, version: (live.map?.version ?? 0) + 1, knownBounds };
  liveChanged.emit('map');
  app().patch({
    mapInfo: {
      width,
      height,
      resolution,
      origin: originPose,
      knownRatio: known / (width * height),
      receivedAt: Date.now(),
      frame,
    },
  });
  if (first) {
    app().pushLog('info', 'Map', `Map received: ${width} × ${height} cells at ${resolution.toFixed(3)} m/cell`);
  }
}

// ── Odometry, scan, path, AMCL ──────────────────────────────────────────

function onOdom(msg: T.Odometry): void {
  const v = msg.twist.twist.linear.x;
  const w = msg.twist.twist.angular.z;
  const cur = app().velocity;
  if (!cur || Math.abs(cur.linear - v) > 0.003 || Math.abs(cur.angular - w) > 0.003) {
    app().patch({ velocity: { linear: v, angular: w } });
  }
}

function onScan(msg: T.LaserScan): void {
  const target = fixedFrame();
  const look = live.tf.lookup(target, msg.header.frame_id);
  if (!look) return;
  const { t, q } = look.tf;
  const m00 = 1 - 2 * (q.y * q.y + q.z * q.z);
  const m01 = 2 * (q.x * q.y - q.z * q.w);
  const m10 = 2 * (q.x * q.y + q.z * q.w);
  const m11 = 1 - 2 * (q.x * q.x + q.z * q.z);
  const ranges = msg.ranges;
  const n = ranges.length;
  const pts = new Float32Array(n * 2);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const r = ranges[i];
    if (!(r >= msg.range_min && r <= msg.range_max)) continue; // also drops NaN/Inf
    const a = msg.angle_min + i * msg.angle_increment;
    const lx = r * Math.cos(a);
    const ly = r * Math.sin(a);
    pts[k++] = m00 * lx + m01 * ly + t.x;
    pts[k++] = m10 * lx + m11 * ly + t.y;
  }
  live.scan = { points: pts, count: k / 2, frame: target, receivedAt: performance.now() };
  liveChanged.emit('scan');
}

function onPlan(msg: T.Path): void {
  const poses = msg.poses ?? [];
  if (poses.length < 2) {
    live.plan = null;
    app().patch({ plannedPathLength: null });
    liveChanged.emit('plan');
    return;
  }
  const target = fixedFrame();
  const look = live.tf.lookup(target, msg.header.frame_id || target);
  const pts = new Float32Array(poses.length * 2);
  let len = 0;
  for (let i = 0; i < poses.length; i++) {
    let x = poses[i].pose.position.x;
    let y = poses[i].pose.position.y;
    if (look) {
      const { t, q } = look.tf;
      const m00 = 1 - 2 * (q.y * q.y + q.z * q.z);
      const m01 = 2 * (q.x * q.y - q.z * q.w);
      const m10 = 2 * (q.x * q.y + q.z * q.w);
      const m11 = 1 - 2 * (q.x * q.x + q.z * q.z);
      const nx = m00 * x + m01 * y + t.x;
      y = m10 * x + m11 * y + t.y;
      x = nx;
    }
    pts[i * 2] = x;
    pts[i * 2 + 1] = y;
    if (i > 0) len += Math.hypot(x - pts[i * 2 - 2], y - pts[i * 2 - 1]);
  }
  live.plan = { points: pts, count: poses.length, frame: target, receivedAt: performance.now() };
  app().patch({ plannedPathLength: len });
  liveChanged.emit('plan');
}

function onAmclPose(msg: T.PoseWithCovarianceStamped): void {
  amclSeenAt = Date.now();
  const c = msg.pose.covariance;
  if (!c || c.length < 36) return;
  const sigmaXY = Math.sqrt(Math.max(0, Math.max(c[0], c[7])));
  const sigmaYaw = Math.sqrt(Math.max(0, c[35]));
  app().patch({ localization: { ...app().localization, sigmaXY, sigmaYaw } });
}

// ═══════════════════════════════════════════════════════════════════════
// Navigation (Nav2 NavigateToPose)
// ═══════════════════════════════════════════════════════════════════════

let navPrimed = false;
/** status messages arriving this soon after connecting are the latched replay of old goals */
let navPrimeUntil = 0;
let pendingHmiGoal: { target: NavTarget; sentAt: number } | null = null;
const seenStatus = new Map<string, number>();

export function describeTarget(t: NavTarget | null): string {
  if (!t) return 'goal';
  return t.label ? t.label : `(${t.x.toFixed(2)}, ${t.y.toFixed(2)})`;
}

function onNavStatus(msg: T.GoalStatusArray): void {
  const cur = pickCurrentGoal(msg.status_list);
  const s = app();

  const latchedReplay = !navPrimed && performance.now() < navPrimeUntil && !pendingHmiGoal;
  navPrimed = true;
  if (latchedReplay) {
    // Latched history delivered on (re)connect: remember finished goals silently
    for (const g of msg.status_list ?? []) seenStatus.set(uuidToHex(g.goal_info.goal_id.uuid), g.status);
    if (cur && isActiveStatus(cur.status)) {
      if (s.nav.goalId !== cur.id) {
        s.setNav({ ...IDLE_NAV, phase: phaseFromStatus(cur.status), goalId: cur.id, source: 'external', startedAt: Date.now() });
      }
    } else if (s.nav.phase === 'active' || s.nav.phase === 'canceling') {
      s.setNav({ ...IDLE_NAV });
    }
    return;
  }
  if (!cur) return;

  const prev = seenStatus.get(cur.id);
  seenStatus.set(cur.id, cur.status);
  if (seenStatus.size > 200) seenStatus.delete(seenStatus.keys().next().value as string);

  const isNew = s.nav.goalId !== cur.id;
  const phase = phaseFromStatus(cur.status);

  if (isNew) {
    if (prev !== undefined && isTerminalStatus(prev)) return; // old goal resurfacing
    let source: 'hmi' | 'external' = 'external';
    let target: NavTarget | null = null;
    if (pendingHmiGoal && Date.now() - pendingHmiGoal.sentAt < 15000) {
      source = 'hmi';
      target = pendingHmiGoal.target;
      pendingHmiGoal = null;
    }
    s.setNav({
      ...IDLE_NAV,
      phase,
      goalId: cur.id,
      source,
      target,
      startedAt: Date.now(),
      endedAt: isTerminalStatus(cur.status) ? Date.now() : null,
    });
    if (isActiveStatus(cur.status)) {
      s.pushLog('info', 'Navigation', source === 'hmi' ? `Goal accepted: ${describeTarget(target)}` : 'Navigation started (goal from another client)');
    } else {
      reportNavEnd(phase, target);
    }
    return;
  }

  if (phase !== s.nav.phase) {
    const terminal = isTerminalStatus(cur.status);
    s.setNav({
      phase,
      endedAt: terminal ? Date.now() : null,
      ...(phase === 'succeeded' ? { distanceRemaining: 0 } : {}),
    });
    if (terminal && (prev === undefined || !isTerminalStatus(prev))) reportNavEnd(phase, s.nav.target);
  }
}

function reportNavEnd(phase: string, target: NavTarget | null): void {
  const where = describeTarget(target);
  if (phase === 'succeeded') notify('success', 'Navigation', target ? `Arrived at ${where}` : 'Goal reached');
  else if (phase === 'canceled') notify('info', 'Navigation', 'Navigation canceled');
  else if (phase === 'aborted') {
    notify('error', 'Navigation', 'Navigation failed', 'Nav2 aborted the goal — the target may be unreachable, blocked, or inside a keep-out zone.');
  }
}

function onNavFeedback(msg: T.NavigateToPoseFeedbackMessage): void {
  const id = uuidToHex(msg.goal_id.uuid);
  const s = app();
  if (id !== s.nav.goalId) return;
  const fb = msg.feedback;
  const remaining = Number.isFinite(fb.distance_remaining) ? fb.distance_remaining : null;
  const initial = remaining !== null ? Math.max(s.nav.initialDistance ?? 0, remaining) : s.nav.initialDistance;
  const dur = (d: T.Duration) => d.sec + d.nanosec / 1e9;
  s.setNav({
    distanceRemaining: remaining,
    initialDistance: initial && initial > 0 ? initial : null,
    etaSec: dur(fb.estimated_time_remaining),
    elapsedSec: dur(fb.navigation_time),
    recoveries: fb.number_of_recoveries,
  });
}

export function navigateTo(x: number, y: number, yaw: number | null, label?: string): void {
  const s = app();
  if (!bridge.connected) {
    notify('error', 'Navigation', 'Cannot send goal', 'Not connected to the robot');
    return;
  }
  // No heading given (e.g. a label): arrive facing away from where the robot is now
  let heading = yaw;
  if (heading === null) {
    const p = s.pose;
    heading = p ? Math.atan2(y - p.y, x - p.x) : 0;
  }
  const target: NavTarget = { x, y, yaw, label };
  pendingHmiGoal = { target, sentAt: Date.now() };
  s.setNav({ ...IDLE_NAV, phase: 'pending', target, source: 'hmi', startedAt: Date.now() });

  const goal: T.NavigateToPoseGoal = {
    pose: {
      header: { frame_id: s.settings.frames.map, stamp: { sec: 0, nanosec: 0 } },
      pose: { position: { x, y, z: 0 }, orientation: quatFromYaw(heading) },
    },
    behavior_tree: '',
  };
  const id = bridge.sendActionGoal<T.NavigateToPoseGoal, unknown, unknown>(NAMES.navAction, TYPES.navAction, goal, {
    onError: (e) => {
      // Terminal states seen on the status topic are reported there; this covers rejection
      if (app().nav.phase === 'pending' && pendingHmiGoal?.target === target) {
        pendingHmiGoal = null;
        app().setNav({ phase: 'aborted', endedAt: Date.now() });
        notify('error', 'Navigation', 'Goal rejected', explain(e, NAMES.navAction));
      }
    },
  });
  if (id === null) {
    s.setNav({ ...IDLE_NAV });
    notify('error', 'Navigation', 'Cannot send goal', 'Not connected to the robot');
    return;
  }
  s.pushLog('info', 'Navigation', `Goal sent: ${describeTarget(target)}${yaw !== null ? ` heading ${((yaw * 180) / Math.PI).toFixed(0)}°` : ''}`);
  // Nav2 not running: no status ever arrives
  setTimeout(() => {
    if (app().nav.phase === 'pending' && pendingHmiGoal?.target === target) {
      pendingHmiGoal = null;
      app().setNav({ phase: 'aborted', endedAt: Date.now() });
      notify('error', 'Navigation', 'No response from Nav2', 'The goal was not accepted within 10 s — is the navigation stack running?');
    }
  }, 10000);
}

/** Cancel every NavigateToPose goal, whoever sent it. */
export async function cancelNavigation(quiet = false): Promise<boolean> {
  try {
    const res = await bridge.call<{ goal_info: T.GoalInfo }, T.CancelGoalResponse>(
      NAMES.navCancel,
      TYPES.cancelGoal,
      { goal_info: { goal_id: { uuid: new Array(16).fill(0) }, stamp: { sec: 0, nanosec: 0 } } },
      5000,
    );
    if (pendingHmiGoal) pendingHmiGoal = null;
    if (app().nav.phase === 'pending') app().setNav({ phase: 'canceled', endedAt: Date.now() });
    if (!quiet) {
      const n = res.goals_canceling?.length ?? 0;
      app().pushLog('info', 'Navigation', n ? `Cancel requested for ${n} goal${n > 1 ? 's' : ''}` : 'No active goal to cancel');
    }
    return true;
  } catch (err) {
    if (!quiet) notify('error', 'Navigation', 'Cancel failed', explain(err, NAMES.navCancel));
    return false;
  }
}

/** Set the AMCL pose estimate (RViz "2D Pose Estimate"). */
export function setInitialPose(x: number, y: number, yaw: number): void {
  const s = app();
  const cov = new Array(36).fill(0);
  cov[0] = 0.25;
  cov[7] = 0.25;
  cov[35] = 0.06853891945200942;
  const ok = bridge.publish<T.PoseWithCovarianceStamped>(NAMES.initialPose, TYPES.poseCov, {
    header: { frame_id: s.settings.frames.map, stamp: { sec: 0, nanosec: 0 } },
    pose: { pose: { position: { x, y, z: 0 }, orientation: quatFromYaw(yaw) }, covariance: cov },
  });
  if (ok) notify('info', 'Localization', 'Pose estimate sent', `(${x.toFixed(2)}, ${y.toFixed(2)}), ${((yaw * 180) / Math.PI).toFixed(0)}°`);
  else notify('error', 'Localization', 'Cannot set pose', 'Not connected to the robot');
}

const ZERO_TWIST: T.Twist = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };

/** Publish a zero velocity on both the guarded teleop topic and the base topic. */
export function publishZeroVelocity(): boolean {
  const t = app().settings.topics;
  const a = bridge.publish(t.cmdVel, TYPES.twist, ZERO_TWIST);
  const b = t.cmdVel === NAMES.baseCmdVel ? a : bridge.publish(NAMES.baseCmdVel, TYPES.twist, ZERO_TWIST);
  return a || b;
}

// ═══════════════════════════════════════════════════════════════════════
// Labels
// ═══════════════════════════════════════════════════════════════════════

function toLabel(e: T.LabelEntry): Label {
  const g = e.geometry;
  const poly = g.type === 'polygon' && g.polygon_points?.length >= 3 ? g.polygon_points.map((p) => ({ x: p.x, y: p.y })) : null;
  return {
    id: e.label_id,
    name: e.display_name,
    aliases: [...(e.aliases ?? [])],
    type: e.semantic_type || 'other',
    x: g.x,
    y: g.y,
    radius: g.radius > 0 ? g.radius : 1,
    polygon: poly,
    mapVersion: e.map_version ?? '',
  };
}

function setLabels(labels: Label[], synced: boolean): void {
  const s = app();
  const sel = s.selection;
  s.patch({
    labels: labels.sort((a, b) => a.name.localeCompare(b.name)),
    labelsSynced: synced || s.labelsSynced,
    selection: sel?.kind === 'label' && !labels.some((l) => l.id === sel.id) ? null : sel,
  });
}

function onLabelList(msg: T.LabelArray): void {
  setLabels((msg.labels ?? []).map(toLabel), true);
}

export async function refreshLabels(fallback = false): Promise<void> {
  try {
    const res = await bridge.call<{ map_version: string; semantic_type: string }, T.GetLabelsResponse>(
      NAMES.getLabels,
      TYPES.getLabels,
      { map_version: '', semantic_type: '' },
      6000,
    );
    if (res.success && (!app().labelsSynced || !fallback)) setLabels(res.labels.map(toLabel), false);
    if (fallback) app().pushLog('warn', 'Labels', 'Using /get_labels (no /label_list snapshot) — rebuild semantic_nav_bringup for live label sync');
  } catch (err) {
    if (fallback) app().pushLog('warn', 'Labels', `Labels unavailable: ${explain(err, NAMES.getLabels)}`);
  }
}

function splitAliases(s: string): string[] {
  return s
    .split(',')
    .map((a) => a.trim())
    .filter((a, i, arr) => a.length > 0 && arr.indexOf(a) === i);
}

/** Create or update a label. Resolves true on success (dialog may close). */
export async function saveLabel(d: LabelDraft): Promise<boolean> {
  const geometry = { type: 'point_radius', x: d.x, y: d.y, radius: d.radius, polygon_points: [] };
  const name = d.name.trim();
  try {
    if (d.id) {
      const res = await bridge.call<unknown, T.MutationResponse>(NAMES.updateLabel, TYPES.updateLabel, {
        label_id: d.id,
        display_name: name,
        aliases: splitAliases(d.aliases),
        semantic_type: d.type,
        geometry,
      });
      if (!res.success) throw new Error(res.message || 'Update rejected');
      notify('success', 'Labels', `Label "${name}" updated`);
    } else {
      const res = await bridge.call<unknown, T.AddLabelResponse>(NAMES.addLabel, TYPES.addLabel, {
        display_name: name,
        aliases: splitAliases(d.aliases),
        semantic_type: d.type,
        geometry,
        map_version: '',
      });
      if (!res.success) throw new Error(res.message || 'Create rejected');
      notify('success', 'Labels', `Label "${name}" created`, `at (${d.x.toFixed(2)}, ${d.y.toFixed(2)})`);
    }
    if (!app().labelsSynced) void refreshLabels();
    return true;
  } catch (err) {
    notify('error', 'Labels', d.id ? 'Could not update label' : 'Could not create label', explain(err, d.id ? NAMES.updateLabel : NAMES.addLabel));
    return false;
  }
}

export async function deleteLabel(label: Label): Promise<boolean> {
  try {
    const res = await bridge.call<{ label_id: string }, T.MutationResponse>(NAMES.removeLabel, TYPES.removeLabel, { label_id: label.id });
    if (!res.success) throw new Error(res.message || 'Delete rejected');
    notify('info', 'Labels', `Label "${label.name}" deleted`);
    if (!app().labelsSynced) void refreshLabels();
    return true;
  } catch (err) {
    notify('error', 'Labels', 'Could not delete label', explain(err, NAMES.removeLabel));
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Keep-out zones
// ═══════════════════════════════════════════════════════════════════════

function onZoneList(msg: T.KeepoutZoneArray): void {
  const zones: Zone[] = (msg.zones ?? [])
    .filter((z) => (z.polygon?.points?.length ?? 0) >= 3)
    .map((z) => ({
      id: z.zone_id,
      groupId: z.zone_group_id,
      reason: z.reason,
      points: z.polygon.points.map((p) => ({ x: p.x, y: p.y })),
      duration: z.duration || 'session',
      ttl: z.ttl_seconds,
      active: z.is_active,
    }));
  const s = app();
  const sel = s.selection;
  s.patch({
    zones,
    zonesSynced: true,
    selection: sel?.kind === 'zone' && !zones.some((z) => z.id === sel.id) ? null : sel,
  });
}

/** Same group id the navigation executor uses, so "it's okay to go near X" clears HMI zones too. */
export function groupIdFor(name: string): string {
  return `group_${name.replace(/ /g, '_').toLowerCase()}`;
}

export async function addZone(d: ZoneDraft): Promise<boolean> {
  try {
    const res = await bridge.call<unknown, T.AddKeepoutZoneResponse>(NAMES.addZone, TYPES.addZone, {
      zone: { points: d.points.map((p) => ({ x: p.x, y: p.y, z: 0 })) },
      reason: d.reason.trim() || 'operator keep-out',
      zone_group_id: d.groupId,
      duration: d.duration,
      ttl_seconds: d.duration === 'one_shot' ? d.ttl : 0,
    });
    if (!res.success) throw new Error(res.message || 'Rejected by the costmap layer');
    notify('success', 'Keep-out', `Keep-out zone added`, d.reason.trim() || undefined);
    return true;
  } catch (err) {
    notify('error', 'Keep-out', 'Could not add keep-out zone', explain(err, NAMES.addZone));
    return false;
  }
}

export async function removeZone(zone: Zone): Promise<boolean> {
  try {
    const res = await bridge.call<{ zone_id: string }, T.MutationResponse>(NAMES.removeZone, TYPES.removeZone, { zone_id: zone.id });
    if (!res.success) throw new Error(res.message || 'Rejected');
    notify('info', 'Keep-out', 'Keep-out zone removed', zone.reason || undefined);
    return true;
  } catch (err) {
    notify('error', 'Keep-out', 'Could not remove zone', explain(err, NAMES.removeZone));
    return false;
  }
}

export function labelPolygon(label: Label): Point2[] {
  return label.polygon ?? circlePolygon(label.x, label.y, label.radius, 8);
}

export async function avoidLabel(label: Label): Promise<boolean> {
  return addZone({
    points: labelPolygon(label),
    reason: `avoid ${label.name}`,
    duration: 'session',
    ttl: 0,
    groupId: groupIdFor(label.name),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Natural-language commands & dialogue
// ═══════════════════════════════════════════════════════════════════════

let pendingCommand: { chatId: number; timer: ReturnType<typeof setTimeout> } | null = null;
let lastExecuting: { chatId: number; at: number } | null = null;
type Speak = (text: string) => void;
let speaker: Speak = () => {};

export function setSpeaker(fn: Speak): void {
  speaker = fn;
}

export function sendCommand(text: string): boolean {
  const s = app();
  const trimmed = text.trim();
  if (!trimmed) return false;
  s.pushChat({ role: 'user', kind: 'command', text: trimmed });
  if (!bridge.publish<T.StringMsg>(NAMES.voice, TYPES.string, { data: trimmed })) {
    s.pushChat({ role: 'system', kind: 'error', text: 'Not connected to the robot — command not sent.' });
    return false;
  }
  s.pushLog('info', 'Command', `"${trimmed}"`);
  if (pendingCommand) clearTimeout(pendingCommand.timer);
  const chatId = s.pushChat({ role: 'system', kind: 'pending', text: 'Interpreting…' });
  pendingCommand = {
    chatId,
    timer: setTimeout(() => {
      if (pendingCommand?.chatId !== chatId) return;
      pendingCommand = null;
      app().updateChat(chatId, {
        kind: 'noreply',
        text: 'No response from the command pipeline in 10 s. Check that intent_parser_node, target_resolver_node and dialogue_manager_node are running (System panel).',
      });
    }, 10000),
  };
  return true;
}

export function answerQuestion(chatId: number, option: string): void {
  const s = app();
  s.updateChat(chatId, { answered: true });
  s.pushChat({ role: 'user', kind: 'command', text: option });
  if (!bridge.publish<T.StringMsg>(NAMES.dialogueResponse, TYPES.string, { data: option })) {
    s.pushChat({ role: 'system', kind: 'error', text: 'Not connected to the robot — answer not sent.' });
  }
}

function onDialogue(ev: T.DialogueEvent): void {
  const s = app();
  if (pendingCommand) {
    clearTimeout(pendingCommand.timer);
    s.patch({ chat: s.chat.filter((m) => m.id !== pendingCommand!.chatId) });
    pendingCommand = null;
  }
  const text = ev.message || ev.event_type;
  switch (ev.event_type) {
    case 'question':
      s.pushChat({ role: 'system', kind: 'question', text, options: ev.options ?? [] });
      speaker(text);
      break;
    case 'executing': {
      // dialogue manager and executor both announce execution; merge the pair
      const now = Date.now();
      if (lastExecuting && now - lastExecuting.at < 2000 && s.chat.some((m) => m.id === lastExecuting!.chatId)) {
        s.updateChat(lastExecuting.chatId, { text });
        lastExecuting.at = now;
      } else {
        lastExecuting = { chatId: s.pushChat({ role: 'system', kind: 'info', text }), at: now };
      }
      break;
    }
    case 'resolved':
      s.pushChat({ role: 'system', kind: 'info', text });
      break;
    case 'completed':
      s.pushChat({ role: 'system', kind: 'success', text });
      break;
    case 'rejected':
    case 'failed':
      s.pushChat({ role: 'system', kind: 'error', text });
      speaker(text);
      break;
    case 'cancelled':
    case 'timeout':
      s.pushChat({ role: 'system', kind: 'error', text });
      break;
    default:
      s.pushChat({ role: 'system', kind: 'info', text });
  }
  s.pushLog(ev.event_type === 'failed' || ev.event_type === 'rejected' ? 'warn' : 'info', 'Dialogue', `${ev.event_type}: ${text}`);
}

// ═══════════════════════════════════════════════════════════════════════
// Map saving (SLAM)
// ═══════════════════════════════════════════════════════════════════════

export interface SaveMapResult {
  base: string;
  poseGraph: { ok: boolean; detail: string };
  grid: { ok: boolean; detail: string };
}

export async function saveMap(directory: string, name: string): Promise<SaveMapResult> {
  const dir = directory.trim().replace(/\/+$/, '') || '.';
  const safe = name.trim().replace(/[^A-Za-z0-9_.-]+/g, '_') || 'semantic_nav_map';
  const base = `${dir}/${safe}`;
  const result: SaveMapResult = { base, poseGraph: { ok: false, detail: '' }, grid: { ok: false, detail: '' } };

  try {
    const res = await bridge.call<{ filename: string }, { result: number }>(NAMES.serializeMap, TYPES.serializeMap, { filename: base }, 20000);
    result.poseGraph = res.result === 0 ? { ok: true, detail: `${base}.posegraph / .data` } : { ok: false, detail: `slam_toolbox returned ${res.result}` };
  } catch (err) {
    result.poseGraph = { ok: false, detail: explain(err, NAMES.serializeMap) };
  }

  try {
    const res = await bridge.call<unknown, { result: boolean }>(
      NAMES.saveMap,
      TYPES.saveMap,
      {
        map_topic: app().settings.topics.map,
        map_url: base,
        image_format: 'pgm',
        map_mode: 'trinary',
        free_thresh: 0.25,
        occupied_thresh: 0.65,
      },
      20000,
    );
    result.grid = res.result ? { ok: true, detail: `${base}.yaml / .pgm` } : { ok: false, detail: 'map_saver reported failure' };
  } catch (err) {
    result.grid = { ok: false, detail: explain(err, NAMES.saveMap) };
  }

  const s = app();
  if (result.grid.ok) {
    notify('success', 'Map', 'Map saved', `${base}.yaml${result.poseGraph.ok ? ' + pose graph' : ''}`);
  } else {
    notify('error', 'Map', 'Map save failed', result.grid.detail);
  }
  if (!result.poseGraph.ok) s.pushLog('warn', 'Map', `Pose graph not saved: ${result.poseGraph.detail}`);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Health polling (rosapi)
// ═══════════════════════════════════════════════════════════════════════

let pollTimers: ReturnType<typeof setInterval>[] = [];
let rosapiWarned = false;

function startPolling(): void {
  stopPolling();
  resetPing();
  void pollNodes();
  pollTimers = [setInterval(() => void pollNodes(), 5000), setInterval(sendPing, 2000)];
  setTimeout(sendPing, 500);
}

function stopPolling(): void {
  for (const t of pollTimers) clearInterval(t);
  pollTimers = [];
}

async function pollNodes(): Promise<void> {
  try {
    const res = await bridge.call<Record<string, never>, T.NodesResponse>(NAMES.nodes, TYPES.nodes, {}, 4000);
    const nodes = [...res.nodes].sort();
    const usesGuard = app().settings.topics.cmdVel === '/hmi/cmd_vel';
    app().patch({ nodes, nodesAt: Date.now(), guardOnline: usesGuard ? nodes.includes('/teleop_guard') : null });
    rosapiWarned = false;
  } catch (err) {
    app().patch({ nodes: null, guardOnline: null });
    if (!rosapiWarned && bridge.connected) {
      rosapiWarned = true;
      app().pushLog('warn', 'System', `Node list unavailable: ${explain(err, NAMES.nodes)}`);
    }
  }
}

// Round-trip probe. A rosapi service call is a poor latency gauge: rosbridge
// creates a fresh ROS client per call, so it mostly measures DDS discovery
// (~0.5 s on localhost). A loopback message measures what an operator feels.
const clientId = Math.random().toString(36).slice(2, 10);
let pingSeq = 0;
const pingSent = new Map<number, number>();
let lastPong = 0;
let rttSamples: number[] = [];
let warmup = true;

function resetPing(): void {
  pingSent.clear();
  rttSamples = [];
  warmup = true;
  lastPong = 0;
}

function sendPing(): void {
  if (!bridge.connected) return;
  const now = performance.now();
  for (const [seq, t] of pingSent) if (now - t > 10000) pingSent.delete(seq);
  if (lastPong && now - lastPong > 8000 && app().link.latencyMs !== null) {
    app().patch({ link: { ...app().link, latencyMs: null } });
  }
  const seq = ++pingSeq;
  pingSent.set(seq, now);
  bridge.publish<T.StringMsg>(NAMES.ping, TYPES.string, { data: `${clientId}:${seq}` });
}

function onPing(msg: T.StringMsg): void {
  const [id, seqText] = msg.data.split(':');
  if (id !== clientId) return; // another console's probe
  const seq = Number(seqText);
  const t0 = pingSent.get(seq);
  if (t0 === undefined) return;
  pingSent.delete(seq);
  const now = performance.now();
  lastPong = now;
  // The first probe after connecting pays DDS discovery of the loopback topic
  if (warmup) {
    warmup = false;
    return;
  }
  rttSamples = [...rttSamples.slice(-4), now - t0];
  const sorted = [...rttSamples].sort((a, b) => a - b);
  const latencyMs = sorted[Math.floor(sorted.length / 2)];
  app().patch({ link: { ...app().link, latencyMs } });
}

export function pathLengthText(): string {
  const l = app().plannedPathLength;
  return l === null ? '—' : fmtMeters(l);
}
