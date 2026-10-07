import { useEffect, useState } from 'react';
import { Activity, CircleCheck, CircleDashed, CircleX, RefreshCw } from 'lucide-react';
import { fmtAge, fmtRate } from '../../lib/format';
import { bridge, reconnect } from '../../ros/app';
import { EXPECTED_NODES } from '../../ros/names';
import type { TopicStats } from '../../ros/bridge';
import { live } from '../../state/live';
import { app, useApp } from '../../state/store';
import { Button, Dialog, StatusPill } from '../ui';

function shortType(t: string): string {
  const parts = t.split('/');
  return parts[parts.length - 1];
}

export function SystemDialog() {
  const link = useApp((s) => s.link);
  const nodes = useApp((s) => s.nodes);
  const nodesAt = useApp((s) => s.nodesAt);
  const frames = useApp((s) => s.settings.frames);
  const [stats, setStats] = useState<TopicStats[]>(() => bridge.topicStats());
  const [now, setNow] = useState(Date.now());
  const close = () => app().patch({ dialog: null });

  useEffect(() => {
    const t = setInterval(() => {
      setStats(bridge.topicStats());
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const expected = new Set(EXPECTED_NODES.flatMap((g) => g.nodes.map((n) => n.name)));
  const others = (nodes ?? []).filter((n) => !expected.has(n) && !n.startsWith('/_'));

  const tfRows = [
    { name: `${frames.map} → ${frames.odom}`, age: live.tf.edgeAge(frames.odom), parent: live.tf.parentOf(frames.odom) },
    { name: `${frames.odom} → ${frames.base}`, age: live.tf.edgeAge(frames.base), parent: live.tf.parentOf(frames.base) },
  ];

  return (
    <Dialog
      title="System health"
      icon={Activity}
      onClose={close}
      width={760}
      footer={
        <>
          <span className="muted small">{nodesAt ? `Node list ${fmtAge(now - nodesAt)}` : 'Node list unavailable'}</span>
          <span className="spacer" />
          <Button variant="secondary" icon={RefreshCw} onClick={() => reconnect()}>
            Reconnect
          </Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <div className="system">
        <section className="system__block">
          <h3>Link</h3>
          <dl className="kv">
            <dt>rosbridge</dt>
            <dd className="mono">{link.url || '—'}</dd>
            <dt>State</dt>
            <dd>
              {link.state === 'connected' ? (
                <StatusPill tone="good" icon={CircleCheck}>
                  Connected{link.connectedAt ? ` · ${fmtAge(now - link.connectedAt).replace(' ago', '')}` : ''}
                </StatusPill>
              ) : (
                <StatusPill tone={link.state === 'connecting' ? 'warning' : 'critical'} icon={CircleX}>
                  {link.state}
                </StatusPill>
              )}
            </dd>
            <dt>Round trip</dt>
            <dd className="tnum">{link.latencyMs !== null ? `${Math.round(link.latencyMs)} ms` : '—'}</dd>
            {link.lastError && (
              <>
                <dt>Last error</dt>
                <dd className="tone-critical">{link.lastError}</dd>
              </>
            )}
          </dl>

          <h3>Transforms</h3>
          <ul className="node-list">
            {tfRows.map((r) => {
              const ok = r.age !== null && r.age < 1500;
              return (
                <li key={r.name}>
                  {ok ? <CircleCheck size={14} className="tone-good" aria-label="fresh" /> : <CircleX size={14} className="tone-critical" aria-label="missing" />}
                  <span className="mono">{r.name}</span>
                  <span className="muted small">{r.age === null ? 'missing' : ok ? 'live' : `stale ${fmtAge(r.age)}`}</span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">{live.tf.frames().length} frames known</p>
        </section>

        <section className="system__block">
          <h3>Nodes</h3>
          {nodes === null ? (
            <p className="muted small">Node list unavailable — rosapi isn't reachable. It starts with semantic_nav.launch.py.</p>
          ) : (
            EXPECTED_NODES.map((g) => (
              <div key={g.group} className="node-group">
                <h4>{g.group}</h4>
                <ul className="node-list">
                  {g.nodes.map((n) => {
                    const up = nodes.includes(n.name);
                    return (
                      <li key={n.name}>
                        {up ? (
                          <CircleCheck size={14} className="tone-good" aria-label="running" />
                        ) : n.optional ? (
                          <CircleDashed size={14} className="muted" aria-label="not running" />
                        ) : (
                          <CircleX size={14} className="tone-critical" aria-label="missing" />
                        )}
                        <span>{n.label}</span>
                        <span className="muted small mono">{up ? n.name : n.optional ? 'not running' : 'missing'}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
          {others.length > 0 && (
            <details className="other-nodes">
              <summary>Other nodes ({others.length})</summary>
              <p className="mono small">{others.join('  ')}</p>
            </details>
          )}
        </section>

        <section className="system__block system__block--wide">
          <h3>Subscriptions</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Type</th>
                  <th className="num">Rate</th>
                  <th className="num">Messages</th>
                  <th className="num">Last</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((t) => (
                  <tr key={t.name}>
                    <td className="mono">{t.name}</td>
                    <td className="muted">{shortType(t.type)}</td>
                    <td className="num tnum">{fmtRate(t.rateHz)}</td>
                    <td className="num tnum">{t.count}</td>
                    <td className="num">{t.lastAt ? fmtAge(now - t.lastAt) : <span className="muted">never</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
