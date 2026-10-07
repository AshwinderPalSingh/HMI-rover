import { useState } from 'react';
import { ShieldOff } from 'lucide-react';
import { fmtArea } from '../../lib/format';
import { polygonArea } from '../../lib/math';
import { addZone } from '../../ros/app';
import { app, useApp, type ZoneDraft } from '../../state/store';
import { Button, Dialog, Field, Segmented } from '../ui';

export function ZoneDialog({ draft }: { draft: ZoneDraft }) {
  const connected = useApp((s) => s.link.state === 'connected');
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const area = Math.abs(polygonArea(d.points));
  const ttlError = d.duration === 'one_shot' && !(d.ttl >= 5 && d.ttl <= 86400) ? 'Between 5 s and 24 h' : null;

  const close = () => app().patch({ zoneDraft: null });
  const submit = async () => {
    if (busy || ttlError) return;
    setBusy(true);
    const ok = await addZone(d);
    setBusy(false);
    if (ok) {
      close();
      app().setTool('pan');
    }
  };

  return (
    <Dialog
      title="New keep-out zone"
      icon={ShieldOff}
      onClose={close}
      initialFocus="#zone-reason"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Discard
          </Button>
          <Button variant="primary" loading={busy} disabled={!connected || !!ttlError} onClick={() => void submit()}>
            Add keep-out zone
          </Button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="muted small">
          {d.points.length} corners · {fmtArea(area)}. Nav2 will plan around this area; if the robot is inside it, it may drive out first.
        </p>
        <Field label="Reason" htmlFor="zone-reason" hint="Shown on the map and in the log">
          <input
            id="zone-reason"
            className="input"
            value={d.reason}
            onChange={(e) => setD({ ...d, reason: e.target.value })}
            placeholder="e.g. wet floor, construction"
            autoComplete="off"
            maxLength={80}
          />
        </Field>
        <div className="field">
          <span className="field__label">Duration</span>
          <Segmented
            label="Duration"
            value={d.duration}
            onChange={(v) => setD({ ...d, duration: v })}
            options={[
              { value: 'session', label: 'Until restart' },
              { value: 'one_shot', label: 'Timed' },
              { value: 'permanent', label: 'Permanent' },
            ]}
          />
        </div>
        {d.duration === 'one_shot' && (
          <Field label="Expires after (seconds)" htmlFor="zone-ttl" error={ttlError}>
            <input
              id="zone-ttl"
              className="input tnum"
              type="number"
              min={5}
              max={86400}
              step={5}
              value={Number.isFinite(d.ttl) ? d.ttl : ''}
              onChange={(e) => setD({ ...d, ttl: e.target.valueAsNumber })}
            />
          </Field>
        )}
        <Field label="Group id (optional)" htmlFor="zone-group" hint="Zones in a group can be cleared together, e.g. by voice">
          <input
            id="zone-group"
            className="input mono"
            value={d.groupId}
            onChange={(e) => setD({ ...d, groupId: e.target.value.replace(/\s+/g, '_') })}
            placeholder="group_construction"
            autoComplete="off"
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
