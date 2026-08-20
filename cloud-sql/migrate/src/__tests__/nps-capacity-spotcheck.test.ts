import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  drawSample,
  publishingRows,
  renderMarkdown,
  ringCentroid,
  ringPerimeterM,
  roadSuspicion,
  spotcheckCandidates,
  stableRank,
  ROAD_SHAPE_MIN_AREA_M2,
  SPOTCHECK_STRATA,
} from "../nps-capacity-spotcheck";

const ORIGIN = { lat: 45, lng: -121 };

/** A rectangle `metres` by `wide`, wound clockwise the way this layer draws. */
function rect(metres: number, wide: number, at = ORIGIN): Array<readonly [number, number]> {
  const dLat = wide / 111_320;
  const dLng = metres / (111_320 * Math.cos((at.lat * Math.PI) / 180));
  return [
    [at.lng, at.lat],
    [at.lng, at.lat + dLat],
    [at.lng + dLng, at.lat + dLat],
    [at.lng + dLng, at.lat],
    [at.lng, at.lat],
  ];
}

function lot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    GEOMETRYID: "{LOT-1}",
    MAPLABEL: "SNOW LAKE PARKING",
    UNITCODE: "MORA",
    UNITNAME: "Mount Rainier National Park",
    OPENTOPUBLIC: "Unknown",
    _geometry: { rings: [rect(60, 60)] },
    ...overrides,
  };
}

test("a lot shaped like a lot is not a road", () => {
  const square = rect(60, 60);
  const { suspect, reason } = roadSuspicion(3_600, ringPerimeterM(square, ORIGIN), "Snow Lake Parking");
  assert.equal(suspect, false);
  assert.equal(reason, null);
});

test("a long thin polygon is a road however it is named", () => {
  // 400 m of carriageway 8 m wide covers 3,200 m², which the curve reads as
  // about 50 cars. It holds none.
  const strip = rect(400, 8);
  const area = 400 * 8;
  const { suspect, reason } = roadSuspicion(area, ringPerimeterM(strip, ORIGIN), "Picnic Area Parking");
  assert.equal(suspect, true);
  assert.equal(reason, "shape");
});

test("a road-named lot is flagged whatever its shape", () => {
  const square = rect(60, 60);
  for (const name of ["Rim Drive Parking", "Skyline Loop", "Blue Ridge Parkway Overlook", "Route 9 Pullout", "Cave Road Lot"]) {
    const { suspect, reason } = roadSuspicion(3_600, ringPerimeterM(square, ORIGIN), name);
    assert.equal(suspect, true, name);
    assert.equal(reason, "name", name);
  }
  // Both tests firing is worth telling apart from either alone.
  const strip = rect(400, 8);
  assert.equal(roadSuspicion(3_200, ringPerimeterM(strip, ORIGIN), "Rim Drive").reason, "shape_and_name");
});

test("a lot with a planted island in it is judged on its own outline", () => {
  // The perimeter belongs to the exterior ring, so the ratio has to be built
  // from that ring's own area. Bison Basin's campground loop is 24,000-odd m²
  // of outline around 7,222 m² of surface, and measuring one against the other
  // called a campground a carriageway.
  const outline = rect(445, 55);
  const perimeter = ringPerimeterM(outline, ORIGIN);
  assert.equal(roadSuspicion(445 * 55, perimeter, "Basin Campground").suspect, false);
  assert.equal(roadSuspicion(7_222, perimeter, "Basin Campground").suspect, true);
});

test("a small elongated polygon is left alone", () => {
  // A 30 m by 4 m pullout is thin and is not a road; the area floor is what
  // keeps the flag off the pullouts the bottom bucket is full of.
  const pullout = rect(30, 4);
  assert.ok(30 * 4 < ROAD_SHAPE_MIN_AREA_M2);
  assert.equal(roadSuspicion(120, ringPerimeterM(pullout, ORIGIN), "Trailhead Pullout").suspect, false);
});

test("candidates carry the ring they came from and the rank they placed at", () => {
  const small = rect(30, 30);
  const large = rect(90, 90, { lat: 45.01, lng: -121 });
  const candidates = spotcheckCandidates([lot({ _geometry: { rings: [small, large] } })]);
  assert.equal(candidates.length, 2);
  // Largest first, so the big one ranks 0 — and it is the second ring listed.
  assert.deepEqual(
    candidates.map((row) => [row.area_rank, row.source_ring_index]),
    [
      [0, 1],
      [1, 0],
    ]
  );
});

test("a staff lot and an anomalous lot never reach the sample", () => {
  assert.deepEqual(spotcheckCandidates([lot({ MAPLABEL: "MAINTENANCE YARD PARKING" })]), []);
  assert.deepEqual(spotcheckCandidates([lot({ ISEXTANT: "False" })]), []);
  // And a part under the three-car floor makes no claim, so it is not a row.
  assert.deepEqual(spotcheckCandidates([lot({ _geometry: { rings: [rect(5, 5)] } })]), []);
});

