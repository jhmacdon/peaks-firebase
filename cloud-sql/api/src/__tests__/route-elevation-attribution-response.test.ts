import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildRouteDetailQuery } from "../routes/routes";

const REQUIRED_FIELDS = [
  "elevation_source",
  "elevation_source_url",
  "elevation_attribution",
  "elevation_license_url",
  "elevation_retrieved_at",
] as const;

test("route detail and destination routes expose elevation credits", () => {
  const routeDetail = buildRouteDetailQuery("route-1", "user-1").text;
  const destinationRoutes = fs.readFileSync(
    path.resolve(__dirname, "../routes/destinations.ts"),
    "utf8"
  );

  for (const field of REQUIRED_FIELDS) {
    assert.match(routeDetail, new RegExp(`r\\.${field}`));
    assert.match(destinationRoutes, new RegExp(`r\\.${field}`));
  }
});
