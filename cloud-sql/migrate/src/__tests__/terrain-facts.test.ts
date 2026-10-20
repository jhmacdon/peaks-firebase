import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuote, htmlToText, publisherOf, verify, type Page } from "../terrain-facts/verify";
import { groupStretches, measure, packetSha256, type Packet } from "../terrain-facts/packet";
import type { Research } from "../terrain-facts/schema";

const packet: Packet = {
  route_id: "r1", route_name: "Test Peak via Ridge", shape: "out_and_back", state_code: "WA",
  objective: { destination_id: "d1", name: "Test Peak", elevation_ft: 6200 }, trailhead: null,
  length_m: 3000, low_ft: 3000, high_ft: 6200,
  stretches: [
    { id: "S1", name: "Ridge Trail", segment_ids: ["a"], start_m: 0, end_m: 2500, start_ft: 3000, end_ft: 5800, low_ft: 3000, high_ft: 5800 },
    { id: "S2", name: "Summit Scramble", segment_ids: ["b"], start_m: 2500, end_m: 3000, start_ft: 5800, end_ft: 6200, low_ft: 5800, high_ft: 6200 },
  ],
  waypoints: [{ id: "W1", destination_id: "d1", name: "Test Peak", features: ["summit"], along_m: 3000, elevation_ft: 6200, off_route_m: 0 }],
  profile: [[0, 3000], [1000, 4100], [2000, 5300], [2500, 5800], [2800, 6050], [3000, 6200]],
  built_at: "2026-10-20T00:00:00Z",
};
const sha = packetSha256(packet);

const pageA: Page = { url: "https://a.example.org/route", status: "ok", http_status: 200, via: "https", error: null,
  text: "The trail climbs steadily to the ridge. The final 400 feet above 5,800 feet is a Class 3 scramble where you will use your hands on solid rock." };
const pageB: Page = { url: "https://b.example.com/test-peak", status: "ok", http_status: 200, via: "https", error: null,
  text: "Expect a short third-class scramble on the summit block; hands are needed for a few moves." };
const pages = new Map([[pageA.url, pageA], [pageB.url, pageB]]);

function research(over: Partial<Research> = {}): Research {
  return {
    route_id: "r1", packet_sha256: sha,
    route: { hardest_class: { value: "3", claim_ids: ["c1", "c2"] }, hands_needed_anywhere: { value: "yes", claim_ids: ["c1", "c2"] }, glacier_travel: { value: "unknown", claim_ids: [] }, technical_gear: { value: "unknown", claim_ids: [] } },
    features: [{ id: "f1", type: "scramble", yds_class: "3", hands: "required", conflicting: false, note: "", season: null, claim_ids: ["c1", "c2"],
      location: { anchor: "elevation_band", waypoint_id: null, stretch_ids: [], from_ft: 5800, to_ft: 6200, claim_ids: ["c1"], note: "" } }],
    stretches: [{ stretch_id: "S1", terrain: "unknown", claim_ids: [] }, { stretch_id: "S2", terrain: "scramble", claim_ids: ["c1", "c2"] }],
    claims: [
      { id: "c1", source_url: pageA.url, publisher: "A", source_type: "route_page", quote: "The final 400 feet above 5,800 feet is a Class 3 scramble where you will use your hands", establishes: "" },
      { id: "c2", source_url: pageB.url, publisher: "B", source_type: "route_page", quote: "Expect a short third-class scramble on the summit block; hands are needed for a few moves.", establishes: "" },
    ],
    unknowns: [], conflicts: [], sources_consulted: [pageA.url, pageB.url], ...over,
  };
}

test("a clean answer passes and places the feature on the final climb", () => {
  const v = verify(packet, sha, research(), pages);
  assert.deepEqual(v.findings.filter(f => !f.ok), []);
  assert.equal(v.ok, true);
  // The band maps only to the profile points the route reaches above 5,800 ft (within 25 ft).
  assert.deepEqual(v.locations.f1, { start_m: 2500, end_m: 3000, how: "route between 5800 and 6200 ft" });
});

test("quotes match through typography and tags, not through edits", () => {
  assert.equal(findQuote("It’s a  Class 3 scramble — use hands", "it's a class 3 scramble - use hands"), "exact");
  assert.equal(findQuote("Class 3 scramble where you will use your hands", htmlToText("<p>Class 3 <b>scramble</b>, where you will use your hands</p>")), "loose");
  assert.equal(findQuote("a Class 4 scramble where you will use your hands", pageA.text), null);
  const cut = research({ claims: research().claims.map(c => c.id === "c1" ? { ...c, quote: "The final 400 feet ... a Class 3 scramble where you will use your hands" } : c) });
  assert.equal(verify(packet, sha, cut, pages).claims.find(c => c.id === "c1")!.status, "bad_quote");
});

