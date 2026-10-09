import { FieldValue, type Firestore } from "firebase-admin/firestore";

// Stateful Firebase double: endpoint tests use real SQL when TEST_DATABASE_URL
// is set, while all Firebase and Strava work stays in this process.
export class AccountFirestore {
  readonly documents = new Map<string, Record<string, any>>();
  failDelete = false;
  failAfterChildDelete = false;
  ref(path: string): any {
    return {
      path,
      id: path.split("/").at(-1),
      collection: (name: string) => this.collection(`${path}/${name}`),
      listCollections: async () => [...new Set([...this.documents.keys()]
        .filter((key) => key.startsWith(`${path}/`))
        .map((key) => key.split("/").slice(0, path.split("/").length + 1).join("/")))]
        .map((collection) => ({ path: collection })),
      get: async () => ({ exists: this.documents.has(path), data: () => this.documents.get(path) }),
      set: async (value: Record<string, any>, options?: { merge: boolean }) => {
        this.documents.set(path, options?.merge ? { ...this.documents.get(path), ...value } : value);
      },
      update: async (value: Record<string, any>) => {
        const data = { ...this.documents.get(path) };
        for (const [key, next] of Object.entries(value)) {
          if (next instanceof FieldValue) {
            if (next.isEqual(FieldValue.delete())) delete data[key];
            else {
              // Use the SDK's own equality method to check arrayRemove without
              // depending on its private serialization fields.
              data[key] = (data[key] ?? []).filter((item: string) => !next.isEqual(FieldValue.arrayRemove(item)));
            }
          } else data[key] = next;
        }
        this.documents.set(path, data);
      },
      delete: async () => { this.documents.delete(path); },
    };
  }
  collection(path: string): any {
    const query = (filters: Array<[string, string, string]> = [], limit = Infinity): any => ({
      doc: (id: string) => this.ref(`${path}/${id}`),
      where: (field: string, op: string, value: string) => query([...filters, [field, op, value]], limit),
      limit: (value: number) => query(filters, value),
      get: async () => {
        const docs = [...this.documents].filter(([key, data]) =>
          key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1 &&
          filters.every(([field, op, value]) => op === "==" ? data[field] === value : data[field]?.includes(value))
        ).slice(0, limit).map(([key, data]) => ({
          id: key.split("/").at(-1), data: () => data, ref: this.ref(key),
        }));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    });
    return query();
  }
  async recursiveDelete(ref: { path: string }) {
    if (this.failDelete) { this.failDelete = false; throw new Error("Firestore unavailable"); }
    for (const path of this.documents.keys()) {
      if (path === ref.path || path.startsWith(`${ref.path}/`)) {
        this.documents.delete(path);
        if (this.failAfterChildDelete) {
          this.failAfterChildDelete = false;
          throw new Error("recursive deletion failed partway through");
        }
      }
    }
  }
  async runTransaction(run: (tx: any) => Promise<any>) {
    return run({ get: (ref: any) => ref.get(), set: (ref: any, ...args: any[]) => ref.set(...args) });
  }
  bulkWriter(): any {
    const pending: Promise<any>[] = [];
    return {
      set: (ref: any, ...args: any[]) => pending.push(ref.set(...args)),
      delete: (ref: any) => pending.push(ref.delete()),
      close: () => Promise.all(pending),
    };
  }
  asFirestore(): Firestore { return this as unknown as Firestore; }
}

export class AccountStorage {
  readonly files = new Set<string>();
  failDelete = false;
  bucket() {
    const file = (name: string): any => ({
      name,
      exists: async () => [this.files.has(name)],
      copy: async (target: { name: string }) => { this.files.add(target.name); },
      delete: async () => {
        if (this.failDelete) { this.failDelete = false; throw new Error("Storage unavailable"); }
        this.files.delete(name);
      },
    });
    return {
      file,
      getFiles: async ({ prefix }: { prefix: string }) => [
        [...this.files].filter((name) => name.startsWith(prefix)).map(file),
      ],
    };
  }
}
