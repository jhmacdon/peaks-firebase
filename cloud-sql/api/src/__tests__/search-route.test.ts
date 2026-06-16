import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildDestinationSearchQuery } from "../routes/search";

function whereClause(sql: string): string {
  const match = sql.match(/\bWHERE\b([\s\S]+?)\bORDER BY\b/);
  assert.ok(match, "expected SQL to include a WHERE clause before ORDER BY");
  return match[1];
}

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

test("2-character non-geo destination search uses full-text token prefix matching", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "ra",
    rawQuery: "Ra",
    limit: 20,
  });

  assert.match(query.text, /to_tsvector\('simple', COALESCE\(NULLIF\(search_name, ''\), lower\(name\)\)\)/);
  assert.match(query.text, /to_tsquery\('simple', \$1\)/);
  assert.doesNotMatch(query.text, /similarity\(/);
  assert.doesNotMatch(query.text, /% \$1/);
  assert.doesNotMatch(whereClause(query.text), / ILIKE /);
  assert.equal(
    whereClause(query.text).trim(),
    "to_tsvector('simple', COALESCE(NULLIF(search_name, ''), lower(name))) @@ to_tsquery('simple', $1)"
  );
  assert.deepEqual(query.values, ["ra:*", "ra%", "ra%", "ra", "ra", 10]);
});

test("2-character geo destination search uses full-text token prefix matching with distance", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "ra",
    rawQuery: "Ra",
    lat: 46.85,
    lng: -121.7,
    limit: 20,
  });

  assert.match(query.text, /ST_Distance\(location, ST_MakePoint\(\$7, \$6\)::geography\)/);
  assert.doesNotMatch(query.text, /similarity\(/);
  assert.doesNotMatch(whereClause(query.text), / ILIKE /);
  assert.equal(
    whereClause(query.text).trim(),
    "to_tsvector('simple', COALESCE(NULLIF(search_name, ''), lower(name))) @@ to_tsquery('simple', $1)"
  );
  assert.deepEqual(query.values, ["ra:*", "ra%", "ra%", "ra", "ra", 46.85, -121.7, 10]);
});

test("2-character invalid destination search stays on short empty path", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "r-",
    rawQuery: "r-",
    limit: 20,
  });

  assert.doesNotMatch(query.text, /similarity\(/);
  assert.doesNotMatch(query.text, /% \$1/);
  assert.match(query.text, /\bWHERE false\b/);
  assert.deepEqual(query.values, [10]);
});

test("3-character destination search keeps trigram matching", () => {
  const query = buildDestinationSearchQuery({
    normalizedQuery: "rai",
    rawQuery: "Rai",
    limit: 20,
  });

  assert.match(query.text, /similarity\(/);
  assert.match(query.text, /% \$1/);
  assert.deepEqual(query.values, ["rai", "rai%", "rai%", 20]);
});
