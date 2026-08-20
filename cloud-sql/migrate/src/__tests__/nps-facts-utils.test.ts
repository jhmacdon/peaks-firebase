import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  boundsContain,
  buildNpsFactRow,
  candidatesWithinGate,
  isNonPublicLotName,
  metresToPolygon,
  npsBathroomFacts,
  npsFeatureAnomaly,
  npsLotLocationNote,
  npsLotName,
  npsParkingFacts,
  npsSeasonNote,
  padBounds,
  ringsBounds,
  toiletTypeForPoi,
  NPS_JOIN_RADIUS_M,
  NPS_LICENSE,
  NPS_SOURCE_NAME,
  type NpsCandidate,
  type NpsSource,
  type PolygonRings,
} from "../nps-facts-utils";

const POI_SOURCE: NpsSource = {
  kind: "nps_pois",
  name: NPS_SOURCE_NAME,
  url: "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_POIs/FeatureServer/0/query",
  license: NPS_LICENSE,
  retrieved_at: "2026-08-19",
};
const PARKING_SOURCE: NpsSource = {
  kind: "nps_parking",
  name: NPS_SOURCE_NAME,
  url: "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_ParkingLots/MapServer/0/query",
  license: NPS_LICENSE,
  retrieved_at: "2026-08-19",
};

function poi(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { POITYPE: "Restroom", OPENTOPUBLIC: "Unknown", SEASONAL: "Unknown", ...overrides };
}

function lot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { MAPLABEL: "PARADISE PARKING (UPPER LOT)", OPENTOPUBLIC: "Unknown", ...overrides };
}

function candidate(distanceM: number, row: Record<string, unknown>): NpsCandidate {
  return { distanceM, row };
}

// --- the vocabulary ---------------------------------------------------------

test("the POI vocabulary maps to the Peaks bathroom types", () => {
  assert.equal(toiletTypeForPoi("Vault Toilet"), "vault_pit");
  assert.equal(toiletTypeForPoi("Pit Toilet"), "vault_pit");
  assert.equal(toiletTypeForPoi("Flush Toilet"), "flush");
  // A restroom names a fact without naming its plumbing. Guessing it into a
  // bucket would publish a specific claim nobody made.
  assert.equal(toiletTypeForPoi("Restroom"), "unspecified");
  assert.equal(toiletTypeForPoi("Toilet"), "unspecified");
  assert.equal(toiletTypeForPoi("Floating Restroom"), "unspecified");
});

test("a POI type outside the vocabulary is not a toilet", () => {
  assert.equal(toiletTypeForPoi("Parking Lot"), null);
  assert.equal(toiletTypeForPoi("Trailhead"), null);
  assert.equal(toiletTypeForPoi(null), null);
  assert.equal(toiletTypeForPoi(42), null);
});

test("case and stray whitespace do not hide a toilet", () => {
  assert.equal(toiletTypeForPoi("  vault   toilet "), "vault_pit");
  assert.equal(toiletTypeForPoi("FLUSH TOILET"), "flush");
});

// --- anomalies --------------------------------------------------------------

test("a feature that is not there, or not for the public, is an anomaly", () => {
  assert.equal(npsFeatureAnomaly(poi({ POISTATUS: "Planned" })), "status_planned");
  assert.equal(npsFeatureAnomaly(poi({ POISTATUS: "Not Existing " })), "status_not_existing");
  assert.equal(npsFeatureAnomaly(poi({ POISTATUS: "Decommissioned" })), "status_decommissioned");
  assert.equal(
    npsFeatureAnomaly(poi({ POISTATUS: "Temporarily Closed" })),
    "status_temporarily_closed"
  );
  assert.equal(npsFeatureAnomaly(poi({ OPENTOPUBLIC: "No" })), "not_open_to_public");
  assert.equal(npsFeatureAnomaly(poi({ ISEXTANT: "False" })), "not_extant");
  assert.equal(npsFeatureAnomaly(poi({ ISEXTANT: "No" })), "not_extant");
});

test("the layer's ordinary silences are not anomalies", () => {
  assert.equal(npsFeatureAnomaly(poi()), null);
  assert.equal(npsFeatureAnomaly(poi({ POISTATUS: "Existing", ISEXTANT: "True" })), null);
  assert.equal(npsFeatureAnomaly(poi({ OPENTOPUBLIC: "yes", ISEXTANT: "Unknown" })), null);
});

// --- season notes -----------------------------------------------------------

