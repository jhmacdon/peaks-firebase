// Every API reader of session_routes assumed a row meant "did this route".
// Partial rows break that assumption, so each reader filters. These tests are
// the pins: a reader that loses its filter starts counting approach hikes as
// completions of the route.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { buildListDestinationsQuery } from "../routes/lists";
import { SESSION_ROUTES_SQL } from "../routes/sessions";
import { routeDoneCoverageSql } from "../route-coverage";

test("list popularity counts only routes the session actually did", () => {
  const { text } = buildListDestinationsQuery("cascade-volcanoes");
  assert.match(text, /FROM session_routes sr/);
  assert.ok(
    text.includes(routeDoneCoverageSql("sr")),
    "the best-route popularity COUNT must carry the did-this-route predicate"
  );
});

test("session detail lists only routes the session actually did", () => {
  assert.ok(
    SESSION_ROUTES_SQL.includes(routeDoneCoverageSql("sr")),
    "SESSION_ROUTES_SQL must carry the did-this-route predicate"
  );
});

test("GET /api/sessions/:id/routes carries the same predicate", () => {
  const source = readFileSync(resolve(__dirname, "../routes/sessions.ts"), "utf8");
  const handler = source.slice(
    source.indexOf("// GET /api/sessions/:id/routes"),
    source.indexOf("// GET /api/sessions/:id/comparisons/:otherId")
  );
  assert.ok(
    handler.includes("routeDoneCoverageSql(\"sr\")"),
    "the routes endpoint must carry the did-this-route predicate"
  );
});

test("a trip report links only routes the activity actually did", () => {
  const source = readFileSync(resolve(__dirname, "../routes/trip-reports.ts"), "utf8");
  const derive = source.slice(
    source.indexOf("async function deriveLinks"),
    source.indexOf("async function reportById")
  );
  assert.match(derive, /INSERT INTO trip_report_routes/);
  assert.ok(
    derive.includes("routeDoneCoverageSql(\"sr\")"),
    "trip report route links must carry the did-this-route predicate"
  );
});
