import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (name: string) => readFileSync(join(__dirname, `../${name}`), "utf8");

test("legacy destination migration never invents a zero elevation", () => {
  const migration = source("migrate-destinations.ts");
  assert.doesNotMatch(migration, /elevation\s*\?\?\s*0/);
  assert.match(migration, /CASE WHEN \$8::double precision IS NULL THEN NULL/);
});

test("legacy points and markers require trusted finite elevation", () => {
  const points = source("migrate-points.ts");
  const sessions = source("migrate-sessions.ts");
  assert.doesNotMatch(points, /p\.elevation\s*\?\?\s*0/);
  assert.match(points, /p\.lat, p\.lng, p\.time, p\.elevation/);
  assert.doesNotMatch(sessions, /ST_MakePoint\(\$2, \$3, 0\)/);
  assert.match(sessions, /m\.lat, m\.lng, m\.elevation/);
  assert.match(sessions, /ST_MakePoint\(\$2, \$3, \$4\)/);
});
