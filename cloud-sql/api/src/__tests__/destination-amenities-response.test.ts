// Destination detail must carry the static facts the app renders on a
// trailhead: `amenities` (per-leaf sourced values) and `external_ids`. The web
// query has selected `amenities` since the campsite import; the Cloud Run
// query did not, so iOS could not see a fact the database already held.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildDestinationDetailQuery,
  mapDestinationDetailRow,
} from "../routes/destinations";

const TRAILHEAD_AMENITIES = {
  parking: {
    fee_required: {
      value: true,
      source: {
        kind: "usfs_edw",
        name: "US Forest Service",
        url: "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0",
        license: "public domain (US federal government)",
        external_id: "1104061",
      },
      retrieved_at: "2026-08-18",
    },
    capacity_vehicles: {
      value: 40,
      source: {
        kind: "usfs_web",
        name: "US Forest Service",
        url: "https://www.fs.usda.gov/recarea/mbs/recarea/?recid=17811",
        license: "public domain (US federal government)",
      },
      retrieved_at: "2026-08-18",
    },
  },
  bathrooms: {
    status: {
      value: "present",
      source: {
        kind: "usfs_edw",
        name: "US Forest Service",
        url: "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0",
        license: "public domain (US federal government)",
        external_id: "1104061",
      },
      retrieved_at: "2026-08-18",
    },
  },
};

test("destination detail query selects amenities and external ids", () => {
  const query = buildDestinationDetailQuery("dest-1");

  // Both are JSONB, so they arrive as objects and serialize as objects — no
  // ::json cast, and no JSON string for the client to parse a second time.
  assert.match(query.text, /d\.amenities\b/);
  assert.match(query.text, /d\.external_ids\b/);
  assert.deepEqual(query.values, ["dest-1"]);
});

test("mapDestinationDetailRow passes stored amenities through untouched", () => {
  const row: any = {
    id: "trailhead-1",
    name: "Snow Lake Trailhead",
    amenities: TRAILHEAD_AMENITIES,
    external_ids: { osm: "123456789" },
    areas: [],
  };

  const mapped = mapDestinationDetailRow(row);

  // Deep-equal, not a normalized subset: each leaf carries its own source
  // envelope and the client renders that credit beside the fact.
  assert.deepEqual(mapped.amenities, TRAILHEAD_AMENITIES);
  assert.equal(mapped.amenities.parking.fee_required.value, true);
  assert.equal(mapped.amenities.parking.fee_required.source.kind, "usfs_edw");
  assert.equal(
    mapped.amenities.parking.fee_required.source.license,
    "public domain (US federal government)"
  );
  assert.deepEqual(mapped.external_ids, { osm: "123456789" });
});

test("a destination with no facts still answers with the keys", () => {
  const row: any = {
    id: "summit-1",
    name: "Mount Rainier",
    amenities: null,
    external_ids: {},
    areas: [],
  };

  const mapped = mapDestinationDetailRow(row);

  assert.equal(mapped.amenities, null);
  assert.deepEqual(mapped.external_ids, {});
});

test("missing amenities and external ids collapse to one absent shape", () => {
  const mapped = mapDestinationDetailRow({ id: "summit-2", name: "Glacier Peak", areas: [] });

  assert.equal(mapped.amenities, null);
  assert.deepEqual(mapped.external_ids, {});
});

test("amenity facts are not withheld by the place-copy credit guard", () => {
  const row: any = {
    id: "trailhead-2",
    name: "Ira Spring Trailhead",
    // Uncredited place copy is dropped; the amenities beside it are not.
    description: "A busy trailhead off the Middle Fork road.",
    description_source_name: null,
    description_source_url: null,
    description_source_license: null,
    amenities: TRAILHEAD_AMENITIES,
    areas: [],
  };

  const mapped = mapDestinationDetailRow(row);

  assert.equal(mapped.description, null);
  assert.deepEqual(mapped.amenities, TRAILHEAD_AMENITIES);
});
