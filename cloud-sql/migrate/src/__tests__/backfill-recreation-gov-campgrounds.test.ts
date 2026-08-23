import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCampgroundAudit,
  buildReviewedCampgroundUpdates,
  distanceMeters,
  normalizeCampgroundName,
  parseRidbCampgrounds,
  type CampsiteDestination,
  type RidbCampground,
} from "../backfill-recreation-gov-campgrounds";

function destination(
  overrides: Partial<CampsiteDestination> = {}
): CampsiteDestination {
  return {
    id: "destination-1",
    name: "Cougar Rock Campground",
    lat: 46.767,
    lng: -121.805,
    features: ["campsite"],
    externalIds: { osm: "123" },
    ...overrides,
  };
}

function facility(overrides: Partial<RidbCampground> = {}): RidbCampground {
  return {
    facilityId: "232459",
    name: "Cougar Rock Campground",
    lat: 46.765,
    lng: -121.805,
    lastUpdatedDate: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

test("keeps only enabled, reservable campground facilities with stable IDs and coordinates", () => {
  const base = {
    FacilityID: "232459",
    FacilityName: "Cougar Rock Campground",
    FacilityTypeDescription: "Campground",
    FacilityLatitude: 46.765,
    FacilityLongitude: -121.805,
    Enabled: true,
    Reservable: true,
    LastUpdatedDate: "2026-08-20T00:00:00Z",
  };
  assert.deepEqual(parseRidbCampgrounds([
    base,
    { ...base, FacilityID: "2", Reservable: false },
    { ...base, FacilityID: "3", FacilityTypeDescription: "Facility" },
    { ...base, FacilityID: "4", Enabled: false },
    { ...base, FacilityID: "bad-id" },
  ]), [facility()]);
  assert.throws(() => parseRidbCampgrounds([base, base]), /repeats facility 232459/);
});

test("normalizes names and measures nearby facilities", () => {
  assert.equal(normalizeCampgroundName("Cañón — Campground"), "canoncampground");
  assert.ok(distanceMeters(destination(), facility()) < 250);
});

test("proposes only one exact-name nearby facility and holds loose matches", () => {
  const audit = buildCampgroundAudit(
    [
      facility(),
      facility({
        facilityId: "999",
        name: "Paradise Campground",
        lat: 46.768,
      }),
    ],
    [
      destination(),
      destination({ id: "destination-2", name: "Paradise" }),
      destination({ id: "destination-3", name: "Far Away", lat: 40, lng: -105 }),
    ]
  );

  assert.deepEqual(audit.proposals.map((row) => ({
    destinationId: row.destinationId,
    facilityId: row.facilityId,
  })), [{ destinationId: "destination-1", facilityId: "232459" }]);
  assert.deepEqual(audit.ambiguities.map((row) => row.destinationId), ["destination-2"]);
  assert.deepEqual(audit.unmatched.map((row) => row.destinationId), ["destination-3"]);
});

test("reviewed updates preserve every existing ID and are idempotent", () => {
  const review = {
    version: 1 as const,
    matches: [{
      destinationId: "destination-1",
      destinationName: "Cougar Rock Campground",
      ridbFacilityId: "232459",
      facilityName: "Cougar Rock Campground",
    }],
  };
  assert.deepEqual(buildReviewedCampgroundUpdates(
    review,
    [facility()],
    [destination()]
  ), [{
    destinationId: "destination-1",
    destinationName: "Cougar Rock Campground",
    ridbFacilityId: "232459",
    expectedExternalIds: { osm: "123" },
    distanceMeters: Math.round(distanceMeters(destination(), facility())),
  }]);
  assert.deepEqual(buildReviewedCampgroundUpdates(
    review,
    [facility()],
    [destination({ externalIds: { osm: "123", ridb_facility: "232459" } })]
  ), []);
});

test("review validation rejects source, target, and identity drift", () => {
  const review = {
    version: 1 as const,
    matches: [{
      destinationId: "destination-1",
      destinationName: "Cougar Rock Campground",
      ridbFacilityId: "232459",
      facilityName: "Cougar Rock Campground",
    }],
  };
  assert.throws(
    () => buildReviewedCampgroundUpdates(review, [facility()], [destination({ name: "Renamed" })]),
    /changed name after review/
  );
  assert.throws(
    () => buildReviewedCampgroundUpdates(review, [facility({ name: "Renamed" })], [destination()]),
    /RIDB facility 232459 changed name after review/
  );
  assert.throws(
    () => buildReviewedCampgroundUpdates(review, [facility()], [destination({ features: ["trailhead"] })]),
    /is not a campsite/
  );
  assert.throws(
    () => buildReviewedCampgroundUpdates(review, [facility()], [
      destination(),
      destination({
        id: "destination-2",
        externalIds: { ridb_facility: "232459" },
      }),
    ]),
    /already belongs to destination-2/
  );
});
