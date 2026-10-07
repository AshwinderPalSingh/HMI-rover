/**
 * High-rate data that bypasses React: TF, the decoded map image, laser points
 * and the planned path. Canvas views subscribe to `liveChanged` and redraw on
 * the next animation frame, so a 30 Hz TF stream never re-renders components.
 */

import { Signal } from '../lib/emitter';
import type { Pose2D } from '../lib/math';
import { TfTree } from '../ros/tf';

export interface MapLayer {
  /** Pixel image; buffer row 0 = grid row 0 = world y at origin (drawn in a Y-up frame). */
  image: HTMLCanvasElement;
  width: number;
  height: number;
  resolution: number;
  origin: Pose2D;
  frame: string;
  version: number;
  /** World-space bounds of the explored (known) cells, for "fit to map" */
  knownBounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export interface PointLayer {
  /** Interleaved x,y in `frame` */
  points: Float32Array;
  count: number;
  frame: string;
  receivedAt: number;
}

export type LiveChannel = 'tf' | 'map' | 'scan' | 'plan';

export const live = {
  tf: new TfTree(),
  map: null as MapLayer | null,
  scan: null as PointLayer | null,
  plan: null as PointLayer | null,
};

export const liveChanged = new Signal<LiveChannel>();

export function resetLive(): void {
  live.tf.clear();
  live.scan = null;
  live.plan = null;
  // The map image is kept across reconnects: still useful to look at while offline.
  liveChanged.emit('tf');
}
