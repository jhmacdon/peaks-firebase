import type { KeyValueStorage } from "./storage.js";

export type QueueKind = "event" | "update";

export interface QueueItem {
  /** Stable id used to remove the item after a send; equals event_id or update_id. */
  id: string;
  kind: QueueKind;
  /** Epoch ms the item describes; used for the age limit. */
  at: number;
  /** The JSON-safe body sent to the collector. */
  body: Record<string, unknown>;
}

export interface QueueLimits {
  maxSize: number;
  maxAgeMs: number;
}

/**
 * A persisted FIFO of pending events and profile updates.
 *
 * Several tabs can share one storage, so every change re-reads the stored
 * array and merges: stored items stay, this instance's not-yet-stored items
 * are added, and ids this instance sent or dropped are removed. The size and
 * age limits apply after the merge. If storage cannot be written, the merged
 * list stays in memory and the pending changes are retried on the next sync.
 */
export class PersistentQueue {
  private items: QueueItem[] = [];
  private unsaved: QueueItem[] = [];
  private readonly removed = new Set<string>();

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly key: string,
    private readonly limits: QueueLimits,
    private readonly now: () => number,
  ) {
    this.items = this.load() ?? [];
  }

  get size(): number {
    return this.items.length;
  }

  push(item: QueueItem): void {
    this.unsaved.push(item);
    this.sync();
  }

  /** Re-reads storage and drops items past the age limit. */
  refresh(): void {
    this.sync();
  }

  /**
   * The oldest items of one kind, at most `count` of them and at most
   * `maxBytes` of serialized JSON (always at least one item).
   */
  peek(kind: QueueKind, count: number, maxBytes: number): { item: QueueItem; json: string }[] {
    const batch: { item: QueueItem; json: string }[] = [];
    let bytes = 0;
    for (const item of this.items) {
      if (batch.length >= count) break;
      if (item.kind !== kind) continue;
      const json = JSON.stringify(item.body);
      const size = utf8Length(json) + 1;
      if (batch.length > 0 && bytes + size > maxBytes) break;
      batch.push({ item, json });
      bytes += size;
    }
    return batch;
  }

  remove(ids: Iterable<string>): void {
    for (const id of ids) this.removed.add(id);
    this.unsaved = this.unsaved.filter((item) => !this.removed.has(item.id));
    this.sync();
  }

  clear(): void {
    for (const item of this.items) this.removed.add(item.id);
    this.unsaved = [];
    this.items = [];
    try {
      this.storage.removeItem(this.key);
      this.removed.clear();
    } catch {
      // Keep the removed ids so a later sync still deletes them.
    }
  }

  private sync(): void {
    const stored = this.load();
    const base = stored ?? this.items;
    const merged = base.filter((item) => !this.removed.has(item.id));
    const present = new Set(merged.map((item) => item.id));
    for (const item of this.unsaved) {
      if (!present.has(item.id) && !this.removed.has(item.id)) {
        merged.push(item);
        present.add(item.id);
      }
    }
    const cutoff = this.now() - this.limits.maxAgeMs;
    let limited = merged.filter((item) => item.at >= cutoff);
    const overflow = limited.length - this.limits.maxSize;
    if (overflow > 0) limited = limited.slice(overflow);
    this.items = limited;

    try {
      if (limited.length === 0) this.storage.removeItem(this.key);
      else this.storage.setItem(this.key, JSON.stringify(limited));
      this.unsaved = [];
      this.removed.clear();
    } catch {
      // Storage full or unavailable: keep the pending changes in memory.
      const kept = new Set(limited.map((item) => item.id));
      this.unsaved = this.unsaved.filter((item) => kept.has(item.id));
    }
  }

  /** The stored array, `[]` when missing or corrupt, `null` when unreadable. */
  private load(): QueueItem[] | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return null;
    }
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isQueueItem) : [];
    } catch {
      return [];
    }
  }
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function isQueueItem(value: unknown): value is QueueItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<QueueItem>;
  return (
    typeof item.id === "string" &&
    (item.kind === "event" || item.kind === "update") &&
    typeof item.at === "number" &&
    typeof item.body === "object" &&
    item.body !== null
  );
}
