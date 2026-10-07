/**
 * Link to the simulation's orbit camera (semantic_nav_gazebo viewer camera plugin).
 *
 * The plugin reports its view on /viewer_camera/state (latched) — receiving it is how
 * the console knows the 3D view can be orbited at all. While the operator drags, the
 * local view is authoritative and is streamed to /viewer_camera/command at ≤ 30 Hz;
 * echoes are ignored until the operator has been idle for a moment, so a late echo
 * never snaps the view back mid-gesture. Other consoles' changes arrive the same way.
 *
 * Each state is stamped with the simulation time it took effect; the recent history
 * tells which view any camera frame (stamped the same way) was rendered from.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from '../ros/app';
import { LATCHED } from '../ros/bridge';
import { NAMES, TYPES } from '../ros/names';
import type { Time } from '../ros/types';
import { clampView, type OrbitView } from './orbit';

/** Ignore the plugin's echo for this long after a local edit. */
const HOLD_MS = 600;
/** Minimum spacing of view commands. */
const SEND_MS = 33;
/** How much view history to keep (simulation seconds). */
const HISTORY_S = 5;

/** semantic_nav_interfaces/msg/ViewerCamera */
type ViewerCamera = Omit<OrbitView, 'horizontal_fov'>;

/** semantic_nav_interfaces/msg/ViewerCameraState */
interface ViewerCameraState {
  header: { stamp: Time; frame_id: string };
  view: ViewerCamera;
  horizontal_fov: number;
  target_radius: number;
  target_height: number;
}

export const stampSec = (t: Time) => t.sec + t.nanosec * 1e-9;

export interface Orbit {
  /** an orbit camera is running and reporting its view */
  available: boolean;
  /** the view turns with the robot (chase view) rather than staying world-fixed */
  followHeading: boolean;
  /** the current view (local edits included), or null when unavailable */
  view(): OrbitView | null;
  /** the view a frame stamped `t` (simulation seconds) was rendered from, if known */
  viewAt(t: number): OrbitView | null;
  /** size of the followed robot (m) */
  robot(): { radius: number; height: number };
  /** apply a new view locally and stream it to the camera */
  set(v: OrbitView): void;
  /** back to the plugin's default view */
  reset(): void;
  toggleFollowHeading(): void;
}

/** `onChange` runs whenever the current view changes (local edit or adopted state). */
export function useOrbit(enabled: boolean, onChange?: () => void): Orbit {
  const viewRef = useRef<OrbitView | null>(null);
  const history = useRef<{ t: number; view: OrbitView }[]>([]);
  const robotSize = useRef({ radius: 0, height: 0 });
  const [available, setAvailable] = useState(false);
  const [followHeading, setFollowHeading] = useState(true);
  const editedAt = useRef(-Infinity);
  const lastSent = useRef(-Infinity);
  const timer = useRef<number | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;

  const send = useCallback((v: OrbitView) => {
    lastSent.current = performance.now();
    const { horizontal_fov: _fov, ...cmd } = v;
    bridge.publish<ViewerCamera>(NAMES.viewerCommand, TYPES.viewerCamera, cmd);
  }, []);

  const flush = useCallback(() => {
    timer.current = null;
    if (viewRef.current) send(viewRef.current);
  }, [send]);

  const set = useCallback(
    (v: OrbitView) => {
      viewRef.current = clampView(v);
      editedAt.current = performance.now();
      changed.current?.();
      if (timer.current !== null) return; // already scheduled; it will send the latest view
      const wait = SEND_MS - (performance.now() - lastSent.current);
      if (wait <= 0) flush();
      else timer.current = window.setTimeout(flush, wait);
    },
    [flush],
  );

  /** Send now and adopt whatever the plugin answers (reset, frame switches). */
  const command = useCallback(
    (v: OrbitView) => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      editedAt.current = -Infinity;
      send(v);
    },
    [send],
  );

  useEffect(() => {
    if (!enabled) return;
    const off = bridge.subscribe<ViewerCameraState>(
      NAMES.viewerState,
      TYPES.viewerState,
      (msg) => {
        const v: OrbitView = { ...msg.view, horizontal_fov: msg.horizontal_fov };
        robotSize.current = { radius: msg.target_radius ?? 0, height: msg.target_height ?? 0 };
        const t = stampSec(msg.header.stamp);
        const h = history.current;
        if (h.length && t < h[h.length - 1].t) h.length = 0; // simulation was reset
        h.push({ t, view: v });
        while (h.length > 2 && h[1].t < t - HISTORY_S) h.shift();

        if (!viewRef.current) bridge.advertise(NAMES.viewerCommand, TYPES.viewerCamera);
        setFollowHeading(v.follow_heading);
        if (viewRef.current && performance.now() - editedAt.current < HOLD_MS) return;
        viewRef.current = v;
        setAvailable(true);
        changed.current?.();
      },
      { qos: LATCHED },
    );
    return () => {
      off();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      viewRef.current = null;
      history.current = [];
      setAvailable(false);
    };
  }, [enabled]);

  return {
    available,
    followHeading,
    view: () => viewRef.current,
    viewAt: (t: number) => {
      const h = history.current;
      for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t + 1e-6) return h[i].view;
      return null;
    },
    robot: () => robotSize.current,
    set,
    reset: () => {
      if (viewRef.current) command({ ...viewRef.current, distance: 0 });
    },
    toggleFollowHeading: () => {
      const v = viewRef.current;
      if (!v) return;
      setFollowHeading(!v.follow_heading);
      command({ ...v, follow_heading: !v.follow_heading });
    },
  };
}
