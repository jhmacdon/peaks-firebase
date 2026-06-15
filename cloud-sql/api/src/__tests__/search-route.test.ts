import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildDestinationSearchQuery } from "../routes/search";

test("destination search falls back to destination name when search_name is missing", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "south sis",
    rawQuery: "South sis",
    limit: 20,
  });

  assert.match(query.text, /COALESCE\(NULLIF\(search_name, ''\), lower\(name\)\)/);
  assert.match(query.text, /lower\(name\) ILIKE/);
  assert.deepEqual(query.values, ["south sis", "south sis%", "south sis%", 20]);
});

test("geo destination search uses the same name fallback", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "south sis",
    rawQuery: "South sis",
    lat: 44.103,
    lng: -121.769,
    limit: 20,
  });

  assert.match(query.text, /COALESCE\(NULLIF\(search_name, ''\), lower\(name\)\)/);
  assert.match(query.text, /lower\(name\) ILIKE/);
  assert.deepEqual(query.values, ["south sis", 44.103, -121.769, "south sis%", "south sis%", 20]);
});
