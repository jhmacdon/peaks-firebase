import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Pool } from "pg";

import { reconcileFirestoreList } from "../migrate-list-record";

const databaseUrl = process.env.TEST_DATABASE_URL;
const isSafeTestDatabase = databaseUrl
  ? new URL(databaseUrl).pathname.endsWith("_test")
  : false;
const skipReason = isSafeTestDatabase
  ? undefined
  : "TEST_DATABASE_URL must name a database ending in _test";
const pool = isSafeTestDatabase ? new Pool({ connectionString: databaseUrl }) : null;

const prefix = `migrate-list-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const listId = `${prefix}-list`;
const otherListId = `${prefix}-other-list`;
const keepId = `${prefix}-keep`;
const staleId = `${prefix}-stale`;
const newId = `${prefix}-new`;
const destinationIds = [keepId, staleId, newId];

async function memberships(id: string): Promise<Array<[string, number]>> {
  const result = await pool!.query<{ destination_id: string; ordinal: number }>(
    `SELECT destination_id, ordinal
     FROM list_destinations
     WHERE list_id = $1
     ORDER BY ordinal, destination_id`,
    [id]
  );
  return result.rows.map((row) => [row.destination_id, row.ordinal]);
}

async function resetTargetList(): Promise<void> {
  await pool!.query("DELETE FROM list_destinations WHERE list_id = $1", [listId]);
  await pool!.query("UPDATE lists SET completion_target = 2 WHERE id = $1", [listId]);
  await pool!.query(
    `INSERT INTO list_destinations (list_id, destination_id, ordinal)
     VALUES ($1, $2, 0), ($1, $3, 1)`,
    [listId, keepId, staleId]
  );
}

describe("Firestore list reconciliation", { skip: skipReason }, () => {
  before(async () => {
    for (const [index, destinationId] of destinationIds.entries()) {
      await pool!.query(
        `INSERT INTO destinations (id, name, search_name, features)
         VALUES ($1, $2, $3, ARRAY['summit']::destination_feature[])`,
        [destinationId, `Migration Peak ${index}`, `migration peak ${index}`]
      );
    }
    await pool!.query(
      `INSERT INTO lists (id, name, owner, completion_target)
       VALUES ($1, 'Migration target', 'peaks', 2),
              ($2, 'Migration other', 'peaks', NULL)`,
      [listId, otherListId]
    );
    await resetTargetList();
    await pool!.query(
      `INSERT INTO list_destinations (list_id, destination_id, ordinal)
       VALUES ($1, $2, 0)`,
      [otherListId, staleId]
    );
  });

  after(async () => {
    await pool!.query("DELETE FROM lists WHERE id = ANY($1::text[])", [[listId, otherListId]]);
    await pool!.query("DELETE FROM destinations WHERE id = ANY($1::text[])", [destinationIds]);
    await pool!.end();
  });

  test("removes stale members, updates ordinals, and leaves other lists alone", async () => {
    await reconcileFirestoreList(pool!, listId, {
      name: "Migration target",
      destinations: [keepId, newId],
      completionTarget: 1,
    });

    assert.deepEqual(await memberships(listId), [[keepId, 0], [newId, 1]]);
    assert.deepEqual(await memberships(otherListId), [[staleId, 0]]);
    const result = await pool!.query("SELECT completion_target FROM lists WHERE id = $1", [listId]);
    assert.equal(result.rows[0].completion_target, 1);
  });

  test("an explicit empty roster deletes only the exact list's members", async () => {
    await reconcileFirestoreList(pool!, listId, {
      name: "Migration target",
      destinations: [],
      completionTarget: null,
    });

    assert.deepEqual(await memberships(listId), []);
    assert.deepEqual(await memberships(otherListId), [[staleId, 0]]);
  });

  test("a failed member upsert rolls back target and membership changes", async () => {
    await resetTargetList();

    await assert.rejects(
      reconcileFirestoreList(pool!, listId, {
        name: "Changed name",
        destinations: [keepId, `${prefix}-missing`],
        completionTarget: 1,
      }),
      /foreign key constraint/
    );

    assert.deepEqual(await memberships(listId), [[keepId, 0], [staleId, 1]]);
    const result = await pool!.query(
      "SELECT name, completion_target FROM lists WHERE id = $1",
      [listId]
    );
    assert.deepEqual(result.rows[0], {
      name: "Migration target",
      completion_target: 2,
    });
  });

  test("an invalid target fails without overwriting a valid SQL target", async () => {
    await assert.rejects(
      reconcileFirestoreList(pool!, listId, {
        name: "Changed name",
        destinations: [keepId, staleId],
        completionTarget: 2.5,
      }),
      /completion target must be/
    );

    const result = await pool!.query(
      "SELECT name, completion_target FROM lists WHERE id = $1",
      [listId]
    );
    assert.deepEqual(result.rows[0], {
      name: "Migration target",
      completion_target: 2,
    });
  });
});
