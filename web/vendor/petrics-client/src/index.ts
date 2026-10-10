import { migrateLegacyKeys, storageKeys, type StorageKeys } from "./keys.js";
import { PersistentQueue, type QueueItem, type QueueKind } from "./queue.js";
import { defaultStorage, type KeyValueStorage } from "./storage.js";
import { postJson, type TransportOptions } from "./transport.js";

export type { KeyValueStorage } from "./storage.js";
export { MemoryStorage } from "./storage.js";

export type PropertyValue =
  | string
  | number
  | boolean
  | null
  | (string | number | boolean | null)[]
  | Record<string, string | number | boolean | null>;
export type Properties = Record<string, PropertyValue>;

export interface PetricsOptions {
  sourceKey: string;
  /** Default "https://petrics-collector-5kar4p37xq-uc.a.run.app". */
  endpoint?: string;
  platform?: "web" | "server" | string;
  appVersion?: string;
  /** Default: localStorage when present, else in-memory. */
  storage?: KeyValueStorage;
  /** Default: globalThis.fetch. */
  fetch?: typeof fetch;
  /** Default 10_000; 0 disables the timer. */
  flushIntervalMs?: number;
  /** Default 50, max 200. */
  batchSize?: number;
  /** Default 10_000; oldest dropped first. */
  maxQueueSize?: number;
  /** Default 5 days; older queued events are dropped before send. */
  maxEventAgeMs?: number;
  /** Default 30 minutes. */
  sessionTimeoutMs?: number;
  /** Per-request timeout; default 30_000. A timeout counts as retryable. */
  requestTimeoutMs?: number;
  /** Test hook. */
  now?: () => number;
  /** Test hook; default crypto.randomUUID. */
  randomId?: () => string;
}

export interface TrackOverrides {
  userId?: string;
  anonymousId?: string;
  time?: number | Date;
  eventId?: string;
  /** Session to report when the call passes its own identity (servers). */
  sessionId?: string;
}

/** Identity for one profile update, used instead of the shared identity (servers). */
export interface ProfileIdentity {
  userId?: string;
  anonymousId?: string;
}

export interface Petrics {
  readonly anonymousId: string;
  readonly userId: string | undefined;
  track(event: string, properties?: Properties, overrides?: TrackOverrides): void;
  identify(userId: string): void;
  reset(): void;
  register(properties: Properties): void;
  registerOnce(properties: Properties): void;
  unregister(key: string): void;
  optOut(): void;
  optIn(): void;
  readonly people: {
    set(properties: Properties, identity?: ProfileIdentity): void;
    setOnce(properties: Properties, identity?: ProfileIdentity): void;
    unset(keys: string[], identity?: ProfileIdentity): void;
    increment(properties: Record<string, number>, identity?: ProfileIdentity): void;
    append(properties: Properties, identity?: ProfileIdentity): void;
    union(properties: Record<string, PropertyValue[]>, identity?: ProfileIdentity): void;
    remove(properties: Properties, identity?: ProfileIdentity): void;
  };
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export const DEFAULT_ENDPOINT = "https://petrics-collector-5kar4p37xq-uc.a.run.app";
const LIB = "petrics-js";
const LIB_VERSION = "2.0.0";
const MAX_BATCH = 200;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Normal batches stay under this many bytes of JSON body. */
const MAX_BATCH_BYTES = 900_000;
/** Keepalive requests on page unload stay under this many bytes (browser limit is 64 KiB). */
const MAX_KEEPALIVE_BYTES = 60_000;

type ProfileOp = "$set" | "$set_once" | "$unset" | "$add" | "$append" | "$union" | "$remove";

interface PersistedState {
  anonymousId: string;
  userId?: string;
  superProperties: Properties;
  optedOut: boolean;
  sessionId?: string;
  lastEventAt?: number;
}

export function createPetrics(options: PetricsOptions): Petrics {
  return new PetricsClient(options);
}

interface EventTargetLike {
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

interface FlushMode {
  keepalive: boolean;
  maxBytes: number;
}

class PetricsClient implements Petrics {
  private readonly storage: KeyValueStorage;
  private readonly keys: StorageKeys;
  private readonly transport: TransportOptions;
  private readonly queue: PersistentQueue;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly sessionTimeoutMs: number;
  private readonly context: Record<string, string>;
  private state: PersistedState;
  private inFlight: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private retryAfterMs: number | undefined;
  private stopped = false;
  /** True while the last state save failed; memory is then newer than storage. */
  private stateDirty = false;
  private unloadInFlight: Promise<void> | undefined;
  private readonly detachListeners: (() => void)[] = [];