test("the draw is the same every run", () => {
  const rows = Array.from({ length: 400 }, (_, i) =>
    lot({
      GEOMETRYID: `{LOT-${i}}`,
      UNITCODE: `U${i % 9}`,
      _geometry: { rings: [rect(40 + (i % 60), 40 + (i % 60))] },
    })
  );
  const candidates = spotcheckCandidates(rows);
  const first = drawSample(candidates).map((row) => row.lot_id);
  const second = drawSample(candidates).map((row) => row.lot_id);
  assert.deepEqual(first, second);
  // …and it is not simply file order, which would sample one park.
  assert.notDeepEqual(first, candidates.slice(0, first.length).map((row) => row.lot_id));
});

test("the strata are the reviewed ones", () => {
  assert.deepEqual(SPOTCHECK_STRATA, {
    under_10: 10,
    "10_to_25": 10,
    "25_to_50": 10,
    "50_to_100": 15,
    "100_plus": 15,
  });
  assert.equal(Object.values(SPOTCHECK_STRATA).reduce((a, b) => a + b, 0), 60);
});

test("the ranking key is stable and spread", () => {
  assert.equal(stableRank("{LOT-1}#0"), stableRank("{LOT-1}#0"));
  assert.notEqual(stableRank("{LOT-1}#0"), stableRank("{LOT-1}#1"));
  for (const key of ["a", "b", "{X}#0", "{Y}#3"]) {
    const rank = stableRank(key);
    assert.ok(rank >= 0 && rank <= 1, key);
  }
});

test("the centroid of a rectangle is its middle, to the centimetre", () => {
  // Shoelace at real coordinates cancels away eleven of a double's sixteen
  // digits — 121 × 45 against a square-degree area of 1e-7 — and the answer
  // used to land 2.5 m outside a 60 m lot. The maps link is the whole point of
  // the row, so the frame is local. A centimetre is 1e-7 degrees.
  const centre = ringCentroid(rect(60, 60));
  assert.ok(centre);
  const expectedLat = ORIGIN.lat + 30 / 111_320;
  const expectedLng = ORIGIN.lng + 30 / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180));
  assert.ok(Math.abs(centre.lat - expectedLat) < 1e-7, `lat ${centre.lat}`);
  assert.ok(Math.abs(centre.lng - expectedLng) < 1e-7, `lng ${centre.lng}`);
});

test("a ring with no usable vertex has no centre", () => {
  assert.equal(ringCentroid([]), null);
  assert.equal(
    ringCentroid([
      [Number.NaN, Number.NaN],
      [Number.NaN, Number.NaN],
    ]),
    null
  );
  // A zero-area ring has no centre either, and must not divide by zero.
  assert.equal(
    ringCentroid([
      [-121, 45],
      [-121, 45],
      [-121, 45],
    ]),
    null
  );
});

test("the publishing table names the lots the join actually matched", () => {
  const candidates = spotcheckCandidates([lot(), lot({ GEOMETRYID: "{LOT-2}", MAPLABEL: "OTHER LOT" })]);
  const facts = [
    JSON.stringify({
      destination_id: "dest-1",
      diagnostics: { parking: { lot_id: "{LOT-2}", area: { area_rank: 0 } } },
    }),
    // A second trailhead joined to the same lot is one row, not two.
    JSON.stringify({
      destination_id: "dest-2",
      diagnostics: { parking: { lot_id: "{LOT-2}", area: { area_rank: 0 } } },
    }),
    // A row whose lot made no claim carries no area block at all.
    JSON.stringify({ destination_id: "dest-3", diagnostics: { parking: { lot_id: "{LOT-9}", area: null } } }),
    "not json",
  ].join("\n");
  const publishing = publishingRows(candidates, facts);
  assert.deepEqual(
    publishing.map((row) => row.lot_id),
    ["{LOT-2}"]
  );
});

test("the markdown states the road rule and both tables", () => {
  const candidates = spotcheckCandidates([lot({ MAPLABEL: "RIM DRIVE PARKING" })]);
  const markdown = renderMarkdown(candidates, candidates.length, candidates);
  assert.match(markdown, /does not count toward the bar/);
  assert.match(markdown, /one-way door/);
  assert.match(markdown, /## The stratified sixty/);
  assert.match(markdown, /## Every lot that would publish today/);
  assert.match(markdown, /\*\*road\?\*\*/);
  // The part cell quotes the layer's ring, not only this code's ordering.
  assert.match(markdown, /ring 0/);
  // Without a facts file the section says so rather than printing nothing.
  assert.match(renderMarkdown(candidates, 1, []), /Run the normalizer/);
});
