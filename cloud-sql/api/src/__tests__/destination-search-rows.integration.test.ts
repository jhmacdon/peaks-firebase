import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import db from "../db";
import { dbSkipReason } from "./helpers/test-db";

after(async () => { await db.end(); });

// destination_search_rows is the narrow copy destination search reads. A row
// trigger copies each destination's search fields on every write.
test("destination_search_rows follows destination inserts, edits, and deletes", {
  skip: dbSkipReason ?? undefined,
}, async () => {
  const client = await db.connect();
  const id = `dest-search-rows-${randomUUID()}`;
  const row = async () => (await client.query(
    `SELECT name, search_name, owner, features::text AS features, session_count_offset,
            ST_AsText(location) AS location
     FROM destination_search_rows WHERE id = $1`, [id])).rows[0];
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO destinations (id, name, search_name, features, owner, location)
       VALUES ($1, 'Colchuck Lake', 'colchuck lake', ARRAY['lake'::destination_feature], 'peaks',
               ST_GeomFromText('POINT Z(-120.83 47.49 1700)', 4326)::geography)`, [id]);
    assert.deepEqual(await row(), {
      name: "Colchuck Lake", search_name: "colchuck lake", owner: "peaks", features: "{lake}",
      session_count_offset: 0, location: "POINT Z (-120.83 47.49 1700)",
    });

    await client.query(
      `UPDATE destinations SET name = 'Colchuck Tarn', search_name = 'colchuck tarn', owner = 'someone',
         features = ARRAY['lake'::destination_feature, 'viewpoint'::destination_feature],
         session_count_offset = 12,
         location = ST_GeomFromText('POINT Z(-120.84 47.5 1710)', 4326)::geography
       WHERE id = $1`, [id]);
    assert.deepEqual(await row(), {
      name: "Colchuck Tarn", search_name: "colchuck tarn", owner: "someone", features: "{lake,viewpoint}",
      session_count_offset: 12, location: "POINT Z (-120.84 47.5 1710)",
    });

    await client.query("DELETE FROM destinations WHERE id = $1", [id]);
    assert.equal(await row(), undefined);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