  readonly people: Petrics["people"];

  constructor(options: PetricsOptions) {
    if (!options.sourceKey) throw new Error("Petrics: sourceKey is required");
    const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) throw new Error("Petrics: no fetch available; pass options.fetch");

    this.storage = options.storage ?? defaultStorage();
    this.keys = storageKeys(options.sourceKey);
    migrateLegacyKeys(this.storage, this.keys);
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? defaultRandomId;
    this.flushIntervalMs = Math.max(0, options.flushIntervalMs ?? 10_000);
    this.batchSize = clamp(Math.floor(options.batchSize ?? 50), 1, MAX_BATCH);
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? 30 * 60_000;
    this.transport = {
      endpoint: (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, ""),
      sourceKey: options.sourceKey,
      fetch: fetchImpl,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
    };
    this.queue = new PersistentQueue(
      this.storage,
      this.keys.queue,
      {
        maxSize: Math.max(1, options.maxQueueSize ?? 10_000),
        maxAgeMs: options.maxEventAgeMs ?? 5 * 24 * 60 * 60_000,
      },
      this.now,
    );
    this.context = buildContext(options);
    this.state = this.readStoredState() ?? this.freshState(false);

    this.people = {
      set: (properties, identity) => this.engage("$set", properties, identity),
      setOnce: (properties, identity) => this.engage("$set_once", properties, identity),
      unset: (keys, identity) => this.engage("$unset", [...keys], identity),
      increment: (properties, identity) => this.engage("$add", properties, identity),
      append: (properties, identity) => this.engage("$append", properties, identity),
      union: (properties, identity) => this.engage("$union", properties, identity),
      remove: (properties, identity) => this.engage("$remove", properties, identity),
    };

    this.attachBrowserListeners();
    this.schedule(this.flushIntervalMs);
  }

  get anonymousId(): string {
    return this.refreshState().anonymousId;
  }

  get userId(): string | undefined {
    return this.refreshState().userId;
  }

  track(event: string, properties?: Properties, overrides?: TrackOverrides): void {
    if (this.refreshState().optedOut) return;
    const now = this.now();
    const at = overrides?.time === undefined ? now : toMs(overrides.time);
    const eventId = overrides?.eventId ?? this.randomId();
    const ownIdentity = overrides?.userId !== undefined || overrides?.anonymousId !== undefined;

    let anonymousId: string;
    let userId: string | undefined;
    let sessionId: string | undefined;
    if (ownIdentity) {
      // Server style: the call names its subject; shared identity and session stay out.
      userId = overrides?.userId;
      anonymousId = overrides?.anonymousId ?? overrides!.userId!;
      sessionId = overrides?.sessionId;
    } else {
      this.mutateState((state) => {
        if (
          state.sessionId === undefined ||
          state.lastEventAt === undefined ||
          now - state.lastEventAt > this.sessionTimeoutMs
        ) {
          state.sessionId = this.randomId();
        }
        state.lastEventAt = now;
      });
      anonymousId = this.state.anonymousId;
      userId = this.state.userId;
      sessionId = overrides?.sessionId ?? this.state.sessionId;
    }

    const body = this.jsonSafe(`track("${event}")`, {
      event,
      event_id: eventId,
      time: new Date(at).toISOString(),
      anonymous_id: anonymousId,
      ...(userId === undefined ? {} : { user_id: userId }),
      ...(sessionId === undefined ? {} : { session_id: sessionId }),
      context: this.context,
      properties: { ...this.state.superProperties, ...properties },
    });
    if (body) this.queue.push({ id: eventId, kind: "event", at, body });
  }

  identify(userId: string): void {
    if (this.refreshState().optedOut) return;
    this.mutateState((state) => {
      state.userId = userId;
    });
  }

  reset(): void {
    this.mutateState((state) => {
      const optedOut = state.optedOut;
      for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key];
      Object.assign(state, { anonymousId: this.randomId(), superProperties: {}, optedOut });
    });
  }

  register(properties: Properties): void {
    if (this.refreshState().optedOut) return;
    this.mutateState((state) => {
      state.superProperties = { ...state.superProperties, ...properties };
    });
  }

