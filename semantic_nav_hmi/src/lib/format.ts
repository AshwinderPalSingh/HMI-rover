/** Display formatting for telemetry, durations and times. */

import { toDeg } from './math';

const DASH = '—';

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const s = v.toFixed(digits);
  // Avoid "-0.00"
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

export function fmtSigned(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const s = fmtNum(v, digits);
  return v > 0 && Number(s) !== 0 ? `+${s}` : s;
}

/** Heading in degrees, 0–360, one decimal. */
export function fmtHeading(rad: number | null | undefined): string {
  if (rad === null || rad === undefined || !Number.isFinite(rad)) return DASH;
  const d = (toDeg(rad) + 360) % 360;
  return `${d.toFixed(1)}°`;
}

export function fmtMeters(m: number | null | undefined, digits = 1): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return DASH;
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(digits)} m`;
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return DASH;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Compact "time ago" for ages in ms. */
export function fmtAge(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'never';
  if (ms < 1500) return 'just now';
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s)} s ago`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function fmtClock(ts: number, withSeconds = true): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (!withSeconds) return `${hh}:${mm}`;
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function fmtRate(hz: number | null | undefined): string {
  if (hz === null || hz === undefined || !Number.isFinite(hz) || hz <= 0) return DASH;
  return hz >= 10 ? `${hz.toFixed(0)} Hz` : `${hz.toFixed(1)} Hz`;
}

export function fmtArea(m2: number): string {
  if (!Number.isFinite(m2)) return DASH;
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2).toLocaleString()} m²`;
}

/** Title-case a snake/space separated word: "point_radius" → "Point radius". */
export function humanize(s: string): string {
  const t = s.replace(/_/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
