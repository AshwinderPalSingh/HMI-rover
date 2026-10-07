/**
 * Draws one frame of the 2D map scene.
 *
 * The occupancy image is drawn through a world transform (Y up); everything
 * else is projected to screen space first, so strokes, text and hatching stay
 * crisp and constant-size at any zoom.
 *
 * Color roles (validated as a categorical set, all-pairs, on the map surface):
 *   blue  #3987e5  robot, planned path, goal   — "self / intent"
 *   aqua  #199e70  labelled places
 *   orange #d95926 laser returns
 * Keep-out zones use the reserved status "critical" red #d03b3b and always
 * carry hatching + an icon/label, so they never rely on hue alone.
 */

import { pointInPolygon, polygonCentroid, type Point2, type Pose2D } from '../lib/math';
import type { MapLayer, PointLayer } from '../state/live';
import type { Settings } from '../state/settings';
import type { Label, NavTarget, Selection, Zone } from '../state/store';
import { CANVAS_ICONS } from './canvasIcons';
import { gridStep, visibleBounds, worldToScreen, type Size, type View } from './viewport';

export const MAP_COLORS = {
  bg: '#0d1015',
  grid: 'rgba(232, 236, 243, 0.045)',
  gridMajor: 'rgba(232, 236, 243, 0.10)',
  robot: '#3987e5',
  robotStale: '#5d6678',
  path: '#3987e5',
  under: 'rgba(5, 7, 10, 0.6)',
  label: '#199e70',
  labelFill: 'rgba(25, 158, 112, 0.10)',
  labelStroke: 'rgba(25, 158, 112, 0.70)',
  laser: '#d95926',
  zone: '#d03b3b',
  zoneFill: 'rgba(208, 59, 59, 0.14)',
  zoneHatch: 'rgba(208, 59, 59, 0.42)',
  ink: '#e8ecf3',
  inkMuted: '#a6afbf',
  halo: 'rgba(11, 13, 18, 0.92)',
  chip: 'rgba(13, 16, 21, 0.88)',
};

const FONT = '500 12px Inter, "Inter Variable", system-ui, sans-serif';
const FONT_SMALL = '500 11px Inter, "Inter Variable", system-ui, sans-serif';

export type Draft =
  | { kind: 'arrow'; tool: 'goal' | 'pose'; from: Point2; to: Point2 | null }
  | { kind: 'label'; at: Point2; radius: number }
  | { kind: 'zone'; points: Point2[]; cursor: Point2 | null; closing: boolean }
  | null;

export interface Scene {
  view: View;
  size: Size;
  dpr: number;
  map: MapLayer | null;
  robot: { pose: Pose2D; stale: boolean } | null;
  footprint: { length: number; width: number };
  labels: readonly Label[];
  zones: readonly Zone[];
  selection: Selection;
  hoverId: string | null;
  plan: PointLayer | null;
  scan: PointLayer | null;
  target: NavTarget | null;
  navActive: boolean;
  layers: Settings['layers'];
  draft: Draft;
  compact: boolean;
}

// ── icons ─────────────────────────────────────────────────────────────────

const iconCache = new Map<string, Path2D[]>();

function iconPaths(name: string): Path2D[] {
  const cached = iconCache.get(name);
  if (cached) return cached;
  const node = CANVAS_ICONS[name] ?? CANVAS_ICONS.other;
  const paths: Path2D[] = [];
  for (const [tag, a] of node) {
    const n = (k: string) => Number(a[k] ?? 0);
    if (tag === 'path') {
      paths.push(new Path2D(String(a.d)));
    } else if (tag === 'circle') {
      const p = new Path2D();
      p.arc(n('cx'), n('cy'), n('r'), 0, Math.PI * 2);
      paths.push(p);
    } else if (tag === 'rect') {
      const p = new Path2D();
      const r = n('rx');
      if (r > 0 && 'roundRect' in p) p.roundRect(n('x'), n('y'), n('width'), n('height'), r);
      else p.rect(n('x'), n('y'), n('width'), n('height'));
      paths.push(p);
    } else if (tag === 'line') {
      const p = new Path2D();
      p.moveTo(n('x1'), n('y1'));
      p.lineTo(n('x2'), n('y2'));
      paths.push(p);
    } else if (tag === 'polyline' || tag === 'polygon') {
      const nums = String(a.points).trim().split(/[\s,]+/).map(Number);
      const p = new Path2D();
      for (let i = 0; i + 1 < nums.length; i += 2) {
        if (i === 0) p.moveTo(nums[i], nums[i + 1]);
        else p.lineTo(nums[i], nums[i + 1]);
      }
      if (tag === 'polygon') p.closePath();
      paths.push(p);
    }
  }
  iconCache.set(name, paths);
  return paths;
}

