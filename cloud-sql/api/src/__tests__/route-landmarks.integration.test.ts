import assert from "node:assert/strict";
import { after, test } from "node:test";
import db from "../db";
import { buildRouteLandmarksQuery } from "../lib/route-landmarks";
import { dbSkipReason } from "./helpers/test-db";

after(async () => { await db.end(); });

test("route landmarks find camps without changing saved objectives", {
  skip: dbSkipReason ?? undefined,
}, async (t) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE routes (id text PRIMARY KEY, owner text, status text,
        path geography(LineStringZ,4326)) ON COMMIT DROP;
      CREATE TEMP TABLE destinations (id text PRIMARY KEY, name text, owner text,
        elevation float8, features destination_feature[], location geography(PointZ,4326)) ON COMMIT DROP;
      CREATE TEMP TABLE route_destinations (route_id text, destination_id text) ON COMMIT DROP;
      CREATE TEMP TABLE plans (id text, user_id text) ON COMMIT DROP;
      CREATE TEMP TABLE plan_routes (plan_id text, route_id text) ON COMMIT DROP;
      CREATE TEMP TABLE plan_party (plan_id text, user_id text) ON COMMIT DROP;
      INSERT INTO routes VALUES ('route','peaks','active',
        ST_GeogFromText('SRID=4326;LINESTRING Z (0 0 0,0 0.1 0)'));
    `);
    const add = async (id: string, name: string, feature: string, offset: number, owner = "peaks") => {
      await client.query(`INSERT INTO destinations
        SELECT $1,$2,$3,100,ARRAY[$4]::destination_feature[],
          ST_Force3DZ(ST_Project('SRID=4326;POINT(0 0.05)'::geography,$5::float8,pi()/2)::geometry)::geography`,
      [id, name, owner, feature, offset]);
    };
    const rows = async (uid = "") => {
      const query = buildRouteLandmarksQuery("route", uid);
      return (await client.query(query.text, query.values)).rows;
    };

    await add("mackinaw-camp", "Mackinaw Shelter", "campsite", 15);
    await add("mackinaw-hut", "Mackinaw Shelter", "hut", 25);
    await add("white-pass", "White Pass Camp", "campsite", 250.4);
    await add("glacier-gap", "Glacier Gap Camp", "campsite", 0.2);
    await add("red-creek", "Red Creek Camp", "campsite", 9.4);
    await add("far-camp", "Far camp", "campsite", 301);
    await add("private-camp", "Private camp", "campsite", 1, "someone");
    await add("summit", "Disappointment Peak", "summit", 10);
    await add("view", "Trail viewpoint", "viewpoint", 40);
    await add("far-view", "Off trail viewpoint", "viewpoint", 60);
    await add("unnamed", "  ", "campsite", 5);

    await t.test("includes nearby camps, one Mackinaw, and only close landmarks", async () => {
      const places = await rows();
      assert.deepEqual(places.map(row => row.id),
        ["glacier-gap", "red-creek", "mackinaw-camp", "view", "white-pass"]);
      assert.ok(Math.abs(places.at(-1).route_offset_m - 250.4) < 0.01);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM route_destinations")).rows[0].n, 0);
      assert.ok(!(await rows("someone")).some(row => row.id === "private-camp"));
    });

    await t.test("keeps distinct places with the same name", async () => {
      await client.query(`INSERT INTO destinations VALUES ('other-mackinaw','Mackinaw Shelter','peaks',100,
        ARRAY['campsite']::destination_feature[],'SRID=4326;POINT Z (0 0.08 0)'::geography)`);
      assert.ok((await rows()).some(row => row.id === "other-mackinaw"));
    });

    await t.test("omits places already linked, including a duplicate of the linked hut", async () => {
      await client.query("INSERT INTO route_destinations VALUES ('route','mackinaw-hut'),('route','white-pass')");
      const places = await rows();
      assert.ok(!places.some(row => ["mackinaw-camp", "mackinaw-hut", "white-pass"].includes(row.id)));
      assert.equal((await client.query("SELECT count(*)::int AS n FROM route_destinations")).rows[0].n, 2);
    });

    await t.test("honors private route access and route status", async () => {
      await client.query("UPDATE routes SET owner='owner'");
      assert.deepEqual(await rows(), []);
      assert.deepEqual(await rows("stranger"), []);
      assert.ok((await rows("owner")).length > 0);
      await client.query("INSERT INTO plans VALUES ('plan','owner'); INSERT INTO plan_routes VALUES ('plan','route'); INSERT INTO plan_party VALUES ('plan','friend')");
      assert.ok((await rows("friend")).length > 0);
      await client.query("UPDATE routes SET status='superseded'");
      assert.deepEqual(await rows("owner"), []);
    });

    await t.test("skips missing paths and long trails", async () => {
      await client.query("UPDATE routes SET status='active', path=NULL");
      assert.deepEqual(await rows("owner"), []);
      await client.query(`UPDATE routes SET path='SRID=4326;LINESTRING Z (0 0 0,0 2 0)'::geography`);
      assert.deepEqual(await rows("owner"), []);
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
