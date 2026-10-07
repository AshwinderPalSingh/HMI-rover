/**
 * Manual driving: keyboard / on-screen pad / joystick → velocity commands.
 *
 * - Publishes only while the operator is actively driving (plus a final zero),
 *   so Nav2 keeps ownership of /cmd_vel otherwise.
 * - Acceleration-limited ramps: smooth starts, quicker (but not jerky) stops.
 * - Manual input preempts autonomy: the first input cancels any Nav2 goal.
 * - Any loss of focus (window blur, hidden tab, page unload, disconnect)
 *   releases every input — no stuck keys driving the robot into a wall.
 * - On the robot, the teleop guard node zeroes /cmd_vel if this stream stops.
 */

import { app, notify } from '../state/store';
import { bridge, cancelNavigation, publishZeroVelocity } from './app';
import { TYPES } from './names';
import type { Twist } from './types';

export type Dir = 'fwd' | 'back' | 'left' | 'right';

const RATE_HZ = 20;
const ACCEL = { v: 0.5, w: 2.5 }; // m/s², rad/s² while speeding up
const DECEL = { v: 1.0, w: 5.0 }; // when slowing / stopping

function approach(cur: number, target: number, up: number, down: number, dt: number): number {
  const slowing = Math.abs(target) < Math.abs(cur) || Math.sign(target) !== Math.sign(cur);
  const step = (slowing ? down : up) * dt;
  if (Math.abs(target - cur) <= step) return target;
  return cur + Math.sign(target - cur) * step;
}

class TeleopController {
  private keys = new Set<Dir>();
  private stick: { x: number; y: number } | null = null;
  private v = 0;
  private w = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private overridden = false;
  private lastUiUpdate = 0;

  /** Keyboard / on-screen pad. */
  setKey(dir: Dir, down: boolean): void {
    if (down) {
      if (!this.keys.has(dir)) {
        this.keys.add(dir);
        this.engage();
      }
    } else if (this.keys.delete(dir)) {
      this.ensureLoop();
    }
  }

  /** Joystick: x = turn right (+), y = forward (+), both in [-1, 1]; null = released. */
  setStick(x: number, y: number): void {
    this.stick = { x, y };
    this.engage();
  }

  releaseStick(): void {
    this.stick = null;
    this.ensureLoop();
  }

  /** Drop all inputs; the loop ramps down and sends a final zero. */
  releaseAll(): void {
    this.keys.clear();
    this.stick = null;
    this.ensureLoop();
  }

  /** Immediate stop: no ramp. */
  halt(): void {
    this.keys.clear();
    this.stick = null;
    this.v = 0;
    this.w = 0;
    this.stopLoop();
    publishZeroVelocity();
    this.overridden = false;
    app().patch({ command: { linear: 0, angular: 0, active: false } });
  }

  isActive(dir?: Dir): boolean {
    return dir ? this.keys.has(dir) : this.keys.size > 0 || this.stick !== null;
  }

  private hasInput(): boolean {
    return this.keys.size > 0 || this.stick !== null;
  }

  private target(): { v: number; w: number } {
    const lim = app().settings.teleop;
    let fwd = 0;
    let turn = 0;
    if (this.keys.has('fwd')) fwd += 1;
    if (this.keys.has('back')) fwd -= 1;
    if (this.keys.has('left')) turn += 1;
    if (this.keys.has('right')) turn -= 1;
    if (this.stick) {
      // Expo curve: fine control near the center, full speed at the rim
      const expo = (a: number) => Math.sign(a) * Math.abs(a) ** 1.6;
      fwd = Math.max(-1, Math.min(1, fwd + expo(this.stick.y)));
      turn = Math.max(-1, Math.min(1, turn - expo(this.stick.x)));
    }
    // Turning in place feels twitchy at full rate; soften pure rotation from keys
    const turnScale = fwd === 0 && !this.stick ? 0.7 : 1;
    return { v: fwd * lim.maxLinear, w: turn * lim.maxAngular * turnScale };
  }

  private engage(): void {
    if (!bridge.connected) {
      this.keys.clear();
      this.stick = null;
      notify('warn', 'Teleop', 'Not connected', 'Driving is disabled until the link to the robot is back.');
      return;
    }
    if (!this.overridden) {
      this.overridden = true;
      const phase = app().nav.phase;
      if (phase === 'active' || phase === 'pending' || phase === 'canceling') {
        void cancelNavigation(true);
        notify('warn', 'Teleop', 'Manual override', 'Navigation goal canceled — you have control.');
      }
    }
    this.ensureLoop();
  }

  private ensureLoop(): void {
    if (this.timer) return;
    if (!this.hasInput() && this.v === 0 && this.w === 0) return;
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), 1000 / RATE_HZ);
    this.tick();
  }

  private stopLoop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.2, (now - this.last) / 1000);
    this.last = now;
    const tgt = this.target();
    this.v = approach(this.v, tgt.v, ACCEL.v, DECEL.v, dt);
    this.w = approach(this.w, tgt.w, ACCEL.w, DECEL.w, dt);

    const topic = app().settings.topics.cmdVel;
    const msg: Twist = { linear: { x: this.v, y: 0, z: 0 }, angular: { x: 0, y: 0, z: this.w } };
    const ok = bridge.publish(topic, TYPES.twist, msg);
    if (!ok) {
      // Link dropped mid-drive: the guard on the robot stops it; we reset locally
      this.keys.clear();
      this.stick = null;
      this.v = 0;
      this.w = 0;
      this.stopLoop();
      this.overridden = false;
      app().patch({ command: { linear: 0, angular: 0, active: false } });
      return;
    }

    const idle = !this.hasInput() && this.v === 0 && this.w === 0;
    if (idle || now - this.lastUiUpdate > 90) {
      this.lastUiUpdate = now;
      app().patch({ command: { linear: this.v, angular: this.w, active: !idle } });
    }
    if (idle) {
      // final zero already published above; hand /cmd_vel back to autonomy
      this.stopLoop();
      this.overridden = false;
    }
  }
}

export const teleop = new TeleopController();

/** Release inputs whenever the console stops being in the operator's hands. */
export function installTeleopSafety(): void {
  const release = () => teleop.releaseAll();
  window.addEventListener('blur', release);
  window.addEventListener('pagehide', release);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
  });
  bridge.onDisconnect.on(() => teleop.halt());
}
