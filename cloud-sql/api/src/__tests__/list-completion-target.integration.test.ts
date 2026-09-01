import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import db from "../db";
import { app } from "../index";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const prefix = `list-completion-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const listId = `${prefix}-list`;
const invalidListId = `${prefix}-invalid`;
const destinationIds = [0, 1, 2].map((index) => `${prefix}-destination-${index}`);
const userId = `${prefix}-user`;

async function cleanup(): Promise<void> {
  await db.query("DELETE FROM lists WHERE id = ANY($1::text[])", [[listId, invalidListId]]);
  await db.query("DELETE FROM destinations WHERE id = ANY($1::text[])", [destinationIds]);
}

describe("list completion targets", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    for (const [index, destinationId] of destinationIds.entries()) {
      await db.query(
        `INSERT INTO destinations (id, name, search_name, features)
         VALUES ($1, $2, $3, ARRAY['summit']::destination_feature[])`,
        [destinationId, `Completion Peak ${index}`, `completion peak ${index}`]
      );
    }
    await db.query(
      `INSERT INTO lists (id, name, owner, completion_target)
       VALUES ($1, 'Partial completion test', 'peaks', 2)`,
      [listId]
    );
    for (const [ordinal, destinationId] of destinationIds.entries()) {
      await db.query(
        `INSERT INTO list_destinations (list_id, destination_id, ordinal)
         VALUES ($1, $2, $3)`,
        [listId, destinationId, ordinal]
      );
    }
  });

  after(cleanup);

  test("the database helper defaults invalid values to all current members", async () => {
    const result = await db.query<{
      configured: number;
      missing: number;
      non_positive: number;
      too_large: number;
      empty: number;
    }>(
      `SELECT effective_list_completion_target(2, 3) AS configured,
              effective_list_completion_target(NULL, 3) AS missing,
              effective_list_completion_target(0, 3) AS non_positive,
              effective_list_completion_target(4, 3) AS too_large,
              effective_list_completion_target(2, 0) AS empty`
    );

    assert.deepEqual(result.rows[0], {
      configured: 2,
      missing: 3,
      non_positive: 3,
      too_large: 3,
      empty: 0,
    });
  });

  test("the lists table rejects a stored non-positive target", async () => {
    await assert.rejects(
      db.query(
        `INSERT INTO lists (id, name, owner, completion_target)
         VALUES ($1, 'Invalid completion test', 'peaks', 0)`,
        [invalidListId]
      ),
      /lists_completion_target_positive/
    );
  });

  test("all list API reads expose member count and effective target", async () => {
    const detail = await request(app)
      .get(`/api/lists/${listId}`)
      .set("X-Test-User", userId);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.destination_count, 3);
    assert.equal(detail.body.completion_target, 2);

    const index = await request(app)
      .get("/api/lists?limit=1000")
      .set("X-Test-User", userId);
    assert.equal(index.status, 200);
    const indexRow = index.body.find((row: { id: string }) => row.id === listId);
    assert.equal(indexRow.destination_count, 3);
    assert.equal(indexRow.completion_target, 2);

    const popular = await request(app)
      .get("/api/lists/popular?limit=1000")
      .set("X-Test-User", userId);
    assert.equal(popular.status, 200);
    const popularRow = popular.body.find((row: { id: string }) => row.id === listId);
    assert.equal(popularRow.destination_count, 3);
    assert.equal(popularRow.completion_target, 2);

    const byDestination = await request(app)
      .get(`/api/lists/by-destinations?ids=${destinationIds[0]}`)
      .set("X-Test-User", userId);
    assert.equal(byDestination.status, 200);
    assert.equal(byDestination.body[0].destination_count, 3);
    assert.equal(byDestination.body[0].completion_target, 2);

    const destinationLists = await request(app)
      .get(`/api/destinations/${destinationIds[0]}/lists`)
      .set("X-Test-User", userId);
    assert.equal(destinationLists.status, 200);
    assert.equal(destinationLists.body[0].destination_count, 3);
    assert.equal(destinationLists.body[0].completion_target, 2);
  });

  test("a stale target above the roster size fails closed in API output", async () => {
    await db.query("UPDATE lists SET completion_target = 99 WHERE id = $1", [listId]);

    const response = await request(app)
      .get(`/api/lists/${listId}`)
      .set("X-Test-User", userId);

    assert.equal(response.status, 200);
    assert.equal(response.body.destination_count, 3);
    assert.equal(response.body.completion_target, 3);
  });
});
