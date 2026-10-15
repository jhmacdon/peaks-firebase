import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildNearbyRoutesQuery,
  buildRouteDetailQuery,
} from "../routes/routes";
import { buildRouteSearchQuery } from "../routes/search";
import { buildDestinationRoutesQuery } from "../routes/destinations";
import { buildAreaDetailQuery } from "../routes/areas";
import { buildListDestinationsQuery } from "../routes/lists";
import { buildPlanRoutesQuery } from "../routes/plans";
import {
  buildSessionRoutesQuery,
  SESSION_ROUTES_SQL,
} from "../routes/sessions";

const migration = readFileSync(
  resolve(__dirname, "../../../migrations/20260830_route_cover_photos.sql"),
  "utf8"
);
const schema = readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8");

function viewBody(sql: string): string {
  const match = sql.match(
    /CREATE OR REPLACE VIEW route_cover_photos AS([\s\S]*?);(?:\r?\n|$)/
  );
  assert.ok(match, "expected route_cover_photos view");
  return match[1].replace(/\s+/g, " ").trim();
}

test("route cover view derives one fully credited linked photo", () => {
  const view = viewBody(migration);

  assert.match(view, /SELECT DISTINCT ON \(rd\.route_id\)/);
  assert.match(view, /FROM route_destinations rd JOIN destinations d ON d\.id = rd\.destination_id/);
  assert.match(view, /NULLIF\(btrim\(d\.hero_image\), ''\) IS NOT NULL/);
  assert.match(view, /NULLIF\(btrim\(d\.hero_image_attribution\), ''\) IS NOT NULL/);
  assert.match(view, /NULLIF\(btrim\(d\.hero_image_attribution_url\), ''\) IS NOT NULL/);
});

test("route cover choice is stable and summit-first", () => {
  const view = viewBody(migration);

  assert.match(
    view,
    /ORDER BY rd\.route_id, \('summit'::destination_feature = ANY\(d\.features\)\) DESC, rd\.ordinal DESC, d\.prominence DESC NULLS LAST, d\.elevation DESC NULLS LAST, d\.name ASC NULLS LAST, d\.id ASC$/
  );
});

test("schema and migration carry the same derived view without route photo columns", () => {
  assert.equal(viewBody(schema), viewBody(migration));
  assert.match(migration, /GRANT SELECT ON route_cover_photos TO "peaks-api"/);

  const routesTable = schema.match(/CREATE TABLE routes \(([\s\S]*?)\n\);/)?.[1] ?? "";
  assert.doesNotMatch(routesTable, /hero_image|cover_image|photo/);
});

const coverAliases = [
  "cover_destination_id",
  "cover_destination_name",
  "cover_image",
  "cover_image_attribution",
  "cover_image_attribution_url",
  "cover_image_focal_x",
  "cover_image_focal_y",
  "cover_image_origin",
];

test("every flat route API shape returns the shared derived cover", () => {
  const queries = [
    buildRouteDetailQuery("route-1", "user-1").text,
    buildNearbyRoutesQuery(47.4, -121.6, 5000, 20, "user-1").text,
    buildRouteSearchQuery({
      normalizedQuery: "rainier",
      rawQuery: "Rainier",
      limit: 10,
      uid: "user-1",
    }).text,
    buildDestinationRoutesQuery("destination-1", "user-1").text,
    buildListDestinationsQuery("list-1").text,
    buildPlanRoutesQuery("plan-1", "user-1").text,
    buildSessionRoutesQuery("session-1", "user-1").text,
  ];

  for (const sql of queries) {
    assert.match(sql, /LEFT JOIN route_cover_photos cover ON cover\.route_id = (?:r\.id|br\.route_id)/);
    for (const alias of coverAliases) {
      assert.match(sql, new RegExp(`AS ${alias}\\b`));
    }
  }
});

test("every embedded route API shape returns the shared derived cover", () => {
  const queries = [
    buildAreaDetailQuery("area-1", "user-1").text,
    SESSION_ROUTES_SQL,
  ];

  for (const sql of queries) {
    assert.match(sql, /LEFT JOIN route_cover_photos cover ON cover\.route_id = r\.id/);
    for (const key of coverAliases) {
      assert.match(sql, new RegExp(`'${key}'`));
    }
  }
});

const ownCoverMigration = readFileSync(
  resolve(__dirname, "../../../migrations/20261015_route_covers.sql"),
  "utf8"
);

test("route cover lookup prefers the route's own credited cover, then its places", () => {
  const fn = ownCoverMigration.match(
    /CREATE FUNCTION route_cover_photo\(target_route_id text\)([\s\S]*?)\n\$\$;/
  )?.[1];
  assert.ok(fn, "expected route_cover_photo");
  const body = fn.replace(/\s+/g, " ");
  assert.match(body, /'route'::text AS origin, 0 AS priority FROM routes r WHERE r\.id = target_route_id/);
  assert.match(body, /NULLIF\(btrim\(r\.cover_attribution\), ''\) IS NOT NULL/);
  assert.match(body, /NULLIF\(btrim\(r\.cover_attribution_url\), ''\) IS NOT NULL/);
  assert.match(body, /'destination'::text, 1 FROM route_destinations rd/);
  assert.match(body, /ORDER BY choice\.priority LIMIT 1/);
  // The seven existing columns keep their order; origin is appended.
  assert.match(
    body,
    /RETURNS TABLE \( destination_id text, destination_name text, image_url text, attribution text, attribution_url text, focal_x smallint, focal_y smallint, origin text \)/
  );
});
