import assert from "node:assert/strict";
import test from "node:test";
import { parkingBadge, parkingRow, parkingTypeLabel } from "./trailhead-parking";
import type { TrailheadParking } from "./amenities";

const NPS_SOURCE = {
  kind: "nps_parking",
  name: "National Park Service",
  url: "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_ParkingLots/MapServer/0/query",
  license: "public domain (US federal government)",
};

function leaf(value: unknown, source: Record<string, unknown> = NPS_SOURCE) {
  return { value, source, retrieved_at: "2026-08-19" };
}

/** The block as unvalidated JSONB arrives, which is how the page reads it. */
function block(fields: Record<string, unknown>): TrailheadParking {
  return fields as unknown as TrailheadParking;
}

test("each parking kind has a plain label", () => {
  assert.equal(parkingTypeLabel("lot"), "Parking lot");
  assert.equal(parkingTypeLabel("roadside"), "Roadside parking");
  assert.equal(parkingTypeLabel("garage"), "Parking garage");
  assert.equal(parkingTypeLabel("other"), "Parking available");
});

test("a value outside the vocabulary prints nothing", () => {
  assert.equal(parkingTypeLabel("carpark"), null);
  assert.equal(parkingTypeLabel(3), null);
  assert.equal(parkingTypeLabel(null), null);
  assert.equal(parkingTypeLabel(undefined), null);
});

test("a lot with no capacity still answers the question", () => {
  const row = parkingRow(block({ type: leaf("lot") }));
  assert.deepEqual(row, {
    label: "Parking",
    value: "Parking lot",
    captions: [],
    credits: [{ name: "National Park Service", url: NPS_SOURCE.url }],
  });
});

test("the lot's own name stands under the answer", () => {
  // Paradise has four lots. "Parking lot" alone does not say which.
  const row = parkingRow(
    block({ type: leaf("lot"), location_note: leaf("Paradise Parking (Upper Lot)") })
  );
  assert.equal(row?.value, "Parking lot");
  assert.deepEqual(row?.captions, ["Paradise Parking (Upper Lot)"]);
  assert.deepEqual(row?.credits, [{ name: "National Park Service", url: NPS_SOURCE.url }]);
});

test("the name stands under a counted capacity too", () => {
  const row = parkingRow(
    block({
      capacity_vehicles: leaf(30, { kind: "usfs_web", name: "US Forest Service" }),
      location_note: leaf("Paradise Parking (Upper Lot)"),
    })
  );
  assert.equal(row?.value, "30 vehicles");
  assert.deepEqual(row?.captions, ["Paradise Parking (Upper Lot)"]);
  // Both sources are credited, each once.
  assert.deepEqual(row?.credits, [
    { name: "US Forest Service" },
    { name: "National Park Service", url: NPS_SOURCE.url },
  ]);
});

test("a name with nothing to hang it on still prints", () => {
  const row = parkingRow(block({ location_note: leaf("Paradise Parking (Upper Lot)") }));
  assert.equal(row?.label, "Parking");
  assert.equal(row?.value, "Paradise Parking (Upper Lot)");
});

test("a malformed or blank name is not a caption", () => {
  assert.deepEqual(parkingRow(block({ type: leaf("lot"), location_note: leaf("   ") }))?.captions, []);
  assert.deepEqual(parkingRow(block({ type: leaf("lot"), location_note: leaf(42) }))?.captions, []);
  assert.deepEqual(parkingRow(block({ type: leaf("lot"), location_note: "a note" }))?.captions, []);
});

test("a counted capacity outranks the kind, and the two never print together", () => {
  const row = parkingRow(
    block({
      type: leaf("lot"),
      capacity_vehicles: leaf(30, { kind: "usfs_web", name: "US Forest Service" }),
    })
  );
  assert.equal(row?.label, "Parking capacity");
  assert.equal(row?.value, "30 vehicles");
  assert.deepEqual(row?.captions, []);
  assert.deepEqual(row?.credits, [{ name: "US Forest Service" }]);
});

test("a malformed capacity falls through to the kind rather than printing itself", () => {
  const row = parkingRow(block({ type: leaf("lot"), capacity_vehicles: leaf({ spaces: 30 }) }));
  assert.equal(row?.value, "Parking lot");
});

test("a block with neither fact prints nothing", () => {
  assert.equal(parkingRow(block({ fee_required: leaf(true) })), null);
  assert.equal(parkingRow(undefined), null);
  assert.equal(parkingRow(null), null);
  assert.equal(parkingRow("parking" as unknown as TrailheadParking), null);
});

test("a leaf that is not an envelope prints nothing", () => {
  assert.equal(parkingRow(block({ type: "lot" })), null);
});

test("a source with no name credits nobody", () => {
  const row = parkingRow(block({ type: leaf("lot", { kind: "nps_parking" }) }));
  assert.equal(row?.value, "Parking lot");
  assert.deepEqual(row?.credits, []);
});

test("the admin chip says the same thing, shorter", () => {
  assert.equal(parkingBadge(block({ type: leaf("lot") })), "parking lot");
  assert.equal(parkingBadge(block({ type: leaf("garage") })), "parking garage");
  assert.equal(parkingBadge(block({ capacity_vehicles: leaf(30) })), "30 parking spaces");
  assert.equal(parkingBadge(block({ fee_required: leaf(true) })), null);
  assert.equal(parkingBadge(undefined), null);
});

test("the admin chip names the lot, which is what an import check needs", () => {
  assert.equal(
    parkingBadge(block({ type: leaf("lot"), location_note: leaf("Paradise Parking (Upper Lot)") })),
    "parking lot (Paradise Parking (Upper Lot))"
  );
  assert.equal(
    parkingBadge(block({ capacity_vehicles: leaf(30), location_note: leaf("Snow Lake Lot") })),
    "30 parking spaces (Snow Lake Lot)"
  );
  assert.equal(
    parkingBadge(block({ location_note: leaf("Snow Lake Lot") })),
    "Snow Lake Lot"
  );
});
