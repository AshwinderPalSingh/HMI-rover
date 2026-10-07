/**
 * Camera feed from a sensor_msgs/CompressedImage topic.
 *
 * Pipeline: rosbridge (CBOR, queue_length 1, throttled) → Blob → createImageBitmap
 * (decoded off the main thread) → canvas. At most one decode is in flight; a
 * newer frame replaces any waiting one, so latency never accumulates.
 * The subscription rate drops when the feed is only shown picture-in-picture.
 */

import { useEffect, useRef, useState } from 'react';
import { VideoOff, Video } from 'lucide-react';
import { bridge } from '../ros/app';
import { TYPES } from '../ros/names';
import type { CompressedImage } from '../ros/types';
import { useApp } from '../state/store';

type Role = 'primary' | 'pip';

const NO_SIGNAL_MS = 3000;

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

export function CameraView({ role }: { role: Role }) {
  const compact = role === 'pip';
  const topic = useApp((s) => s.settings.topics.camera);
  const linkState = useApp((s) => s.link.state);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'waiting' | 'live' | 'lost'>('waiting');
  const [info, setInfo] = useState<{ fps: number; w: number; h: number } | null>(null);
  const stats = useRef({ last: 0, fpsEma: 0, frames: 0 });

  useEffect(() => {
    let decoding = false;
    let pending: CompressedImage | null = null;
    let disposed = false;
    let lastSize = { w: 0, h: 0 };

    // New topic (or role): forget the previous stream entirely
    stats.current = { last: 0, fpsEma: 0, frames: 0 };
    setStatus('waiting');
    setInfo(null);
    const c0 = canvasRef.current;
    c0?.getContext('2d')?.clearRect(0, 0, c0.width, c0.height);

    const paint = (bmp: ImageBitmap) => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
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
      // contain-fit with letterboxing
      const scale = Math.min(cw / bmp.width, ch / bmp.height);
      const dw = bmp.width * scale;
      const dh = bmp.height * scale;
      ctx.fillStyle = '#07090c';
      ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      lastSize = { w: bmp.width, h: bmp.height };
    };

    const decode = async (msg: CompressedImage) => {
      decoding = true;
      try {
        const bytes = toBytes(msg.data);
        if (bytes && bytes.length) {
          const mime = /png/i.test(msg.format) ? 'image/png' : 'image/jpeg';
          const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
          if (!disposed) paint(bmp);
          bmp.close();
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
      setStatus(st.frames === 0 ? 'waiting' : age > NO_SIGNAL_MS ? 'lost' : 'live');
      setInfo(st.frames ? { fps: age > NO_SIGNAL_MS ? 0 : st.fpsEma, w: lastSize.w, h: lastSize.h } : null);
    }, 500);

    return () => {
      disposed = true;
      off();
      clearInterval(ui);
    };
  }, [topic, compact]);

  const showOverlay = status !== 'live';
  return (
    <div ref={wrapRef} className={`cameraview ${compact ? 'cameraview--pip' : ''}`}>
      <canvas ref={canvasRef} aria-label="Robot camera feed" role="img" />
      {!compact && status === 'live' && info && (
        <div className="cam-badge" aria-live="off">
          <span className="cam-badge__dot" aria-hidden />
          <span>Live</span>
          <span className="cam-badge__meta">
            {info.w}×{info.h} · {info.fps.toFixed(0)} fps
          </span>
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
