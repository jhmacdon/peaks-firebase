import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildAreaDetailQuery } from "../routes/areas";
import { buildListDestinationsQuery } from "../routes/lists";
import { buildPlanRoutesQuery } from "../routes/plans";
import { buildRouteDetailQuery } from "../routes/routes";
import { buildRouteSearchQuery } from "../routes/search";
import { SESSION_ROUTES_SQL } from "../routes/sessions";

test("route-bearing API queries expose route provenance", () => {
  const routeDetail = buildRouteDetailQuery("route-1", "user-1");
  const routeSearch = buildRouteSearchQuery({
    normalizedQuery: "red mountain",
    rawQuery: "Red Mountain",
    limit: 10,
  });
  const listDestinations = buildListDestinationsQuery("list-1");
  const areaDetail = buildAreaDetailQuery("area-1", "user-1");
  const planRoutes = buildPlanRoutesQuery("plan-1", "user-1");

  assert.match(routeDetail.text, /r\.provenance/);
  assert.match(routeSearch.text, /r\.provenance/);
  assert.match(listDestinations.text, /r\.provenance AS route_provenance/);
  assert.match(areaDetail.text, /'provenance', r\.provenance/);
  assert.match(planRoutes.text, /r\.provenance/);
  assert.match(
    planRoutes.text,
    /r\.status IN \('active', 'superseded'\)/
  );
  assert.match(SESSION_ROUTES_SQL, /'provenance', r\.provenance/);
  assert.match(SESSION_ROUTES_SQL, /'is_catalog', r\.owner = 'peaks'/);
  assert.match(
    SESSION_ROUTES_SQL,
    /r\.status IN \('active', 'superseded'\)/
  );
  assert.match(SESSION_ROUTES_SQL, /r\.owner = 'peaks' OR r\.owner = s\.user_id/);
});