  registerOnce(properties: Properties): void {
    if (this.refreshState().optedOut) return;
    this.mutateState((state) => {
      state.superProperties = { ...properties, ...state.superProperties };
    });
  }

  unregister(key: string): void {
    if (this.refreshState().optedOut) return;
    this.mutateState((state) => {
      const { [key]: _removed, ...rest } = state.superProperties;
      state.superProperties = rest;
    });
  }

  optOut(): void {
    this.mutateState((state) => {
      state.optedOut = true;
    });
    this.queue.clear();
  }

  optIn(): void {
    this.mutateState((state) => {
      state.optedOut = false;
    });
  }

  flush(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.runFlush({ keepalive: false, maxBytes: MAX_BATCH_BYTES })
        .catch(() => {})
        .finally(() => {
          this.inFlight = undefined;
          this.schedule(this.nextTimerDelay());
        });
    }
    return this.inFlight;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.clearTimer();
    for (const detach of this.detachListeners.splice(0)) detach();
    await this.flush();
    this.clearTimer();
  }

  private engage(
    op: ProfileOp,
    properties: Record<string, unknown> | string[],
    identity?: ProfileIdentity,
  ): void {
    if (this.refreshState().optedOut) return;
    const at = this.now();
    const updateId = this.randomId();
    let subject: { user_id: string } | { anonymous_id: string };
    if (identity?.userId !== undefined) subject = { user_id: identity.userId };
    else if (identity?.anonymousId !== undefined) subject = { anonymous_id: identity.anonymousId };
    else if (this.state.userId !== undefined) subject = { user_id: this.state.userId };
    else subject = { anonymous_id: this.state.anonymousId };
    const body = this.jsonSafe(`people ${op}`, {
      update_id: updateId,
      ...subject,
      op,
      properties,
      time: new Date(at).toISOString(),
    });
    if (body) this.queue.push({ id: updateId, kind: "update", at, body });
  }

  /** A JSON round trip of `body`, or undefined (with a warning) when it cannot be serialized. */
  private jsonSafe(label: string, body: Record<string, unknown>): Record<string, unknown> | undefined {
    try {
      return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    } catch (error) {
      console.warn(`Petrics: dropped ${label}; its properties cannot be serialized as JSON.`, error);
      return undefined;
    }
  }

  /**
   * Sends queued events, then queued updates. Stops at the first retryable
   * failure. Items leave the queue only on a 2xx or a permanent error.
   */
  private async runFlush(mode: FlushMode): Promise<void> {
    if (this.refreshState().optedOut) return;
    const plan: [QueueKind, "/v2/track" | "/v2/engage", "events" | "updates"][] = [
      ["event", "/v2/track", "events"],
      ["update", "/v2/engage", "updates"],
    ];
    for (const [kind, path, field] of plan) {
      for (;;) {
        if (this.refreshState().optedOut) return;
        this.queue.refresh();
        const envelope = `{"${field}":[]}`;
        const batch = this.queue.peek(kind, this.batchSize, mode.maxBytes - envelope.length);
        if (batch.length === 0) break;
        const body = `{"${field}":[${batch.map((entry) => entry.json).join(",")}]}`;
        const result = await postJson(this.transport, path, body, mode.keepalive);
        if (result.kind === "retry") {
          this.failures += 1;
          this.retryAfterMs = result.retryAfterMs;
          return;
        }
        if (result.kind === "drop") {
          console.warn(
            `Petrics: ${path} returned HTTP ${result.status}; dropped ${batch.length} item(s).`,
          );
        }
        this.failures = 0;
        this.retryAfterMs = undefined;
        this.queue.remove(batch.map((entry: { item: QueueItem }) => entry.item.id));
      }
    }
  }

  private flushOnUnload(): void {
    // visibilitychange and pagehide often fire together; keepalive requests
    // share one 64 KiB budget, so only one unload flush runs at a time.
    if (this.stopped || this.unloadInFlight) return;
    // Runs beside any timer flush; a repeat send carries the same ids.
    this.unloadInFlight = this.runFlush({ keepalive: true, maxBytes: MAX_KEEPALIVE_BYTES })
      .catch(() => {})
      .finally(() => {
        this.unloadInFlight = undefined;
      });
  }

  private attachBrowserListeners(): void {
    const win = globalThis as unknown as Partial<EventTargetLike>;
    const doc = (globalThis as { document?: Partial<EventTargetLike> & { visibilityState?: string } })
      .document;
    if (typeof win.addEventListener !== "function" || typeof win.removeEventListener !== "function") {
      return;
    }
    const listen = (target: EventTargetLike, type: string, listener: (event: any) => void) => {
      target.addEventListener(type, listener);
      this.detachListeners.push(() => target.removeEventListener(type, listener));
    };
    const winTarget = win as EventTargetLike;
    listen(winTarget, "storage", (event: { key?: string | null }) => {
      if (event?.key === this.keys.state || event?.key === null) this.refreshState();
    });
    if (doc && typeof doc.addEventListener === "function" && typeof doc.removeEventListener === "function") {
      listen(doc as EventTargetLike, "visibilitychange", () => {
        if (doc.visibilityState === "hidden") this.flushOnUnload();
      });
      listen(winTarget, "pagehide", () => this.flushOnUnload());
    }
  }

  private nextTimerDelay(): number {
    if (this.failures === 0) return this.flushIntervalMs;
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (this.failures - 1), MAX_BACKOFF_MS);
    return Math.min(Math.max(backoff, this.retryAfterMs ?? 0), MAX_BACKOFF_MS);
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    if (this.stopped || this.flushIntervalMs === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush().catch(() => {});
    }, delayMs);
    // Do not keep a Node process alive just for analytics.
    (this.timer as { unref?: () => void }).unref?.();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Re-reads stored state so another tab's identify/register/reset/opt-out is seen. */
  private refreshState(): PersistedState {
    if (this.stateDirty) {
      // A save failed: memory holds changes storage lacks. Retry, and keep
      // memory until a save succeeds.
      this.saveState();
      if (this.stateDirty) return this.state;
    }
    const stored = this.readStoredState();
    if (stored) this.state = stored;
    return this.state;
  }

  /** Read-modify-write: apply `change` to the latest stored state and save it. */
  private mutateState(change: (state: PersistedState) => void): void {
    this.refreshState();
    change(this.state);
    this.saveState();
  }

  private freshState(optedOut: boolean): PersistedState {
    this.state = { anonymousId: this.randomId(), superProperties: {}, optedOut };
    this.saveState();
    return this.state;
  }

  private readStoredState(): PersistedState | undefined {
    try {
      const raw = this.storage.getItem(this.keys.state);
      if (raw === null) return undefined;
      const parsed = JSON.parse(raw) as Partial<PersistedState> | null;
      if (!parsed || typeof parsed.anonymousId !== "string" || !parsed.anonymousId) return undefined;
      const state: PersistedState = {
        anonymousId: parsed.anonymousId,
        superProperties: isPlainObject(parsed.superProperties)
          ? (parsed.superProperties as Properties)
          : {},
        optedOut: parsed.optedOut === true,
      };
      if (typeof parsed.userId === "string") state.userId = parsed.userId;
      if (typeof parsed.sessionId === "string") state.sessionId = parsed.sessionId;
      if (typeof parsed.lastEventAt === "number") state.lastEventAt = parsed.lastEventAt;
      return state;
    } catch {
      // Corrupt or unreadable state: keep what we have (or start fresh).
      return undefined;
    }
  }

  private saveState(): void {
    try {
      this.storage.setItem(this.keys.state, JSON.stringify(this.state));
      this.stateDirty = false;
    } catch {
      // Storage full or unavailable: keep in-memory state and retry later.
      this.stateDirty = true;
    }
  }
}

function buildContext(options: PetricsOptions): Record<string, string> {
  const context: Record<string, string> = {};
  if (options.platform) context.platform = options.platform;
  if (options.appVersion) context.app_version = options.appVersion;
  context.lib = LIB;
  context.lib_version = LIB_VERSION;
  const locale = (globalThis as { navigator?: { language?: unknown } }).navigator?.language;
  if (typeof locale === "string" && locale) context.locale = locale;
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) context.timezone = timezone;
  } catch {
    // Intl missing or broken: omit timezone.
  }
  for (const key of Object.keys(context)) {
    context[key] = context[key]!.slice(0, 128);
  }
  return context;
}

function defaultRandomId(): string {
  const cryptoImpl = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoImpl?.randomUUID) return cryptoImpl.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toMs(time: number | Date): number {
  return time instanceof Date ? time.getTime() : time;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
