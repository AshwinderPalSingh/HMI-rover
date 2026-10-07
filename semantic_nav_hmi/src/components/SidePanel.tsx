import { useApp } from '../state/store';
import { CommandPanel } from './panels/CommandPanel';
import { DrivePanel } from './panels/DrivePanel';
import { LabelPanel } from './panels/LabelPanel';
import { MapPanel } from './panels/MapPanel';
import { RobotCard } from './panels/RobotCard';

export function SidePanel() {
  const mode = useApp((s) => s.mode);
  return (
    <aside className="side" aria-label="Controls">
      <RobotCard />
      <div className="side__mode" role="tabpanel" aria-label={`${mode} controls`}>
        {mode === 'drive' && <DrivePanel />}
        {mode === 'map' && <MapPanel />}
        {mode === 'label' && <LabelPanel />}
        {mode === 'command' && <CommandPanel />}
      </div>
    </aside>
  );
}
