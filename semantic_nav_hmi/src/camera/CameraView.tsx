/**
 * Camera feed from a sensor_msgs/CompressedImage topic.
 *
 * Pipeline: rosbridge (CBOR, queue_length 1, throttled) → Blob → createImageBitmap
 * (decoded off the main thread) → canvas. At most one decode is in flight; a
 * newer frame replaces any waiting one, so latency never accumulates.
 * The subscription rate drops when the feed is only shown picture-in-picture.
 *
 * In simulation the feed comes from an orbit camera (see useOrbit) and the main view
 * is navigable like the Gazebo GUI: drag to pan, Shift/middle-drag to orbit,
 * right-drag or scroll to zoom toward the pointer, double-click to reset.
 * Any other camera can still be zoomed digitally (wheel, pinch, buttons, +/−) and
 * dragged around while zoomed.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Compass, LocateFixed, Minus, Plus, RotateCcw, RotateCw, Scan, Video, VideoOff, X } from 'lucide-react';
import { IconButton } from '../components/ui';
import { bridge } from '../ros/app';
import { NAMES, TYPES } from '../ros/names';
import type { CompressedImage } from '../ros/types';
import { useApp } from '../state/store';
import { lerpView, orbitView, panView, sameView, wrapAngle, zoomView, type OrbitView, type Pt } from './orbit';
import { Picture } from './picture';
import { stampSec, useOrbit, type Orbit } from './useOrbit';

type Role = 'primary' | 'pip';

const NO_SIGNAL_MS = 3000;
const ZOOM_MAX = 6;
/** One button press / key press of orbit. */
const ORBIT_STEP = Math.PI / 8;
/** Button and key steps glide there rather than jump. */
const STEP_MS = 260;
const HINT_KEY = 'hint.orbit.dismissed';

