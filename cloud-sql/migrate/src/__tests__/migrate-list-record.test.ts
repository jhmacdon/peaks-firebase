import assert from "node:assert/strict";
import test from "node:test";

import {
  type ListMigrationClient,
  type ListMigrationPool,
  reconcileFirestoreList,
} from "../migrate-list-record";

interface FakeState {
  targets: Map<string, number | null>;
  memberships: Map<string, Map<string, number>>;
}

interface RecordedQuery {
  text: string;
  values: unknown[];
}

function cloneState(state: FakeState): FakeState {
  return {
    targets: new Map(state.targets),
    memberships: new Map(
      [...state.memberships].map(([listId, memberships]) => [
        listId,
        new Map(memberships),
      ])
    ),
  };
}

function restoreState(state: FakeState, snapshot: FakeState): void {
  state.targets.clear();
  for (const [listId, target] of snapshot.targets) state.targets.set(listId, target);
  state.memberships.clear();
  for (const [listId, memberships] of snapshot.memberships) {
    state.memberships.set(listId, new Map(memberships));
  }
}

class FakeClient implements ListMigrationClient {
  readonly calls: RecordedQuery[] = [];
  released = false;
  private snapshot: FakeState | null = null;

  constructor(
    private readonly state: FakeState,
    private readonly failDestinationId?: string
  ) {}

  async query(text: string, values: unknown[] = []): Promise<unknown> {
    const sql = text.trim();
    this.calls.push({ text: sql, values });

    if (sql === "BEGIN") {
      this.snapshot = cloneState(this.state);
    } else if (sql.startsWith("INSERT INTO lists")) {
      this.state.targets.set(values[0] as string, values[4] as number | null);
    } else if (sql.startsWith("DELETE FROM list_destinations")) {
      const listId = values[0] as string;
      const keep = new Set(values[1] as string[]);
      const memberships = this.state.memberships.get(listId) ?? new Map<string, number>();
      for (const destinationId of memberships.keys()) {
        if (!keep.has(destinationId)) memberships.delete(destinationId);
      }
      this.state.memberships.set(listId, memberships);
    } else if (sql.startsWith("INSERT INTO list_destinations")) {
      const listId = values[0] as string;
      const destinationId = values[1] as string;
      if (destinationId === this.failDestinationId) {
        throw new Error(`missing destination ${destinationId}`);
      }
      const memberships = this.state.memberships.get(listId) ?? new Map<string, number>();
      memberships.set(destinationId, values[2] as number);
      this.state.memberships.set(listId, memberships);
    } else if (sql === "COMMIT") {
      this.snapshot = null;
    } else if (sql === "ROLLBACK" && this.snapshot) {
      restoreState(this.state, this.snapshot);
      this.snapshot = null;
    }

    return { rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements ListMigrationPool {
  connectCalls = 0;

  constructor(readonly client: FakeClient) {}

  async connect(): Promise<ListMigrationClient> {
    this.connectCalls += 1;
    return this.client;
  }
}

function membershipEntries(state: FakeState, listId: string): Array<[string, number]> {
  return [...(state.memberships.get(listId) ?? new Map())];
}

test("reconcile removes stale members and upserts the full Firestore roster", async () => {
  const state: FakeState = {
    targets: new Map([["target-list", null], ["other-list", null]]),
    memberships: new Map([
      ["target-list", new Map([["keep", 4], ["stale", 5]])],
      ["other-list", new Map([["stale", 0]])],
    ]),
  };
  const client = new FakeClient(state);
  const pool = new FakePool(client);

  await reconcileFirestoreList(pool, "target-list", {
    name: "Target list",
    destinations: ["keep", "new"],
    completionTarget: 1,
  });

  assert.deepEqual(membershipEntries(state, "target-list"), [["keep", 0], ["new", 1]]);
  assert.deepEqual(membershipEntries(state, "other-list"), [["stale", 0]]);
  assert.equal(state.targets.get("target-list"), 1);
  assert.equal(client.calls[0].text, "BEGIN");
  assert.equal(client.calls.at(-1)?.text, "COMMIT");
  const removal = client.calls.find((call) => call.text.startsWith("DELETE"));
  assert.match(removal?.text ?? "", /WHERE list_id = \$1/);
  assert.match(removal?.text ?? "", /ANY\(\$2::text\[\]\)/);
  assert.deepEqual(removal?.values, ["target-list", ["keep", "new"]]);
  assert.equal(client.released, true);
});

test("an explicit empty roster removes only that list's memberships", async () => {
  const state: FakeState = {
    targets: new Map([["empty-list", 1], ["other-list", null]]),
    memberships: new Map([
      ["empty-list", new Map([["old", 0]])],
      ["other-list", new Map([["keep", 0]])],
    ]),
  };
  const client = new FakeClient(state);

  await reconcileFirestoreList(new FakePool(client), "empty-list", {
    destinations: [],
    completionTarget: null,
  });

  assert.deepEqual(membershipEntries(state, "empty-list"), []);
  assert.deepEqual(membershipEntries(state, "other-list"), [["keep", 0]]);
  assert.equal(state.targets.get("empty-list"), null);
  assert.equal(client.calls.filter((call) => call.text.startsWith("INSERT INTO list_destinations")).length, 0);
});

test("a membership failure rolls back list metadata, removals, and upserts", async () => {
  const original: FakeState = {
    targets: new Map([["target-list", 2]]),
    memberships: new Map([
      ["target-list", new Map([["keep", 0], ["stale", 1]])],
    ]),
  };
  const state = cloneState(original);
  const client = new FakeClient(state, "missing");

  await assert.rejects(
    reconcileFirestoreList(new FakePool(client), "target-list", {
      destinations: ["keep", "missing"],
      completionTarget: 1,
    }),
    /missing destination missing/
  );

  assert.deepEqual(state, original);
  assert.equal(client.calls[0].text, "BEGIN");
  assert.equal(client.calls.at(-1)?.text, "ROLLBACK");
  assert.equal(client.released, true);
});

test("an invalid explicit target fails before checkout and preserves SQL state", async () => {
  const invalidTargets: unknown[] = [1.5, 0, -1, 3, "1", Number.NaN];

  for (const completionTarget of invalidTargets) {
    const original: FakeState = {
      targets: new Map([["target-list", 1]]),
      memberships: new Map([
        ["target-list", new Map([["keep", 0], ["second", 1]])],
      ]),
    };
    const state = cloneState(original);
    const pool = new FakePool(new FakeClient(state));

    await assert.rejects(
      reconcileFirestoreList(pool, "target-list", {
        destinations: ["keep", "second"],
        completionTarget,
      }),
      /completion target must be/
    );

    assert.equal(pool.connectCalls, 0);
    assert.deepEqual(state, original);
    assert.deepEqual(pool.client.calls, []);
  }
});
