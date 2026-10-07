import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, CircleCheck, CircleX, Info, ScrollText, TriangleAlert } from 'lucide-react';
import { fmtClock } from '../lib/format';
import { app, useApp, type LogEntry, type LogLevel } from '../state/store';
import { Segmented } from './ui';

const LEVEL_ICON: Record<LogLevel, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warn: TriangleAlert,
  error: CircleX,
};

function LevelIcon({ level, size = 13 }: { level: LogLevel; size?: number }) {
  const I = LEVEL_ICON[level];
  return <I size={size} className={`log-icon log-icon--${level}`} aria-label={level} />;
}

function EventLog() {
  const log = useApp((s) => s.log);
  const [filter, setFilter] = useState<'all' | 'warn' | 'error'>('all');
  const rows = useMemo(() => {
    const keep = (e: LogEntry) => filter === 'all' || (filter === 'warn' ? e.level === 'warn' || e.level === 'error' : e.level === 'error');
    return log.filter(keep).slice().reverse();
  }, [log, filter]);

  return (
    <section className="eventlog" aria-label="Event log">
      <header className="eventlog__head">
        <ScrollText size={15} aria-hidden />
        <h2>Event log</h2>
        <Segmented
          label="Filter events"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'warn', label: 'Warnings' },
            { value: 'error', label: 'Errors' },
          ]}
        />
        <span className="spacer" />
        <button type="button" className="link-btn" onClick={() => app().clearLog()}>
          Clear
        </button>
        <button type="button" className="link-btn" onClick={() => app().patch({ logOpen: false })}>
          Close
        </button>
      </header>
      <ol className="eventlog__list">
        {rows.length === 0 && <li className="eventlog__empty">No events.</li>}
        {rows.map((e) => (
          <li key={e.id} className={`eventlog__row eventlog__row--${e.level}`}>
            <time className="tnum">{fmtClock(e.ts)}</time>
            <LevelIcon level={e.level} />
            <span className="eventlog__src">{e.source}</span>
            <span className="eventlog__msg">{e.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function StatusBar() {
  const log = useApp((s) => s.log);
  const open = useApp((s) => s.logOpen);
  const url = useApp((s) => s.link.url);
  const state = useApp((s) => s.link.state);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const last = log[log.length - 1];
  const problems = useMemo(() => log.filter((e) => (e.level === 'error' || e.level === 'warn') && now - e.ts < 10 * 60 * 1000).length, [log, now]);

  return (
    <>
      {open && <EventLog />}
      <footer className="statusbar">
        <span className={`statusbar__link statusbar__link--${state}`}>
          <span className="statusbar__dot" aria-hidden />
          {url || 'rosbridge'}
        </span>
        <button type="button" className="statusbar__last" onClick={() => app().patch({ logOpen: !open })} aria-expanded={open}>
          {last ? (
            <>
              <LevelIcon level={last.level} />
              <span className="statusbar__src">{last.source}</span>
              <span className="statusbar__msg">{last.message}</span>
            </>
          ) : (
            <span className="muted">No events yet</span>
          )}
        </button>
        <button type="button" className="statusbar__log" onClick={() => app().patch({ logOpen: !open })} aria-expanded={open} aria-label="Toggle event log">
          <ScrollText size={13} aria-hidden />
          Log
          {problems > 0 && <span className="badge badge--warn">{problems}</span>}
          {open ? <ChevronDown size={13} aria-hidden /> : <ChevronUp size={13} aria-hidden />}
        </button>
        <time className="statusbar__clock tnum">{fmtClock(now, false)}</time>
      </footer>
    </>
  );
}
