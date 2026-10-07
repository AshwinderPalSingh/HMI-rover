/**
 * Interactive 2D map. Canvas rendering is driven by a dirty flag + rAF: the
 * view redraws only when something visible changed (robot moved, new scan,
 * pan/zoom, store update), so an idle console costs ~0 CPU.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Crosshair,
  Expand,
  Hand,
  Layers,
  LocateFixed,
  Map as MapIcon,
  MapPinPlus,
  Minus,
  Navigation,
  OctagonX,
  Plus,
  Satellite,
  ShieldOff,
  Trash2,
  Pencil,
  Ban,
  X,
} from 'lucide-react';
import { distance, isSimplePolygon, poseChanged, transformToPose2D, type Point2, type Pose2D } from '../lib/math';
import { fmtNum } from '../lib/format';
import { live, liveChanged } from '../state/live';
import { app, useApp, type Tool } from '../state/store';
import { avoidLabel, navigateTo, removeZone, setInitialPose, deleteLabel } from '../ros/app';
import { setToolKeyHandler } from '../hooks/keyboard';
import { IconButton, Kbd } from '../components/ui';
import { hitLabel, hitZone, renderScene, type Draft } from './renderer';
import { fitBounds, niceScale, panBy, screenToWorld, worldToScreen, zoomAt, type Size, type View } from './viewport';

type Role = 'primary' | 'pip';

const savedViews: Record<Role, View | null> = { primary: null, pip: null };

const TOOLS: { tool: Tool; icon: typeof Hand; label: string; key: string }[] = [
  { tool: 'pan', icon: Hand, label: 'Select & pan', key: 'V' },
  { tool: 'goal', icon: Navigation, label: 'Send navigation goal', key: 'G' },
  { tool: 'pose', icon: LocateFixed, label: 'Set pose estimate (AMCL)', key: 'P' },
  { tool: 'label', icon: MapPinPlus, label: 'Place label', key: 'L' },
  { tool: 'zone', icon: ShieldOff, label: 'Draw keep-out zone', key: 'K' },
];

const HINTS: Record<Tool, string | null> = {
  pan: null,
  goal: 'Click to send a goal · drag to set the arrival heading',
  pose: 'Click where the robot is · drag to set its heading',
  label: 'Click the map to place a label',
  zone: 'Click to add corners · click the first corner or press Enter to finish · Backspace undo · Esc cancel',
};

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; view: View; moved: boolean; button: number }
  | { kind: 'pinch'; dist: number; mid: Point2; view: View }
  | { kind: 'arrow'; tool: 'goal' | 'pose'; from: Point2; sx: number; sy: number }
  | null;

const ACTIVE_NAV = new Set(['pending', 'active', 'canceling']);

function robotInFixedFrame(): { pose: Pose2D; stale: boolean } | null {
  const s = app();
  const f = s.settings.frames;
  const fixed = live.map?.frame ?? (live.tf.lookup(f.map, f.base) ? f.map : f.odom);
  const res = live.tf.lookup(fixed, f.base);
  if (!res) return null;
  return { pose: transformToPose2D(res.tf), stale: res.age > 1500 || s.link.state !== 'connected' };
}

export function MapView({ role }: { role: Role }) {
  const compact = role === 'pip';
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordsRef = useRef<HTMLSpanElement>(null);
  const viewRef = useRef<View>(savedViews[role] ?? { cx: 0, cy: 0, ppm: compact ? 14 : 28 });
  const sizeRef = useRef<Size>({ w: 1, h: 1 });
  const dprRef = useRef(1);
  const draftRef = useRef<Draft>(null);
  const zonePtsRef = useRef<Point2[]>([]);
  const hoverRef = useRef<string | null>(null);
  const gestureRef = useRef<Gesture>(null);
  const pointersRef = useRef(new Map<number, Point2>());
  const dirtyRef = useRef(true);
  const rafRef = useRef(0);
  const fittedRef = useRef(savedViews[role] !== null);
  /** the operator moved the view; never auto-fit after that */
  const userMovedRef = useRef(savedViews[role] !== null);
  const mapFittedRef = useRef(savedViews[role] !== null);
  const lastRobotRef = useRef<Pose2D | null>(null);
  const lastOverlayRef = useRef(0);
  const [viewTick, setViewTick] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  const [zoneCount, setZoneCount] = useState(0);

  const tool = useApp((s) => (compact ? 'pan' : s.tool));
  const follow = useApp((s) => s.followRobot);
  const hasMap = useApp((s) => s.mapInfo !== null);
  const hasPose = useApp((s) => s.pose !== null);
  const linkState = useApp((s) => s.link.state);
  const layers = useApp((s) => s.settings.layers);
  const selection = useApp((s) => s.selection);
  const labels = useApp((s) => s.labels);
  const zones = useApp((s) => s.zones);
  const localization = useApp((s) => s.localization.mode);

  // ── rendering ──────────────────────────────────────────────────────────

  const bumpOverlay = useCallback((force = false) => {
    const now = performance.now();
    if (force || now - lastOverlayRef.current > 50) {
      lastOverlayRef.current = now;
      setViewTick((t) => t + 1);
    }
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const s = app();
    const robot = robotInFixedFrame();
    if (robot && (compact || s.followRobot)) {
      const v = viewRef.current;
      if (Math.abs(v.cx - robot.pose.x) > 1e-4 || Math.abs(v.cy - robot.pose.y) > 1e-4) {
        viewRef.current = { ...v, cx: robot.pose.x, cy: robot.pose.y };
        if (!compact) bumpOverlay();
      }
    }
    renderScene(ctx, {
      view: viewRef.current,
      size: sizeRef.current,
      dpr: dprRef.current,
      map: live.map,
      robot,
      footprint: s.settings.robot,
      labels: s.labels,
      zones: s.zones,
      selection: compact ? null : s.selection,
      hoverId: compact ? null : hoverRef.current,
      plan: live.plan,
      scan: live.scan,
      target: s.nav.target,
      navActive: ACTIVE_NAV.has(s.nav.phase),
      layers: s.settings.layers,
      draft: compact ? null : draftRef.current,
      compact,
    });
    savedViews[role] = viewRef.current;
  }, [bumpOverlay, compact, role]);

  const requestRender = useCallback(() => {
    dirtyRef.current = true;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      draw();
    });
  }, [draw]);

  const fitToContent = useCallback(() => {
    const m = live.map;
    const size = sizeRef.current;
    if (size.w < 10 || size.h < 10) return false;
    let b = m?.knownBounds ?? (m ? { minX: m.origin.x, minY: m.origin.y, maxX: m.origin.x + m.width * m.resolution, maxY: m.origin.y + m.height * m.resolution } : null);
    const robot = robotInFixedFrame();
    if (robot) {
      const p = robot.pose;
      b = b
        ? { minX: Math.min(b.minX, p.x - 2), minY: Math.min(b.minY, p.y - 2), maxX: Math.max(b.maxX, p.x + 2), maxY: Math.max(b.maxY, p.y + 2) }
        : { minX: p.x - 6, minY: p.y - 6, maxX: p.x + 6, maxY: p.y + 6 };
    }
    if (!b) return false;
    // never zoom in past a ~10 m view: a fresh SLAM map is only a few cells wide
    const MIN_EXTENT = 10;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const hw = Math.max(b.maxX - b.minX, MIN_EXTENT) / 2;
    const hh = Math.max(b.maxY - b.minY, MIN_EXTENT) / 2;
    b = { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
    viewRef.current = fitBounds(b, size, compact ? 12 : 48);
    if (compact) viewRef.current = { ...viewRef.current, ppm: Math.max(viewRef.current.ppm, 10) };
    fittedRef.current = true;
    requestRender();
    bumpOverlay(true);
    return true;
  }, [bumpOverlay, compact, requestRender]);

  // size & DPR
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      sizeRef.current = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      dprRef.current = dpr;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      if (!fittedRef.current) fitToContent();
      requestRender();
      bumpOverlay(true);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [bumpOverlay, fitToContent, requestRender]);

  // live data → redraw
  useEffect(() => {
    const off = liveChanged.on((ch) => {
      if (ch === 'tf') {
        const r = robotInFixedFrame();
        if (poseChanged(lastRobotRef.current, r?.pose ?? null)) {
          lastRobotRef.current = r?.pose ?? null;
          if (!fittedRef.current && r) fitToContent();
          requestRender();
        }
        return;
      }
      // keep framing the map as it arrives / grows (SLAM) until the operator takes over the view
      if (ch === 'map' && !compact && !userMovedRef.current && !app().followRobot && live.map) {
        mapFittedRef.current = true;
        fitToContent();
      } else if (ch === 'map' && !fittedRef.current) fitToContent();
      requestRender();
    });
    return () => {
      off();
    };
  }, [fitToContent, requestRender]);

  // store → redraw
  useEffect(
    () =>
      useApp.subscribe((s, p) => {
        if (
          s.labels !== p.labels ||
          s.zones !== p.zones ||
          s.selection !== p.selection ||
          s.nav !== p.nav ||
          s.settings !== p.settings ||
          s.followRobot !== p.followRobot ||
          s.link.state !== p.link.state
        ) {
          requestRender();
        }
      }),
    [requestRender],
  );

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // tool change clears drafts
  useEffect(() => {
    draftRef.current = null;
    zonePtsRef.current = [];
    setZoneCount(0);
    gestureRef.current = null;
    requestRender();
  }, [tool, requestRender]);

  // ── interaction helpers ────────────────────────────────────────────────

  const local = (e: { clientX: number; clientY: number }): Point2 => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p: Point2) => screenToWorld(viewRef.current, sizeRef.current, p.x, p.y);

  const setView = (v: View) => {
    viewRef.current = v;
    requestRender();
    bumpOverlay();
  };

  const finishZone = useCallback(() => {
    const pts = zonePtsRef.current;
    if (pts.length < 3) {
      app().pushToast({ level: 'warn', title: 'A keep-out zone needs at least 3 corners' });
      return;
    }
    if (!isSimplePolygon(pts)) {
      app().pushToast({ level: 'warn', title: 'Zone edges cross', detail: 'Draw the corners in order around the area.' });
      return;
    }
    app().patch({ zoneDraft: { points: [...pts], reason: '', duration: 'session', ttl: 300, groupId: '' } });
    zonePtsRef.current = [];
    setZoneCount(0);
    draftRef.current = null;
    requestRender();
  }, [requestRender]);

  // keyboard for drafts (primary only)
  useEffect(() => {
    if (compact) return;
    setToolKeyHandler((e) => {
      if (app().tool === 'zone') {
        if (e.key === 'Enter' && zonePtsRef.current.length) {
          finishZone();
          return true;
        }
        if (e.key === 'Backspace' && zonePtsRef.current.length) {
          zonePtsRef.current = zonePtsRef.current.slice(0, -1);
          setZoneCount(zonePtsRef.current.length);
          const d = draftRef.current;
          draftRef.current = d?.kind === 'zone' ? { ...d, points: zonePtsRef.current } : d;
          requestRender();
          return true;
        }
        if (e.key === 'Escape' && zonePtsRef.current.length) {
          zonePtsRef.current = [];
          setZoneCount(0);
          draftRef.current = null;
          requestRender();
          return true;
        }
      }
      if (e.key === 'Escape' && gestureRef.current?.kind === 'arrow') {
        gestureRef.current = null;
        draftRef.current = null;
        requestRender();
        return true;
      }
      return false;
    });
    return () => setToolKeyHandler(null);
  }, [compact, finishZone, requestRender]);

  // ── pointer handling ───────────────────────────────────────────────────

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (compact) return;
    const p = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, p);
    setLayersOpen(false);
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      gestureRef.current = { kind: 'pinch', dist: distance(a, b), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: viewRef.current };
      if (draftRef.current?.kind === 'arrow') draftRef.current = null;
      return;
    }
    if (pointersRef.current.size > 2) return;
    const t = app().tool;
    if ((t === 'goal' || t === 'pose') && e.button === 0) {
      const w = toWorld(p);
      gestureRef.current = { kind: 'arrow', tool: t, from: w, sx: p.x, sy: p.y };
      draftRef.current = { kind: 'arrow', tool: t, from: w, to: null };
      requestRender();
      return;
    }
    gestureRef.current = { kind: 'pan', sx: p.x, sy: p.y, view: viewRef.current, moved: false, button: e.button };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    const w = toWorld(p);
    if (coordsRef.current) coordsRef.current.textContent = `x ${fmtNum(w.x)}  y ${fmtNum(w.y)}`;
    if (compact) return;
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, p);
    const g = gestureRef.current;
    const t = app().tool;

    if (g?.kind === 'pinch' && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const moved = panBy(g.view, mid.x - g.mid.x, mid.y - g.mid.y);
      userMovedRef.current = true;
      setView(zoomAt(moved, sizeRef.current, mid.x, mid.y, distance(a, b) / Math.max(1, g.dist)));
      if (app().followRobot) app().setFollow(false);
      return;
    }
    if (g?.kind === 'pan') {
      const dx = p.x - g.sx;
      const dy = p.y - g.sy;
      if (!g.moved && Math.hypot(dx, dy) > 4) {
        g.moved = true;
        userMovedRef.current = true;
        if (app().followRobot) app().setFollow(false);
      }
      if (g.moved) setView(panBy(g.view, dx, dy));
      return;
    }
    if (g?.kind === 'arrow') {
      draftRef.current = { kind: 'arrow', tool: g.tool, from: g.from, to: w };
      requestRender();
      return;
    }
    // hover (no button pressed)
    if (t === 'pan') {
      const hit = hitLabel(app().labels, viewRef.current, sizeRef.current, p.x, p.y);
      const id = hit?.id ?? null;
      const overZone = !hit && hitZone(app().zones, w.x, w.y);
      e.currentTarget.style.cursor = hit || overZone ? 'pointer' : '';
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        requestRender();
      }
    } else if (t === 'label') {
      draftRef.current = { kind: 'label', at: w, radius: 1.5 };
      requestRender();
    } else if (t === 'zone') {
      const pts = zonePtsRef.current;
      const first = pts.length ? worldToScreen(viewRef.current, sizeRef.current, pts[0].x, pts[0].y) : null;
      const closing = pts.length >= 3 && !!first && distance(first, p) < 12;
      draftRef.current = { kind: 'zone', points: pts, cursor: w, closing };
      requestRender();
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (compact) {
      app().swapViews();
      return;
    }
    const p = local(e);
    pointersRef.current.delete(e.pointerId);
    const g = gestureRef.current;
    if (g?.kind === 'pinch') {
      if (pointersRef.current.size < 2) gestureRef.current = null;
      return;
    }
    gestureRef.current = null;
    if (g?.kind === 'arrow') {
      const to = toWorld(p);
      const dragged = Math.hypot(p.x - g.sx, p.y - g.sy) > 10;
      const yaw = dragged ? Math.atan2(to.y - g.from.y, to.x - g.from.x) : null;
      draftRef.current = null;
      requestRender();
      if (g.tool === 'goal') navigateTo(g.from.x, g.from.y, yaw);
      else setInitialPose(g.from.x, g.from.y, yaw ?? app().pose?.yaw ?? 0);
      return;
    }
    if (g?.kind !== 'pan' || g.moved || g.button !== 0) return;

    // a click
    const w = toWorld(p);
    const t = app().tool;
    if (t === 'pan') {
      const l = hitLabel(app().labels, viewRef.current, sizeRef.current, p.x, p.y);
      if (l) {
        app().patch({ selection: { kind: 'label', id: l.id } });
        return;
      }
      const z = hitZone(app().zones, w.x, w.y);
      app().patch({ selection: z ? { kind: 'zone', id: z.id } : null });
    } else if (t === 'label') {
      app().patch({ labelDraft: { name: '', aliases: '', type: 'house', x: w.x, y: w.y, radius: 1.5 } });
    } else if (t === 'zone') {
      const pts = zonePtsRef.current;
      const first = pts.length ? worldToScreen(viewRef.current, sizeRef.current, pts[0].x, pts[0].y) : null;
      if (pts.length >= 3 && first && distance(first, p) < 12) {
        finishZone();
        return;
      }
      zonePtsRef.current = [...pts, w];
      setZoneCount(zonePtsRef.current.length);
      draftRef.current = { kind: 'zone', points: zonePtsRef.current, cursor: w, closing: false };
      requestRender();
    }
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    gestureRef.current = null;
    if (draftRef.current?.kind === 'arrow') draftRef.current = null;
    requestRender();
  };

  const onPointerLeave = () => {
    if (coordsRef.current) coordsRef.current.textContent = '';
    if (hoverRef.current) {
      hoverRef.current = null;
      requestRender();
    }
    if (draftRef.current?.kind === 'label') {
      draftRef.current = null;
      requestRender();
    }
  };

  // wheel zoom (non-passive so we can prevent page scroll)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || compact) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const factor = Math.exp(-e.deltaY * unit * 0.0016);
      const following = app().followRobot;
      const sx = following ? sizeRef.current.w / 2 : e.clientX - r.left;
      const sy = following ? sizeRef.current.h / 2 : e.clientY - r.top;
      viewRef.current = zoomAt(viewRef.current, sizeRef.current, sx, sy, factor);
      userMovedRef.current = true;
      requestRender();
      bumpOverlay();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [bumpOverlay, compact, requestRender]);

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (compact) return;
    const t = app().tool;
    if (t === 'zone') {
      // the two clicks already added a duplicate corner
      const pts = zonePtsRef.current;
      if (pts.length >= 2 && distance(pts[pts.length - 1], pts[pts.length - 2]) < 1e-6) zonePtsRef.current = pts.slice(0, -1);
      finishZone();
    } else if (t === 'pan') {
      const p = local(e);
      setView(zoomAt(viewRef.current, sizeRef.current, p.x, p.y, 2));
    }
  };

  // ── public controls ────────────────────────────────────────────────────

  const zoomBy = (f: number) => {
    userMovedRef.current = true;
    setView(zoomAt(viewRef.current, sizeRef.current, sizeRef.current.w / 2, sizeRef.current.h / 2, f));
  };

  // expose fit/zoom to global shortcuts
  useEffect(() => {
    if (compact) return;
    const onCmd = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail;
      if (cmd === 'fit') fitToContent();
      else if (cmd === 'zoom-in') zoomBy(1.4);
      else if (cmd === 'zoom-out') zoomBy(1 / 1.4);
      else if (cmd.startsWith('focus:')) {
        const [, xs, ys] = cmd.split(':');
        setView({ ...viewRef.current, cx: Number(xs), cy: Number(ys), ppm: Math.max(viewRef.current.ppm, 40) });
        app().setFollow(false);
      }
    };
    window.addEventListener('map-command', onCmd);
    return () => window.removeEventListener('map-command', onCmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, fitToContent]);

  // ── overlays ───────────────────────────────────────────────────────────

  const scale = useMemo(() => niceScale(viewRef.current.ppm, 90), [viewTick]);

  const popover = useMemo(() => {
    if (compact || !selection) return null;
    const size = sizeRef.current;
    if (selection.kind === 'label') {
      const l = labels.find((x) => x.id === selection.id);
      if (!l) return null;
      const c = worldToScreen(viewRef.current, size, l.x, l.y);
      return { kind: 'label' as const, label: l, x: c.x, y: c.y };
    }
    const z = zones.find((x) => x.id === selection.id);
    if (!z) return null;
    const xs = z.points.map((q) => worldToScreen(viewRef.current, size, q.x, q.y));
    return { kind: 'zone' as const, zone: z, x: xs.reduce((a, b) => a + b.x, 0) / xs.length, y: Math.min(...xs.map((q) => q.y)) };
  }, [compact, selection, labels, zones, viewTick]);

  if (compact) {
    return (
      <div ref={wrapRef} className="mapview mapview--pip">
        <canvas ref={canvasRef} onPointerUp={onPointerUp} aria-label="Map overview — click to enlarge" role="button" />
        {!hasMap && !hasPose && <div className="pip-empty">No map yet</div>}
      </div>
    );
  }

  const cursorClass = tool === 'pan' ? 'is-pan' : 'is-crosshair';
  const amclOnly = localization === 'slam';

  return (
    <div ref={wrapRef} className={`mapview ${cursorClass}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Robot map. Use the tool palette to send goals, place labels or draw keep-out zones."
      />

      <div className="map-tools" role="toolbar" aria-label="Map tools" aria-orientation="vertical">
        {TOOLS.map((t) => (
          <IconButton
            key={t.tool}
            icon={t.icon}
            label={t.label + (t.tool === 'pose' && amclOnly ? ' — not used while SLAM is running' : '')}
            shortcut={t.key}
            active={tool === t.tool}
            tipSide="right"
            onClick={() => app().setTool(t.tool)}
          />
        ))}
      </div>

      {HINTS[tool] && (
        <div className="map-hint" role="status">
          <span>{HINTS[tool]}</span>
          {tool === 'zone' && zoneCount > 0 && <span className="map-hint__count">{zoneCount} corner{zoneCount === 1 ? '' : 's'}</span>}
          <button type="button" className="map-hint__close" onClick={() => app().setTool('pan')} aria-label="Exit tool">
            <Kbd>Esc</Kbd>
          </button>
        </div>
      )}

      <div className="map-controls">
        <div className="map-controls__group">
          <IconButton icon={Plus} label="Zoom in" shortcut="+" tipSide="left" onClick={() => zoomBy(1.4)} />
          <IconButton icon={Minus} label="Zoom out" shortcut="−" tipSide="left" onClick={() => zoomBy(1 / 1.4)} />
        </div>
        <div className="map-controls__group">
          <IconButton icon={Expand} label="Fit map" shortcut="0" tipSide="left" onClick={() => fitToContent()} />
          <IconButton
            icon={Crosshair}
            label={follow ? 'Stop following robot' : 'Follow robot'}
            shortcut="F"
            tipSide="left"
            active={follow}
            disabled={!hasPose}
            onClick={() => {
              app().setFollow(!follow);
              requestRender();
            }}
          />
          <IconButton icon={Layers} label="Layers" tipSide="left" active={layersOpen} onClick={() => setLayersOpen((o) => !o)} />
        </div>
        {layersOpen && (
          <div className="layers-pop" role="group" aria-label="Map layers">
            {(
              [
                ['labels', 'Labels'],
                ['zones', 'Keep-out zones'],
                ['path', 'Planned path'],
                ['laser', 'Laser scan'],
                ['grid', 'Grid'],
              ] as const
            ).map(([k, name]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={layers[k]} onChange={(e) => app().updateSettings({ layers: { [k]: e.target.checked } })} />
                <span>{name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="map-readout" aria-hidden>
        <div className="scalebar">
          <span className="scalebar__bar" style={{ width: `${scale.px}px` }} />
          <span className="scalebar__label">{scale.label}</span>
        </div>
        <span ref={coordsRef} className="map-readout__coords" />
      </div>

      {!hasMap && !hasPose && (
        <div className="map-empty">
          {linkState === 'connected' ? <Satellite size={22} aria-hidden /> : <MapIcon size={22} aria-hidden />}
          <p>{linkState === 'connected' ? 'Waiting for map and robot pose…' : 'Not connected to the robot'}</p>
          <span>{linkState === 'connected' ? 'Start SLAM or the map server; the map appears as soon as /map is published.' : 'The map will appear once the link is up.'}</span>
        </div>
      )}

      {popover?.kind === 'label' && (
        <div className="popover" style={{ left: clampX(popover.x + 18), top: clampY(popover.y - 12) }} role="dialog" aria-label={`Label ${popover.label.name}`}>
          <header>
            <strong>{popover.label.name}</strong>
            <button type="button" className="popover__x" aria-label="Close" onClick={() => app().patch({ selection: null })}>
              <X size={14} />
            </button>
          </header>
          <p className="popover__meta">
            {popover.label.type} · ({fmtNum(popover.label.x)}, {fmtNum(popover.label.y)}) · r {fmtNum(popover.label.radius, 1)} m
          </p>
          {popover.label.aliases.length > 0 && <p className="popover__aliases">aka {popover.label.aliases.join(', ')}</p>}
          <div className="popover__actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => navigateTo(popover.label.x, popover.label.y, null, popover.label.name)}>
              <Navigation size={14} /> Go here
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void avoidLabel(popover.label)}>
              <Ban size={14} /> Avoid
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-label="Edit label"
              onClick={() => {
                const l = popover.label;
                app().patch({ labelDraft: { id: l.id, name: l.name, aliases: l.aliases.join(', '), type: l.type, x: l.x, y: l.y, radius: l.radius } });
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="btn btn--danger-ghost btn--sm"
              aria-label="Delete label"
              onClick={() => {
                const l = popover.label;
                app().patch({
                  confirm: {
                    title: `Delete "${l.name}"?`,
                    body: 'The label is removed from the label database. Voice commands will no longer resolve to it.',
                    confirmLabel: 'Delete label',
                    danger: true,
                    onConfirm: () => void deleteLabel(l),
                  },
                });
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}

      {popover?.kind === 'zone' && (
        <div className="popover" style={{ left: clampX(popover.x - 120), top: clampY(popover.y - 96) }} role="dialog" aria-label="Keep-out zone">
          <header>
            <OctagonX size={15} className="tone-critical" aria-hidden />
            <strong>{popover.zone.reason || 'Keep-out zone'}</strong>
            <button type="button" className="popover__x" aria-label="Close" onClick={() => app().patch({ selection: null })}>
              <X size={14} />
            </button>
          </header>
          <p className="popover__meta">
            {popover.zone.duration.replace('_', '-')}
            {popover.zone.duration === 'one_shot' && popover.zone.ttl > 0 ? ` · ${Math.round(popover.zone.ttl)} s TTL` : ''} · {popover.zone.points.length} corners
          </p>
          <div className="popover__actions">
            <button type="button" className="btn btn--danger btn--sm" onClick={() => void removeZone(popover.zone)}>
              <Trash2 size={14} /> Remove zone
            </button>
          </div>
        </div>
      )}
    </div>
  );

  function clampX(x: number) {
    return Math.max(8, Math.min(sizeRef.current.w - 268, x));
  }
  function clampY(y: number) {
    return Math.max(8, Math.min(sizeRef.current.h - 150, y));
  }
}
