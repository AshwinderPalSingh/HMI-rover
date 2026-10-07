import { ArrowLeftRight, Minimize2, PictureInPicture2, Hand } from 'lucide-react';
import { CameraView } from '../camera/CameraView';
import { MapView } from '../map/MapView';
import { fmtNum, fmtHeading } from '../lib/format';
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

export function Stage() {
  const primary = useApp((s) => s.primary);
  const pipVisible = useApp((s) => s.pipVisible);
  const mode = useApp((s) => s.mode);
  const secondary = primary === 'map' ? 'camera' : 'map';
  const secondaryName = secondary === 'map' ? 'Map' : 'Camera';

  return (
    <section className="stage" aria-label="Main view">
      <div className="stage__primary">
        {primary === 'map' ? <MapView role="primary" /> : <CameraView role="primary" />}
        {primary === 'camera' && mode === 'drive' && <DriveHud />}
      </div>

      {pipVisible ? (
        <div className="pip">
          <div className="pip__body">{secondary === 'map' ? <MapView role="pip" /> : <CameraView role="pip" />}</div>
          <div className="pip__bar">
            <span className="pip__title">{secondaryName}</span>
            <IconButton icon={ArrowLeftRight} label="Swap views" shortcut="C" size="sm" tipSide="bottom" onClick={() => app().swapViews()} />
            <IconButton icon={Minimize2} label={`Hide ${secondaryName.toLowerCase()}`} size="sm" tipSide="bottom" onClick={() => app().setPipVisible(false)} />
          </div>
        </div>
      ) : (
        <button type="button" className="pip-restore" onClick={() => app().setPipVisible(true)}>
          <PictureInPicture2 size={15} aria-hidden /> Show {secondaryName.toLowerCase()}
        </button>
      )}
    </section>
  );
}