test("a scramble needs two publishers, and both must not be trip reports", () => {
  const one = research({ claims: research().claims.map(c => ({ ...c, source_url: pageA.url })) });
  const pagesOne = new Map([[pageA.url, { ...pageA, text: pageA.text + " " + pageB.text }]]);
  assert.ok(verify(packet, sha, one, pagesOne).findings.some(f => f.path === "features.f1.type" && f.problems.includes("rests on one publisher")));
  const reports = research({ claims: research().claims.map(c => ({ ...c, source_type: "trip_report" as const })) });
  assert.ok(verify(packet, sha, reports, pages).findings.some(f => f.problems.includes("rests only on trip reports or forums")));
});

test("a class the quotes never state fails", () => {
  const r = research();
  r.features[0].yds_class = "4";
  assert.ok(verify(packet, sha, r, pages).findings.some(f => f.path === "features.f1.yds_class" && f.problems.includes("no verified quote states it in words")));
});

test("an elevation not stated in a placing quote fails", () => {
  const r = research();
  r.features[0].location.to_ft = 6100;
  const v = verify(packet, sha, r, pages);
  assert.ok(v.findings.some(f => f.path === "features.f1.location" && f.problems.some(p => p.includes("6100 ft is not stated"))));
  assert.equal(v.locations.f1, null);
});

test("a quote that is not on the page fails every finding citing only it", () => {
  const r = research();
  r.stretches[0] = { stretch_id: "S1", terrain: "rough_trail", claim_ids: ["c3"] };
  r.claims.push({ id: "c3", source_url: pageB.url, publisher: "B", source_type: "route_page", quote: "The lower trail is steep, rocky and full of roots throughout.", establishes: "" });
  const v = verify(packet, sha, r, pages);
  assert.equal(v.claims.find(c => c.id === "c3")!.status, "not_on_page");
  assert.ok(v.findings.some(f => f.path === "stretches.S1" && f.problems.includes("no cited claim passed the page check")));
});

test("every stretch must appear once, and the packet hash must match", () => {
  const v = verify(packet, sha, research({ stretches: [{ stretch_id: "S2", terrain: "unknown", claim_ids: [] }], packet_sha256: "x" }), pages);
  assert.ok(v.structural.includes("stretch S1 appears 0 times"));
  assert.ok(v.structural.includes("packet_sha256 does not match the packet"));
});

test("blocked pages are reported, not verified", () => {
  const blocked = new Map(pages); blocked.set(pageB.url, { ...pageB, status: "blocked", text: "", error: "bot check" });
  assert.equal(verify(packet, sha, research(), blocked).claims.find(c => c.id === "c2")!.status, "page_blocked");
});

test("publishers fold subdomains", () => {
  assert.equal(publisherOf("https://www.wta.org/go-hiking/hikes/mount-si"), "wta.org");
  assert.equal(publisherOf("https://fs.usda.gov/x"), publisherOf("https://www.fs.usda.gov/y"));
  assert.equal(publisherOf("ftp://x.org"), null);
});

test("stretches group by name and scale to the route line", () => {
  const coords = [[0, 0, 100], [0, 0.009, 200], [0, 0.018, 300]];
  const along = measure(coords);
  const s = groupStretches([{ id: "a", name: "A", length_m: 900 }, { id: "b", name: "A", length_m: 100 }, { id: "c", name: "B", length_m: 1000 }], coords, along);
  assert.deepEqual(s.map(x => [x.id, x.segment_ids, x.start_m]), [["S1", ["a", "b"], 0], ["S2", ["c"], Math.round(along[2] / 2)]]);
});

test("the word scramble alone does not make a scramble", () => {
  const r = research();
  r.features[0] = { ...r.features[0], yds_class: "unknown", hands: "unknown" };
  assert.ok(verify(packet, sha, r, pages).findings.some(f => f.path === "features.f1.type" && f.problems.some(p => p.includes("the word alone is not enough"))));
});