test("a season description is kept exactly as the park wrote it", () => {
  assert.equal(npsSeasonNote("May 1 - Oct 31 (check park website)"), "May 1 - Oct 31 (check park website)");
  assert.equal(
    npsSeasonNote(" Winter seasonal closure dependent on current conditions "),
    "Winter seasonal closure dependent on current conditions"
  );
});

test("a placeholder is not a season note", () => {
  // "Unknown" printed under a restroom reads as information about the season.
  assert.equal(npsSeasonNote("Unknown"), null);
  assert.equal(npsSeasonNote("N/A"), null);
  assert.equal(npsSeasonNote("  "), null);
  assert.equal(npsSeasonNote(null), null);
});

// --- lot names --------------------------------------------------------------

test("LOTNAME leads and MAPLABEL fills in", () => {
  assert.deepEqual(npsLotName({ LOTNAME: "Coach House Parking", MAPLABEL: "CH" }), {
    text: "Coach House Parking",
    field: "LOTNAME",
  });
  // Every lot this join matches today has a MAPLABEL and no LOTNAME, Paradise
  // included, so the fallback is what makes the note exist at all.
  assert.deepEqual(npsLotName(lot()), {
    text: "PARADISE PARKING (UPPER LOT)",
    field: "MAPLABEL",
  });
  assert.equal(npsLotName({ LOTNAME: " ", MAPLABEL: "Unknown" }), null);
});

test("a staff lot is recognized by its name, since nothing else says so", () => {
  assert.equal(isNonPublicLotName("LONGMIRE MAINTENANCE AREA PARKING"), true);
  assert.equal(isNonPublicLotName("LONGMIRE RESIDENCE AREA PARKING"), true);
  assert.equal(isNonPublicLotName("Employee Parking"), true);
  assert.equal(isNonPublicLotName("PARADISE PARKING (UPPER LOT)"), false);
  assert.equal(isNonPublicLotName("Hurricane Hill Trailhead Parking"), false);
  assert.equal(isNonPublicLotName(null), false);
});

test("a lot name becomes a note only when it says something new", () => {
  assert.deepEqual(npsLotLocationNote(lot()), {
    kind: "note",
    text: "PARADISE PARKING (UPPER LOT)",
    field: "MAPLABEL",
  });
  assert.deepEqual(npsLotLocationNote({ MAPLABEL: "Parking Lot" }), {
    kind: "refused",
    reason: "generic_name",
  });
  assert.deepEqual(npsLotLocationNote({ MAPLABEL: "Visitor Parking" }), {
    kind: "refused",
    reason: "generic_name",
  });
  assert.deepEqual(npsLotLocationNote({ LOTNAME: null, MAPLABEL: null }), {
    kind: "refused",
    reason: "no_name",
  });
});

test("a truncated label is refused rather than trimmed into nonsense", () => {
  // Cutting the marker off "…NATURE TRAIL PARKI*" leaves "PARKI", and guessing
  // the rest invents a name the park never wrote.
  assert.deepEqual(
    npsLotLocationNote({ MAPLABEL: "ANCIENT GROVES (NIGHT SHADOWS) NATURE TRAIL PARKI*" }),
    { kind: "refused", reason: "truncated_name" }
  );
});

test("a name that only qualifies the generic words still says something", () => {
  assert.equal(npsLotLocationNote({ MAPLABEL: "Tioga Road Pullout" }).kind, "note");
  assert.equal(npsLotLocationNote({ MAPLABEL: "Visitor Center Parking" }).kind, "note");
});

// --- geometry ---------------------------------------------------------------

/** A square about 100 m on a side, near Paradise's latitude. */
const SQUARE: PolygonRings = [
  [
    [-121.0, 47.0],
    [-121.0013, 47.0],
    [-121.0013, 47.0009],
    [-121.0, 47.0009],
  ],
];

test("a point inside the lot is zero metres from it", () => {
  assert.equal(metresToPolygon({ lat: 47.00045, lng: -121.00065 }, SQUARE), 0);
});

test("a point outside measures to the nearest edge, not the centroid", () => {
  // 100 m north of the northern edge. A centroid measurement would read about
  // 150, which is the difference between clearing a 150 m gate and missing it.
  const distance = metresToPolygon({ lat: 47.0009 + 100 / 111_320, lng: -121.00065 }, SQUARE);
  assert.ok(distance !== null && Math.abs(distance - 100) < 2, `got ${distance}`);
});

