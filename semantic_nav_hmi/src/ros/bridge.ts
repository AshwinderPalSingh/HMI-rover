/**
 * Connection to rosbridge with the guarantees an operator console needs.
 *
 * Why not use roslib's built-in reconnect: roslib queues every publish and
 * service call made while disconnected and replays them on reconnect
 * (Ros.callOnConnection). For a robot that means stale velocity commands or a
 * "delete" clicked minutes ago firing later. Instead:
 *
 *  - every connection attempt gets a fresh Ros instance (nothing queued survives);
 *  - publish/call refuse to run unless connected (callers get `false` / a rejection);
 *  - subscriptions live in a registry and are re-opened on each new connection;
 *  - pending service calls are rejected the moment the link drops;
 *  - publishers registered up front are advertised at connect time, so DDS
 *    discovery has finished before the first one-shot message (e.g. a voice
 *    command) is sent;
 *  - per-subscription QoS (rosbridge >= 2.0) is injected so latched topics
 *    such as /map are received even when the console connects first.
 */

import { Action, Ros, Service, Topic } from 'roslib';
import { Signal } from '../lib/emitter';

export type LinkState = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export type RosErrorKind = 'offline' | 'timeout' | 'failed';

export class RosError extends Error {
  constructor(
    message: string,
    readonly kind: RosErrorKind,
  ) {
    super(message);
    this.name = 'RosError';
  }
}

export interface QoS {
  durability?: 'transient_local' | 'volatile';
  reliability?: 'reliable' | 'best_effort';
  history?: 'keep_last' | 'keep_all';
  depth?: number;
}

/** Latched "state" topics: map, snapshots, action status. */
export const LATCHED: QoS = { durability: 'transient_local', reliability: 'reliable', history: 'keep_last', depth: 1 };

export interface SubscribeOptions {
  /** 'cbor' sends binary arrays (map cells, image bytes, scan ranges) as typed arrays */
  compression?: 'none' | 'cbor';
  /** minimum ms between messages, enforced by rosbridge */
  throttleMs?: number;
  /** rosbridge-side queue; 1 = always deliver the freshest message, drop stale ones */
  queueLength?: number;
  qos?: QoS;
}

export interface TopicStats {
  name: string;
  type: string;
  count: number;
  lastAt: number | null;
  rateHz: number;
}

interface SubRecord {
  name: string;
  type: string;
  opts: SubscribeOptions;
  cb: (msg: unknown) => void;
  topic: Topic<unknown> | null;
  count: number;
  arrivals: number[];
}

interface PubRecord {
  name: string;
  type: string;
  latch: boolean;
  topic: Topic<unknown> | null;
}

const CONNECT_TIMEOUT_MS = 6000;
const MAX_BACKOFF_MS = 8000;
const RATE_WINDOW = 40;

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'WebSocket error';
}

export class RosBridge {
  state: LinkState = 'idle';
  url = '';
  lastError: string | null = null;
  nextRetryAt: number | null = null;
  connectedAt: number | null = null;

  readonly onState = new Signal<LinkState>();
  /** Fired after a (re)connection, once subscriptions/publishers are re-opened. */
  readonly onConnect = new Signal<void>();
  /** Fired when an established connection is lost or closed. */
  readonly onDisconnect = new Signal<void>();

  private ros: Ros | null = null;
  private gen = 0;
  private attempts = 0;
  private stopped = true;
  private everConnected = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private subs = new Set<SubRecord>();
  private pubs = new Map<string, PubRecord>();
  private pending = new Set<(err: Error) => void>();

  get connected(): boolean {
    return this.state === 'connected' && !!this.ros?.isConnected;
  }

  start(url: string): void {
    this.url = url;
    this.stopped = false;
    this.attempts = 0;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const wasConnected = this.state === 'connected';
    this.teardown();
    if (wasConnected) this.onDisconnect.emit();
    this.setState('idle');
  }

  /** Skip the backoff and try again immediately (e.g. user pressed "Reconnect"). */
  reconnectNow(url?: string): void {
    if (url !== undefined) this.url = url;
    this.stopped = false;
    this.attempts = 0;
    const wasConnected = this.state === 'connected';
    this.clearTimers();
    this.teardown();
    if (wasConnected) this.onDisconnect.emit();
    this.open();
  }

