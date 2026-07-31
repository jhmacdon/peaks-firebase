import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRouteProvenance } from "./route-provenance";

const base = {
  source_kind: "openstreetmap",
  source_url: "https://www.openstreetmap.org/",
  license_name: "Open Data Commons Open Database License (ODbL) 1.0",
  license_url: "https://opendatacommons.org/licenses/odbl/1-0/",
  attribution: "© OpenStreetMap contributors",
  retrieved_at: "2026-07-31T00:00:00Z",
  osm_way_ids: [123],
  osm_way_urls: ["https://www.openstreetmap.org/way/123"],
  contains_osm_geometry: true,
};

test("keeps paired elevation provenance", () => {
  assert.deepEqual(
    normalizeRouteProvenance({
      ...base,
      elevation_source: "AWS Open Data Terrain Tiles",
      elevation_profile: "terrain",
    }),
    {
      ...base,
      retrieved_at: "2026-07-31T00:00:00.000Z",
      elevation_source: "AWS Open Data Terrain Tiles",
      elevation_profile: "terrain",
    }
  );
});

test("rejects half of an elevation provenance pair", () => {
  assert.throws(
    () =>
      normalizeRouteProvenance({
        ...base,
        elevation_source: "AWS Open Data Terrain Tiles",
      }),
    /must be supplied together/
  );
});