test("a class ceiling is not a rating", () => {
  const ceiling: Page = { url: "https://c.example.gov/brief.pdf", status: "ok", http_status: 200, via: "https", error: null,
    text: "The guides mark the route with wands and the main climbing route is 3rd or 4th class at most. If it is harder, you are off route." };
  const r = research();
  r.route.hardest_class = { value: "3", claim_ids: ["c9"] };
  r.claims.push({ id: "c9", source_url: ceiling.url, publisher: "C", source_type: "official", quote: "the main climbing route is 3rd or 4th class at most.", establishes: "" });
  const v = verify(packet, sha, r, new Map([...pages, [ceiling.url, ceiling]]));
  assert.ok(v.findings.some(f => f.path === "route.hardest_class" && f.problems.includes("quotes give only a ceiling, not a rating")));
});

// ---------- apply ----------
import { cutLine, lineLength, plan, resolve, type SegmentRow } from "../terrain-facts/apply";

// Two 1 km segments heading north, climbing 0 -> 100 -> 300 m; the second is stored reversed.
const north = (lat0: number, km: number, z0: number, z1: number) => [0, 0.5, 1].map(f => [0, lat0 + f * km / 111.195, z0 + f * (z1 - z0)]);
const rows: SegmentRow[] = [
  { ordinal: 0, direction: "forward", id: "a", kind: "trail", coords: north(0, 1, 0, 100) },
  { ordinal: 1, direction: "reverse", id: "b", kind: "scramble", coords: [...north(1 / 111.195, 1, 100, 300)].reverse() },
];

test("cutLine splits at distances and interpolates elevation", () => {
  const [p1, p2] = cutLine(north(0, 1, 0, 100), [250]);
  assert.ok(Math.abs(lineLength(p1) - 250) < 1 && Math.abs(lineLength(p2) - 750) < 1);
  assert.ok(Math.abs(p1[p1.length - 1][2] - 25) < 0.5);
});

test("an elevation endpoint resolves along the walked route, across a reversed segment", () => {
  assert.ok(Math.abs(resolve({ elevation_ft: 200 / 0.3048, crossing: "last" }, rows) - 1500) < 2);
  assert.throws(() => resolve({ elevation_ft: 2000, crossing: "last" }, rows), /never crosses/);
});

test("plan splits a reversed segment where an interval starts, and resets unbacked scrambles", () => {
  const p = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "scramble", from: { elevation_ft: 200 / 0.3048, crossing: "last" }, to: "end", note: "" }] });
  assert.equal(p.ops.length, 1);
  const split = p.ops[0];
  assert.equal(split.op, "split");
  if (split.op !== "split") return;
  // Stored reversed: the route's last 500 m is the first 500 m of the stored line.
  assert.deepEqual(split.pieces.map(x => [x.kind, x.length_m]), [["scramble", 500], ["trail", 500]]);
  const reset = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [] });
  assert.deepEqual(reset.ops.map(o => o.op === "kind" && [o.segment_id, o.to]), [["b", "trail"]]);
});

test("plan snaps cuts near segment ends and refuses overlaps", () => {
  const p = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "climbers_route", from: 1005, to: "end", note: "" }] });
  assert.deepEqual(p.ops.map(o => o.op === "kind" && [o.segment_id, o.to]), [["b", "climbers_route"]]);
  assert.throws(() => plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "scramble", from: 0, to: 1200, note: "" }, { kind: "trail", from: 1100, to: "end", note: "" }] }), /overlap/);
});

test("a segment edge endpoint lands exactly on the boundary", () => {
  const p = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "climbers_route", from: { segment: "b", edge: "start" }, to: { segment: "b", edge: "end" }, note: "" }] });
  assert.deepEqual(p.ops.map(o => o.op === "kind" && [o.segment_id, o.to]), [["b", "climbers_route"]]);
});

test("adjacent intervals share one cut", () => {
  const p = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [
    { kind: "climbers_route", from: "start", to: 1500, note: "" }, { kind: "scramble", from: 1500, to: "end", note: "" }] });
  const split = p.ops.find(o => o.op === "split");
  assert.ok(split && split.op === "split" && split.pieces.length === 2);
});

test("an interval can rename the stretch it labels", () => {
  const p = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "scramble", from: 1500, to: "end", note: "", display_name: "Summit gully" }] });
  const split = p.ops.find(o => o.op === "split");
  assert.ok(split && split.op === "split");
  if (split?.op === "split") assert.deepEqual(split.pieces.map(x => x.display_name), ["Summit gully", null]);
});

test("a cut whose pieces would read the same is a relabel, not a split", () => {
  const p = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [
    { kind: "trail", from: "start", to: 1500, note: "" }, { kind: "trail", from: 1500, to: "end", note: "" }] });
  assert.deepEqual(p.ops.map(o => o.op === "kind" ? [o.segment_id, o.to] : o.op), [["b", "trail"]]);
});