  // ── connection lifecycle ──────────────────────────────────────────────

  private setState(s: LinkState): void {
    if (this.state === s) return;
    this.state = s;
    this.onState.emit(s);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.retryTimer = null;
    this.connectTimer = null;
  }

  private open(): void {
    this.clearTimers();
    this.teardown();
    const gen = ++this.gen;
    const ros = new Ros({});
    this.ros = ros;
    this.nextRetryAt = null;
    this.setState(this.everConnected ? 'reconnecting' : 'connecting');

    ros.on('connection', () => {
      if (gen !== this.gen) return;
      this.clearTimers();
      this.attempts = 0;
      this.lastError = null;
      this.everConnected = true;
      this.connectedAt = Date.now();
      this.setState('connected');
      for (const pub of this.pubs.values()) this.openPub(pub);
      for (const rec of this.subs) this.openSub(rec);
      this.onConnect.emit();
    });
    ros.on('close', () => {
      if (gen !== this.gen) return;
      this.handleDown();
    });
    ros.on('error', (e) => {
      if (gen !== this.gen) return;
      this.lastError = describeError(e);
    });

    this.connectTimer = setTimeout(() => {
      if (gen !== this.gen || this.state === 'connected') return;
      this.lastError = `No answer from ${this.url} within ${CONNECT_TIMEOUT_MS / 1000}s`;
      this.handleDown();
    }, CONNECT_TIMEOUT_MS);

    ros.connect(this.url).catch((err: unknown) => {
      if (gen !== this.gen) return;
      this.lastError = describeError(err);
      this.handleDown();
    });
  }

