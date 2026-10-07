import { Gauge, ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import { fmtNum } from '../../lib/format';
import { TELEOP_LIMITS } from '../../state/settings';
import { app, useApp } from '../../state/store';
import { Joystick } from '../Joystick';
import { Kbd, Segmented, StatusPill } from '../ui';

const PRESETS = {
  slow: { maxLinear: 0.12, maxAngular: 0.5 },
  normal: { maxLinear: 0.26, maxAngular: 1.0 },
  fast: { maxLinear: 0.45, maxAngular: 1.4 },
} as const;

type Preset = keyof typeof PRESETS | 'custom';

function presetOf(l: number, a: number): Preset {
  for (const [k, v] of Object.entries(PRESETS)) {
    if (Math.abs(v.maxLinear - l) < 1e-6 && Math.abs(v.maxAngular - a) < 1e-6) return k as Preset;
  }
  return 'custom';
}

/** Centered bar: commanded value as a fill from the middle, measured as a tick. */
function VelocityBar({ label, unit, cmd, meas, max }: { label: string; unit: string; cmd: number; meas: number | null; max: number }) {
  const f = (v: number) => Math.max(-1, Math.min(1, v / max));
  const c = f(cmd);
  return (
    <div className="velbar">
      <div className="velbar__head">
        <span>
          {label} <span className="muted">{unit}</span>
        </span>
        <span className="tnum">
          <span className="muted">Commanded</span> {fmtNum(cmd)} <span className="muted">· Measured</span> {fmtNum(meas)}
        </span>
      </div>
      <div className="velbar__track" aria-hidden>
        <span className="velbar__mid" />
        <span className="velbar__fill" style={{ left: `${50 + Math.min(0, c) * 50}%`, width: `${Math.abs(c) * 50}%` }} />
        {meas !== null && <span className="velbar__tick" style={{ left: `${50 + f(meas) * 50}%` }} />}
      </div>
    </div>
  );
}

export function DrivePanel() {
  const limits = useApp((s) => s.settings.teleop);
  const cmd = useApp((s) => s.command);
  const vel = useApp((s) => s.velocity);
  const guard = useApp((s) => s.guardOnline);
  const topic = useApp((s) => s.settings.topics.cmdVel);
  const connected = useApp((s) => s.link.state === 'connected');
  const preset = presetOf(limits.maxLinear, limits.maxAngular);

  return (
    <div className="panel-body">
      <div className="section-head">
        <h2>Manual drive</h2>
        {guard === true && (
          <StatusPill tone="good" icon={ShieldCheck} title="teleop_guard stops the robot if this console's command stream drops">
            Deadman active
          </StatusPill>
        )}
        {guard === false && (
          <StatusPill tone="critical" icon={ShieldAlert} title={`No /teleop_guard node: commands on ${topic} won't reach the base`}>
            Guard offline
          </StatusPill>
        )}
        {guard === null && connected && (
          <StatusPill tone="neutral" icon={Shield} title="Guard status unknown (rosapi unavailable or direct /cmd_vel)">
            Guard unknown
          </StatusPill>
        )}
      </div>

      {guard === false && (
        <p className="callout callout--critical">
          The teleop guard isn't running, so joystick commands on <code>{topic}</code> are not forwarded to the base. Start the full launch, or switch the
          teleop topic to <code>/cmd_vel</code> in Settings.
        </p>
      )}

      <div className="drive-pad">
        <Joystick />
        <div className="keys-hint" aria-label="Keyboard driving">
          <div className="keys-hint__grid" aria-hidden>
            <span />
            <Kbd>W</Kbd>
            <span />
            <Kbd>A</Kbd>
            <Kbd>S</Kbd>
            <Kbd>D</Kbd>
          </div>
          <dl className="keys-hint__list">
            <div>
              <dt>Hold</dt>
              <dd>to drive</dd>
            </div>
            <div>
              <dt>Arrows</dt>
              <dd>also work</dd>
            </div>
            <div>
              <dt>
                <Kbd>Space</Kbd>
              </dt>
              <dd>stop</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <Gauge size={15} aria-hidden />
          <h3>Speed limits</h3>
        </div>
        <Segmented<Preset>
          label="Speed preset"
          size="sm"
          value={preset}
          onChange={(p) => p !== 'custom' && app().updateSettings({ teleop: PRESETS[p] })}
          options={[
            { value: 'slow', label: 'Slow' },
            { value: 'normal', label: 'Normal' },
            { value: 'fast', label: 'Fast' },
            ...(preset === 'custom' ? [{ value: 'custom' as const, label: 'Custom' }] : []),
          ]}
        />
        <label className="range">
          <span className="range__label">
            Linear <strong className="tnum">{limits.maxLinear.toFixed(2)} m/s</strong>
          </span>
          <input
            type="range"
            min={TELEOP_LIMITS.linear.min}
            max={TELEOP_LIMITS.linear.max}
            step={0.01}
            value={limits.maxLinear}
            onChange={(e) => app().updateSettings({ teleop: { maxLinear: Number(e.target.value) } })}
          />
        </label>
        <label className="range">
          <span className="range__label">
            Angular <strong className="tnum">{limits.maxAngular.toFixed(2)} rad/s</strong>
          </span>
          <input
            type="range"
            min={TELEOP_LIMITS.angular.min}
            max={TELEOP_LIMITS.angular.max}
            step={0.05}
            value={limits.maxAngular}
            onChange={(e) => app().updateSettings({ teleop: { maxAngular: Number(e.target.value) } })}
          />
        </label>
      </div>

      <div className="card">
        <VelocityBar label="Linear" unit="m/s" cmd={cmd.linear} meas={vel?.linear ?? null} max={TELEOP_LIMITS.linear.max} />
        <VelocityBar label="Angular" unit="rad/s" cmd={cmd.angular} meas={vel?.angular ?? null} max={TELEOP_LIMITS.angular.max} />
      </div>

      <p className="footnote">Driving manually cancels any active navigation goal. Releasing every control brings the robot to a smooth stop.</p>
    </div>
  );
}
