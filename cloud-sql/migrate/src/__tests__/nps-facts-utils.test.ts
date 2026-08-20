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
  titleCaseName,
  toiletTypeFromName,
  ringsBounds,
  toiletTypeForPoi,
  nearestExteriorPart,
  npsLotCapacity,
  partAreasM2,
  polygonParts,
  ringAreaM2,
  ringsOrigin,
  signedRingAreaM2,
  CAPACITY_RANGE_EMISSION_DEFAULT,
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

/** Paradise's upper lot, which is where most of these fixtures stand. */
const TEST_POINT = { lat: 46.786721, lng: -121.734541 };

function candidate(
  distanceM: number,
  row: Record<string, unknown>,
  rings?: PolygonRings
): NpsCandidate {
  return rings === undefined ? { distanceM, row } : { distanceM, row, rings };
}

/**
 * A rectangle of `metres` by `metres` with its south-west corner on `origin`,
 * wound clockwise — the way this layer draws an exterior ring.
 */
function squareRings(origin: { lat: number; lng: number }, metres: number): PolygonRings {
  return [squareRing(origin, metres, true)];
}

function squareRing(
  origin: { lat: number; lng: number },
  metres: number,
  clockwise: boolean
): Array<readonly [number, number]> {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  const ring: Array<readonly [number, number]> = [
    [origin.lng, origin.lat],
    [origin.lng + dLng, origin.lat],
    [origin.lng + dLng, origin.lat + dLat],
    [origin.lng, origin.lat + dLat],
    [origin.lng, origin.lat],
  ];
  return clockwise ? ring.slice().reverse() : ring;
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
    text: "Paradise Parking (Upper Lot)",
    verbatim: "PARADISE PARKING (UPPER LOT)",
    field: "MAPLABEL",
  });
  assert.deepEqual(npsLotLocationNote({ MAPLABEL: "Parking Lot" }), {
    kind: "refused",
    reason: "generic_name",
  });
  // A bare lettered half of one lot is the row's own label read back.
  assert.deepEqual(npsLotLocationNote({ MAPLABEL: "Parking B" }), {
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
  const result = npsParkingFacts([candidate(0, lot())], PARKING_SOURCE, TEST_POINT);
  assert.ok(result.outcome);
  assert.equal(result.outcome.facts.type.value, "lot");
  assert.equal(result.outcome.facts.location_note?.value, "Paradise Parking (Upper Lot)");
  // The shouting original stays where an auditor can read it.
  assert.equal(result.outcome.diagnostics.lot_name, "PARADISE PARKING (UPPER LOT)");
  assert.equal(result.outcome.diagnostics.inside_lot, true);
  // Area is a capacity proxy nobody calibrated. Nothing numeric goes out.
  assert.deepEqual(Object.keys(result.outcome.facts).sort(), ["location_note", "type"]);
});

test("an overlook lot is still a lot", () => {
  const result = npsParkingFacts([candidate(4, lot({ LOTTYPE: "Overlook" }))], PARKING_SOURCE, TEST_POINT);
  assert.equal(result.outcome?.facts.type.value, "lot");
  assert.equal(result.outcome?.diagnostics.lot_type, "Overlook");
});

test("the maintenance yard is stepped past for the visitor lot behind it", () => {
  const result = npsParkingFacts(
    [
      candidate(44.9, lot({ MAPLABEL: "LONGMIRE MAINTENANCE AREA PARKING" })),
      candidate(88, lot({ MAPLABEL: "LONGMIRE NATIONAL PARK INN PARKING LOOP" })),
    ],
    PARKING_SOURCE,
    TEST_POINT
  );
  assert.equal(result.outcome?.facts.location_note?.value, "Longmire National Park Inn Parking Loop");
  assert.deepEqual(result.skipped, [
    { reason: "non_public_lot", distance_m: 44.9, lot_name: "LONGMIRE MAINTENANCE AREA PARKING" },
  ]);
});

test("a lot with only staff lots near it publishes no parking at all", () => {
  const result = npsParkingFacts(
    [candidate(88, lot({ MAPLABEL: "LONGMIRE MAINTENANCE AREA PARKING" }))],
    PARKING_SOURCE,
    TEST_POINT
  );
  assert.equal(result.outcome, null);
  assert.equal(result.candidates, 1);
});

