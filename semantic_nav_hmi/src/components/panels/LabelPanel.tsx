import { useMemo, useState } from 'react';
import { Ban, MapPinPlus, Navigation, Pencil, Search, Tags, Trash2, RefreshCw } from 'lucide-react';
import { fmtNum } from '../../lib/format';
import { avoidLabel, deleteLabel, navigateTo, refreshLabels } from '../../ros/app';
import { app, useApp, type Label } from '../../state/store';
import { LABEL_TYPES, labelTypeInfo } from '../labelTypes';
import { Button, EmptyState, IconButton } from '../ui';

function focusOnMap(l: Label) {
  const s = app();
  if (s.primary !== 'map') s.setPrimary('map');
  s.patch({ selection: { kind: 'label', id: l.id } });
  // let the primary map mount before centering
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('map-command', { detail: `focus:${l.x}:${l.y}` })));
}

function confirmDelete(l: Label) {
  app().patch({
    confirm: {
      title: `Delete "${l.name}"?`,
      body: 'The label is removed from the label database. Voice commands will no longer resolve to it.',
      confirmLabel: 'Delete label',
      danger: true,
      onConfirm: () => void deleteLabel(l),
    },
  });
}

export function LabelPanel() {
  const labels = useApp((s) => s.labels);
  const synced = useApp((s) => s.labelsSynced);
  const connected = useApp((s) => s.link.state === 'connected');
  const selection = useApp((s) => s.selection);
  const tool = useApp((s) => s.tool);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return labels.filter(
      (l) =>
        (type === 'all' || l.type === type) &&
        (!q || l.name.toLowerCase().includes(q) || l.aliases.some((a) => a.toLowerCase().includes(q)) || l.type.includes(q)),
    );
  }, [labels, query, type]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of labels) c.set(l.type, (c.get(l.type) ?? 0) + 1);
    return c;
  }, [labels]);

  return (
    <div className="panel-body panel-body--fill">
      <div className="section-head">
        <h2>
          Labels <span className="count">{labels.length}</span>
        </h2>
        <Button
          variant={tool === 'label' ? 'primary' : 'secondary'}
          size="sm"
          icon={MapPinPlus}
          onClick={() => {
            app().setPrimary('map');
            app().setTool(tool === 'label' ? 'pan' : 'label');
          }}
        >
          {tool === 'label' ? 'Placing…' : 'Add label'}
        </Button>
      </div>

      <div className="filter-row">
        <div className="input-icon">
          <Search size={14} aria-hidden />
          <input className="input" type="search" placeholder="Search names and aliases" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search labels" />
        </div>
        <select className="input select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="all">All types</option>
          {LABEL_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
              {counts.get(t.value) ? ` (${counts.get(t.value)})` : ''}
            </option>
          ))}
        </select>
      </div>

      <ul className="label-list" aria-label="Labels">
        {filtered.map((l) => {
          const T = labelTypeInfo(l.type);
          const selected = selection?.kind === 'label' && selection.id === l.id;
          return (
            <li key={l.id} className={`label-row ${selected ? 'is-selected' : ''}`}>
              <button type="button" className="label-row__main" onClick={() => focusOnMap(l)} aria-label={`Show ${l.name} on the map`}>
                <span className="label-row__icon" aria-hidden>
                  <T.icon size={14} />
                </span>
                <span className="label-row__text">
                  <span className="label-row__name">{l.name}</span>
                  <span className="label-row__meta">
                    {T.label} · ({fmtNum(l.x, 1)}, {fmtNum(l.y, 1)}){l.aliases.length > 0 && ` · aka ${l.aliases.join(', ')}`}
                  </span>
                </span>
              </button>
              <div className="label-row__actions">
                <IconButton icon={Navigation} label="Go here" size="sm" tipSide="top" disabled={!connected} onClick={() => navigateTo(l.x, l.y, null, l.name)} />
                <IconButton icon={Ban} label="Avoid (keep-out)" size="sm" tipSide="top" disabled={!connected} onClick={() => void avoidLabel(l)} />
                <IconButton
                  icon={Pencil}
                  label="Edit"
                  size="sm"
                  tipSide="top"
                  onClick={() => app().patch({ labelDraft: { id: l.id, name: l.name, aliases: l.aliases.join(', '), type: l.type, x: l.x, y: l.y, radius: l.radius } })}
                />
                <IconButton icon={Trash2} label="Delete" size="sm" tipSide="top" tone="danger" disabled={!connected} onClick={() => confirmDelete(l)} />
              </div>
            </li>
          );
        })}
      </ul>

      {labels.length === 0 && (
        <EmptyState icon={Tags} title={connected ? 'No labels yet' : 'Labels unavailable offline'}>
          {connected ? (
            <p>
              Choose <strong>Add label</strong> (or press <kbd className="kbd">L</kbd>) and click the map where a place is. Labels let you say “go to the
              park” or “avoid all houses”.
            </p>
          ) : (
            <p>Labels load from label_db_node once the robot is connected.</p>
          )}
        </EmptyState>
      )}
      {labels.length > 0 && filtered.length === 0 && <p className="muted center">No labels match the filter.</p>}

      <footer className="panel-foot">
        <span className={`sync-dot ${synced && connected ? 'is-live' : ''}`} aria-hidden />
        <span>{synced && connected ? 'Live from label_db_node' : connected ? 'Waiting for /label_list…' : 'Offline — showing last known labels'}</span>
        {connected && (
          <IconButton icon={RefreshCw} label="Reload labels" size="sm" tipSide="top" onClick={() => void refreshLabels()} />
        )}
      </footer>
    </div>
  );
}
