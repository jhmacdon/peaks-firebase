import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCampsiteAmenities, isTrailheadAmenities, type Amenities } from "./amenities";

test("empty amenities narrow as campsite (unknown-shape default)", () => {
  const amenities: Amenities = {};
  assert.equal(isCampsiteAmenities(amenities), true);
  assert.equal(isTrailheadAmenities(amenities), false);
});

test("a parking block narrows as trailhead", () => {
  const amenities: Amenities = { parking: {} };
  assert.equal(isTrailheadAmenities(amenities), true);
  assert.equal(isCampsiteAmenities(amenities), false);
});

test("a road_access block narrows as trailhead", () => {
  const amenities: Amenities = { road_access: {} };
  assert.equal(isTrailheadAmenities(amenities), true);
  assert.equal(isCampsiteAmenities(amenities), false);
});

test("a bathrooms block narrows as trailhead", () => {
  const amenities: Amenities = { bathrooms: {} };
  assert.equal(isTrailheadAmenities(amenities), true);
  assert.equal(isCampsiteAmenities(amenities), false);
});

test("a campsite-typical shape narrows as campsite", () => {
  const amenities: Amenities = {
    toilet: "flush",
    drinking_water: "yes",
    capacity: 12,
    fee: { required: true, amount: "$10" },
  };
  assert.equal(isCampsiteAmenities(amenities), true);
  assert.equal(isTrailheadAmenities(amenities), false);
});

// Guard for the "keep in sync by hand" rule stated in both files' header
// comments: cloud-sql/migrate/src/lib/amenities.ts and this file must be
// mirrored exactly, since there is no shared package between the two apps.
test("cloud-sql/migrate and web copies of amenities.ts stay byte-identical", () => {
  const webCopy = readFileSync(join(import.meta.dirname, "amenities.ts"), "utf8");
  const migrateCopy = readFileSync(
    join(import.meta.dirname, "../../../cloud-sql/migrate/src/lib/amenities.ts"),
    "utf8"
  );
  assert.equal(
    webCopy,
    migrateCopy,
    "web/src/lib/amenities.ts and cloud-sql/migrate/src/lib/amenities.ts have drifted — mirror the change by hand into both files"
  );
});
