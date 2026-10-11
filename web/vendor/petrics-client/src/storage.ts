export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** localStorage when the runtime has a working one, else in-memory storage. */
export function defaultStorage(): KeyValueStorage {
  try {
    const candidate = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (candidate) {
      const probe = "petrics:probe";
      candidate.setItem(probe, "1");
      candidate.removeItem(probe);
      return candidate;
    }
  } catch {
    // Access can throw (blocked cookies, private mode, Node without --localstorage-file).
  }
  return new MemoryStorage();
}