test("a hole is a hole: a point inside one is outside the polygon", () => {
  const withHole: PolygonRings = [
    SQUARE[0],
    [
      [-121.0005, 47.0004],
      [-121.0007, 47.0004],
      [-121.0007, 47.0005],
      [-121.0005, 47.0005],
    ],
  ];
  const inHole = metresToPolygon({ lat: 47.00045, lng: -121.0006 }, withHole);
  assert.ok(inHole !== null && inHole > 0, `got ${inHole}`);
});

test("a polygon with no usable vertex has no distance", () => {
  assert.equal(metresToPolygon({ lat: 47, lng: -121 }, []), null);
  assert.equal(ringsBounds([]), null);
});

test("the padded box is a prefilter, not the gate", () => {
  const bounds = ringsBounds(SQUARE);
  assert.ok(bounds !== null);
  const padded = padBounds(bounds, 150);
  assert.equal(boundsContain(padded, { lat: 47.0009 + 100 / 111_320, lng: -121.00065 }), true);
  assert.equal(boundsContain(padded, { lat: 47.02, lng: -121.00065 }), false);
});

test("candidates come back inside the gate, nearest first", () => {
  const trailhead = { lat: 47.0, lng: -121.0 };
  const near = { lat: 47.0005, lng: -121.0 };
  const far = { lat: 47.0009, lng: -121.0 };
  const outside = { lat: 47.01, lng: -121.0 };
  const found = candidatesWithinGate(trailhead, [
    { point: far, row: poi({ POINAME: "far" }) },
    { point: outside, row: poi({ POINAME: "outside" }) },
    { point: near, row: poi({ POINAME: "near" }) },
  ]);
  assert.deepEqual(
    found.map((entry) => entry.row.POINAME),
    ["near", "far"]
  );
  assert.equal(NPS_JOIN_RADIUS_M, 150);
});

// --- the bathroom block -----------------------------------------------------

test("the nearest usable toilet answers, and it answers present", () => {
  const result = npsBathroomFacts([candidate(89.6, poi())], POI_SOURCE);
  assert.ok(result.outcome);
  assert.equal(result.outcome.facts.status.value, "present");
  assert.equal(result.outcome.facts.type.value, "unspecified");
  assert.equal(result.outcome.facts.status.source.kind, "nps_pois");
  assert.equal(result.outcome.facts.status.retrieved_at, "2026-08-19");
  assert.equal(result.outcome.diagnostics.distance_m, 89.6);
  assert.equal(result.outcome.diagnostics.candidates_within_gate, 1);
});

test("an anomalous POI is stepped past, not turned into a negative", () => {
  const result = npsBathroomFacts(
    [candidate(20, poi({ ISEXTANT: "False" })), candidate(120, poi({ POITYPE: "Vault Toilet" }))],
    POI_SOURCE
  );
  assert.ok(result.outcome);
  assert.equal(result.outcome.facts.type.value, "vault_pit");
  assert.deepEqual(result.skipped, [{ reason: "not_extant", distance_m: 20, poi_type: "Restroom" }]);
});

test("when every nearby toilet is refused the trailhead gets nothing, never absent", () => {
  const result = npsBathroomFacts([candidate(20, poi({ ISEXTANT: "False" }))], POI_SOURCE);
  assert.equal(result.outcome, null);
  assert.equal(result.candidates, 1);
  assert.equal(result.skipped.length, 1);
});

test("a real season description rides along; a placeholder does not", () => {
  const withNote = npsBathroomFacts(
    [candidate(30, poi({ SEASDESC: "May 1 - Oct 31 (check park website)" }))],
    POI_SOURCE
  );
  assert.equal(withNote.outcome?.facts.season_note?.value, "May 1 - Oct 31 (check park website)");
  const withPlaceholder = npsBathroomFacts([candidate(30, poi({ SEASDESC: "Unknown" }))], POI_SOURCE);
  assert.equal(withPlaceholder.outcome?.facts.season_note, undefined);
});

// --- the parking block ------------------------------------------------------

test("a matched lot publishes its type and its name, and no number", () => {
  const result = npsParkingFacts([candidate(0, lot())], PARKING_SOURCE);
  assert.ok(result.outcome);
  assert.equal(result.outcome.facts.type.value, "lot");
  assert.equal(result.outcome.facts.location_note?.value, "PARADISE PARKING (UPPER LOT)");
  assert.equal(result.outcome.diagnostics.inside_lot, true);
  // Area is a capacity proxy nobody calibrated. Nothing numeric goes out.
  assert.deepEqual(Object.keys(result.outcome.facts).sort(), ["location_note", "type"]);
});