test("a generic label leaves the lot without a note, and says why", () => {
  const result = npsParkingFacts([candidate(2, lot({ MAPLABEL: "Parking Lot" }))], PARKING_SOURCE, TEST_POINT);
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
    PARKING_SOURCE,
    TEST_POINT
  );
  assert.equal(result.outcome?.diagnostics.seasonal_description, "winter closure December 1 - April 15");
  assert.deepEqual(Object.keys(result.outcome?.facts ?? {}).sort(), ["location_note", "type"]);
});

// --- the area contract ------------------------------------------------------
//
// The reference numbers below come from PostGIS itself: each polygon was run
// through `SELECT ST_Area(ST_GeomFromText(...)::geography)` on the production
// instance, which is the quantity `parking-capacity.ts` was fitted on and the
// quantity its header binds every caller to. Anything that drifts from them is
// measuring something else.

const SQUARE_45N: PolygonRings = [
  [
    [-121.0, 45.0],
    [-121.0, 45.001],
    [-120.999, 45.001],
    [-120.999, 45.0],
    [-121.0, 45.0],
  ],
];
const HOLE_45N: ReadonlyArray<readonly [number, number]> = [
  [-120.9997, 45.0003],
  [-120.9993, 45.0003],
  [-120.9993, 45.0007],
  [-120.9997, 45.0007],
  [-120.9997, 45.0003],
];

test("a ring's area is the geodesic one PostGIS returns, not a planar one", () => {
  // ST_Area(::geography) on the same three squares: 8762.313, 8137.335 and
  // 12309.072 m². One thousandth of a degree square covers less ground the
  // further north it sits, and a Web Mercator area would say the opposite —
  // ×2.00 at 45°N, ×2.32 at 49°N, in the direction that promises a hiker more
  // parking than there is.
  const at = (lat: number) =>
    ringAreaM2(
      [
        [-121.0, lat],
        [-121.0, lat + 0.001],
        [-120.999, lat + 0.001],
        [-120.999, lat],
        [-121.0, lat],
      ],
      { lat: lat + 0.0005, lng: -120.9995 }
    );
  assert.ok(Math.abs(at(45) - 8762.313) < 0.05, `45°N: ${at(45)}`);
  assert.ok(Math.abs(at(49) - 8137.335) < 0.05, `49°N: ${at(49)}`);
  assert.ok(Math.abs(at(0) - 12309.072) < 0.05, `0°: ${at(0)}`);
});

test("winding says which ring is the lot and which is the hole in it", () => {
  const origin = ringsOrigin(SQUARE_45N);
  assert.ok(origin);
  // Esri draws an exterior clockwise, which is a negative shoelace with
  // longitude east and latitude north.
  assert.ok(signedRingAreaM2(SQUARE_45N[0], origin) < 0);
  assert.ok(signedRingAreaM2(HOLE_45N, origin) > 0);
  const { parts, orphanHoles, demotedHoles } = polygonParts([SQUARE_45N[0], HOLE_45N]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].holes.length, 1);
  assert.equal(orphanHoles, 0);
  assert.equal(demotedHoles, 0);
});

test("net of the hole is what the calibration is handed, and it moves the bucket", () => {
  // PostGIS puts the square at 8762.313 m² and the square-with-hole at
  // 7360.343. The 100-car edge is 8,759 m², so the hole is the difference
  // between telling a reader "roughly 100+ cars" and "roughly 50-100".
  const origin = ringsOrigin([SQUARE_45N[0], HOLE_45N]);
  assert.ok(origin);
  const { parts } = polygonParts([SQUARE_45N[0], HOLE_45N]);
  const areas = partAreasM2(parts[0], origin);
  assert.ok(Math.abs(areas.grossM2 - 8762.313) < 0.05, `gross ${areas.grossM2}`);
  assert.ok(Math.abs(areas.netM2 - 7360.343) < 0.05, `net ${areas.netM2}`);
  const capacity = npsLotCapacity({ lat: 45.0005, lng: -120.9995 }, [SQUARE_45N[0], HOLE_45N]);
  assert.equal(capacity?.capacity_range, "50_to_100");
  assert.equal(capacity?.holes, 1);
});

