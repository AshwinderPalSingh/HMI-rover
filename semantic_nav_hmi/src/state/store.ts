/**
 * Application state (zustand). Holds everything React renders.
 * High-rate streams (TF, map pixels, scan points, camera frames) live in
 * state/live.ts instead and are drawn straight to canvas.
 */

import { create } from 'zustand';
import type { Point2, Pose2D } from '../lib/math';
import type { LinkState } from '../ros/bridge';
import { loadSettings, mergeSettings, saveSettings, type Settings, type SettingsPatch } from './settings';

export type Mode = 'drive' | 'map' | 'label' | 'command';
export type Tool = 'pan' | 'goal' | 'pose' | 'label' | 'zone';
export type ViewKind = 'camera' | 'map';

export const MODE_ORDER: Mode[] = ['drive', 'map', 'label', 'command'];

export const MODE_DEFAULTS: Record<Mode, { primary: ViewKind; tool: Tool }> = {
  drive: { primary: 'camera', tool: 'pan' },
  map: { primary: 'map', tool: 'pan' },
  label: { primary: 'map', tool: 'label' },
  command: { primary: 'map', tool: 'goal' },
};

export interface Label {
  id: string;
  name: string;
  aliases: string[];
  type: string;
  x: number;
  y: number;
  radius: number;
  polygon: Point2[] | null;
  mapVersion: string;
}

export interface Zone {
  id: string;
  groupId: string;
  reason: string;
  points: Point2[];
  duration: string;
  ttl: number;
  active: boolean;
}

export type NavPhase = 'idle' | 'pending' | 'active' | 'canceling' | 'succeeded' | 'canceled' | 'aborted';

export interface NavTarget {
  x: number;
  y: number;
  yaw: number | null;
  label?: string;
}

export interface NavState {
  phase: NavPhase;
  goalId: string | null;
  target: NavTarget | null;
  /** 'hmi' when this console sent the goal, 'external' for voice/executor/RViz goals */
  source: 'hmi' | 'external' | null;
  distanceRemaining: number | null;
  initialDistance: number | null;
  etaSec: number | null;
  elapsedSec: number | null;
  recoveries: number;
  startedAt: number | null;
  endedAt: number | null;
}

export const IDLE_NAV: NavState = {
  phase: 'idle',
  goalId: null,
  target: null,
  source: null,
  distanceRemaining: null,
  initialDistance: null,
  etaSec: null,
  elapsedSec: null,
  recoveries: 0,
  startedAt: null,
  endedAt: null,
};

export type LocalizationMode = 'amcl' | 'slam' | 'map' | 'odom' | 'none';

export interface LocalizationState {
  mode: LocalizationMode;
  /** 1-sigma position uncertainty from /amcl_pose, meters */
  sigmaXY: number | null;
  sigmaYaw: number | null;
}

export interface MapInfo {
  width: number;
  height: number;
  resolution: number;
  origin: Pose2D;
  knownRatio: number;
  receivedAt: number;
  frame: string;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
}

export interface Toast {
  id: number;
  level: LogLevel;
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
  ttl: number;
}

export type ChatKind = 'command' | 'pending' | 'question' | 'info' | 'success' | 'error' | 'noreply';

export interface ChatMessage {
  id: number;
  ts: number;
  role: 'user' | 'system';
  kind: ChatKind;
  text: string;
  options?: string[];
  answered?: boolean;
}

export interface LabelDraft {
  /** present when editing */
  id?: string;
  name: string;
  aliases: string;
  type: string;
  x: number;
  y: number;
  radius: number;
}

export interface ZoneDraft {
  points: Point2[];
  reason: string;
  duration: 'session' | 'permanent' | 'one_shot';
  ttl: number;
  groupId: string;
}

export type Selection = { kind: 'label'; id: string } | { kind: 'zone'; id: string } | null;

export interface LinkInfo {
  state: LinkState;
  url: string;
  latencyMs: number | null;
  lastError: string | null;
  nextRetryAt: number | null;
  connectedAt: number | null;
}

export interface Velocity {
  linear: number;
  angular: number;
}

export interface AppState {
  mode: Mode;
  tool: Tool;
  primary: ViewKind;
  pipVisible: boolean;
  followRobot: boolean;

  link: LinkInfo;
  pose: Pose2D | null;
  poseFrame: string | null;
  poseStale: boolean;
  velocity: Velocity | null;
  command: Velocity & { active: boolean };
  localization: LocalizationState;
  nav: NavState;
  plannedPathLength: number | null;

  labels: Label[];
  labelsSynced: boolean;
  zones: Zone[];
  zonesSynced: boolean;
  mapInfo: MapInfo | null;

  nodes: string[] | null;
  nodesAt: number | null;
  guardOnline: boolean | null;

