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
    credits: [{ name: "National Park Service", url: NPS_SOURCE.url }],
  });
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
