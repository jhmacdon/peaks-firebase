import assert from "node:assert/strict";
import test from "node:test";
import db from "../db";
import routesRouter, { buildRouteDetailQuery, buildSharedRoutesQuery } from "../routes/routes";
import { buildDestinationRoutesQuery } from "../routes/destinations";
import { buildMixedSearchQueries } from "../routes/search";

test("route detail and destination routes include the trail contract fields", () => {
  const fields = [
    "shape", "kind", "slug", "difficulty", "est_moving_seconds", "state_code", "country_code",
    "aliases", "objective_destination_id", "trailhead_destination_id", "popularity",
    "description", "description_source_name", "description_source_url", "description_source_license",
  ];
  for (const query of [buildRouteDetailQuery("route", "caller"), buildDestinationRoutesQuery("place", "caller")]) {
    for (const field of fields) assert.match(query.text, new RegExp(`r\\.${field}\\b`));
    assert.match(query.text, /r\.status = 'active'/);
  }
  assert.match(buildDestinationRoutesQuery("place", "caller").text, /ORDER BY r\.popularity DESC, r\.name/);
});

test("shared routes check source and neighbor access and count physical segments once", () => {
  const query = buildSharedRoutesQuery("source", "caller");
  assert.deepEqual(query.values, ["source", "caller"]);
  for (const alias of ["source", "r"]) {
    assert.match(query.text, new RegExp(`${alias}\\.status = 'active'`));
    assert.match(query.text, new RegExp(`${alias}\\.owner = 'peaks'`));
    assert.match(query.text, new RegExp(`${alias}\\.owner = \\$2`));
    assert.match(query.text, new RegExp(`${alias}\\.owner = access_p\\.user_id`));
  }
  assert.match(query.text, /access_pp\.user_id = \$2/);
  assert.doesNotMatch(query.text, /is_public/);
  assert.match(query.text, /SELECT DISTINCT rs\.segment_id/);
  assert.match(query.text, /SELECT DISTINCT rs\.route_id, rs\.segment_id/);
  assert.match(query.text, /rs\.route_id <> \$1/);
  assert.match(query.text, /SUM\(COALESCE\(s\.distance, ST_Length\(s\.path\), 0\)\)::double precision AS shared_distance/);
  assert.match(query.text, /ORDER BY shared_distance DESC, r\.name, r\.id\s+LIMIT 20/);
});

test("GET /:id/shared serves snake_case rows using the authenticated caller", async (t) => {
  const rows = [{
    id: "neighbor", name: "Neighbor Trail", kind: "summit", distance: 9300,
    gain: 1450, difficulty: "hard", shared_distance: 5000, shared_segment_ids: ["segment"],
  }];
  t.mock.method(db, "query", async (text: string, values: unknown[]) => {
    const expected = buildSharedRoutesQuery("source", "caller");
    assert.equal(text, expected.text);
    assert.deepEqual(values, expected.values);
    return { rows };
  });
  const handler = (routesRouter as any).stack.find((layer: any) => layer.route?.path === "/:id/shared").route.stack[0].handle;
  let body: unknown;
  await handler(
    { params: { id: "source" }, uid: "caller", query: { uid: "intruder" } },
    { json: (value: unknown) => { body = value; } },
    (error: unknown) => { throw error; }
  );
  assert.deepEqual(body, rows);
});

test("route search rows carry shape so clients total the same trip as est_moving_seconds", () => {
  const { routes } = buildMixedSearchQueries({ normalizedQuery: "ingalls", rawQuery: "Ingalls", limit: 20 });
  const outer = routes.text.slice(routes.text.lastIndexOf("SELECT r.id, r.name"));
  assert.match(outer, /JOIN routes r ON r\.id = ranked\.id/, "the page reads full rows for ranked routes only");
  assert.match(outer, /\br\.shape\b/, "shape must reach the outer route rows");
});

test("route search rows carry the credited description the trail page shows", () => {
  const { routes } = buildMixedSearchQueries({ normalizedQuery: "ingalls", rawQuery: "Ingalls", limit: 20 });
  for (const field of ["description", "description_source_name", "description_source_url", "description_source_license"]) {
    const outer = routes.text.slice(routes.text.lastIndexOf("SELECT r.id, r.name"));
    assert.match(outer, new RegExp(`\\br\\.${field}\\b`), `${field} must reach the outer route rows`);
  }
});
