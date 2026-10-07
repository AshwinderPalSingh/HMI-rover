/**
 * Latest-value TF tree built from /tf and /tf_static.
 *
 * Each edge stores T_parent_child exactly as published. lookup(target, source)
 * walks both frames to their common root and returns T_target_source, i.e. the
 * transform that maps points in `source` into `target` — the same semantics as
 * tf2's lookupTransform(target, source, latest).
 *
 * No time interpolation: for display at human timescales the latest transform
 * is what an operator wants to see.
 */

import { IDENTITY, compose, invert, type Transform } from '../lib/math';
import type { TFMessage, TransformStamped } from './types';

interface Edge {
  parent: string;
  tf: Transform;
  /** wall-clock ms of the last update (performance.now based) */
  updatedAt: number;
  isStatic: boolean;
}

export interface LookupResult {
  tf: Transform;
  /** age in ms of the oldest dynamic edge on the path (0 if all static) */
  age: number;
}

const MAX_DEPTH = 64;

export const stripSlash = (frame: string): string => (frame.startsWith('/') ? frame.slice(1) : frame);

export class TfTree {
  private edges = new Map<string, Edge>();
  /** Bumped on every update; cheap change detection for renderers. */
  version = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  setTransform(msg: TransformStamped, isStatic: boolean): void {
    const child = stripSlash(msg.child_frame_id);
    const parent = stripSlash(msg.header.frame_id);
    if (!child || !parent || child === parent) return;
    const { translation: t, rotation: r } = msg.transform;
    this.edges.set(child, {
      parent,
      tf: { t: { x: t.x, y: t.y, z: t.z }, q: { x: r.x, y: r.y, z: r.z, w: r.w } },
      updatedAt: this.now(),
      isStatic,
    });
    this.version++;
  }

  ingest(msg: TFMessage, isStatic: boolean): void {
    for (const t of msg.transforms ?? []) this.setTransform(t, isStatic);
  }

  has(frame: string): boolean {
    return this.edges.has(stripSlash(frame));
  }

  /** T_root_frame and the root it ends at. */
  private toRoot(frame: string): { root: string; tf: Transform; oldest: number } {
    let tf: Transform = IDENTITY;
    let current = stripSlash(frame);
    let oldest = Infinity;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const edge = this.edges.get(current);
      if (!edge) break;
      tf = compose(edge.tf, tf);
      if (!edge.isStatic) oldest = Math.min(oldest, edge.updatedAt);
      current = edge.parent;
    }
    return { root: current, tf, oldest };
  }

  /** T_target_source, or null when the frames are not connected. */
  lookup(target: string, source: string): LookupResult | null {
    const tgt = stripSlash(target);
    const src = stripSlash(source);
    if (tgt === src) return { tf: IDENTITY, age: 0 };
    const a = this.toRoot(src);
    const b = this.toRoot(tgt);
    if (a.root !== b.root) return null;
    const oldest = Math.min(a.oldest, b.oldest);
    return {
      tf: compose(invert(b.tf), a.tf),
      age: Number.isFinite(oldest) ? this.now() - oldest : 0,
    };
  }

  /** Age (ms) of a frame's own edge; null if unknown. */
  edgeAge(frame: string): number | null {
    const e = this.edges.get(stripSlash(frame));
    return e ? this.now() - e.updatedAt : null;
  }

  parentOf(frame: string): string | null {
    return this.edges.get(stripSlash(frame))?.parent ?? null;
  }

  frames(): string[] {
    const set = new Set<string>();
    for (const [child, e] of this.edges) {
      set.add(child);
      set.add(e.parent);
    }
    return [...set].sort();
  }

  clear(): void {
    this.edges.clear();
    this.version++;
  }
}
