// Every API reader of session_routes assumed a row meant "did this route".
// Partial rows break that assumption, so each reader filters. These tests are
// the pins: a reader that loses its filter starts counting approach hikes as
// completions of the route.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { buildListDestinationsQuery } from "../routes/lists";
import {
  buildSessionRoutesQuery,
  SESSION_ROUTES_SQL,
} from "../routes/sessions";
import { TRIP_REPORT_ROUTE_COPY_SQL } from "../routes/trip-reports";
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
  const query = buildSessionRoutesQuery("session-1", "user-1");
  assert.ok(
    query.text.includes(routeDoneCoverageSql("sr")),
    "the routes endpoint must carry the did-this-route predicate"
  );
});

test("a trip report links only routes the activity actually did", () => {
  // The SQL lives in an exported constant (PR #135 extracted it), so assert on
  // the built string rather than on a slice of the file.
  assert.match(TRIP_REPORT_ROUTE_COPY_SQL, /INSERT INTO trip_report_routes/);
  assert.ok(
    TRIP_REPORT_ROUTE_COPY_SQL.includes(routeDoneCoverageSql("sr")),
    "trip report route links must carry the did-this-route predicate"
  );
  // Main's own owner scoping must survive alongside it.
  assert.match(TRIP_REPORT_ROUTE_COPY_SQL, /r\.owner = 'peaks'/);
});

test("the public session route read carries the predicate and owner scoping", () => {
  // PR #135 added this reader; the merge had to give it the filter.
  const source = readFileSync(
    resolve(__dirname, "../../../../web/src/lib/public-session-routes.ts"),
    "utf8"
  );
  assert.match(source, /FROM session_routes sr/);
  assert.ok(
    source.includes("routeDoneCoverageSql(\"sr\")"),
    "the public session route read must carry the did-this-route predicate"
  );
  assert.match(source, /r\.owner = 'peaks' OR r\.owner = ts\.user_id/);
});
