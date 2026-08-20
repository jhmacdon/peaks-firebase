import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeCredits,
  leafCredit,
  roadAccessBadge,
  roadAccessRow,
  roadSurface,
  roadValue,
  seasonalCaption,
  seasonalDateLabel,
  vehicleDemand,
} from "./trailhead-road-access";
import type { TrailheadRoadAccess } from "./amenities";

const ROADCORE = {
  kind: "usfs_roadcore",
  name: "USFS National Forest System Roads (RoadCore)",
  url: "https://example.invalid/roadcore",
};
const MVUM = { kind: "usfs_mvum", name: "USFS Motor Vehicle Use Map roads" };

function leaf(value: unknown, source: Record<string, unknown> = ROADCORE): unknown {
  return { value, source, retrieved_at: "2026-08-19" };
}

/** The block as the importer writes it, cast the way the page reads it. */
function block(fields: Record<string, unknown>): TrailheadRoadAccess {
  return fields as unknown as TrailheadRoadAccess;
}

test("four driven wheels outrank clearance, and a false flag speaks only alone", () => {
  assert.equal(vehicleDemand("not_required", true), "4WD required");
  assert.equal(vehicleDemand("required", undefined), "High-clearance required");
  assert.equal(vehicleDemand("recommended", false), "High-clearance recommended");
  assert.equal(vehicleDemand("not_required", false), "Passenger car OK");
  assert.equal(vehicleDemand(undefined, false), "4WD not required");
  assert.equal(vehicleDemand(undefined, undefined), null);
  // Nothing outside the contract is guessed at.
  assert.equal(vehicleDemand("maybe", "yes"), null);
});

test("a surface that names a thing can be leaned on as an adjective", () => {
  assert.equal(roadValue("High-clearance required", roadSurface("gravel")), "High-clearance gravel");
  assert.equal(
    roadValue("High-clearance required", roadSurface("paved")),
    "High-clearance required, paved"
  );
  assert.equal(roadValue("4WD required", roadSurface("dirt")), "4WD required, dirt");
  assert.equal(roadValue("Passenger car OK", null), "Passenger car OK");
  assert.equal(roadValue(null, roadSurface("chip seal")), "Chip seal");
  assert.equal(roadValue(null, null), null);
});

test("an un-normalized agency code still reads as a word", () => {
  assert.equal(roadSurface("AGG")?.label, "Gravel");
  assert.equal(roadSurface("NAT")?.label, "Dirt");
  assert.equal(roadSurface("AC")?.label, "Paved");
  // Anything else is the agency's own wording, printed as it came.
  assert.equal(roadSurface("improved dirt")?.label, "Improved dirt");
  assert.equal(roadSurface(""), null);
  assert.equal(roadSurface(42), null);
});

test("a gate date is a month and a day, or it is not printed", () => {
  assert.equal(seasonalDateLabel("2026-04-02"), "Apr 2");
  assert.equal(seasonalDateLabel("2026-11-30"), "Nov 30");
  assert.equal(seasonalDateLabel("2026-04-02T00:00:00Z"), "Apr 2");
  assert.equal(seasonalDateLabel("04/02"), "Apr 2");
  assert.equal(seasonalDateLabel("02-29"), "Feb 29");
  assert.equal(seasonalDateLabel("N/A"), null);
  assert.equal(seasonalDateLabel("13/45"), null);
  assert.equal(seasonalDateLabel("2026-02-30"), null);
  assert.equal(seasonalDateLabel(null), null);
});

test("half a window is worse than none", () => {
  assert.equal(
    seasonalCaption({ opens: "2026-04-02", closes: "2026-11-30" }),
    "Gate typically open Apr 2 – Nov 30"
  );
  assert.equal(seasonalCaption({ opens: "2026-04-02", closes: "N/A" }), null);
  assert.equal(seasonalCaption({ opens: "2026-04-02" }), null);
  assert.equal(seasonalCaption("summer"), null);
});

test("the row reads as one answer with its sentences under it", () => {
  const row = roadAccessRow(
    block({
      high_clearance: leaf("required"),
      four_wheel_drive: leaf(false),
      surface: leaf("gravel"),
      seasonal_window: leaf({ opens: "2026-04-02", closes: "2026-11-30" }, MVUM),
      limiting_segment_ref: leaf("FR 8040-550"),
    })
  );
  assert.equal(row?.label, "Road");
  assert.equal(row?.value, "High-clearance gravel");
  assert.deepEqual(row?.captions, [
    "Gate typically open Apr 2 – Nov 30",
    "Last rough stretch: FR 8040-550",
  ]);
  assert.deepEqual(
    row?.credits?.map((credit) => credit.name),
    [ROADCORE.name, MVUM.name]
  );
  assert.equal(row?.credits?.[0].url, ROADCORE.url);
});

test("an absent leaf prints nothing, and an empty block prints no row", () => {
  const row = roadAccessRow(block({ surface: leaf("dirt") }));
  assert.equal(row?.value, "Dirt");
  assert.deepEqual(row?.captions, []);

  assert.equal(roadAccessRow(block({})), null);
  assert.equal(roadAccessRow(undefined), null);
  assert.equal(roadAccessRow(null), null);
});

test("a row with only sentences promotes the first rather than sit under an empty line", () => {
  const row = roadAccessRow(
    block({ seasonal_window: leaf({ opens: "2026-06-01", closes: "2026-10-15" }, MVUM) })
  );
  assert.equal(row?.value, "Gate typically open Jun 1 – Oct 15");
  assert.deepEqual(row?.captions, []);
});

test("a malformed leaf is read as an absent one, never thrown on", () => {
  // Everything here comes out of unvalidated JSONB.
  const row = roadAccessRow(
    block({
      high_clearance: "required",
      four_wheel_drive: [],
      surface: leaf("gravel"),
      seasonal_window: leaf(["2026-04-02", "2026-11-30"], MVUM),
      limiting_segment_ref: leaf("   "),
    })
  );
  assert.equal(row?.value, "Gravel");
  assert.deepEqual(row?.captions, []);
});

test("a credit needs a name, and a link needs to be one", () => {
  assert.deepEqual(leafCredit(leaf("gravel")), { name: ROADCORE.name, url: ROADCORE.url });
  assert.deepEqual(leafCredit(leaf("gravel", { kind: "x", name: "Agency" })), { name: "Agency" });
  assert.deepEqual(leafCredit(leaf("gravel", { kind: "x", name: "Agency", url: "javascript:x" })), {
    name: "Agency",
  });
  assert.equal(leafCredit(leaf("gravel", { kind: "x", name: "  " })), null);
  assert.equal(leafCredit("gravel"), null);
  assert.deepEqual(
    dedupeCredits([{ name: "A" }, null, { name: "A", url: "https://b" }, { name: "B" }]),
    [{ name: "A" }, { name: "B" }]
  );
});

test("the admin chip says the same thing in one line", () => {
  assert.equal(
    roadAccessBadge(block({ high_clearance: leaf("required"), surface: leaf("gravel") })),
    "road: high-clearance gravel"
  );
  assert.equal(
    roadAccessBadge(block({ four_wheel_drive: leaf(true) })),
    "road: 4WD required",
    "an acronym keeps its capitals"
  );
  assert.equal(roadAccessBadge(block({})), null);
});