test("a multi-part feature answers with the part the trailhead stands in", () => {
  // Two lots either side of a road are two lots. Summing them would say the
  // near one holds what both hold together.
  const near = squareRing({ lat: 45.0, lng: -121.0 }, 30, true);
  const far = squareRing({ lat: 45.01, lng: -121.0 }, 200, true);
  const { parts } = polygonParts([far, near]);
  assert.equal(parts.length, 2);
  const standing = { lat: 45.0001, lng: -120.99995 };
  const nearest = nearestExteriorPart(standing, parts);
  assert.equal(nearest?.distanceM, 0);
  const capacity = npsLotCapacity(standing, [far, near]);
  assert.equal(capacity?.parts, 2);
  // 30 m by 30 m is 900 m², which is 10_to_25. The far part is 40,000 m² and
  // would have been 100_plus; their sum would have been too.
  assert.equal(capacity?.capacity_range, "10_to_25");
  assert.ok(Math.abs(capacity!.net_area_m2 - 900) < 5, `${capacity?.net_area_m2}`);
});

test("a ring wound like a lot but drawn inside one is read as a hole", () => {
  // 21 rings in 18 of the layer's features contradict their own winding.
  // Believing them leaves a building counted as parking.
  const outer = squareRing({ lat: 45.0, lng: -121.0 }, 100, true);
  const inner = squareRing({ lat: 45.0002, lng: -120.99975 }, 40, true);
  const { parts, demotedHoles } = polygonParts([outer, inner]);
  assert.equal(parts.length, 1);
  assert.equal(demotedHoles, 1);
  const origin = ringsOrigin([outer, inner]);
  const areas = partAreasM2(parts[0], origin!);
  assert.ok(Math.abs(areas.grossM2 - 10_000) < 30, `gross ${areas.grossM2}`);
  assert.ok(Math.abs(areas.netM2 - 8_400) < 40, `net ${areas.netM2}`);
});

test("a hole inside no lot is dropped rather than counted as one", () => {
  const lotRing = squareRing({ lat: 45.0, lng: -121.0 }, 100, true);
  const stray = squareRing({ lat: 45.02, lng: -121.0 }, 60, false);
  const { parts, orphanHoles } = polygonParts([lotRing, stray]);
  assert.equal(parts.length, 1);
  assert.equal(orphanHoles, 1);
  assert.equal(parts[0].holes.length, 0);
});

test("the gates say why they made no claim", () => {
  const pullout = npsLotCapacity({ lat: 45.0, lng: -121.0 }, squareRings({ lat: 45, lng: -121 }, 8));
  assert.equal(pullout?.capacity_range, null);
  assert.equal(pullout?.capacity_range_withheld, "below_floor");
  const enormous = npsLotCapacity(
    { lat: 45.0, lng: -121.0 },
    squareRings({ lat: 45, lng: -121 }, 400)
  );
  assert.equal(enormous?.capacity_range, null);
  assert.equal(enormous?.capacity_range_withheld, "above_cap");
  assert.equal(npsLotCapacity({ lat: 45, lng: -121 }, undefined), null);
  assert.equal(npsLotCapacity({ lat: 45, lng: -121 }, []), null);
});

// --- the capacity range as a leaf -------------------------------------------

test("the range is computed on every run and published on none by default", () => {
  // Off until a person has read the spot-check sample against imagery. The
  // measurement still happens, so a reviewer can see what would be published.
  assert.equal(CAPACITY_RANGE_EMISSION_DEFAULT, false);
  const rings = squareRings({ lat: 46.786721, lng: -121.734541 }, 60);
  const quiet = npsParkingFacts([candidate(0, lot(), rings)], PARKING_SOURCE, TEST_POINT);
  assert.equal(quiet.outcome?.facts.capacity_range, undefined);
  assert.equal(quiet.outcome?.diagnostics.area?.capacity_range, "50_to_100");
  assert.equal(quiet.outcome?.diagnostics.area?.capacity_range_withheld, "emission_disabled");
});