function toBytes(data: CompressedImage['data']): Uint8Array<ArrayBuffer> | null {
  if (data instanceof Uint8Array) {
    // copy into a plain ArrayBuffer-backed view for Blob
    const out = new Uint8Array(data.byteLength);
    out.set(data);
    return out;
  }
  if (typeof data === 'string') {
    try {
      const bin = atob(data);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  }
  if (Array.isArray(data)) return Uint8Array.from(data);
  return null;
}

/** Digital zoom state: factor and the visible window's centre in normalised image coordinates. */
interface Zoom {
  z: number;
  cx: number;
  cy: number;
}

function clampZoom(zm: Zoom): Zoom {
  const z = Math.min(ZOOM_MAX, Math.max(1, zm.z));
  const half = 0.5 / z;
  return {
    z,
    cx: Math.min(1 - half, Math.max(half, zm.cx)),
    cy: Math.min(1 - half, Math.max(half, zm.cy)),
  };
}

type Gesture =
  // orbit camera
  | { kind: 'pan'; from: Pt; v0: OrbitView }
  | { kind: 'orbit'; x: number; y: number; v0: OrbitView }
  | { kind: 'dolly'; at: Pt; y: number; v0: OrbitView }
  | { kind: 'touch'; mid: Pt; y: number; dist: number; angle: number; v0: OrbitView }
  // digital zoom
  | { kind: 'zpan'; x: number; y: number; zm: Zoom }
  | { kind: 'pinch'; d: number; zm: Zoom };

/** Re-project a frame only across a modest view change; a reset just waits for new frames. */
function warpable(frame: OrbitView, now: OrbitView): boolean {
  if (frame.follow_heading !== now.follow_heading || sameView(frame, now, 1e-6)) return false;
  const ratio = now.distance / frame.distance;
  const moved = Math.hypot(now.offset.x - frame.offset.x, now.offset.y - frame.offset.y, now.offset.z - frame.offset.z);
  return (
    Math.abs(wrapAngle(now.azimuth - frame.azimuth)) < 1.6 &&
    Math.abs(now.elevation - frame.elevation) < 1 &&
    ratio > 0.25 &&
    ratio < 4 &&
    moved < Math.max(8, 3 * frame.distance)
  );
}

function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function CameraView({ role }: { role: Role }) {
  const compact = role === 'pip';
  const topic = useApp((s) => s.settings.topics.camera);
  const linkState = useApp((s) => s.link.state);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'waiting' | 'live' | 'lost'>('waiting');
  const [info, setInfo] = useState<{ fps: number; w: number; h: number } | null>(null);
  const stats = useRef({ last: 0, fpsEma: 0, frames: 0 });

  const zoomRef = useRef<Zoom>({ z: 1, cx: 0.5, cy: 0.5 });
  const [zoomLevel, setZoomLevel] = useState(1);
  const lastBmp = useRef<ImageBitmap | null>(null);
  /** Where the full image is drawn (CSS px, letterboxed) — for pointer math */
  const frameRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  /** WebGL renderer; null → 2D canvas fallback */
  const pic = useRef<Picture | null>(null);
  const [noGl, setNoGl] = useState(false);
  /** the view the frame on screen was rendered from (orbit camera) */
  const frameView = useRef<OrbitView | null>(null);
  /** fill the stage like a 3D viewport (orbit camera) instead of showing the whole frame */
  const cover = useRef(false);
  /** assigned on every render, before any handler can run (the hook needs `paint`, `paint` needs it) */
  const orbitRef = useRef<Orbit>(null as unknown as Orbit);
  const [gestureKind, setGestureKind] = useState<Gesture['kind'] | null>(null);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [hintDismissed, setHintDismissed] = useState(readHintDismissed);

  const paint = useCallback(() => {
    const bmp = lastBmp.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!bmp || !canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = wrap.getBoundingClientRect();
    const cw = Math.max(1, Math.round(r.width * dpr));
    const ch = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    if (pic.current) {
      // the operator's view right now, and the one this frame was rendered from
      const now = cover.current ? orbitRef.current.view() : null;
      const fv = frameView.current;
      const rect = pic.current.draw(cw, ch, {
        cover: cover.current,
        zoom: zoomRef.current,
        warp: now && fv && warpable(fv, now) ? { frame: fv, now, robot: orbitRef.current.robot() } : null,
      });
      if (rect) frameRect.current = { x: rect.x / dpr, y: rect.y / dpr, w: rect.w / dpr, h: rect.h / dpr };
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // contain-fit with letterboxing (cover-fit for the 3D view); zoom selects a sub-window of the source
    const scale = (cover.current ? Math.max : Math.min)(cw / bmp.width, ch / bmp.height);
    const dw = bmp.width * scale;
    const dh = bmp.height * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    const { z, cx, cy } = zoomRef.current;
    const sw = bmp.width / z;
    const sh = bmp.height / z;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, cx * bmp.width - sw / 2, cy * bmp.height - sh / 2, sw, sh, dx, dy, dw, dh);
    frameRect.current = { x: dx / dpr, y: dy / dpr, w: dw / dpr, h: dh / dpr };
  }, []);

  /** Repaint on the next animation frame (view changes come faster than frames). */
  const raf = useRef(0);
  const requestPaint = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      paint();
    });
  }, [paint]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const orbit = useOrbit(!compact && topic === NAMES.viewerImage, requestPaint);
  orbitRef.current = orbit;
  cover.current = orbit.available;

  // WebGL when the browser has it; a canvas that refuses it falls back to 2D
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || noGl) return;
    const p = Picture.create(canvas);
    if (!p && !canvas.getContext('2d')) {
      setNoGl(true); // context taken but unusable: start over on a fresh canvas
      return;
    }
    pic.current = p;
    if (p && lastBmp.current) {
      p.upload(lastBmp.current);
      paint();
    }
    return () => {
      p?.dispose();
      pic.current = null;
    };
  }, [noGl, paint]);

  const setZoom = useCallback(
    (zm: Zoom) => {
      zoomRef.current = clampZoom(zm);
      setZoomLevel(zoomRef.current.z);
      paint();
    },
    [paint],
  );

  /** Digital zoom by `factor` keeping the image point under (px, py) — canvas CSS px — in place. */
  const zoomAt = useCallback(
    (factor: number, px?: number, py?: number) => {
      const zm = zoomRef.current;
      const fr = frameRect.current;
      let u = 0.5;
      let v = 0.5;
      if (fr && px !== undefined && py !== undefined && fr.w > 0 && fr.h > 0) {
        u = Math.min(1, Math.max(0, (px - fr.x) / fr.w));
        v = Math.min(1, Math.max(0, (py - fr.y) / fr.h));
      }
      // image point under the cursor (normalised)
      const ix = zm.cx + (u - 0.5) / zm.z;
      const iy = zm.cy + (v - 0.5) / zm.z;
      const z = Math.min(ZOOM_MAX, Math.max(1, zm.z * factor));
      setZoom({ z, cx: ix - (u - 0.5) / z, cy: iy - (v - 0.5) / z });
    },
    [setZoom],
  );

  const resetZoom = useCallback(() => setZoom({ z: 1, cx: 0.5, cy: 0.5 }), [setZoom]);

  useEffect(() => {
    let decoding = false;
    let pending: CompressedImage | null = null;
    let disposed = false;

    // New topic (or role): forget the previous stream entirely
    stats.current = { last: 0, fpsEma: 0, frames: 0 };
    setStatus('waiting');
    setInfo(null);
    lastBmp.current?.close();
    lastBmp.current = null;
    frameView.current = null;
    zoomRef.current = { z: 1, cx: 0.5, cy: 0.5 };
    setZoomLevel(1);
    const c0 = canvasRef.current;
    if (pic.current) pic.current.clear();
    else c0?.getContext('2d')?.clearRect(0, 0, c0.width, c0.height);

    const decode = async (msg: CompressedImage) => {
      decoding = true;
      try {
        const bytes = toBytes(msg.data);
        if (bytes && bytes.length) {
          const mime = /png/i.test(msg.format) ? 'image/png' : 'image/jpeg';
          const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
          if (disposed) {
            bmp.close();
          } else {
            pic.current?.upload(bmp);
            lastBmp.current?.close();
            lastBmp.current = bmp; // kept so zoom/pan can repaint without a new frame
            const o = orbitRef.current;
            frameView.current = o.available && msg.header?.stamp ? o.viewAt(stampSec(msg.header.stamp)) : null;
            paint();
          }
          const now = performance.now();
          const st = stats.current;
          if (st.last) {
            const inst = 1000 / Math.max(1, now - st.last);
            st.fpsEma = st.fpsEma ? st.fpsEma * 0.85 + inst * 0.15 : inst;
          }
          st.last = now;
          st.frames++;
        }
      } catch {
        /* corrupt frame: skip */
      } finally {
        decoding = false;
        if (pending && !disposed) {
          const next = pending;
          pending = null;
          void decode(next);
        }
      }
    };

    const off = bridge.subscribe<CompressedImage>(
      topic,
      TYPES.image,
      (msg) => {
        if (decoding) pending = msg;
        else void decode(msg);
      },
      { compression: 'cbor', throttleMs: compact ? 250 : 30, queueLength: 1 },
    );

    const ui = setInterval(() => {
      const st = stats.current;
      const age = st.last ? performance.now() - st.last : Infinity;
      const b = lastBmp.current;
      setStatus(st.frames === 0 ? 'waiting' : age > NO_SIGNAL_MS ? 'lost' : 'live');
      setInfo(st.frames && b ? { fps: age > NO_SIGNAL_MS ? 0 : st.fpsEma, w: b.width, h: b.height } : null);
    }, 500);

    return () => {
      disposed = true;
      off();
      clearInterval(ui);
      lastBmp.current?.close();
      lastBmp.current = null;
    };
  }, [topic, compact, paint]);

  // ── navigation (main view only) ──────────────────────────────────────
  const orbitMode = orbit.available;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** CSS px → normalised image point (may lie outside 0..1 over the letterbox) */
  const toImage = (p: { x: number; y: number }): Pt | null => {
    const fr = frameRect.current;
    return fr && fr.w > 0 && fr.h > 0 ? { x: (p.x - fr.x) / fr.w, y: (p.y - fr.y) / fr.h } : null;
  };
  const aspect = () => {
    const b = lastBmp.current;
    return b ? b.width / b.height : 16 / 9;
  };

  const dismissHint = useCallback(() => {
    setHintDismissed(true);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* private mode: show it again next time */
    }
  }, []);

  /** A running glide (button / key steps); any direct manipulation cancels it. */
  const glide = useRef<{ from: OrbitView; to: OrbitView; t0: number; raf: number } | null>(null);
  const stopGlide = useCallback(() => {
    if (glide.current) cancelAnimationFrame(glide.current.raf);
    glide.current = null;
  }, []);
  useEffect(() => stopGlide, [stopGlide]);
  const glideTo = useCallback(
    (to: OrbitView) => {
      const o = orbitRef.current;
      const from = o.view();
      if (!from) return;
      // chained presses continue from where the previous glide was heading
      const start = glide.current ? glide.current.to : from;
      stopGlide();
      const target = { ...to, azimuth: start.azimuth + wrapAngle(to.azimuth - start.azimuth) };
      const g = { from, to: target, t0: performance.now(), raf: 0 };
      const step = () => {
        const k = Math.min(1, (performance.now() - g.t0) / STEP_MS);
        o.set(lerpView(g.from, g.to, 1 - Math.pow(1 - k, 3)));
        if (k < 1) g.raf = requestAnimationFrame(step);
        else if (glide.current === g) glide.current = null;
      };
      glide.current = g;
      step();
    },
    [stopGlide],
  );

  /** Orbit-camera zoom by `factor` toward the pointer (canvas CSS px); a glide toward the centre without one. */
  const orbitZoom = useCallback(
    (factor: number, p?: { x: number; y: number }) => {
      const o = orbitRef.current;
      const v = glide.current?.to ?? o.view();
      if (!v) return;
      const b = lastBmp.current;
      const aspect = b ? b.width / b.height : 16 / 9;
      if (!p) {
        glideTo(zoomView(v, factor, null, aspect));
        return;
      }
      stopGlide();
      const fr = frameRect.current;
      const at = fr && fr.w > 0 ? { x: (p.x - fr.x) / fr.w, y: (p.y - fr.y) / fr.h } : null;
      o.set(zoomView(o.view()!, factor, at, aspect));
    },
    [glideTo, stopGlide],
  );

  const orbitBy = useCallback(
    (dAz: number, dEl = 0) => {
      const v = glide.current?.to ?? orbitRef.current.view();
      if (v) glideTo(orbitView(v, dAz, dEl));
    },
    [glideTo],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || compact) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (orbitRef.current.available) {
        // trackpad pinch arrives as ctrl+wheel with small deltas
        orbitZoom(Math.exp(e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)), p);
      } else {
        zoomAt(Math.exp(-e.deltaY * unit * 0.0018), p.x, p.y);
      }
    };
    const onCmd = (ev: Event) => {
      const cmd = (ev as CustomEvent<string>).detail;
      const o = orbitRef.current;
      if (o.available) {
        if (cmd === 'zoom-in') orbitZoom(1 / 1.3);
        else if (cmd === 'zoom-out') orbitZoom(1.3);
        else if (cmd === 'reset') {
          stopGlide();
          o.reset();
        }
        else if (cmd === 'rotate-left') orbitBy(-ORBIT_STEP);
        else if (cmd === 'rotate-right') orbitBy(ORBIT_STEP);
        return;
      }
      if (cmd === 'zoom-in') zoomAt(1.4);
      else if (cmd === 'zoom-out') zoomAt(1 / 1.4);
      else if (cmd === 'reset') resetZoom();
    };
    const ro = new ResizeObserver(() => paint());
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('camera-command', onCmd);
    ro.observe(wrapRef.current!);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('camera-command', onCmd);
      ro.disconnect();
    };
  }, [compact, paint, resetZoom, zoomAt, orbitZoom, orbitBy, stopGlide]);

  const startGesture = (g: Gesture | null) => {
    if (g) stopGlide();
    gesture.current = g;
    setGestureKind(g ? g.kind : null);
    const fr = frameRect.current;
    // the orbit pivot (the target) is always at the centre of the picture
    setFocus(g && (g.kind === 'orbit' || g.kind === 'dolly' || g.kind === 'touch') && fr ? { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 } : null);
  };

  const twoFinger = () => {
    const [a, b] = [...pointers.current.values()];
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (compact) return;
    if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const v0 = orbitRef.current.view();

    if (orbitMode && v0) {
      if (pts.length === 2) {
        const t = twoFinger();
        const mid = toImage(t.mid);
        if (mid) startGesture({ kind: 'touch', mid, y: t.mid.y, dist: t.dist, angle: t.angle, v0 });
      } else if (pts.length === 1) {
        const at = toImage(pts[0]);
        if (!at) return;
        if (e.button === 1 || (e.button === 0 && (e.shiftKey || e.ctrlKey))) {
          startGesture({ kind: 'orbit', x: pts[0].x, y: pts[0].y, v0 });
        } else if (e.button === 2) {
          startGesture({ kind: 'dolly', at, y: pts[0].y, v0 });
        } else if (e.button === 0) {
          startGesture({ kind: 'pan', from: at, v0 });
        }
      }
      return;
    }

    if (pts.length === 2) {
      startGesture({ kind: 'pinch', d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zm: zoomRef.current });
    } else if (pts.length === 1 && e.button === 0) {
      startGesture({ kind: 'zpan', x: pts[0].x, y: pts[0].y, zm: zoomRef.current });
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (compact || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    const fr = frameRect.current;
    if (!g || !fr) return;
    const pts = [...pointers.current.values()];
    const o = orbitRef.current;

    switch (g.kind) {
      case 'pan': {
        const to = toImage(pts[0]);
        const v = to && panView(g.v0, g.from, to, aspect());
        if (v) o.set(v);
        break;
      }
      case 'orbit': {
        // full width ≈ one turn, full height ≈ half a turn; the scene turns with the hand
        const p = pts[0];
        o.set(orbitView(g.v0, (-(p.x - g.x) / fr.w) * 2 * Math.PI, ((p.y - g.y) / fr.h) * Math.PI));
        break;
      }
      case 'dolly':
        // drag up to move in, down to move out
        o.set(zoomView(g.v0, Math.exp((pts[0].y - g.y) * 0.006), g.at, aspect()));
        break;
      case 'touch': {
        if (pts.length < 2) break;
        const t = twoFinger();
        // pinch zooms toward the fingers, twist turns the view, sliding both fingers tilts it
        const v = zoomView(g.v0, g.dist / Math.max(1, t.dist), g.mid, aspect());
        o.set(orbitView(v, t.angle - g.angle, ((t.mid.y - g.y) / fr.h) * Math.PI));
        break;
      }
      case 'pinch': {
        if (pts.length < 2) break;
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        zoomRef.current = g.zm;
        zoomAt(d / Math.max(1, g.d), mid.x, mid.y);
        break;
      }
      case 'zpan':
        if (g.zm.z > 1) {
          const p = pts[0];
          setZoom({ z: g.zm.z, cx: g.zm.cx - (p.x - g.x) / fr.w / g.zm.z, cy: g.zm.cy - (p.y - g.y) / fr.h / g.zm.z });
        }
        break;
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) {
      // found the less obvious controls: the tip has done its job
      if (g && (g.kind === 'orbit' || g.kind === 'touch')) dismissHint();
      startGesture(null);
    } else if (g?.kind === 'touch' && pointers.current.size === 1) {
      // lifted one finger: carry on panning with the other
      const v0 = orbitRef.current.view();
      const at = toImage([...pointers.current.values()][0]);
      startGesture(v0 && at ? { kind: 'pan', from: at, v0 } : null);
    }
  };

  // the orbit camera takes over from digital zoom as soon as it reports in (and changes the fit)
  useEffect(() => {
    resetZoom();
  }, [orbitMode, resetZoom]);

  const onDoubleClick = () => {
    if (compact) return;
    if (orbitMode) {
      stopGlide();
      orbit.reset();
    } else resetZoom();
  };

  const showOverlay = status !== 'live';
  const zoomed = zoomLevel > 1.001;
  const navClass = compact ? '' : orbitMode ? `is-3d${gestureKind ? ` is-${gestureKind}` : ''}` : zoomed ? 'is-zoomed' : 'is-zoomable';
  return (
    <div ref={wrapRef} className={`cameraview ${compact ? 'cameraview--pip' : ''} ${navClass}`}>
      <canvas
        key={noGl ? '2d' : 'gl'}
        ref={canvasRef}
        aria-label={
          compact
            ? 'Robot camera feed'
            : orbitMode
              ? '3D view — drag to pan, Shift-drag or middle-drag to orbit, scroll or right-drag to zoom, double-click to reset'
              : 'Robot camera feed — scroll to zoom, drag to look around, double-click to reset'
        }
        role="img"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => orbitMode && e.preventDefault()}
        onAuxClick={(e) => e.preventDefault()}
      />
      {focus && <span className="orbit-focus" style={{ left: focus.x, top: focus.y }} aria-hidden />}
      {!compact && status === 'live' && info && (
        <div className="cam-badge" aria-live="off">
          <span className="cam-badge__dot" aria-hidden />
          <span>{orbitMode ? '3D view' : 'Live'}</span>
          <span className="cam-badge__meta">
            {info.w}×{info.h} · {info.fps.toFixed(0)} fps{!orbitMode && zoomed ? ` · ${zoomLevel.toFixed(1)}×` : ''}
          </span>
        </div>
      )}
      {!compact && status === 'live' && orbitMode && !hintDismissed && (
        <div className="map-hint cam-hint" role="note">
          <span>
            <b>Drag</b> to pan · <b>Shift-drag</b> to orbit · <b>Scroll</b> to zoom · <b>Double-click</b> to reset
          </span>
          <button type="button" className="map-hint__close icon-btn icon-btn--sm" onClick={dismissHint} aria-label="Dismiss tip">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
      {!compact && status === 'live' && orbitMode && (
        <div className="cam-controls" role="group" aria-label="3D view">
          <IconButton icon={Plus} label="Zoom in" shortcut="+" tipSide="left" onClick={() => orbitZoom(1 / 1.3)} />
          <IconButton icon={Minus} label="Zoom out" shortcut="−" tipSide="left" onClick={() => orbitZoom(1.3)} />
          <span className="cam-controls__sep" aria-hidden />
          <IconButton icon={RotateCcw} label="Orbit left" shortcut="Q" tipSide="left" onClick={() => orbitBy(-ORBIT_STEP)} />
          <IconButton icon={RotateCw} label="Orbit right" shortcut="E" tipSide="left" onClick={() => orbitBy(ORBIT_STEP)} />
          <IconButton
            icon={Compass}
            label={orbit.followHeading ? 'Turning with the robot — click to keep the view world-fixed' : 'World-fixed — click to turn with the robot'}
            active={orbit.followHeading}
            tipSide="left"
            onClick={() => {
              stopGlide();
              orbit.toggleFollowHeading();
            }}
          />
          <span className="cam-controls__sep" aria-hidden />
          <IconButton
            icon={LocateFixed}
            label="Reset view"
            shortcut="0"
            tipSide="left"
            onClick={() => {
              stopGlide();
              orbit.reset();
            }}
          />
        </div>
      )}
      {!compact && status === 'live' && !orbitMode && (
        <div className="cam-controls" role="group" aria-label="Camera zoom">
          <IconButton icon={Plus} label="Zoom in" shortcut="+" tipSide="left" onClick={() => zoomAt(1.4)} />
          <IconButton icon={Minus} label="Zoom out" shortcut="−" tipSide="left" disabled={!zoomed} onClick={() => zoomAt(1 / 1.4)} />
          <IconButton icon={Scan} label="Reset zoom" shortcut="0" tipSide="left" disabled={!zoomed} onClick={resetZoom} />
        </div>
      )}
      {showOverlay && (
        <div className={`cam-empty ${compact ? 'cam-empty--pip' : ''}`}>
          {status === 'lost' ? <VideoOff size={compact ? 16 : 24} aria-hidden /> : <Video size={compact ? 16 : 24} aria-hidden />}
          <p>{linkState !== 'connected' ? 'Camera offline' : status === 'lost' ? 'Camera signal lost' : 'Waiting for camera…'}</p>
          {!compact && (
            <span>
              {linkState !== 'connected' ? 'Not connected to the robot.' : <>Subscribed to <code>{topic}</code></>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
