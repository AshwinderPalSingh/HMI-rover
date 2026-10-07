/**
 * Virtual joystick (pointer events: mouse, touch and pen). Pointer capture
 * guarantees the release event even if the finger leaves the control.
 */

import { useRef, useState, type PointerEvent } from 'react';
import { teleop } from '../ros/teleop';
import { useApp } from '../state/store';

const DEADZONE = 0.06;

export function Joystick({ size = 184 }: { size?: number }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const connected = useApp((s) => s.link.state === 'connected');

  const update = (e: PointerEvent<HTMLDivElement>) => {
    const r = baseRef.current!.getBoundingClientRect();
    const radius = r.width / 2;
    let x = (e.clientX - (r.left + radius)) / radius;
    let y = (e.clientY - (r.top + radius)) / radius;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    setPos({ x, y });
    const mag = Math.min(1, m);
    if (mag < DEADZONE) teleop.setStick(0, 0);
    else teleop.setStick(x, -y);
  };

  const release = () => {
    activeId.current = null;
    setPos({ x: 0, y: 0 });
    teleop.releaseStick();
  };

  const knob = size * 0.3;
  const travel = size / 2 - knob / 2 - 6;

  return (
    <div
      ref={baseRef}
      className={`joystick ${activeId.current !== null ? 'is-active' : ''} ${connected ? '' : 'is-disabled'}`}
      style={{ width: size, height: size }}
      role="application"
      aria-label="Drive joystick: push up to drive forward, left or right to turn. Release to stop."
      onPointerDown={(e) => {
        if (activeId.current !== null) return;
        activeId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === activeId.current) update(e);
      }}
      onPointerUp={(e) => {
        if (e.pointerId === activeId.current) release();
      }}
      onPointerCancel={release}
      onLostPointerCapture={(e) => {
        if (e.pointerId === activeId.current) release();
      }}
    >
      <svg className="joystick__base" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="48" className="joystick__ring" />
        <circle cx="50" cy="50" r="30" className="joystick__ring joystick__ring--inner" />
        <path d="M50 6 v10 M50 84 v10 M6 50 h10 M84 50 h10" className="joystick__tick" />
        <path d="M50 9 l-4 6 h8 z" className="joystick__arrow" />
      </svg>
      <div
        className="joystick__knob"
        style={{
          width: knob,
          height: knob,
          transform: `translate(${pos.x * travel}px, ${pos.y * travel}px)`,
          transition: activeId.current === null ? 'transform 140ms ease-out' : 'none',
        }}
      />
    </div>
  );
}
