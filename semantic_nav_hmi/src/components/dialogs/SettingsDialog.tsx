import { useState } from 'react';
import { RotateCcw, Settings as SettingsIcon } from 'lucide-react';
import { applyTopicSettings, autoRosbridgeUrl, reconnect } from '../../ros/app';
import { DEFAULT_SETTINGS, urlOverride, type Settings } from '../../state/settings';
import { app, notify, useApp } from '../../state/store';
import { Button, Dialog, Field, Switch } from '../ui';

const TOPIC_FIELDS: { key: keyof Settings['topics']; label: string; hint?: string }[] = [
  { key: 'cmdVel', label: 'Teleop velocity', hint: '/hmi/cmd_vel goes through the teleop guard (deadman). /cmd_vel drives the base directly.' },
  { key: 'camera', label: 'Camera (CompressedImage)' },
  { key: 'map', label: 'Map (OccupancyGrid)' },
  { key: 'scan', label: 'Laser scan' },
  { key: 'odom', label: 'Odometry (measured velocity)' },
  { key: 'plan', label: 'Global plan (Path)' },
];

export function SettingsDialog() {
  const current = useApp((s) => s.settings);
  const [s, setS] = useState<Settings>(current);
  const override = urlOverride();
  const close = () => app().patch({ dialog: null });

  const setTopic = (k: keyof Settings['topics'], v: string) => setS({ ...s, topics: { ...s.topics, [k]: v } });
  const setFrame = (k: keyof Settings['frames'], v: string) => setS({ ...s, frames: { ...s.frames, [k]: v } });

  const validTopic = (v: string) => /^\/?[A-Za-z_~][A-Za-z0-9_/~]*$/.test(v.trim());
  const invalid = Object.values(s.topics).some((t) => !validTopic(t)) || Object.values(s.frames).some((f) => !f.trim());
  const urlInvalid = s.rosbridgeUrl.trim() !== '' && !/^wss?:\/\/.+/.test(s.rosbridgeUrl.trim());

  const save = () => {
    if (invalid || urlInvalid) return;
    const clean: Settings = {
      ...s,
      rosbridgeUrl: s.rosbridgeUrl.trim(),
      topics: Object.fromEntries(Object.entries(s.topics).map(([k, v]) => [k, v.trim().startsWith('/') ? v.trim() : `/${v.trim()}`])) as Settings['topics'],
      frames: Object.fromEntries(Object.entries(s.frames).map(([k, v]) => [k, v.trim()])) as Settings['frames'],
    };
    const urlChanged = clean.rosbridgeUrl !== current.rosbridgeUrl;
    const topicsChanged = JSON.stringify(clean.topics) !== JSON.stringify(current.topics) || JSON.stringify(clean.frames) !== JSON.stringify(current.frames);
    app().replaceSettings(clean);
    if (topicsChanged) applyTopicSettings();
    if (urlChanged) reconnect();
    notify('success', 'Settings', 'Settings saved', urlChanged ? 'Reconnecting with the new address.' : undefined);
    close();
  };

  return (
    <Dialog
      title="Settings"
      icon={SettingsIcon}
      onClose={close}
      width={560}
      footer={
        <>
          <Button variant="ghost" icon={RotateCcw} onClick={() => setS({ ...DEFAULT_SETTINGS, layers: s.layers, mapSave: s.mapSave })}>
            Restore defaults
          </Button>
          <span className="spacer" />
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={invalid || urlInvalid} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="form">
        <h3 className="form-section">Connection</h3>
        <Field
          label="rosbridge URL"
          htmlFor="set-url"
          error={urlInvalid ? 'Use ws://host:port or wss://host:port' : null}
          hint={override ? `Overridden by ?ws= in the page address (${override}).` : `Leave empty to use ${autoRosbridgeUrl()} (same host as this page).`}
        >
          <input
            id="set-url"
            className="input mono"
            value={s.rosbridgeUrl}
            placeholder={autoRosbridgeUrl()}
            onChange={(e) => setS({ ...s, rosbridgeUrl: e.target.value })}
            spellCheck={false}
          />
        </Field>

        <h3 className="form-section">Topics</h3>
        <div className="form-grid">
          {TOPIC_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`set-${f.key}`} hint={f.hint} error={validTopic(s.topics[f.key]) ? null : 'Invalid topic name'}>
              <input id={`set-${f.key}`} className="input mono" value={s.topics[f.key]} onChange={(e) => setTopic(f.key, e.target.value)} spellCheck={false} />
            </Field>
          ))}
        </div>

        <h3 className="form-section">Frames</h3>
        <div className="form-row">
          {(['map', 'odom', 'base'] as const).map((k) => (
            <Field key={k} label={{ map: 'Map frame', odom: 'Odometry frame', base: 'Robot base frame' }[k]} htmlFor={`set-f-${k}`}>
              <input id={`set-f-${k}`} className="input mono" value={s.frames[k]} onChange={(e) => setFrame(k, e.target.value)} spellCheck={false} />
            </Field>
          ))}
        </div>

        <h3 className="form-section">Robot footprint</h3>
        <div className="form-row">
          <Field label="Length (m)" htmlFor="set-len">
            <input
              id="set-len"
              className="input tnum"
              type="number"
              min={0.05}
              step={0.01}
              value={s.robot.length}
              onChange={(e) => setS({ ...s, robot: { ...s.robot, length: e.target.valueAsNumber || DEFAULT_SETTINGS.robot.length } })}
            />
          </Field>
          <Field label="Width (m)" htmlFor="set-wid">
            <input
              id="set-wid"
              className="input tnum"
              type="number"
              min={0.05}
              step={0.01}
              value={s.robot.width}
              onChange={(e) => setS({ ...s, robot: { ...s.robot, width: e.target.valueAsNumber || DEFAULT_SETTINGS.robot.width } })}
            />
          </Field>
        </div>

        <h3 className="form-section">Voice</h3>
        <Switch id="set-speak" checked={s.voice.speak} onChange={(v) => setS({ ...s, voice: { ...s.voice, speak: v } })} label="Speak robot questions and failures aloud" />
      </div>
    </Dialog>
  );
}
