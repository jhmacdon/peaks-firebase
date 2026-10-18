import type { KeyValueStorage } from "./storage.js";

/** Keys used before storage was split by source key. */
export const LEGACY_STATE_KEY = "petrics:state";
export const LEGACY_QUEUE_KEY = "petrics:queue";

export interface StorageKeys {
  state: string;
  queue: string;
}

/**
 * 64-bit FNV-1a over the UTF-16 code units, as 16 hex digits. Not a secret: it only keeps two
 * source keys on one origin from sharing storage.
 */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** `petrics:<12 hex digits of the source key's hash>:state` and `...:queue`. */
export function storageKeys(sourceKey: string): StorageKeys {
  const prefix = `petrics:${fnv1a64(sourceKey).slice(0, 12)}`;
  return { state: `${prefix}:state`, queue: `${prefix}:queue` };
}

/**
 * Moves the old shared keys into this source key's keys, once: the first client to load takes
 * them, and the old keys go away. Keys this client already has win over the old ones.
 */
export function migrateLegacyKeys(storage: KeyValueStorage, keys: StorageKeys): void {
  for (const [legacy, current] of [[LEGACY_STATE_KEY, keys.state], [LEGACY_QUEUE_KEY, keys.queue]] as const) {
    try {
      const old = storage.getItem(legacy);
      if (old === null) continue;
      if (storage.getItem(current) === null) storage.setItem(current, old);
      storage.removeItem(legacy);
    } catch {
      // Unreadable or full storage: leave the old key for a later load.
    }
  }
}
