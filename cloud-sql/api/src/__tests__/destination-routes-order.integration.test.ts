import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import db from "../db";
import { app } from "../index";
import { dbSkipReason } from "./helpers/test-db";

const prefix = `dest-routes-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const id = (name: string) => `${prefix}-${name}`;
// name → popularity. "Alpha" sorts first by name but is the least popular.
const routes: [string, number][] = [["Alpha Trail", 0], ["Bravo Trail", 7], ["Charlie Trail", 7], ["Delta Trail", 30]];

async function cleanup(): Promise<void> {
  await db.query("DELETE FROM routes WHERE id LIKE $1", [`${prefix}-%`]);
  await db.query("DELETE FROM destinations WHERE id = $1", [id("lake")]);
}

describe("GET /api/destinations/:id/routes", { skip: dbSkipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    await db.query(
      "INSERT INTO destinations (id, name, search_name, features) VALUES ($1, 'Order Lake', 'order lake', '{lake}')",
      [id("lake")]
    );
    for (const [ordinal, [name, popularity]] of routes.entries()) {
      await db.query(
        `INSERT INTO routes (id, name, owner, status, distance, gain, gain_loss, shape, kind, popularity)
         VALUES ($1, $2, 'peaks', 'active', 4000, 300, 20, 'out_and_back', 'destination', $3)`,
        [id(`r${ordinal}`), name, popularity]
      );
      await db.query(
        "INSERT INTO route_destinations (route_id, destination_id, ordinal) VALUES ($1, $2, 0)",
        [id(`r${ordinal}`), id("lake")]
      );
    }
  });
  after(cleanup);

  test("orders by popularity, then name, and serves catalog fields as JSON numbers and strings", async () => {
    const response = await request(app).get(`/api/destinations/${id("lake")}/routes`).set("X-Test-User", id("caller"));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map((row: any) => row.name), ["Delta Trail", "Bravo Trail", "Charlie Trail", "Alpha Trail"]);
    const first = response.body[0];
    assert.equal(typeof first.popularity, "number");
    assert.equal(first.shape, "out_and_back");
    assert.equal(first.kind, "destination");
    assert.ok("est_moving_seconds" in first && "difficulty" in first && "description_source_name" in first);
  });
});
