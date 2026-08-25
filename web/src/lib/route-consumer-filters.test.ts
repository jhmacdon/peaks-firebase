// Every web reader of session_routes assumed a row meant "did this route".
// Partial rows break that assumption. These are the pins.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const libDir = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(join(libDir, "actions", file), "utf8");

const READERS = [
  "routes.ts",
  "sessions.ts",
  "public-sessions.ts",
  "search.ts",
  "areas.ts",
  "trip-reports.ts",
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
    "routes.ts": 3,
    "sessions.ts": 1,
    "public-sessions.ts": 1,
    "search.ts": 3,
    "areas.ts": 1,
    "trip-reports.ts": 1,
  };
  for (const [file, expected] of Object.entries(counts)) {
    const uses = read(file).match(/routeDoneCoverageSql\(/g) ?? [];
    assert.equal(uses.length, expected, `${file} should call the predicate ${expected} time(s)`);
  }
});
