import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Info, LocateFixed, Radar, Save } from 'lucide-react';
import { fmtAge, fmtArea } from '../../lib/format';
import { saveMap, type SaveMapResult } from '../../ros/app';
import { app, useApp } from '../../state/store';
import { Button, Field, StatusPill } from '../ui';

export function MapPanel() {
  const info = useApp((s) => s.mapInfo);
  const loc = useApp((s) => s.localization.mode);
  const nodes = useApp((s) => s.nodes);
  const connected = useApp((s) => s.link.state === 'connected');
  const save = useApp((s) => s.settings.mapSave);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaveMapResult | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  const slamRunning = nodes ? nodes.includes('/slam_toolbox') : loc === 'slam';
  const amclRunning = nodes ? nodes.includes('/amcl') : loc === 'amcl';
  const totalArea = info ? info.width * info.height * info.resolution * info.resolution : 0;

  const onSave = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await saveMap(save.directory, save.name));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-body">
      <div className="section-head">
        <h2>Mapping</h2>
        {connected && slamRunning && (
          <StatusPill tone="good" icon={Radar}>
            SLAM active
          </StatusPill>
        )}
        {connected && !slamRunning && amclRunning && (
          <StatusPill tone="neutral" icon={LocateFixed}>
            Localization (AMCL)
          </StatusPill>
        )}
      </div>

      {connected && !slamRunning && (
        <p className="callout">
          <Info size={15} aria-hidden />
          <span>
            SLAM isn't running — the robot is localizing on a saved map. To build a new map, relaunch with <code>slam:=True</code>.
            {amclRunning && ' Use the pose tool (P) if the robot looks misplaced.'}
          </span>
        </p>
      )}
      {slamRunning && (
        <p className="callout callout--accent">
          <Radar size={15} aria-hidden />
          <span>Drive slowly through the space and revisit areas to close loops. The map updates every few seconds.</span>
        </p>
      )}

      <div className="stat-grid">
        <div className="tile">
          <span className="tile__label">Map size</span>
          <span className="tile__value tnum">{info ? `${info.width} × ${info.height}` : '—'}</span>
          <span className="tile__sub">{info ? `${info.resolution.toFixed(3)} m per cell` : 'no map yet'}</span>
        </div>
        <div className="tile">
          <span className="tile__label">Explored</span>
          <span className="tile__value tnum">{info ? fmtArea(info.knownRatio * totalArea) : '—'}</span>
          <span className="tile__sub">{info ? `${(info.knownRatio * 100).toFixed(1)}% of grid` : '—'}</span>
        </div>
        <div className="tile">
          <span className="tile__label">Last update</span>
          <span className="tile__value tile__value--text">{info ? fmtAge(Date.now() - info.receivedAt) : '—'}</span>
          <span className="tile__sub">{info ? `frame ${info.frame}` : '—'}</span>
        </div>
        <div className="tile">
          <span className="tile__label">Grid area</span>
          <span className="tile__value tnum">{info ? fmtArea(totalArea) : '—'}</span>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <Save size={15} aria-hidden />
          <h3>Save map</h3>
        </div>
        <Field label="Map name" htmlFor="map-name">
          <input
            id="map-name"
            className="input"
            value={save.name}
            onChange={(e) => app().updateSettings({ mapSave: { name: e.target.value } })}
            spellCheck={false}
          />
        </Field>
        <Field label="Directory on the robot" htmlFor="map-dir" hint="Absolute path on the machine running Nav2; it must already exist.">
          <input
            id="map-dir"
            className="input mono"
            value={save.directory}
            onChange={(e) => app().updateSettings({ mapSave: { directory: e.target.value } })}
            spellCheck={false}
          />
        </Field>
        <Button variant="primary" icon={Save} loading={busy} disabled={!connected || !info || !save.name.trim()} onClick={() => void onSave()}>
          Save map
        </Button>
        {!slamRunning && connected && <p className="field__hint">Saving needs map_saver_server, which starts with SLAM.</p>}
        {result && (
          <ul className="result-list" aria-label="Save results">
            <li>
              {result.grid.ok ? <CircleCheck size={15} className="tone-good" aria-hidden /> : <CircleX size={15} className="tone-critical" aria-hidden />}
              <span>
                <strong>Occupancy grid</strong> {result.grid.detail}
              </span>
            </li>
            <li>
              {result.poseGraph.ok ? <CircleCheck size={15} className="tone-good" aria-hidden /> : <CircleX size={15} className="tone-critical" aria-hidden />}
              <span>
                <strong>Pose graph</strong> {result.poseGraph.detail}
              </span>
            </li>
          </ul>
        )}
        {result?.grid.ok && (
          <p className="footnote">
            To localize on it later, relaunch with <code>map:={result.base}.yaml</code>.
          </p>
        )}
      </div>
    </div>
  );
}
