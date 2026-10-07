import { fmtHeading, fmtNum } from '../../lib/format';
import { useApp } from '../../state/store';

export function RobotCard() {
  const pose = useApp((s) => s.pose);
  const frame = useApp((s) => s.poseFrame);
  const stale = useApp((s) => s.poseStale);
  const vel = useApp((s) => s.velocity);
  const loc = useApp((s) => s.localization);

  const locText =
    loc.mode === 'amcl'
      ? loc.sigmaXY !== null
        ? `AMCL ${loc.sigmaXY < 0.01 ? '<0.01' : `±${fmtNum(loc.sigmaXY, 2)}`} m`
        : 'AMCL'
      : { slam: 'SLAM', map: 'Map frame', odom: 'Odometry only', none: 'Unavailable' }[loc.mode];

  return (
    <section className={`robot-card ${stale ? 'is-stale' : ''}`} aria-label="Robot telemetry">
      <div className="tile">
        <span className="tile__label">Position{frame ? ` (${frame})` : ''}</span>
        <span className="tile__value tnum">
          {pose ? (
            <>
              <span className="tile__axis">x</span> {fmtNum(pose.x)} <span className="tile__axis">y</span> {fmtNum(pose.y)}
            </>
          ) : (
            '—'
          )}
        </span>
      </div>
      <div className="tile">
        <span className="tile__label">Heading</span>
        <span className="tile__value tnum">{fmtHeading(pose?.yaw ?? null)}</span>
      </div>
      <div className="tile">
        <span className="tile__label">Speed</span>
        <span className="tile__value tnum">
          {fmtNum(vel?.linear ?? null)} <small>m/s</small>
        </span>
        <span className="tile__sub tnum">ω {fmtNum(vel?.angular ?? null)} rad/s</span>
      </div>
      <div className="tile">
        <span className="tile__label">Localization</span>
        <span className="tile__value tile__value--text">{locText}</span>
        {stale && pose && <span className="tile__sub tone-warning">Pose is stale</span>}
      </div>
    </section>
  );
}