test("with emission on, the range rides the same envelope as the other leaves", () => {
  const rings = squareRings({ lat: 46.786721, lng: -121.734541 }, 60);
  const result = npsParkingFacts([candidate(0, lot(), rings)], PARKING_SOURCE, TEST_POINT, {
    emitCapacityRange: true,
  });
  const leaf = result.outcome?.facts.capacity_range;
  assert.equal(leaf?.value, "50_to_100");
  assert.equal(leaf?.source.kind, "nps_parking");
  assert.equal(leaf?.source.name, NPS_SOURCE_NAME);
  assert.equal(leaf?.source.license, NPS_LICENSE);
  assert.equal(leaf?.retrieved_at, "2026-08-19");
  assert.equal(leaf?.source.url, PARKING_SOURCE.url);
});

test("no lot ever publishes a vehicle count, whatever its area", () => {
  // The structural rule, over the whole size range: an area may become a
  // bucket and may never become a number of cars.
  for (const metres of [5, 9, 20, 35, 60, 95, 150, 224, 400]) {
    const rings = squareRings({ lat: 46.786721, lng: -121.734541 }, metres);
    const result = npsParkingFacts([candidate(0, lot(), rings)], PARKING_SOURCE, TEST_POINT, {
      emitCapacityRange: true,
    });
    const keys = Object.keys(result.outcome?.facts ?? {});
    assert.equal(keys.includes("capacity_vehicles"), false, `${metres} m published a count`);
    for (const key of keys) {
      assert.ok(
        ["type", "capacity_range", "location_note"].includes(key),
        `${metres} m published an unexpected leaf ${key}`
      );
    }
  }
});

test("a lot with no geometry publishes its type and says nothing about size", () => {
  const result = npsParkingFacts([candidate(3, lot())], PARKING_SOURCE, TEST_POINT, {
    emitCapacityRange: true,
  });
  assert.equal(result.outcome?.facts.capacity_range, undefined);
  assert.equal(result.outcome?.diagnostics.area, null);
  assert.equal(result.outcome?.facts.type.value, "lot");
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
  const parking = npsParkingFacts([candidate(0, lot())], PARKING_SOURCE, TEST_POINT).outcome;
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
  const parking = npsParkingFacts([candidate(5, lot())], PARKING_SOURCE, TEST_POINT).outcome;
  const row = buildNpsFactRow(TRAILHEAD, null, parking);
  assert.ok(row);
  assert.equal(row.bathrooms, undefined);
  assert.equal(row.diagnostics.bathroom, undefined);
});

// --- fixes from review ------------------------------------------------------

test("a present field this code cannot read fails closed", () => {
  // A boolean false in OPENTOPUBLIC says the lot is shut as plainly as "No"
  // does. Coercing it to "" and falling through would publish a closed lot.
  assert.equal(npsFeatureAnomaly(poi({ OPENTOPUBLIC: false })), "open_to_public_unreadable");
  assert.equal(npsFeatureAnomaly(poi({ POISTATUS: 0 })), "status_unreadable");
  assert.equal(npsFeatureAnomaly(poi({ ISEXTANT: [] })), "extant_unreadable");
  // Null and undefined stay ordinary: POISTATUS is null on 30,235 of 35,567.
  assert.equal(npsFeatureAnomaly(poi({ POISTATUS: null, ISEXTANT: undefined })), null);
});

test("a POI whose name names its fixture is typed by the name", () => {
  assert.equal(toiletTypeFromName("Kautz Creek Vault Toilet"), "vault_pit");
  assert.equal(toiletTypeFromName("Canyon Overlook Parking Area Pit Toilet"), "vault_pit");
  assert.equal(toiletTypeFromName("Roaring Springs Composting Toilet"), "composting");
  assert.equal(toiletTypeFromName("Portable Toilet"), "portable");
  assert.equal(toiletTypeFromName("Lodge Flush Toilets"), "flush");
});

test("a name that says nothing, or says two things, does not type anything", () => {
  assert.equal(toiletTypeFromName("Sunrise Restroom"), null);
  assert.equal(toiletTypeFromName(""), null);
  assert.equal(toiletTypeFromName(null), null);
  // No name in the layer holds two fixture words today; the day one does, the
  // honest answer is the one the type already gave.
  assert.equal(toiletTypeFromName("Vault and Flush Toilets"), null);
  // Whole words only: no upgrading a "Pitcher Pump Restroom" to a pit toilet.
  assert.equal(toiletTypeFromName("Pitcher Pump Restroom"), null);
});