  chat: ChatMessage[];
  log: LogEntry[];
  toasts: Toast[];

  settings: Settings;
  selection: Selection;
  labelDraft: LabelDraft | null;
  zoneDraft: ZoneDraft | null;
  dialog: 'settings' | 'system' | 'shortcuts' | 'saveMap' | null;
  confirm: { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void } | null;
  logOpen: boolean;
  listening: boolean;
  interim: string;

  setMode: (mode: Mode) => void;
  setTool: (tool: Tool) => void;
  swapViews: () => void;
  setPrimary: (v: ViewKind) => void;
  setPipVisible: (v: boolean) => void;
  setFollow: (v: boolean) => void;
  patch: (p: Partial<AppState>) => void;
  setNav: (p: Partial<NavState>) => void;
  updateSettings: (p: SettingsPatch) => void;
  replaceSettings: (s: Settings) => void;
  pushLog: (level: LogLevel, source: string, message: string) => void;
  clearLog: () => void;
  pushToast: (t: Omit<Toast, 'id' | 'ttl'> & { ttl?: number }) => number;
  dismissToast: (id: number) => void;
  pushChat: (m: Omit<ChatMessage, 'id' | 'ts'>) => number;
  updateChat: (id: number, p: Partial<ChatMessage>) => void;
  clearChat: () => void;
}

let seq = 1;
const nextId = () => seq++;

const LOG_LIMIT = 500;
const CHAT_LIMIT = 200;

export const useApp = create<AppState>()((set, get) => ({
  mode: 'drive',
  tool: 'pan',
  primary: 'camera',
  pipVisible: true,
  followRobot: false,

  link: { state: 'idle', url: '', latencyMs: null, lastError: null, nextRetryAt: null, connectedAt: null },
  pose: null,
  poseFrame: null,
  poseStale: false,
  velocity: null,
  command: { linear: 0, angular: 0, active: false },
  localization: { mode: 'none', sigmaXY: null, sigmaYaw: null },
  nav: IDLE_NAV,
  plannedPathLength: null,

  labels: [],
  labelsSynced: false,
  zones: [],
  zonesSynced: false,
  mapInfo: null,

  nodes: null,
  nodesAt: null,
  guardOnline: null,

  chat: [],
  log: [],
  toasts: [],

  settings: loadSettings(),
  selection: null,
  labelDraft: null,
  zoneDraft: null,
  dialog: null,
  confirm: null,
  logOpen: false,
  listening: false,
  interim: '',

  setMode: (mode) => {
    if (get().mode === mode) return;
    const d = MODE_DEFAULTS[mode];
    set({ mode, primary: d.primary, tool: d.tool, selection: null });
  },
  setTool: (tool) => set({ tool, selection: tool === 'pan' ? get().selection : null }),
  swapViews: () => set((s) => ({ primary: s.primary === 'map' ? 'camera' : 'map', pipVisible: true })),
  setPrimary: (primary) => set({ primary }),
  setPipVisible: (pipVisible) => set({ pipVisible }),
  setFollow: (followRobot) => set({ followRobot }),
  patch: (p) => set(p),
  setNav: (p) => set((s) => ({ nav: { ...s.nav, ...p } })),

  updateSettings: (p) => {
    const settings = mergeSettings(get().settings, p);
    saveSettings(settings);
    set({ settings });
  },
  replaceSettings: (settings) => {
    saveSettings(settings);
    set({ settings });
  },

  pushLog: (level, source, message) =>
    set((s) => {
      const entry: LogEntry = { id: nextId(), ts: Date.now(), level, source, message };
      const log = s.log.length >= LOG_LIMIT ? [...s.log.slice(-LOG_LIMIT + 1), entry] : [...s.log, entry];
      return { log };
    }),
  clearLog: () => set({ log: [] }),

  pushToast: (t) => {
    const id = nextId();
    const ttl = t.ttl ?? (t.level === 'error' ? 8000 : t.level === 'warn' ? 6000 : 4000);
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id, ttl }] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  pushChat: (m) => {
    const id = nextId();
    set((s) => ({ chat: [...s.chat.slice(-CHAT_LIMIT + 1), { ...m, id, ts: Date.now() }] }));
    return id;
  },
  updateChat: (id, p) => set((s) => ({ chat: s.chat.map((m) => (m.id === id ? { ...m, ...p } : m)) })),
  clearChat: () => set({ chat: [] }),
}));

/** Non-hook access for modules outside React. */
export const app = () => useApp.getState();

/** Log + toast in one call: the toast for the operator, the log for the record. */
export function notify(level: LogLevel, source: string, title: string, detail?: string, action?: Toast['action']): void {
  const s = app();
  s.pushLog(level, source, detail ? `${title} — ${detail}` : title);
  s.pushToast({ level, title, detail, action });
}
