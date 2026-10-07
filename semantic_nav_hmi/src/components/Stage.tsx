import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeftRight, Minimize2, PictureInPicture2, Hand } from 'lucide-react';
import { CameraView } from '../camera/CameraView';
import { MapView } from '../map/MapView';
import { fmtNum, fmtHeading } from '../lib/format';
import { loadJSON, saveJSON } from '../lib/storage';
import { app, useApp } from '../state/store';
import { IconButton } from './ui';

function DriveHud() {
  const cmd = useApp((s) => s.command);
  const vel = useApp((s) => s.velocity);
  const pose = useApp((s) => s.pose);
  return (
    <div className="hud" aria-live="off">
      <div className="hud__cell">
        <span className="hud__label">Speed</span>
        <span className="hud__value">
          {fmtNum(vel?.linear ?? null)} <small>m/s</small>
        </span>
      </div>
      <div className="hud__cell">
        <span className="hud__label">Turn rate</span>
        <span className="hud__value">
          {fmtNum(vel?.angular ?? null)} <small>rad/s</small>
        </span>
      </div>
      <div className="hud__cell">
        <span className="hud__label">Heading</span>
        <span className="hud__value">{fmtHeading(pose?.yaw ?? null)}</span>
      </div>
      {cmd.active && (
        <div className="hud__manual">
          <Hand size={14} aria-hidden /> Manual control
        </div>
      )}
    </div>
  );
}

/** Picture-in-picture placement: fx/fy = 0 left/top … 1 right/bottom, w in px (null = auto). */
interface PipGeom {
  fx: number;
  fy: number;
  w: number | null;
}

const DEFAULT_PIP: PipGeom = { fx: 1, fy: 0, w: null };
const MARGIN = 12;
const BAR_H = 30;
const MIN_W = 150;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const bodyHeight = (w: number) => (w * 10) / 16;

export function Stage() {
  const primary = useApp((s) => s.primary);
  const pipVisible = useApp((s) => s.pipVisible);
  const mode = useApp((s) => s.mode);
  const secondary = primary === 'map' ? 'camera' : 'map';
  const secondaryName = secondary === 'map' ? 'Map' : 'Camera';

  const stageRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [geom, setGeomState] = useState<PipGeom>(() => ({ ...DEFAULT_PIP, ...loadJSON<Partial<PipGeom>>('pip', {}) }));
  // latest geometry for pointer-up: the handler can run before React re-renders the last move
  const geomRef = useRef(geom);
  const setGeom = (g: PipGeom) => {
    geomRef.current = g;
    setGeomState(g);
  };
  const drag = useRef<{ kind: 'move' | 'resize'; px: number; py: number; left: number; top: number; w: number } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // geometry in px for the current stage size
  const maxW = Math.max(MIN_W, Math.min(720, stage.w - 2 * MARGIN, ((stage.h - 2 * MARGIN - BAR_H) * 16) / 10));
  const w = clamp(geom.w ?? (stage.w < 600 ? 150 : stage.w < 1000 ? 248 : 300), MIN_W, maxW);
  const h = bodyHeight(w) + BAR_H;
  const spanX = Math.max(0, stage.w - w - 2 * MARGIN);
  const spanY = Math.max(0, stage.h - h - 2 * MARGIN);
  const left = MARGIN + geom.fx * spanX;
  const top = MARGIN + geom.fy * spanY;

  const place = (nl: number, nt: number, nw: number) => {
    const sx = Math.max(0, stage.w - nw - 2 * MARGIN);
    const sy = Math.max(0, stage.h - bodyHeight(nw) - BAR_H - 2 * MARGIN);
    setGeom({
      w: nw,
      fx: sx > 0 ? clamp((nl - MARGIN) / sx, 0, 1) : 1,
      fy: sy > 0 ? clamp((nt - MARGIN) / sy, 0, 1) : 0,
    });
  };

  const start = (kind: 'move' | 'resize') => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, px: e.clientX, py: e.clientY, left, top, w };
  };

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (d.kind === 'move') {
      place(d.left + dx, d.top + dy, d.w);
    } else {
      // the grip sits on the inner corner: grow towards the stage centre
      const anchoredRight = d.left + d.w / 2 > stage.w / 2;
      const nw = clamp(d.w + (anchoredRight ? -dx : dx), MIN_W, maxW);
      place(anchoredRight ? d.left + d.w - nw : d.left, d.top, nw);
    }
  };

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    saveJSON('pip', geomRef.current);
  };

  const anchoredRight = left + w / 2 > stage.w / 2;

  return (
    <section ref={stageRef} className="stage" aria-label="Main view">
      <div className="stage__primary">
        {primary === 'map' ? <MapView role="primary" /> : <CameraView role="primary" />}
        {primary === 'camera' && mode === 'drive' && <DriveHud />}
      </div>

      {pipVisible ? (
        <div className="pip" style={{ left, top, width: w }}>
          <button type="button" className="pip__body" style={{ height: bodyHeight(w) }} onClick={() => app().swapViews()} aria-label={`Show ${secondaryName.toLowerCase()} full size`}>
            {secondary === 'map' ? <MapView role="pip" /> : <CameraView role="pip" />}
          </button>
          <div
            className="pip__bar"
            onPointerDown={start('move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              setGeom(DEFAULT_PIP);
              saveJSON('pip', DEFAULT_PIP);
            }}
            title="Drag to move · double-click to reset"
          >
            <span className="pip__title">{secondaryName}</span>
            <IconButton icon={ArrowLeftRight} label="Swap views" shortcut="C" size="sm" tipSide="bottom" onClick={() => app().swapViews()} />
            <IconButton icon={Minimize2} label={`Hide ${secondaryName.toLowerCase()}`} size="sm" tipSide="bottom" onClick={() => app().setPipVisible(false)} />
          </div>
          <div
            className={`pip__grip ${anchoredRight ? 'pip__grip--left' : 'pip__grip--right'}`}
            onPointerDown={start('resize')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            aria-hidden
            title="Drag to resize"
          />
        </div>
      ) : (
        <button type="button" className="pip-restore" onClick={() => app().setPipVisible(true)}>
          <PictureInPicture2 size={15} aria-hidden /> Show {secondaryName.toLowerCase()}
        </button>
      )}
    </section>
  );
}