  private handleDown(): void {
    const wasConnected = this.state === 'connected';
    this.clearTimers();
    this.teardown();
    if (wasConnected) this.onDisconnect.emit();
    if (this.stopped) {
      this.setState('idle');
      return;
    }
    const base = Math.min(1000 * 2 ** this.attempts, MAX_BACKOFF_MS);
    const delay = Math.round(base * (0.85 + Math.random() * 0.3));
    this.attempts++;
    this.nextRetryAt = Date.now() + delay;
    this.setState('reconnecting');
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private teardown(): void {
    this.gen++;
    const ros = this.ros;
    this.ros = null;
    this.connectedAt = null;
    for (const rec of this.subs) rec.topic = null;
    for (const pub of this.pubs.values()) pub.topic = null;
    const rejects = [...this.pending];
    this.pending.clear();
    for (const reject of rejects) reject(new RosError('Connection to the robot was lost', 'offline'));
    if (ros) {
      ros.removeAllListeners();
      try {
        ros.close();
      } catch {
        /* already closed */
      }
    }
  }

  // ── subscriptions ─────────────────────────────────────────────────────

  private openSub(rec: SubRecord): void {
    const ros = this.ros;
    if (!ros || !ros.isConnected) return;
    const topic = new Topic<unknown>({
      ros,
      name: rec.name,
      messageType: rec.type,
      compression: rec.opts.compression ?? 'none',
      throttle_rate: rec.opts.throttleMs ?? 0,
      queue_length: rec.opts.queueLength ?? 0,
      reconnect_on_close: false,
    });
    const qos = rec.opts.qos;
    if (qos) {
      const send = topic.callForSubscribeAndAdvertise;
      topic.callForSubscribeAndAdvertise = (msg) =>
        send(msg.op === 'subscribe' ? ({ ...msg, qos } as typeof msg) : msg);
    }
    topic.subscribe((msg) => {
      const now = performance.now();
      rec.count++;
      rec.arrivals.push(now);
      if (rec.arrivals.length > RATE_WINDOW) rec.arrivals.shift();
      try {
        rec.cb(msg);
      } catch (err) {
        console.error(`[ros] handler for ${rec.name} failed`, err);
      }
    });
    rec.topic = topic;
  }

  subscribe<T>(name: string, type: string, cb: (msg: T) => void, opts: SubscribeOptions = {}): () => void {
    for (const other of this.subs) {
      if (other.name === name) console.warn(`[ros] duplicate subscription to ${name}`);
    }
    const rec: SubRecord = {
      name,
      type,
      opts,
      cb: cb as (msg: unknown) => void,
      topic: null,
      count: 0,
      arrivals: [],
    };
    this.subs.add(rec);
    if (this.connected) this.openSub(rec);
    return () => {
      this.subs.delete(rec);
      if (rec.topic) {
        try {
          rec.topic.unsubscribe();
        } catch {
          /* connection already gone */
        }
        rec.topic = null;
      }
    };
  }

  topicStats(): TopicStats[] {
    const now = performance.now();
    return [...this.subs].map((rec) => {
      const a = rec.arrivals;
      const last = a.length ? a[a.length - 1] : null;
      let rate = 0;
      if (a.length >= 2 && last !== null && now - last < 3000) {
        const span = (now - a[0]) / 1000;
        rate = span > 0 ? (a.length - 1) / span : 0;
      }
      return {
        name: rec.name,
        type: rec.type,
        count: rec.count,
        lastAt: last === null ? null : Date.now() - (now - last),
        rateHz: rate,
      };
    });
  }

  // ── publishers ────────────────────────────────────────────────────────

  private openPub(pub: PubRecord): void {
    const ros = this.ros;
    if (!ros || !ros.isConnected) return;
    pub.topic = new Topic<unknown>({
      ros,
      name: pub.name,
      messageType: pub.type,
      latch: pub.latch,
      queue_size: 1,
      reconnect_on_close: false,
    });
    pub.topic.advertise();
  }

  /** Declare a publisher; it is advertised on every (re)connection. */
  advertise(name: string, type: string, latch = false): void {
    if (this.pubs.has(name)) return;
    const pub: PubRecord = { name, type, latch, topic: null };
    this.pubs.set(name, pub);
    if (this.connected) this.openPub(pub);
  }

  /** Publish now, or return false if the link is down. Never queues. */
  publish<T>(name: string, type: string, msg: T): boolean {
    if (!this.connected) return false;
    let pub = this.pubs.get(name);
    if (!pub || pub.type !== type) {
      pub = { name, type, latch: false, topic: null };
      this.pubs.set(name, pub);
    }
    if (!pub.topic) this.openPub(pub);
    if (!pub.topic) return false;
    pub.topic.publish(msg);
    return true;
  }

  // ── services & actions ────────────────────────────────────────────────

  call<Req, Res>(name: string, type: string, request: Req, timeoutMs = 8000): Promise<Res> {
    const ros = this.ros;
    if (!ros || !this.connected) {
      return Promise.reject(new RosError(`Not connected to the robot (cannot call ${name})`, 'offline'));
    }
    return new Promise<Res>((resolve, reject) => {
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.pending.delete(onDrop);
        fn();
      };
      const onDrop = (err: Error) => finish(() => reject(err));
      this.pending.add(onDrop);
      const timer = setTimeout(
        () => finish(() => reject(new RosError(`${name} did not respond within ${timeoutMs / 1000}s`, 'timeout'))),
        timeoutMs,
      );
      const svc = new Service<Req, Res>({ ros, name, serviceType: type });
      svc.callService(
        request,
        (res) => finish(() => resolve(res)),
        (err) => finish(() => reject(new RosError(String(err), 'failed'))),
        timeoutMs / 1000,
      );
    });
  }

  /** Send a ROS 2 action goal. Returns the rosbridge request id, or null if offline. */
  sendActionGoal<G, F, R>(
    name: string,
    type: string,
    goal: G,
    handlers: { onResult?: (r: R) => void; onFeedback?: (f: F) => void; onError?: (e: string) => void } = {},
  ): string | null {
    const ros = this.ros;
    if (!ros || !this.connected) return null;
    const action = new Action<G, F, R>({ ros, name, actionType: type });
    return (
      action.sendGoal(
        goal,
        (r) => handlers.onResult?.(r),
        (f) => handlers.onFeedback?.(f),
        (e) => handlers.onError?.(e),
      ) ?? null
    );
  }
}

/** Default rosbridge URL: same host that served the console. */
export function defaultRosbridgeUrl(port = 9090): string {
  const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${secure ? 'wss' : 'ws'}://${h}:${port}`;
}