test("the name only speaks where the type said nothing specific", () => {
  const upgraded = npsBathroomFacts(
    [candidate(40, poi({ POITYPE: "Restroom", POINAME: "Kautz Creek Vault Toilet" }))],
    POI_SOURCE
  );
  assert.equal(upgraded.outcome?.facts.type.value, "vault_pit");
  assert.equal(upgraded.outcome?.diagnostics.type_from_poi_name, "vault_pit");

  // A specific type is never overruled by a name.
  const specific = npsBathroomFacts(
    [candidate(40, poi({ POITYPE: "Flush Toilet", POINAME: "Vault Toilet" }))],
    POI_SOURCE
  );
  assert.equal(specific.outcome?.facts.type.value, "flush");
  assert.equal(specific.outcome?.diagnostics.type_from_poi_name, null);
});

test("a seasonal flag with no description is worth one honest word", () => {
  const flagged = npsBathroomFacts([candidate(30, poi({ SEASONAL: "Yes" }))], POI_SOURCE);
  assert.equal(flagged.outcome?.facts.season_note?.value, "Seasonal");

  // A described season always beats the flag.
  const described = npsBathroomFacts(
    [candidate(30, poi({ SEASONAL: "Yes", SEASDESC: "Winter Only" }))],
    POI_SOURCE
  );
  assert.equal(described.outcome?.facts.season_note?.value, "Winter Only");

  // And an unflagged, undescribed restroom says nothing about seasons at all.
  const silent = npsBathroomFacts([candidate(30, poi())], POI_SOURCE);
  assert.equal(silent.outcome?.facts.season_note, undefined);
});

test("a shouted name is said at a normal volume, and a chosen one is left alone", () => {
  assert.equal(titleCaseName("PARADISE PARKING (UPPER LOT)"), "Paradise Parking (Upper Lot)");
  assert.equal(titleCaseName("GROVE OF THE PATRIARCHS PARKING"), "Grove of the Patriarchs Parking");
  assert.equal(titleCaseName("HEART O' THE HILLS CAMPGROUND"), "Heart O' the Hills Campground");
  assert.equal(titleCaseName("SHADOW LAKE-SUNRISE CAMP"), "Shadow Lake-Sunrise Camp");
  assert.equal(titleCaseName("TIPSOO LAKE PARKING B"), "Tipsoo Lake Parking B");
  // A small word that opens or closes the name is still capitalized.
  assert.equal(titleCaseName("OF"), "Of");
  // One lowercase letter anywhere means the agency chose this casing.
  assert.equal(titleCaseName("SD (U) Wonsqueak Bike Path Parking"), "SD (U) Wonsqueak Bike Path Parking");
  assert.equal(titleCaseName("Lassen Peak Trailhead Parking"), "Lassen Peak Trailhead Parking");
});

test("the staff-lot list covers the layer's own spellings, typo included", () => {
  assert.equal(isNonPublicLotName("LONGMIRE MAINTENANCE AREA PARKING"), true);
  assert.equal(isNonPublicLotName("Maitenance Yard"), true, "the layer's one dropped n");
  assert.equal(isNonPublicLotName("Maintenence Shop"), true);
  assert.equal(isNonPublicLotName("Dorm Parking"), true);
  assert.equal(isNonPublicLotName("Dormitory Lot"), true);
  assert.equal(isNonPublicLotName("Employee Housing Parking"), true);
  assert.equal(isNonPublicLotName("Officers Quarters"), true);
  assert.equal(isNonPublicLotName("Horse Corral Parking"), true);
  assert.equal(isNonPublicLotName("Barn Lot"), true);
  assert.equal(isNonPublicLotName("Concessionaire Parking"), true);
  assert.equal(isNonPublicLotName("Concessions Parking"), true);
  // The names this must not touch are the ordinary visitor ones.
  assert.equal(isNonPublicLotName("PARADISE PARKING (UPPER LOT)"), false);
  assert.equal(isNonPublicLotName("Hurricane Hill Trailhead Parking"), false);
  assert.equal(isNonPublicLotName("Main Street Parking"), false, "main is not maint");
});
