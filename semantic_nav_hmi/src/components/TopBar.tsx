import { useEffect, useState } from 'react';
import {
  Activity,
  CircleCheck,
  CircleDashed,
  CircleX,
  Compass,
  Gamepad2,
  Keyboard,
  Loader,
  Map as MapIcon,
  MessageSquareText,
  Navigation,
  OctagonX,
  Settings,
  Tags,
  TriangleAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useApp, app, MODE_ORDER, type Mode } from '../state/store';
import { emergencyStop } from '../ros/commands';
import { navProgress } from '../ros/navstate';
import { IconButton, Kbd, StatusPill, type StatusTone } from './ui';

const MODES: Record<Mode, { label: string; icon: typeof Gamepad2 }> = {
  drive: { label: 'Drive', icon: Gamepad2 },
  map: { label: 'Map', icon: MapIcon },
  label: { label: 'Label', icon: Tags },
  command: { label: 'Command', icon: MessageSquareText },
};

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function LinkChip() {
  const link = useApp((s) => s.link);
  const now = useNow(1000);
  let tone: StatusTone = 'neutral';
  let icon = WifiOff;
  let text = 'Disconnected';
  if (link.state === 'connected') {
    tone = 'good';
    icon = Wifi;
    text = link.latencyMs === null ? 'Connected' : `Connected · ${Math.round(link.latencyMs)} ms`;
  } else if (link.state === 'connecting') {
    tone = 'warning';
    icon = Loader;
    text = 'Connecting…';
  } else if (link.state === 'reconnecting') {
    tone = 'critical';
    icon = WifiOff;
    const secs = link.nextRetryAt ? Math.max(0, Math.ceil((link.nextRetryAt - now) / 1000)) : 0;
    text = secs > 0 ? `Offline · retry in ${secs}s` : 'Offline · retrying…';
  }
  return (
    <StatusPill tone={tone} icon={icon} title={`rosbridge: ${link.url || '—'}${link.lastError ? `\nLast error: ${link.lastError}` : ''}`}>
      {text}
    </StatusPill>
  );
}

function LocalizationChip() {
  const loc = useApp((s) => s.localization);
  const connected = useApp((s) => s.link.state === 'connected');
  const stale = useApp((s) => s.poseStale);
  if (!connected) return <StatusPill tone="neutral" icon={Compass}>Pose unknown</StatusPill>;
  const sigma = loc.sigmaXY;
  const name = { amcl: 'AMCL', slam: 'SLAM', map: 'Localized', odom: 'Odometry only', none: 'No pose' }[loc.mode];
  let tone: StatusTone = 'good';
  let icon = CircleCheck;
  let text = name;
  if (loc.mode === 'odom') {
    tone = 'warning';
    icon = TriangleAlert;
  } else if (loc.mode === 'none') {
    tone = 'critical';
    icon = CircleX;
  } else if (stale) {
    tone = 'warning';
    icon = TriangleAlert;
    text = `${name} · stale`;
  } else if (loc.mode === 'amcl' && sigma !== null) {
    text = `AMCL · ${sigma < 0.01 ? '<0.01' : `±${sigma < 0.1 ? sigma.toFixed(2) : sigma.toFixed(1)}`} m`;
    if (sigma > 0.5) {
      tone = 'warning';
      icon = TriangleAlert;
    }
  }
  return (
    <StatusPill tone={tone} icon={icon} title="Localization source and position uncertainty (1σ)">
      {text}
    </StatusPill>
  );
}

function NavChip() {
  const nav = useApp((s) => s.nav);
  const connected = useApp((s) => s.link.state === 'connected');
  const now = useNow(1000);
  const recent = nav.endedAt !== null && now - nav.endedAt < 15000;
  let tone: StatusTone = 'neutral';
  let icon = CircleDashed;
  let text = 'Idle';
  if (!connected && (nav.phase === 'active' || nav.phase === 'pending')) {
    tone = 'warning';
    icon = TriangleAlert;
    text = 'Navigation · status unknown';
  } else if (nav.phase === 'pending') {
    tone = 'accent';
    icon = Loader;
    text = 'Sending goal…';
  } else if (nav.phase === 'active') {
    tone = 'accent';
    icon = Navigation;
    const p = navProgress(nav.distanceRemaining, nav.initialDistance);
    text = p === null ? 'Navigating' : `Navigating · ${Math.round(p * 100)}%`;
  } else if (nav.phase === 'canceling') {
    tone = 'warning';
    icon = Loader;
    text = 'Canceling…';
  } else if (recent && nav.phase === 'succeeded') {
    tone = 'good';
    icon = CircleCheck;
    text = 'Arrived';
  } else if (recent && nav.phase === 'aborted') {
    tone = 'critical';
    icon = CircleX;
    text = 'Navigation failed';
  } else if (recent && nav.phase === 'canceled') {
    tone = 'neutral';
    icon = CircleX;
    text = 'Canceled';
  }
  return (
    <StatusPill tone={tone} icon={icon} title="Nav2 NavigateToPose status">
      {text}
    </StatusPill>
  );
}

export function TopBar() {
  const mode = useApp((s) => s.mode);
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 64 64" width="26" height="26" aria-hidden>
          <rect width="64" height="64" rx="14" fill="#1f1f1f" />
          <path d="M32 12 L48 50 L32 41 L16 50 Z" fill="#3987e5" />
          <circle cx="32" cy="30" r="4" fill="#ededed" />
        </svg>
        <div className="brand__text">
          <span className="brand__name">Semantic Nav</span>
          <span className="brand__sub">Operator console</span>
        </div>
      </div>

      <nav className="modes" role="tablist" aria-label="Operating mode">
        {MODE_ORDER.map((m, i) => {
          const M = MODES[m];
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`modes__tab ${mode === m ? 'is-active' : ''}`}
              onClick={() => app().setMode(m)}
              data-tip={`${M.label} mode · ${i + 1}`}
              data-tip-side="bottom"
            >
              <M.icon size={16} aria-hidden />
              <span className="modes__label">{M.label}</span>
              <span className="modes__key" aria-hidden>
                {i + 1}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="topbar__status" aria-label="System status">
        <LinkChip />
        <LocalizationChip />
        <NavChip />
      </div>

      <div className="topbar__actions">
        <IconButton icon={Activity} label="System health" onClick={() => app().patch({ dialog: 'system' })} />
        <IconButton icon={Settings} label="Settings" onClick={() => app().patch({ dialog: 'settings' })} />
        <IconButton icon={Keyboard} label="Keyboard shortcuts" shortcut="?" onClick={() => app().patch({ dialog: 'shortcuts' })} />
      </div>

      <button type="button" className="stop-btn" onClick={() => void emergencyStop()} aria-label="Stop the robot (Space)" aria-keyshortcuts="Space">
        <OctagonX size={20} aria-hidden />
        <span className="stop-btn__text">STOP</span>
        <Kbd>Space</Kbd>
      </button>
    </header>
  );
}
