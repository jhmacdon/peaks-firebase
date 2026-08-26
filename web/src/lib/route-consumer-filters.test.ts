// Every web reader of session_routes assumed a row meant "did this route".
// Partial rows break that assumption. These are the pins.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const libDir = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(join(libDir, file), "utf8");

// Paths are relative to src/lib. The public-session read lives in its own
// builder rather than under actions/ — PR #135 extracted it so it could be
// unit-tested, and the predicate travelled with the query.
const READERS = [
  "actions/routes.ts",
  "actions/sessions.ts",
  "actions/search.ts",
  "actions/areas.ts",
  "actions/trip-reports.ts",
  "public-session-routes.ts",
];

test("every web action that reads session_routes carries the predicate", () => {
  for (const file of READERS) {
    const source = read(file);
    assert.match(source, /(FROM|JOIN) session_routes/, `${file} should still read session_routes`);
    assert.match(
      source,
      /routeDoneCoverageSql/,
      `${file} reads session_routes without the did-this-route predicate`
    );
  }
});

test("each web read carries its own predicate call", () => {
  const counts: Record<string, number> = {
    "actions/routes.ts": 3,
    "actions/sessions.ts": 1,
    "actions/search.ts": 3,
    "actions/areas.ts": 1,
    "actions/trip-reports.ts": 1,
    "public-session-routes.ts": 1,
  };
  for (const [file, expected] of Object.entries(counts)) {
    const uses = read(file).match(/routeDoneCoverageSql\(/g) ?? [];
    assert.equal(uses.length, expected, `${file} should call the predicate ${expected} time(s)`);
  }
});
