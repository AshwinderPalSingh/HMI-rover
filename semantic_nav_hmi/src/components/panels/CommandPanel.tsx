import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Loader,
  Mic,
  MicOff,
  Navigation,
  OctagonX,
  Send,
  ShieldOff,
  Trash2,
  Volume2,
  VolumeX,
  Info,
  CircleHelp,
} from 'lucide-react';
import { fmtDuration, fmtMeters, fmtNum } from '../../lib/format';
import { answerQuestion, cancelNavigation, describeTarget, removeZone, sendCommand } from '../../ros/app';
import { navProgress } from '../../ros/navstate';
import { speechInputBlocker, startListening, stopListening } from '../../speech/speech';
import { app, useApp, type ChatMessage } from '../../state/store';
import { Button, EmptyState, IconButton, Meter, StatusPill } from '../ui';

function NavCard() {
  const nav = useApp((s) => s.nav);
  const connected = useApp((s) => s.link.state === 'connected');
  const pathLen = useApp((s) => s.plannedPathLength);
  const vel = useApp((s) => s.velocity);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const active = nav.phase === 'active' || nav.phase === 'pending' || nav.phase === 'canceling';
  const recent = nav.endedAt !== null && now - nav.endedAt < 30000;
  if (!active && !recent) return null;

  const progress = nav.phase === 'succeeded' ? 1 : navProgress(nav.distanceRemaining, nav.initialDistance);
  const moving = (vel?.linear ?? 0) > 0.02;
  const eta = nav.etaSec !== null && nav.etaSec > 0 && nav.etaSec < 3600 && moving ? nav.etaSec : null;
  const remaining = nav.distanceRemaining ?? (nav.phase === 'active' ? pathLen : null);

  const head = {
    pending: { tone: 'accent' as const, icon: Loader, text: 'Sending goal' },
    active: { tone: 'accent' as const, icon: Navigation, text: 'Navigating' },
    canceling: { tone: 'warning' as const, icon: Loader, text: 'Canceling' },
    succeeded: { tone: 'good' as const, icon: CircleCheck, text: 'Arrived' },
    canceled: { tone: 'neutral' as const, icon: CircleX, text: 'Canceled' },
    aborted: { tone: 'critical' as const, icon: CircleX, text: 'Failed' },
    idle: { tone: 'neutral' as const, icon: Navigation, text: 'Idle' },
  }[nav.phase];

  return (
    <section className={`nav-card nav-card--${nav.phase}`} aria-label="Navigation status">
      <div className="nav-card__head">
        <StatusPill tone={head.tone} icon={head.icon}>
          {head.text}
        </StatusPill>
        <span className="nav-card__target" title={nav.target ? `(${fmtNum(nav.target.x)}, ${fmtNum(nav.target.y)})` : undefined}>
          {nav.target ? describeTarget(nav.target) : nav.source === 'external' ? 'Goal from another client' : 'Goal'}
        </span>
      </div>
      <Meter value={progress} tone={nav.phase === 'aborted' ? 'critical' : nav.phase === 'succeeded' ? 'good' : 'accent'} label="Navigation progress" />
      <dl className="nav-card__stats">
        <div>
          <dt>Remaining</dt>
          <dd className="tnum">{remaining !== null ? fmtMeters(remaining) : '—'}</dd>
        </div>
        <div>
          <dt>ETA</dt>
          <dd className="tnum">{active ? (eta !== null ? fmtDuration(eta) : '—') : '—'}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd className="tnum">{fmtDuration(nav.elapsedSec)}</dd>
        </div>
        <div>
          <dt>Recoveries</dt>
          <dd className={`tnum ${nav.recoveries > 0 ? 'tone-warning' : ''}`}>{nav.recoveries}</dd>
        </div>
      </dl>
      {active && (
        <Button variant="danger" size="sm" icon={OctagonX} disabled={!connected || nav.phase === 'canceling'} onClick={() => void cancelNavigation()}>
          Cancel navigation
        </Button>
      )}
    </section>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.role === 'user') {
    return (
      <li className="msg msg--user">
        <span className="msg__bubble">{m.text}</span>
      </li>
    );
  }
  const icon =
    m.kind === 'pending' ? (
      <Loader size={14} className="spin" aria-hidden />
    ) : m.kind === 'success' ? (
      <CircleCheck size={14} className="tone-good" aria-hidden />
    ) : m.kind === 'error' ? (
      <CircleX size={14} className="tone-critical" aria-hidden />
    ) : m.kind === 'noreply' ? (
      <CircleAlert size={14} className="tone-warning" aria-hidden />
    ) : m.kind === 'question' ? (
      <CircleHelp size={14} className="tone-accent" aria-hidden />
    ) : (
      <Info size={14} className="muted" aria-hidden />
    );
  return (
    <li className={`msg msg--system msg--${m.kind}`}>
      <span className="msg__icon">{icon}</span>
      <div className="msg__content">
        <span className="msg__text">{m.text}</span>
        {m.kind === 'question' && m.options && m.options.length > 0 && (
          <div className="msg__options" role="group" aria-label="Choose an answer">
            {m.options.map((o) => (
              <button key={o} type="button" className="chip" disabled={m.answered} onClick={() => answerQuestion(m.id, o)}>
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function Conversation() {
  const chat = useApp((s) => s.chat);
  const labels = useApp((s) => s.labels);
  const listening = useApp((s) => s.listening);
  const interim = useApp((s) => s.interim);
  const connected = useApp((s) => s.link.state === 'connected');
  const speak = useApp((s) => s.settings.voice.speak);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const micBlocker = useMemo(() => speechInputBlocker(), []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, interim]);

  const suggestions = useMemo(() => {
    const out: string[] = [];
    if (labels[0]) out.push(`go to ${labels[0].name}`);
    if (labels[1]) out.push(`avoid ${labels[1].name}`);
    const houses = labels.filter((l) => l.type === 'house').length;
    if (houses > 1) out.push('avoid all houses');
    out.push('cancel');
    return out;
  }, [labels]);

  const submit = (value = text) => {
    if (sendCommand(value)) setText('');
    inputRef.current?.focus();
  };

  return (
    <section className="conversation" aria-label="Command conversation">
      <ul ref={listRef} className="conversation__list" aria-live="polite">
        {chat.length === 0 && (
          <li className="conversation__empty">
            <p>Tell the robot where to go or what to avoid, in plain language.</p>
            <div className="conversation__suggest">
              {suggestions.map((s) => (
                <button key={s} type="button" className="chip" disabled={!connected} onClick={() => submit(s)}>
                  “{s}”
                </button>
              ))}
            </div>
          </li>
        )}
        {chat.map((m) => (
          <Message key={m.id} m={m} />
        ))}
        {listening && (
          <li className="msg msg--user msg--interim">
            <span className="msg__bubble">{interim || 'Listening…'}</span>
          </li>
        )}
      </ul>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          className="input composer__input"
          placeholder={connected ? 'e.g. go to the park' : 'Connect to send commands'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Command"
          autoComplete="off"
          enterKeyHint="send"
        />
        <IconButton
          icon={listening ? MicOff : Mic}
          label={micBlocker ?? (listening ? 'Stop listening' : 'Speak a command')}
          shortcut={micBlocker ? undefined : 'M'}
          active={listening}
          disabled={!connected || micBlocker !== null}
          tipSide="top"
          onClick={() => (listening ? stopListening() : startListening((t) => sendCommand(t)))}
        />
        <IconButton icon={Send} label="Send command" tipSide="top" disabled={!connected || !text.trim()} type="submit" onClick={undefined} />
      </form>
      <div className="conversation__foot">
        <button type="button" className="link-btn" onClick={() => app().updateSettings({ voice: { speak: !speak } })} aria-pressed={speak}>
          {speak ? <Volume2 size={13} aria-hidden /> : <VolumeX size={13} aria-hidden />} {speak ? 'Spoken replies on' : 'Spoken replies off'}
        </button>
        {chat.length > 0 && (
          <button type="button" className="link-btn" onClick={() => app().clearChat()}>
            Clear conversation
          </button>
        )}
      </div>
    </section>
  );
}

function ZoneList() {
  const zones = useApp((s) => s.zones);
  const synced = useApp((s) => s.zonesSynced);
  const connected = useApp((s) => s.link.state === 'connected');
  const tool = useApp((s) => s.tool);
  const selection = useApp((s) => s.selection);

  return (
    <section className="zones" aria-label="Keep-out zones">
      <div className="section-head section-head--sub">
        <h3>
          Keep-out zones <span className="count">{zones.length}</span>
        </h3>
        <Button
          size="sm"
          variant={tool === 'zone' ? 'primary' : 'secondary'}
          icon={ShieldOff}
          disabled={!connected}
          onClick={() => {
            app().setPrimary('map');
            app().setTool(tool === 'zone' ? 'pan' : 'zone');
          }}
        >
          {tool === 'zone' ? 'Drawing…' : 'Draw zone'}
        </Button>
      </div>
      {zones.length === 0 ? (
        <p className="muted small">
          {connected && !synced ? 'Waiting for /keepout_zone_list (is the global costmap up?)' : 'No active keep-out zones. Draw one or say “avoid the park”.'}
        </p>
      ) : (
        <ul className="zone-list">
          {zones.map((z) => (
            <li key={z.id} className={`zone-row ${selection?.kind === 'zone' && selection.id === z.id ? 'is-selected' : ''}`}>
              <button
                type="button"
                className="zone-row__main"
                onClick={() => {
                  app().setPrimary('map');
                  app().patch({ selection: { kind: 'zone', id: z.id } });
                  const c = z.points.reduce((a, p) => ({ x: a.x + p.x / z.points.length, y: a.y + p.y / z.points.length }), { x: 0, y: 0 });
                  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('map-command', { detail: `focus:${c.x}:${c.y}` })));
                }}
              >
                <OctagonX size={14} className="tone-critical" aria-hidden />
                <span className="zone-row__text">
                  <span className="zone-row__name">{z.reason || 'Keep-out zone'}</span>
                  <span className="zone-row__meta">
                    {z.duration.replace('_', '-')}
                    {z.groupId ? ` · ${z.groupId}` : ''}
                  </span>
                </span>
              </button>
              <IconButton icon={Trash2} label="Remove zone" size="sm" tone="danger" tipSide="left" disabled={!connected} onClick={() => void removeZone(z)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CommandPanel() {
  const connected = useApp((s) => s.link.state === 'connected');
  return (
    <div className="panel-body panel-body--fill">
      <div className="section-head">
        <h2>Command</h2>
      </div>
      <NavCard />
      {!connected && <EmptyState icon={CircleAlert} title="Not connected">Commands are sent once the link to the robot is back.</EmptyState>}
      <Conversation />
      <ZoneList />
    </div>
  );
}
