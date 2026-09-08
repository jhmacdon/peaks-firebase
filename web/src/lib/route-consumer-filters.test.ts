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
    "actions/areas.ts": 2, // Initial area routes and subsequent route pages.
    "actions/trip-reports.ts": 1,
    "public-session-routes.ts": 1,
  };
  for (const [file, expected] of Object.entries(counts)) {
    const uses = read(file).match(/routeDoneCoverageSql\(/g) ?? [];
    assert.equal(uses.length, expected, `${file} should call the predicate ${expected} time(s)`);
  }
});

test("area route totals and both page queries share the active catalog boundary", () => {
  const source = read("actions/areas.ts");
  const queries = [
    source.slice(source.indexOf("const AREA_BASE_SELECT"), source.indexOf("async function loadAreaBase")),
    source.slice(source.indexOf("export async function getArea(id"), source.indexOf("export async function getAreaDestinationPage")),
    source.slice(source.indexOf("export async function getAreaRoutePage"), source.indexOf("export async function getAreaPersonalActivity")),
  ];

  for (const query of queries) {
    assert.match(query, /FROM route_areas ra\s+JOIN routes r ON r\.id = ra\.route_id/);
    assert.match(query, /r\.owner = 'peaks'/);
    assert.match(query, /r\.status = 'active'/);
  }
  for (const query of queries.slice(1)) {
    assert.match(query, /sr\.route_id = r\.id\s+AND \$\{routeDoneCoverageSql\("sr"\)\}/);
  }
});