export function drawIcon(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, size: number, color: string, strokePx = 1.6): void {
  const scale = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = strokePx / scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of iconPaths(name)) ctx.stroke(p);
  ctx.restore();
}

export function iconForType(type: string): string {
  return type in CANVAS_ICONS && type !== 'keepout' ? type : 'other';
}

// ── hatch pattern for keep-out zones ─────────────────────────────────────

let hatch: CanvasPattern | null = null;

function hatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (hatch) return hatch;
  const c = document.createElement('canvas');
  c.width = 10;
  c.height = 10;
  const h = c.getContext('2d');
  if (!h) return null;
  h.strokeStyle = MAP_COLORS.zoneHatch;
  h.lineWidth = 1.5;
  h.lineCap = 'square';
  h.beginPath();
  // 45° lines, continuous across tiles
  h.moveTo(-2, 12);
  h.lineTo(12, -2);
  h.moveTo(-2, 2);
  h.lineTo(2, -2);
  h.moveTo(8, 12);
  h.lineTo(12, 8);
  h.stroke();
  hatch = ctx.createPattern(c, 'repeat');
  return hatch;
}

// ── helpers ───────────────────────────────────────────────────────────────

/** roundRect with a plain-rect fallback for older engines. */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const c = ctx as CanvasRenderingContext2D & { roundRect?: CanvasRenderingContext2D['roundRect'] };
  if (typeof c.roundRect === 'function') c.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function polyPath(ctx: CanvasRenderingContext2D, pts: readonly Point2[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = MAP_COLORS.ink): void {
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = MAP_COLORS.halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function arrow(ctx: CanvasRenderingContext2D, from: Point2, to: Point2, color: string, width = 2.5): void {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const head = 11;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x - Math.cos(ang) * head * 0.6, to.y - Math.sin(ang) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - Math.cos(ang - 0.42) * head, to.y - Math.sin(ang - 0.42) * head);
  ctx.lineTo(to.x - Math.cos(ang + 0.42) * head, to.y - Math.sin(ang + 0.42) * head);
  ctx.closePath();
  ctx.fill();
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ── scene ─────────────────────────────────────────────────────────────────

/**
 * Shift the view centre so the world→device translation lands on whole device
 * pixels. Thin one-cell walls otherwise shimmer when the view moves by
 * fractions of a pixel (robot-follow with odometry noise, slow pans).
 */
function snapView(view: View, size: Size, dpr: number): View {
  const ex = dpr * (size.w / 2 - view.cx * view.ppm);
  const ey = dpr * (size.h / 2 + view.cy * view.ppm);
  return {
    ppm: view.ppm,
    cx: (size.w / 2 - Math.round(ex) / dpr) / view.ppm,
    cy: (Math.round(ey) / dpr - size.h / 2) / view.ppm,
  };
}

export function renderScene(ctx: CanvasRenderingContext2D, sc: Scene): void {
  const { size, dpr } = sc;
  const view = snapView(sc.view, size, dpr);
  const S = (x: number, y: number) => worldToScreen(view, size, x, y);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = MAP_COLORS.bg;
  ctx.fillRect(0, 0, size.w, size.h);

  // 1. occupancy image through the world transform (Y up)
  const map = sc.map;
  if (map) {
    ctx.save();
    ctx.setTransform(
      dpr * view.ppm,
      0,
      0,
      -dpr * view.ppm,
      dpr * (size.w / 2 - view.cx * view.ppm),
      dpr * (size.h / 2 + view.cy * view.ppm),
    );
    ctx.translate(map.origin.x, map.origin.y);
    if (map.origin.yaw) ctx.rotate(map.origin.yaw);
    ctx.imageSmoothingEnabled = map.resolution * view.ppm < 3;
    ctx.drawImage(map.image, 0, 0, map.width * map.resolution, map.height * map.resolution);
    ctx.restore();
  }

  // 2. grid
  if (sc.layers.grid && !sc.compact) {
    const step = gridStep(view.ppm);
    const b = visibleBounds(view, size);
    ctx.lineWidth = 1;
    const x0 = Math.ceil(b.minX / step) * step;
    const y0 = Math.ceil(b.minY / step) * step;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? MAP_COLORS.grid : MAP_COLORS.gridMajor;
      ctx.beginPath();
      for (let x = x0; x <= b.maxX; x += step) {
        const major = Math.abs(Math.round(x / (step * 5)) * step * 5 - x) < step * 1e-3;
        if (major !== (pass === 1)) continue;
        const sx = Math.round(S(x, 0).x) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, size.h);
      }
      for (let y = y0; y <= b.maxY; y += step) {
        const major = Math.abs(Math.round(y / (step * 5)) * step * 5 - y) < step * 1e-3;
        if (major !== (pass === 1)) continue;
        const sy = Math.round(S(0, y).y) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(size.w, sy);
      }
      ctx.stroke();
    }
  }

  const sel = sc.selection;

  // 3. keep-out zones
  if (sc.layers.zones) {
    const pattern = hatchPattern(ctx);
    for (const z of sc.zones) {
      const pts = z.points.map((p) => S(p.x, p.y));
      const selected = sel?.kind === 'zone' && sel.id === z.id;
      polyPath(ctx, pts);
      ctx.fillStyle = MAP_COLORS.zoneFill;
      ctx.fill();
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fill();
      }
      ctx.lineJoin = 'round';
      if (selected) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = MAP_COLORS.ink;
        ctx.stroke();
      }
      ctx.lineWidth = selected ? 2 : 1.5;
      ctx.strokeStyle = MAP_COLORS.zone;
      ctx.stroke();
    }
  }

  // 4. label areas
  if (sc.layers.labels) {
    for (const l of sc.labels) {
      const selected = (sel?.kind === 'label' && sel.id === l.id) || sc.hoverId === l.id;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = selected ? 1.75 : 1.25;
      ctx.strokeStyle = MAP_COLORS.labelStroke;
      ctx.fillStyle = MAP_COLORS.labelFill;
      if (l.polygon) {
        polyPath(ctx, l.polygon.map((p) => S(p.x, p.y)));
        ctx.fill();
        ctx.stroke();
      } else {
        const r = l.radius * view.ppm;
        if (r >= 6) {
          const c = S(l.x, l.y);
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
  }

  // 5. planned path
  if (sc.layers.path && sc.plan && sc.plan.count >= 2) {
    const pts = sc.plan.points;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < sc.plan.count; i++) {
      const p = S(pts[i * 2], pts[i * 2 + 1]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = MAP_COLORS.under;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = MAP_COLORS.path;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // 6. laser returns
  if (sc.layers.laser && sc.scan && sc.scan.count > 0) {
    const pts = sc.scan.points;
    const d = sc.compact ? 1.5 : 2.5;
    ctx.fillStyle = MAP_COLORS.laser;
    for (let i = 0; i < sc.scan.count; i++) {
      const p = S(pts[i * 2], pts[i * 2 + 1]);
      if (p.x < -4 || p.y < -4 || p.x > size.w + 4 || p.y > size.h + 4) continue;
      ctx.fillRect(p.x - d / 2, p.y - d / 2, d, d);
    }
  }

  // 7. navigation target (falls back to the end of the plan for external goals)
  let target = sc.target;
  if (!target && sc.navActive && sc.plan && sc.plan.count >= 2) {
    const n = sc.plan.count - 1;
    target = { x: sc.plan.points[n * 2], y: sc.plan.points[n * 2 + 1], yaw: null };
  }
  if (target && sc.navActive) {
    const c = S(target.x, target.y);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(57, 135, 229, 0.22)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = MAP_COLORS.path;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = MAP_COLORS.ink;
    ctx.fill();
    if (target.yaw !== null) {
      arrow(ctx, { x: c.x + Math.cos(-target.yaw) * 10, y: c.y + Math.sin(-target.yaw) * 10 }, {
        x: c.x + Math.cos(-target.yaw) * 28,
        y: c.y + Math.sin(-target.yaw) * 28,
      }, MAP_COLORS.path, 2);
    }
  }

  // 8. robot
  if (sc.robot) {
    drawRobot(ctx, S(sc.robot.pose.x, sc.robot.pose.y), sc.robot.pose.yaw, sc.footprint, view.ppm, sc.robot.stale, sc.compact);
  }

  // 9. label pins and names
  if (sc.layers.labels) {
    const placed: Box[] = [];
    if (sc.robot) {
      const r = S(sc.robot.pose.x, sc.robot.pose.y);
      placed.push({ x: r.x - 14, y: r.y - 14, w: 28, h: 28 });
    }
    const ordered = [...sc.labels].sort((a, b) => {
      const pa = (sel?.kind === 'label' && sel.id === a.id) || sc.hoverId === a.id ? 0 : 1;
      const pb = (sel?.kind === 'label' && sel.id === b.id) || sc.hoverId === b.id ? 0 : 1;
      return pa - pb;
    });
    const pinR = sc.compact ? 5 : 10;
    for (const l of ordered) {
      const c = S(l.x, l.y);
      if (c.x < -40 || c.y < -40 || c.x > size.w + 40 || c.y > size.h + 40) continue;
      const selected = sel?.kind === 'label' && sel.id === l.id;
      const hovered = sc.hoverId === l.id;
      ctx.beginPath();
      ctx.arc(c.x, c.y, pinR + 2, 0, Math.PI * 2);
      ctx.fillStyle = MAP_COLORS.bg;
      ctx.fill();
      if (selected || hovered) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, pinR + 4, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = MAP_COLORS.ink;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(c.x, c.y, pinR, 0, Math.PI * 2);
      ctx.fillStyle = MAP_COLORS.label;
      ctx.fill();
      if (!sc.compact) drawIcon(ctx, iconForType(l.type), c.x, c.y, 12, '#ffffff', 1.5);
      placed.push({ x: c.x - pinR, y: c.y - pinR, w: pinR * 2, h: pinR * 2 });
    }
    if (!sc.compact) {
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (const l of ordered) {
        const c = S(l.x, l.y);
        if (c.x < -200 || c.y < -20 || c.x > size.w + 20 || c.y > size.h + 20) continue;
        const priority = (sel?.kind === 'label' && sel.id === l.id) || sc.hoverId === l.id;
        const w = ctx.measureText(l.name).width;
        const box = { x: c.x + pinR + 5, y: c.y - 8, w: w + 4, h: 16 };
        // the pin itself is in `placed`; ignore overlap with our own pin
        if (!priority && placed.some((b) => overlaps(b, box) && !(b.x === c.x - pinR && b.y === c.y - pinR))) continue;
        haloText(ctx, l.name, box.x, c.y);
        placed.push(box);
      }
    }
  }

  // 10. keep-out chips (icon + reason; never colour alone)
  if (sc.layers.zones && !sc.compact) {
    ctx.font = FONT_SMALL;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const z of sc.zones) {
      const selected = sel?.kind === 'zone' && sel.id === z.id;
      const c = polygonCentroid(z.points);
      const p = S(c.x, c.y);
      const pts = z.points.map((q) => S(q.x, q.y));
      const minX = Math.min(...pts.map((q) => q.x));
      const maxX = Math.max(...pts.map((q) => q.x));
      if (!selected && maxX - minX < 70) {
        drawIcon(ctx, 'keepout', p.x, p.y, 14, MAP_COLORS.zone, 2);
        continue;
      }
      const text = z.reason || 'keep-out';
      const tw = Math.min(ctx.measureText(text).width, 180);
      const w = tw + 30;
      const x = p.x - w / 2;
      const y = p.y - 11;
      ctx.beginPath();
      roundRectPath(ctx, x, y, w, 22, 6);
      ctx.fillStyle = MAP_COLORS.chip;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = selected ? MAP_COLORS.ink : 'rgba(208, 59, 59, 0.7)';
      ctx.stroke();
      drawIcon(ctx, 'keepout', x + 13, p.y, 13, MAP_COLORS.zone, 2);
      ctx.fillStyle = MAP_COLORS.ink;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 22, y, tw + 2, 22);
      ctx.clip();
      ctx.fillText(text, x + 23, p.y + 0.5);
      ctx.restore();
    }
  }

  // 11. drafts (tool interaction)
  const d = sc.draft;
  if (d?.kind === 'arrow') {
    const color = d.tool === 'goal' ? MAP_COLORS.path : MAP_COLORS.ink;
    const a = S(d.from.x, d.from.y);
    ctx.beginPath();
    ctx.arc(a.x, a.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = d.tool === 'goal' ? 'rgba(57, 135, 229, 0.3)' : 'rgba(232, 236, 243, 0.25)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (d.to) {
      const b = S(d.to.x, d.to.y);
      if (Math.hypot(b.x - a.x, b.y - a.y) > 6) arrow(ctx, a, b, color, 2.5);
    }
  } else if (d?.kind === 'label') {
    const c = S(d.at.x, d.at.y);
    const r = d.radius * view.ppm;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = MAP_COLORS.labelStroke;
    ctx.fillStyle = MAP_COLORS.labelFill;
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(r, 4), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = MAP_COLORS.label;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
    drawIcon(ctx, 'other', c.x, c.y, 12, '#ffffff', 1.5);
  } else if (d?.kind === 'zone' && d.points.length > 0) {
    const pts = d.points.map((p) => S(p.x, p.y));
    if (pts.length >= 3) {
      polyPath(ctx, pts);
      ctx.fillStyle = MAP_COLORS.zoneFill;
      ctx.fill();
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = MAP_COLORS.zone;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    if (d.cursor) {
      const c = S(d.cursor.x, d.cursor.y);
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.lineTo(c.x, c.y);
      if (pts.length >= 2) ctx.lineTo(pts[0].x, pts[0].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    pts.forEach((p, i) => {
      const first = i === 0;
      const r = first && d.closing ? 7 : 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = first && d.closing ? MAP_COLORS.ink : MAP_COLORS.bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = MAP_COLORS.zone;
      ctx.stroke();
    });
  }
}

function drawRobot(
  ctx: CanvasRenderingContext2D,
  p: Point2,
  yaw: number,
  fp: { length: number; width: number },
  ppm: number,
  stale: boolean,
  compact: boolean,
): void {
  const len = fp.length * ppm;
  const wid = fp.width * ppm;
  const color = stale ? MAP_COLORS.robotStale : MAP_COLORS.robot;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-yaw); // screen Y points down
  const marker = Math.max(len, wid) < (compact ? 14 : 20);
  if (marker) {
    const s = compact ? 8 : 11;
    ctx.beginPath();
    ctx.arc(0, 0, s + 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(57, 135, 229, 0.18)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.75, s * 0.72);
    ctx.lineTo(-s * 0.35, 0);
    ctx.lineTo(-s * 0.75, -s * 0.72);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = MAP_COLORS.ink;
    ctx.stroke();
  } else {
    const r = Math.min(wid * 0.22, 8);
    ctx.beginPath();
    roundRectPath(ctx, -len / 2, -wid / 2, len, wid, r);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = MAP_COLORS.ink;
    ctx.stroke();
    // heading chevron
    const c = Math.min(len, wid) * 0.32;
    ctx.beginPath();
    ctx.moveTo(len / 2 - c * 0.35, 0);
    ctx.lineTo(len / 2 - c * 1.35, c * 0.75);
    ctx.lineTo(len / 2 - c * 1.35, -c * 0.75);
    ctx.closePath();
    ctx.fillStyle = MAP_COLORS.ink;
    ctx.fill();
  }
  ctx.restore();
}

/** Hit-test helpers shared with the view. */
export function hitLabel(labels: readonly Label[], view: View, size: Size, sx: number, sy: number, radius = 13): Label | null {
  let best: Label | null = null;
  let bestD = radius;
  for (const l of labels) {
    const c = worldToScreen(view, size, l.x, l.y);
    const d = Math.hypot(c.x - sx, c.y - sy);
    if (d <= bestD) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

export function hitZone(zones: readonly Zone[], wx: number, wy: number): Zone | null {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (pointInPolygon(wx, wy, zones[i].points)) return zones[i];
  }
  return null;
}
