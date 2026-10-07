/**
 * Camera feed from a sensor_msgs/CompressedImage topic.
 *
 * Pipeline: rosbridge (CBOR, queue_length 1, throttled) → Blob → createImageBitmap
 * (decoded off the main thread) → canvas. At most one decode is in flight; a
 * newer frame replaces any waiting one, so latency never accumulates.
 * The subscription rate drops when the feed is only shown picture-in-picture.
 *
 * When it is the main view the image can be zoomed (wheel, pinch, buttons,
 * +/−) and dragged around while zoomed; double-click resets.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus, Scan, Video, VideoOff } from 'lucide-react';
import { IconButton } from '../components/ui';
import { bridge } from '../ros/app';
import { TYPES } from '../ros/names';
import type { CompressedImage } from '../ros/types';
import { useApp } from '../state/store';

type Role = 'primary' | 'pip';

const NO_SIGNAL_MS = 3000;
const ZOOM_MAX = 6;

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

/** Zoom state: factor and the visible window's centre in normalised image coordinates. */
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
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // contain-fit with letterboxing; zoom selects a sub-window of the source
    const scale = Math.min(cw / bmp.width, ch / bmp.height);
    const dw = bmp.width * scale;
    const dh = bmp.height * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    const { z, cx, cy } = zoomRef.current;
    const sw = bmp.width / z;
    const sh = bmp.height / z;
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, cx * bmp.width - sw / 2, cy * bmp.height - sh / 2, sw, sh, dx, dy, dw, dh);
    frameRect.current = { x: dx / dpr, y: dy / dpr, w: dw / dpr, h: dh / dpr };
  }, []);

  const setZoom = useCallback(
    (zm: Zoom) => {
      zoomRef.current = clampZoom(zm);
      setZoomLevel(zoomRef.current.z);
      paint();
    },
    [paint],
  );

  /** Zoom by `factor` keeping the image point under (px, py) — canvas CSS px — in place. */
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
    zoomRef.current = { z: 1, cx: 0.5, cy: 0.5 };
    setZoomLevel(1);
    const c0 = canvasRef.current;
    c0?.getContext('2d')?.clearRect(0, 0, c0.width, c0.height);

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
            lastBmp.current?.close();
            lastBmp.current = bmp; // kept so zoom/pan can repaint without a new frame
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
      { compression: 'cbor', throttleMs: compact ? 250 : 66, queueLength: 1 },
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

  // ── zoom & pan (main view only) ───────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan'; x: number; y: number; zm: Zoom } | { kind: 'pinch'; d: number; zm: Zoom } | null>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || compact) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      zoomAt(Math.exp(-e.deltaY * unit * 0.0018), p.x, p.y);
    };
    const onCmd = (ev: Event) => {
      const cmd = (ev as CustomEvent<string>).detail;
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
  }, [compact, paint, resetZoom, zoomAt]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (compact) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = { kind: 'pinch', d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zm: zoomRef.current };
    } else if (pts.length === 1 && e.button === 0) {
      gesture.current = { kind: 'pan', x: pts[0].x, y: pts[0].y, zm: zoomRef.current };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (compact || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    const fr = frameRect.current;
    if (!g || !fr) return;
    const pts = [...pointers.current.values()];
    if (g.kind === 'pinch' && pts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      zoomRef.current = g.zm;
      zoomAt(d / Math.max(1, g.d), mid.x, mid.y);
    } else if (g.kind === 'pan' && g.zm.z > 1) {
      const p = pts[0];
      setZoom({ z: g.zm.z, cx: g.zm.cx - (p.x - g.x) / fr.w / g.zm.z, cy: g.zm.cy - (p.y - g.y) / fr.h / g.zm.z });
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
  };

  const showOverlay = status !== 'live';
  const zoomed = zoomLevel > 1.001;
  return (
    <div ref={wrapRef} className={`cameraview ${compact ? 'cameraview--pip' : ''} ${!compact ? (zoomed ? 'is-zoomed' : 'is-zoomable') : ''}`}>
      <canvas
        ref={canvasRef}
        aria-label={compact ? 'Robot camera feed' : 'Robot camera feed — scroll to zoom, drag to look around, double-click to reset'}
        role="img"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={() => !compact && resetZoom()}
      />
      {!compact && status === 'live' && info && (
        <div className="cam-badge" aria-live="off">
          <span className="cam-badge__dot" aria-hidden />
          <span>Live</span>
          <span className="cam-badge__meta">
            {info.w}×{info.h} · {info.fps.toFixed(0)} fps{zoomed ? ` · ${zoomLevel.toFixed(1)}×` : ''}
          </span>
        </div>
      )}
      {!compact && status === 'live' && (
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
