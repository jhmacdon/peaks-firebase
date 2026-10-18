# Petrics TypeScript client (v2)

A small browser and Node client for the Petrics v2 ingest API (`/v2/track` and `/v2/engage`). Its API follows mixpanel-browser, so a Mixpanel call site moves over with few changes. It has no runtime dependencies.

The v1 client, with consent receipts and attestation, now lives in [`sdk/legacy/typescript`](../legacy/typescript/README.md).

```ts
import { createPetrics } from "@petrics/client";

const petrics = createPetrics({
  sourceKey: "<v2 source key>",
  platform: "web",
  appVersion: "4.2.0",
});

petrics.register({ plan: "pro" });            // super properties, sent with every event
petrics.track("page_viewed", { path: "/home" });

petrics.identify("user_123");                 // later events carry user_id
petrics.people.set({ name: "Ada" });
petrics.people.increment({ logins: 1 });

petrics.reset();                              // on sign-out: new anonymous id
```

## Options

| option | default | notes |
|---|---|---|
| `sourceKey` | required | sent as `X-Petrics-Source-Key` |
| `endpoint` | `https://petrics-collector-5kar4p37xq-uc.a.run.app` | |
| `platform`, `appVersion` | unset | copied into each event's `context` |
| `storage` | `localStorage`, else in-memory | any `getItem`/`setItem`/`removeItem` store |
| `fetch` | `globalThis.fetch` | |
| `flushIntervalMs` | `10000` | `0` turns off the timer; call `flush()` yourself |
| `batchSize` | `50` | at most 200 |
| `maxQueueSize` | `10000` | the oldest items go first |
| `maxEventAgeMs` | 5 days | older items are dropped before a send |
| `sessionTimeoutMs` | 30 minutes | idle time before a new `session_id` |
| `requestTimeoutMs` | `30000` | a timed-out request is retried later |

## Server use (Node)

One server process handles many users, so the shared identity (`identify`, `reset`, sessions) does not fit there. Pass the identity on every call instead:

```ts
import { createPetrics, MemoryStorage } from "@petrics/client";

const petrics = createPetrics({ sourceKey, platform: "server", storage: new MemoryStorage() });

petrics.track("invoice_paid", { amount: 42 }, { userId: "user_123" });
petrics.people.set({ plan: "pro" }, { userId: "user_123" });

await petrics.shutdown(); // before the process exits
```

When a track call names a `userId` and no `anonymousId`, the `userId` is sent as `anonymous_id` too. A call that names its own identity leaves out `session_id` unless you pass `sessionId`. A `people` call with `{ userId }` sends only `user_id`; with only `{ anonymousId }` it sends only `anonymous_id`. Super properties set with `register` still merge into every track call, including calls that pass their own identity, so on a server they reach every user's events.

## Behavior

- `track` stamps `event_id` and `time` when called, so a retry resends the same ids and the collector can drop duplicates. Event properties win over super properties.
- Events and profile updates share one queue in storage (`petrics:<hash>:queue`); identity, super properties, session and opt-out live under `petrics:<hash>:state`. `<hash>` is 12 hex digits from the source key, so two clients with different keys on one origin keep apart. On first load, a client moves any old `petrics:queue` and `petrics:state` into its own keys and deletes the old ones. Tabs that share `localStorage` re-read both keys before each change, so one tab's `identify` or queued events survive another tab's writes.
- Each event or update is checked for JSON when queued. One that cannot be serialized (a `BigInt`, a cycle) is dropped with a warning; the rest still send.
- `flush()` sends queued events first, then profile updates, one batch at a time; a batch holds at most `batchSize` items and about 900 KB of JSON. A 200 removes the batch, rejected rows included. A 400, 401, 403, 413 or 415 drops the batch and logs a warning. A 408, 429, 5xx or network error keeps the batch and stops the flush; the timer then waits 1 s, 2 s, 4 s and so on, up to 5 minutes (or longer if `Retry-After` asks). An explicit `flush()` always tries at once.
- Profile updates carry `user_id` once you call `identify`, and `anonymous_id` before that.
- `optOut()` clears the queue, persists, and turns tracking calls into no-ops until `optIn()`.
- In a browser, hiding the page or leaving it sends the queue with `fetch(..., { keepalive: true })`, at most about 60 KB per request. Items stay queued until a 2xx comes back, so anything the browser cuts off goes out on the next visit with the same ids.
- On a server, call `await petrics.shutdown()` before exit. The timer does not keep a Node process alive.

## Development

```bash
npm install
npm test
```
