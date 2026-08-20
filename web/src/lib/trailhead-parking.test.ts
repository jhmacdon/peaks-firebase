import assert from "node:assert/strict";
import test from "node:test";
import {
  capacityRangeLabel,
  parkingBadge,
  parkingRow,
  parkingTypeLabel,
} from "./trailhead-parking";
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

// --- the estimated range ----------------------------------------------------

test("each bucket has words of its own, with an en dash between the ends", () => {
  assert.equal(capacityRangeLabel("under_10"), "Under 10 cars");
  assert.equal(capacityRangeLabel("10_to_25"), "Roughly 10–25 cars");
  assert.equal(capacityRangeLabel("25_to_50"), "Roughly 25–50 cars");
  assert.equal(capacityRangeLabel("50_to_100"), "Roughly 50–100 cars");
  assert.equal(capacityRangeLabel("100_plus"), "Roughly 100+ cars");
  // "Roughly under 10" would be two hedges in three words, and "100+" has no
  // upper end to print.
  assert.equal(capacityRangeLabel("under_10")?.startsWith("Roughly"), false);
});

test("a bucket outside the vocabulary prints nothing", () => {
  for (const value of ["25-50", "25_to_60", "", 40, null, undefined, { value: "50_to_100" }]) {
    assert.equal(capacityRangeLabel(value), null, JSON.stringify(value));
  }
});

test("a key off Object.prototype is not a bucket", () => {
  // This reads unvalidated JSONB, so the leaf's value can be any string a data
  // file put there. A lookup object answers for these with a function, and the
  // badge then calls charAt on it and throws — a whole detail page lost to a
  // string somebody typed.
  for (const key of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    assert.equal(capacityRangeLabel(key), null, key);
    const fields = block({ capacity_range: leaf(key), type: leaf("lot") });
    assert.equal(parkingRow(fields)?.value, "Parking lot", key);
    assert.equal(parkingBadge(fields), "parking lot", key);
    // And with nothing to fall through to, the row simply says nothing.
    assert.equal(parkingRow(block({ capacity_range: leaf(key) })), null, key);
    assert.equal(parkingBadge(block({ capacity_range: leaf(key) })), null, key);
  }
});

test("an estimated range answers when nobody counted", () => {
  const row = parkingRow(block({ type: leaf("lot"), capacity_range: leaf("25_to_50") }));
  assert.equal(row?.label, "Parking capacity");
  assert.equal(row?.value, "Roughly 25–50 cars");
  assert.deepEqual(row?.credits, [{ name: "National Park Service", url: NPS_SOURCE.url }]);
});

test("a counted capacity beats an estimated range outright", () => {
  // Different claims, and the row prints one of them. "30 vehicles (roughly
  // 25-50)" would invite the reader to average a count with a guess.
  const row = parkingRow(
    block({
      capacity_vehicles: leaf(30, { kind: "usfs_web", name: "US Forest Service" }),
      capacity_range: leaf("25_to_50"),
      type: leaf("lot"),
    })
  );
  assert.equal(row?.value, "30 vehicles");
  assert.equal(row?.value.includes("Roughly"), false);
  assert.deepEqual(row?.credits, [{ name: "US Forest Service" }]);
});

test("a range never prints as a count", () => {
  // The whole vocabulary, checked for a bare number of vehicles.
  for (const bucket of ["under_10", "10_to_25", "25_to_50", "50_to_100", "100_plus"]) {
    const row = parkingRow(block({ capacity_range: leaf(bucket) }));
    assert.equal(row?.value.includes("vehicles"), false, bucket);
    assert.equal(parkingBadge(block({ capacity_range: leaf(bucket) }))?.includes("spaces"), false, bucket);
  }
});

test("a malformed range falls through to the kind rather than printing itself", () => {
  const row = parkingRow(block({ type: leaf("lot"), capacity_range: leaf("25-50") }));
  assert.equal(row?.value, "Parking lot");
  assert.equal(parkingRow(block({ type: leaf("lot"), capacity_range: "50_to_100" }))?.value, "Parking lot");
});

test("the range stands over the lot's own name too", () => {
  const row = parkingRow(
    block({ capacity_range: leaf("100_plus"), location_note: leaf("Paradise Parking (Upper Lot)") })
  );
  assert.equal(row?.value, "Roughly 100+ cars");
  assert.deepEqual(row?.captions, ["Paradise Parking (Upper Lot)"]);
});

test("the admin chip says the same thing, shorter", () => {
  assert.equal(parkingBadge(block({ type: leaf("lot") })), "parking lot");
  assert.equal(parkingBadge(block({ type: leaf("garage") })), "parking garage");
  assert.equal(parkingBadge(block({ capacity_vehicles: leaf(30) })), "30 parking spaces");
  assert.equal(parkingBadge(block({ capacity_range: leaf("25_to_50") })), "roughly 25–50 cars");
  assert.equal(parkingBadge(block({ capacity_range: leaf("under_10") })), "under 10 cars");
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
