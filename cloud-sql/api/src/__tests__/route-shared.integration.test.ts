import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import db from "../db";
import { app } from "../index";
import { dbSkipReason } from "./helpers/test-db";

const prefix = `shared-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const id = (name: string) => `${prefix}-${name}`;
const names = ["source", "long", "short", "private", "party", "pending", "superseded", "unrelated"];
const routeIds = names.map(id);
const segmentIds = ["a", "b", "c"].map(id);
const planIds = ["plan", "foreign-plan"].map(id);
const overflowIds = Array.from({ length: 21 }, (_, i) => id(`extra-${i}`));

async function cleanup(): Promise<void> {
  await db.query("DELETE FROM plans WHERE id = ANY($1)", [planIds]);
  await db.query("DELETE FROM routes WHERE id = ANY($1)", [[...routeIds, ...overflowIds]]);
  await db.query("DELETE FROM segments WHERE id = ANY($1)", [segmentIds]);
}

describe("GET /api/routes/:id/shared", { skip: dbSkipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    await db.query(
      "INSERT INTO segments (id, distance) VALUES ($1, 3000), ($2, 2000), ($3, 1000)",
      segmentIds
    );
    for (const name of names) {
      const owner = name === "private" ? id("stranger") : name === "party" ? id("host") : "peaks";
      const status = name === "pending" || name === "superseded" ? name : "active";
      await db.query(
        `INSERT INTO routes (id, name, owner, status, distance, gain, gain_loss, shape)
         VALUES ($1, $2, $3, $4, 9300, 1450, 100, 'point_to_point')`,
        [id(name), name, owner, status]
      );
      const pieces = name === "unrelated" ? ["c"] : name === "short" ? ["a"] : ["a", "b"];
      // Both source and neighbor repeat a segment: shared distance must still be 5000.
      if (name === "source" || name === "long") pieces.push("a");
      for (const [ordinal, segment] of pieces.entries()) {
        await db.query(
          "INSERT INTO route_segments (route_id, segment_id, ordinal) VALUES ($1, $2, $3)",
          [id(name), id(segment), ordinal]
        );
      }
    }
    await db.query(
      `INSERT INTO plans (id, user_id, name, is_public)
       VALUES ($1, $2, 'Shared plan', false), ($3, $4, 'Foreign route plan', true)`,
      [id("plan"), id("host"), id("foreign-plan"), id("caller")]
    );
    await db.query("INSERT INTO plan_party (plan_id, user_id) VALUES ($1, $2)", [id("plan"), id("caller")]);
    await db.query(
      "INSERT INTO plan_routes (plan_id, route_id) VALUES ($1, $2), ($3, $4)",
      [id("plan"), id("party"), id("foreign-plan"), id("private")]
    );
  });
  after(cleanup);

  test("requires authentication", async () => {
    assert.equal((await request(app).get(`/api/routes/${id("source")}/shared`)).status, 401);
  });

  test("orders visible active neighbors, counts segments once, and returns numeric facts", async () => {
    const response = await request(app).get(`/api/routes/${id("source")}/shared`).set("X-Test-User", id("caller"));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map((row: any) => row.id), ["long", "party", "short"].map(id));
    assert.deepEqual(response.body.map((row: any) => row.shared_distance), [5000, 5000, 3000]);
    assert.deepEqual(response.body[0].shared_segment_ids, [id("a"), id("b")]);
    assert.equal(response.body[0].distance, 9300);
    assert.equal(response.body[0].gain, 1450);
    assert.equal(response.body[0].difficulty, "hard");
    assert.equal(response.body[0].kind, "destination");
  });

  test("hides inaccessible or inactive source routes as well as neighbors", async () => {
    for (const name of ["private", "pending", "superseded", "missing"]) {
      const response = await request(app).get(`/api/routes/${id(name)}/shared`).set("X-Test-User", id("caller"));
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, []);
    }
    const owned = await request(app).get(`/api/routes/${id("private")}/shared`).set("X-Test-User", id("stranger"));
    assert.equal(owned.status, 200);
    assert.deepEqual(owned.body.map((row: any) => row.id), ["long", "source", "short"].map(id));
  });

  test("limits the shared list to 20 routes", async () => {
    try {
      await db.query(
        "INSERT INTO routes (id, name) SELECT extra, extra FROM unnest($1::text[]) extra",
        [overflowIds]
      );
      await db.query(
        "INSERT INTO route_segments (route_id, segment_id) SELECT extra, $2 FROM unnest($1::text[]) extra",
        [overflowIds, id("a")]
      );
      const response = await request(app).get(`/api/routes/${id("source")}/shared`).set("X-Test-User", id("caller"));
      assert.equal(response.status, 200);
      assert.equal(response.body.length, 20);
      assert.equal(new Set(response.body.map((row: any) => row.id)).size, 20);
    } finally {
      await db.query("DELETE FROM routes WHERE id = ANY($1)", [overflowIds]);
    }
  });
});
