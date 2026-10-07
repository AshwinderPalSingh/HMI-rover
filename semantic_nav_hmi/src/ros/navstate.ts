/**
 * Pure helpers for following Nav2's NavigateToPose action from its status and
 * feedback topics. Watching the topics (instead of only our own goal handle)
 * means goals sent by voice commands, the navigation executor or RViz show up
 * in the console too.
 */

import type { NavPhase } from '../state/store';
import { GOAL_STATUS, type GoalStatus, stampToMs } from './types';

/** uint8[16] arrives as Uint8Array (CBOR), number[] or base64 (JSON) — normalize to hex. */
export function uuidToHex(u: Uint8Array | ArrayLike<number> | string | undefined | null): string {
  if (u === undefined || u === null) return '';
  let bytes: ArrayLike<number>;
  if (typeof u === 'string') {
    try {
      const bin = atob(u);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      bytes = arr;
    } catch {
      return u;
    }
  } else {
    bytes = u;
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] & 0xff).toString(16).padStart(2, '0');
  return hex;
}

export const isActiveStatus = (s: number): boolean =>
  s === GOAL_STATUS.ACCEPTED || s === GOAL_STATUS.EXECUTING || s === GOAL_STATUS.CANCELING;

export const isTerminalStatus = (s: number): boolean =>
  s === GOAL_STATUS.SUCCEEDED || s === GOAL_STATUS.CANCELED || s === GOAL_STATUS.ABORTED;

export function phaseFromStatus(s: number): NavPhase {
  switch (s) {
    case GOAL_STATUS.ACCEPTED:
    case GOAL_STATUS.EXECUTING:
      return 'active';
    case GOAL_STATUS.CANCELING:
      return 'canceling';
    case GOAL_STATUS.SUCCEEDED:
      return 'succeeded';
    case GOAL_STATUS.CANCELED:
      return 'canceled';
    case GOAL_STATUS.ABORTED:
      return 'aborted';
    default:
      return 'idle';
  }
}

export interface TrackedGoal {
  id: string;
  status: number;
  acceptedAt: number;
}

/**
 * The goal the console should show: the newest active goal if any,
 * otherwise the newest goal overall (to display its final result).
 */
export function pickCurrentGoal(list: readonly GoalStatus[] | undefined): TrackedGoal | null {
  if (!list || list.length === 0) return null;
  const goals = list.map((g) => ({
    id: uuidToHex(g.goal_info.goal_id.uuid),
    status: g.status,
    acceptedAt: stampToMs(g.goal_info.stamp),
  }));
  const newest = (xs: TrackedGoal[]) => xs.reduce((a, b) => (b.acceptedAt >= a.acceptedAt ? b : a));
  const active = goals.filter((g) => isActiveStatus(g.status));
  return active.length ? newest(active) : newest(goals);
}

/** 0..1 progress from Nav2's remaining path length and the largest remaining length seen. */
export function navProgress(remaining: number | null, initial: number | null): number | null {
  if (remaining === null || initial === null || initial <= 0.05) return null;
  return Math.min(1, Math.max(0, 1 - remaining / initial));
}
