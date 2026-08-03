import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  computeRouteElevationStats,
  decodeElevationProfile,
  encodeElevationProfile,
  profileIsUsable,
} from "../route-elevation-profile";

test("route elevation profile rounds metre samples and decodes every sample", () => {
  const encoded = encodeElevationProfile([1000.4, 1001.6]);

  assert.deepEqual(decodeElevationProfile(encoded), [1000, 1002]);
  assert.equal(decodeElevationProfile(encoded).length, 2);
  assert.equal(encoded, "MTAwMHwxMDAy");
  assert.deepEqual(decodeElevationProfile(encodeElevationProfile([-2.5, 2.5])), [
    -3,
    3,
  ]);
});

test("route elevation profile encodes long profiles without line breaks", () => {
  const encoded = encodeElevationProfile(new Array(200).fill(1200));

  assert.equal(encoded?.includes("\n"), false);
  assert.equal(decodeElevationProfile(encoded).length, 200);
});

test("route elevation profile rejects flat, empty, and non-finite samples", () => {
  assert.equal(profileIsUsable([0, 0, 0]), false);
  assert.equal(profileIsUsable([0.4, -0.4]), false);
  assert.equal(encodeElevationProfile([0, 0, 0]), null);
  assert.equal(encodeElevationProfile([]), null);
  assert.equal(encodeElevationProfile([1200]), null);
  assert.equal(encodeElevationProfile([0.4, -0.4]), null);
  assert.equal(encodeElevationProfile([1000, Number.NaN]), null);
  assert.equal(encodeElevationProfile([1000, Number.POSITIVE_INFINITY]), null);
});

test("route elevation profile rejects non-canonical base64 and mismatched counts", () => {
  assert.deepEqual(decodeElevationProfile("MQ"), []);
  assert.deepEqual(decodeElevationProfile("MTAwMHwxMDAy!"), []);
  assert.deepEqual(decodeElevationProfile("MTAwMHwxMDAy="), []);
  assert.deepEqual(decodeElevationProfile("MQ==junk"), []);
  assert.deepEqual(decodeElevationProfile(Buffer.from("1000|1000.5").toString("base64")), []);
  assert.deepEqual(decodeElevationProfile("MTAwMHwxMDAy", 3), []);
  assert.deepEqual(decodeElevationProfile("MTAwMHwxMDAy", 2), [1000, 1002]);
});

test("route elevation profile counts gain and loss beyond the four-metre dead band", () => {
  assert.deepEqual(computeRouteElevationStats([1000, 1010, 1008]), {
    gain: 10,
    loss: 0,
  });
  assert.deepEqual(computeRouteElevationStats([1000, 990, 992]), {
    gain: 0,
    loss: 10,
  });
  assert.deepEqual(computeRouteElevationStats([1000, 1003, 1000]), {
    gain: 0,
    loss: 0,
  });
  assert.deepEqual(computeRouteElevationStats([1000, 1004, 1000]), {
    gain: 0,
    loss: 0,
  });
});

test("route elevation SQL materializes only valid Peaks-owned paths", () => {
  const migrateRoot = path.resolve(__dirname, "../..");
  const sources = [
    fs.readFileSync(
      path.join(migrateRoot, "../migrations/20260803_route_elevation_backfill.sql"),
      "utf8"
    ),
    fs.readFileSync(path.join(migrateRoot, "../schema.sql"), "utf8"),
  ];

  for (const source of sources) {
    assert.match(source, /ST_GeometryType\(path::geometry\) <> 'ST_LineString'/);
    assert.match(source, /point_count < 2/);
    assert.match(source, /has_nonzero_rounded_elevation/);
    assert.doesNotMatch(source, /isfinite\(elevation\)/);
    assert.match(source, /NEW\.elevation_string = encode_route_elevation_profile\(NEW\.path\)/);
    assert.match(source, /WHEN \(NEW\.owner = 'peaks'\)/);
    assert.match(source, /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON route_elevation_backfill_jobs TO "peaks-api"/);
    assert.match(
      source,
      /CREATE OR REPLACE FUNCTION touch_route_elevation_backfill_job\(\)\s+RETURNS TRIGGER\s+LANGUAGE plpgsql\s+AS \$\$\s+BEGIN\s+NEW\.updated_at = now\(\)/
    );
    assert.match(
      source,
      /CREATE TRIGGER trg_route_elevation_backfill_jobs_updated\s+BEFORE UPDATE ON route_elevation_backfill_jobs/
    );
  }
});
