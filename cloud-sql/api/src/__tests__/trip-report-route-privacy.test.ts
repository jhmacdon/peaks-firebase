import assert from "node:assert/strict";
import test from "node:test";
import {
  REPORT_SELECT,
  TRIP_REPORT_ROUTE_COPY_SQL,
} from "../routes/trip-reports";

test("public trip report rows include only active catalog route ids", () => {
  assert.match(REPORT_SELECT, /JOIN routes report_route/);
  assert.match(REPORT_SELECT, /report_route\.owner = 'peaks'/);
  assert.match(REPORT_SELECT, /report_route\.status = 'active'/);
});

test("trip report route copying ignores imported and user-owned routes", () => {
  assert.match(TRIP_REPORT_ROUTE_COPY_SQL, /r\.owner = 'peaks'/);
  assert.match(TRIP_REPORT_ROUTE_COPY_SQL, /r\.status = 'active'/);
});
