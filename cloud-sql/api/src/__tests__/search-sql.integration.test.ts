import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import db from "../db";
import { buildMixedSearchQueries } from "../routes/search";
import { dbSkipReason as skipReason } from "./helpers/test-db";

after(async () => {
  await db.end();
});

test(
  "every mixed-search SQL variant executes against the current schema",
  { skip: skipReason ?? undefined },
  async () => {
    const inputs = [
      { normalizedQuery: "ra", rawQuery: "ra", limit: 20 },
      { normalizedQuery: "ra", rawQuery: "ra", lat: 47.64, lng: -122.35, limit: 20 },
      { normalizedQuery: "campo", rawQuery: "campo", limit: 20 },
      { normalizedQuery: "campo", rawQuery: "campo", lat: 47.64, lng: -122.35, limit: 20 },
    ];

    for (const input of inputs) {
      const queries = buildMixedSearchQueries(input);
      for (const query of Object.values(queries)) {
        const result = await db.query(query.text, query.values);
        assert.ok(Array.isArray(result.rows));
      }
    }
  }
);