test("a climb needs a 5th-class rating", () => {
  const r = research();
  r.features[0] = { ...r.features[0], type: "technical_climb", yds_class: "4" };
  assert.ok(verify(packet, sha, r, pages).findings.some(f => f.problems.includes("a climb needs a stated 5th-class rating")));
});

test("a summary needs a short line and credited https sources", () => {
  const ok = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [], summary: { line: "Hike with an optional class 3 scramble", gear: [], hardest_class: "3", sources: [{ name: "WTA", url: "https://www.wta.org/x" }] } });
  assert.equal(ok.summary?.line, "Hike with an optional class 3 scramble");
  assert.throws(() => plan("r", rows, { route_id: "r", packet_sha256: "", apply: [], summary: { line: "x", gear: [], hardest_class: null, sources: [] } }), /sources/);
});

test("a hold keeps a segment as it is and spares it the reset", () => {
  const held = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "hold", from: { segment: "b", edge: "start" }, to: "end", note: "held" }] });
  assert.deepEqual(held.ops, [], "b stays scramble; a stays trail");
  const onTrail = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "hold", from: "start", to: "end", note: "held" }] });
  assert.deepEqual(onTrail.ops, [], "a hold never upgrades trail");
});

test("a segment held by another review keeps its kind until a decision labels it", () => {
  const reset = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [] }, [], ["b"]);
  assert.deepEqual(reset.ops, [], "no reset of a held scramble");
  assert.deepEqual(reset.holds, { add: [], clear: [] });
  const settled = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "trail", from: { segment: "b", edge: "start" }, to: "end", note: "settled" }] }, [], ["b"]);
  assert.deepEqual(settled.ops.map(o => o.op === "kind" && [o.segment_id, o.to]), [["b", "trail"]]);
  assert.deepEqual(settled.holds.clear, ["b"]);
  const held = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "hold", from: "start", to: "end", note: "held" }] });
  assert.deepEqual(held.holds.add, ["a", "b"]);
});

test("the held piece of a split segment is registered as held", () => {
  // From 1,600 m: the segment's midpoint (1,500 m) is outside the hold, so it splits.
  const p = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "hold", from: 1600, to: "end", note: "held" }] });
  const split = p.ops.find(o => o.op === "split");
  assert.ok(split && split.op === "split");
  if (split?.op !== "split") return;
  const heldPiece = split.pieces.find(x => x.kind === "scramble")!;
  assert.deepEqual(p.holds.add, [heldPiece.id]);
});

test("a segment walked twice is fine when both passes agree", () => {
  const loop: SegmentRow[] = [rows[0], { ...rows[0], ordinal: 1, direction: "reverse" }];
  assert.doesNotThrow(() => plan("r", loop, { route_id: "r", packet_sha256: "", apply: [] }));
  assert.throws(() => plan("r", loop, { route_id: "r", packet_sha256: "", apply: [{ kind: "scramble", from: 0, to: 1000, note: "" }] }), /different answers/);
});

test("slope flags a scramble on gentle ground and never changes a label", () => {
  // Segment b climbs 200 m in 1 km: 20% at most, under the 25% scramble prompt.
  const p = plan("r", rows, { route_id: "r", packet_sha256: "", apply: [{ kind: "scramble", from: { segment: "b", edge: "start" }, to: "end", note: "" }] });
  assert.ok(p.flags.some(f => /no steeper than 20% over 50 m/.test(f)));
  assert.deepEqual(p.ops, [], "b is already scramble; the flag changes nothing");
});

test("elevation crossings count on the way down, and climbers routes keep mapped ice", () => {
  // Up 0 -> 300 m, then down to 100 m: 200 m is crossed twice, the last time at 2,500 m.
  const down: SegmentRow = { ordinal: 2, direction: "forward", id: "c", kind: "glacier", coords: north(2 / 111.195, 1, 300, 100) };
  const traverse = [...rows, down];
  assert.ok(Math.abs(resolve({ elevation_ft: 200 / 0.3048, crossing: "last" }, traverse) - 2500) < 2);
  const p = plan("r", traverse, { route_id: "r", packet_sha256: "", apply: [{ kind: "climbers_route", from: { segment: "b", edge: "start" }, to: "end", note: "" }] });
  assert.deepEqual(p.ops.map(o => o.op === "kind" && [o.segment_id, o.to]), [["b", "climbers_route"]], "c stays glacier");
});