test("an overlook lot is still a lot", () => {
  const result = npsParkingFacts([candidate(4, lot({ LOTTYPE: "Overlook" }))], PARKING_SOURCE);
  assert.equal(result.outcome?.facts.type.value, "lot");
  assert.equal(result.outcome?.diagnostics.lot_type, "Overlook");
});

test("the maintenance yard is stepped past for the visitor lot behind it", () => {
  const result = npsParkingFacts(
    [
      candidate(44.9, lot({ MAPLABEL: "LONGMIRE MAINTENANCE AREA PARKING" })),
      candidate(88, lot({ MAPLABEL: "LONGMIRE NATIONAL PARK INN PARKING LOOP" })),
    ],
    PARKING_SOURCE
  );
  assert.equal(result.outcome?.facts.location_note?.value, "LONGMIRE NATIONAL PARK INN PARKING LOOP");
  assert.deepEqual(result.skipped, [
    { reason: "non_public_lot", distance_m: 44.9, lot_name: "LONGMIRE MAINTENANCE AREA PARKING" },
  ]);
});

test("a lot with only staff lots near it publishes no parking at all", () => {
  const result = npsParkingFacts(
    [candidate(88, lot({ MAPLABEL: "LONGMIRE MAINTENANCE AREA PARKING" }))],
    PARKING_SOURCE
  );
  assert.equal(result.outcome, null);
  assert.equal(result.candidates, 1);
});

test("a generic label leaves the lot without a note, and says why", () => {
  const result = npsParkingFacts([candidate(2, lot({ MAPLABEL: "Parking Lot" }))], PARKING_SOURCE);
  assert.equal(result.outcome?.facts.location_note, undefined);
  assert.equal(result.outcome?.facts.type.value, "lot");
  assert.equal(result.outcome?.diagnostics.location_note_refused, "generic_name");
});

test("a lot's seasonal text is carried in the diagnostics, not published", () => {
  // The parking block has no seasonal leaf. Inventing one on a field 419 of
  // 6,740 lots carry — none of them matched today — would be schema for its
  // own sake, so the evidence waits in the file instead.
  const result = npsParkingFacts(
    [candidate(2, lot({ SEASDESC: "winter closure December 1 - April 15" }))],
    PARKING_SOURCE
  );
  assert.equal(result.outcome?.diagnostics.seasonal_description, "winter closure December 1 - April 15");
  assert.deepEqual(Object.keys(result.outcome?.facts ?? {}).sort(), ["location_note", "type"]);
});

// --- the row ----------------------------------------------------------------

const TRAILHEAD = { id: "xaMGyHut8CoGCSkCPKh6", name: "Paradise", lat: 46.786721, lng: -121.734541 };

test("a trailhead with nothing near it gets no row at all", () => {
  // Not a row with two empty blocks: a row saying "looked, found nothing" is
  // the negative this source cannot support, written where a later reader
  // would take it for one.
  assert.equal(buildNpsFactRow(TRAILHEAD, null, null), null);
});

test("a row carries the blocks that answered and their evidence apart from them", () => {
  const bathroom = npsBathroomFacts([candidate(89.6, poi())], POI_SOURCE).outcome;
  const parking = npsParkingFacts([candidate(0, lot())], PARKING_SOURCE).outcome;
  const row = buildNpsFactRow(TRAILHEAD, bathroom, parking);
  assert.ok(row);
  assert.equal(row.destination_id, "xaMGyHut8CoGCSkCPKh6");
  assert.equal(row.bathrooms?.status.value, "present");
  assert.equal(row.parking?.type.value, "lot");
  assert.equal(row.diagnostics.bathroom?.distance_m, 89.6);
  assert.equal(row.diagnostics.parking?.inside_lot, true);
  // The evidence lives in its own block so the importer can ignore it whole.
  assert.equal("distance_m" in (row.parking as unknown as Record<string, unknown>), false);
});

test("one block answering is enough for a row", () => {
  const parking = npsParkingFacts([candidate(5, lot())], PARKING_SOURCE).outcome;
  const row = buildNpsFactRow(TRAILHEAD, null, parking);
  assert.ok(row);
  assert.equal(row.bathrooms, undefined);
  assert.equal(row.diagnostics.bathroom, undefined);
});
