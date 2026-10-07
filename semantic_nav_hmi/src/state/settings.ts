/** Operator-editable configuration, persisted per browser. */

import { loadJSON, saveJSON } from '../lib/storage';

export interface Settings {
  /** Empty = same host that served the console, port from /hmi-config.json (default 9090). */
  rosbridgeUrl: string;
  topics: {
    /** Teleop output. /hmi/cmd_vel goes through the teleop guard (deadman) to /cmd_vel. */
    cmdVel: string;
    camera: string;
    map: string;
    scan: string;
    odom: string;
    plan: string;
  };
  frames: {
    map: string;
    odom: string;
    base: string;
  };
  robot: {
    length: number;
    width: number;
  };
  teleop: {
    maxLinear: number;
    maxAngular: number;
  };
  voice: {
    speak: boolean;
    lang: string;
  };
  layers: {
    grid: boolean;
    labels: boolean;
    zones: boolean;
    path: boolean;
    laser: boolean;
  };
  mapSave: {
    directory: string;
    name: string;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  rosbridgeUrl: '',
  topics: {
    cmdVel: '/hmi/cmd_vel',
    camera: '/chase_camera/image_raw/compressed',
    map: '/map',
    scan: '/scan',
    odom: '/odometry/filtered',
    plan: '/plan',
  },
  frames: {
    map: 'map',
    odom: 'odom',
    base: 'base_footprint',
  },
  // basic_mobile_bot footprint (URDF base_length x base_width)
  robot: {
    length: 0.7,
    width: 0.39,
  },
  // Nav2 DWB limits for this robot (max_vel_x / max_vel_theta)
  teleop: {
    maxLinear: 0.26,
    maxAngular: 1.0,
  },
  voice: {
    speak: true,
    lang: 'en-US',
  },
  layers: {
    grid: true,
    labels: true,
    zones: true,
    path: true,
    laser: true,
  },
  mapSave: {
    directory: '/tmp',
    name: 'semantic_nav_map',
  },
};

/** Teleop limits the operator may choose; the teleop guard clamps to 0.5 m/s, 1.5 rad/s. */
export const TELEOP_LIMITS = {
  linear: { min: 0.05, max: 0.5 },
  angular: { min: 0.1, max: 1.5 },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T extends object>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch || typeof patch !== 'object') return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    const cur = (base as Record<string, unknown>)[k];
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object') {
      out[k] = merge(cur as object, v as DeepPartial<object>);
    } else if (v !== undefined && typeof v === typeof cur) {
      out[k] = v;
    }
  }
  return out as T;
}

export function loadSettings(): Settings {
  return merge(DEFAULT_SETTINGS, loadJSON<DeepPartial<Settings>>('settings', {}));
}

export function saveSettings(s: Settings): void {
  saveJSON('settings', s);
}

export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  return merge(base, patch);
}

export type SettingsPatch = DeepPartial<Settings>;

/** ?ws=ws://host:9090 overrides the rosbridge URL for this page load only. */
export function urlOverride(): string | null {
  try {
    const v = new URLSearchParams(window.location.search).get('ws');
    return v && /^wss?:\/\//.test(v) ? v : null;
  } catch {
    return null;
  }
}
