import { useState } from 'react';
import { Tag } from 'lucide-react';
import { saveLabel } from '../../ros/app';
import { app, useApp, type LabelDraft } from '../../state/store';
import { LABEL_TYPES } from '../labelTypes';
import { Button, Dialog, Field } from '../ui';

export function LabelDialog({ draft }: { draft: LabelDraft }) {
  const labels = useApp((s) => s.labels);
  const connected = useApp((s) => s.link.state === 'connected');
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const editing = !!draft.id;

  const name = d.name.trim();
  const duplicate = labels.some((l) => l.id !== d.id && l.name.trim().toLowerCase() === name.toLowerCase());
  const nameError = !name ? 'A name is required' : duplicate ? 'Another label already has this name — voice commands would be ambiguous' : null;
  const radiusError = !(d.radius >= 0.1 && d.radius <= 50) ? 'Radius must be between 0.1 and 50 m' : null;
  const posError = !Number.isFinite(d.x) || !Number.isFinite(d.y) ? 'Position must be numeric' : null;
  const valid = !nameError && !radiusError && !posError;

  const close = () => app().patch({ labelDraft: null });
  const submit = async () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    const ok = await saveLabel({ ...d, name });
    setBusy(false);
    // stay in the label tool: labelling sessions usually place several in a row
    if (ok) close();
  };

  return (
    <Dialog
      title={editing ? `Edit label` : 'New label'}
      icon={Tag}
      onClose={close}
      initialFocus="#label-name"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!connected || (touched && !valid)} onClick={() => void submit()}>
            {editing ? 'Save changes' : 'Create label'}
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
        <Field label="Name" htmlFor="label-name" error={touched ? nameError : null} hint="What people will call it, e.g. “Ash's house”">
          <input
            id="label-name"
            className="input"
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            onBlur={() => setTouched(true)}
            autoComplete="off"
            maxLength={80}
          />
        </Field>
        <Field label="Aliases" htmlFor="label-aliases" hint="Comma-separated alternatives the resolver should match">
          <input
            id="label-aliases"
            className="input"
            value={d.aliases}
            onChange={(e) => setD({ ...d, aliases: e.target.value })}
            placeholder="e.g. home, the blue house"
            autoComplete="off"
          />
        </Field>
        <div className="field">
          <span className="field__label" id="label-type-label">
            Type
          </span>
          <div className="type-grid" role="radiogroup" aria-labelledby="label-type-label">
            {LABEL_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={d.type === t.value}
                className={`type-chip ${d.type === t.value ? 'is-active' : ''}`}
                onClick={() => setD({ ...d, type: t.value })}
              >
                <t.icon size={15} aria-hidden />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="form-row">
          <Field label="Radius (m)" htmlFor="label-radius" error={touched ? radiusError : null}>
            <input
              id="label-radius"
              className="input tnum"
              type="number"
              min={0.1}
              max={50}
              step={0.1}
              value={Number.isFinite(d.radius) ? d.radius : ''}
              onChange={(e) => setD({ ...d, radius: e.target.valueAsNumber })}
            />
          </Field>
          <Field label="x (m)" htmlFor="label-x">
            <input
              id="label-x"
              className="input tnum"
              type="number"
              step={0.05}
              value={Number.isFinite(d.x) ? Number(d.x.toFixed(3)) : ''}
              onChange={(e) => setD({ ...d, x: e.target.valueAsNumber })}
            />
          </Field>
          <Field label="y (m)" htmlFor="label-y" error={touched ? posError : null}>
            <input
              id="label-y"
              className="input tnum"
              type="number"
              step={0.05}
              value={Number.isFinite(d.y) ? Number(d.y.toFixed(3)) : ''}
              onChange={(e) => setD({ ...d, y: e.target.valueAsNumber })}
            />
          </Field>
        </div>
        {!connected && <p className="callout callout--critical">Not connected — the label can't be saved until the link is back.</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
