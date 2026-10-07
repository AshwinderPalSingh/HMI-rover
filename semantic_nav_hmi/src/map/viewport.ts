/**
 * World-centric 2D viewport. `ppm` = CSS pixels per meter. World Y points up
 * (REP-103), screen Y points down — the flip lives here and nowhere else.
 */

import { clamp, type Point2 } from '../lib/math';

export interface View {
  cx: number;
  cy: number;
  ppm: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const PPM_MIN = 1.5;
export const PPM_MAX = 600;

export function worldToScreen(v: View, s: Size, x: number, y: number): Point2 {
  return { x: s.w / 2 + (x - v.cx) * v.ppm, y: s.h / 2 - (y - v.cy) * v.ppm };
}

export function screenToWorld(v: View, s: Size, sx: number, sy: number): Point2 {
  return { x: v.cx + (sx - s.w / 2) / v.ppm, y: v.cy - (sy - s.h / 2) / v.ppm };
}

/** Zoom by `factor`, keeping the world point under (sx, sy) fixed on screen. */
export function zoomAt(v: View, s: Size, sx: number, sy: number, factor: number): View {
  const ppm = clamp(v.ppm * factor, PPM_MIN, PPM_MAX);
  const wp = screenToWorld(v, s, sx, sy);
  return { ppm, cx: wp.x - (sx - s.w / 2) / ppm, cy: wp.y + (sy - s.h / 2) / ppm };
}

/** Move the content by a screen-space delta. */
export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, cx: v.cx - dx / v.ppm, cy: v.cy + dy / v.ppm };
}

export function fitBounds(b: Bounds, s: Size, padding = 32): View {
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const ppm = clamp(Math.min((s.w - 2 * padding) / bw, (s.h - 2 * padding) / bh), PPM_MIN, PPM_MAX);
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, ppm };
}

export function visibleBounds(v: View, s: Size): Bounds {
  const a = screenToWorld(v, s, 0, s.h);
  const b = screenToWorld(v, s, s.w, 0);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/** A 1/2/5 × 10^n length whose on-screen size is close to `targetPx`. */
export function niceScale(ppm: number, targetPx = 96): { meters: number; px: number; label: string } {
  const raw = targetPx / ppm;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const m = raw / base;
  const nice = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * base;
  const label = nice >= 1000 ? `${nice / 1000} km` : nice >= 1 ? `${nice} m` : `${Math.round(nice * 100)} cm`;
  return { meters: nice, px: nice * ppm, label };
}

/** Grid spacing (m) so lines are at least `minPx` apart. */
export function gridStep(ppm: number, minPx = 28): number {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
  return steps.find((s) => s * ppm >= minPx) ?? 200;
}
