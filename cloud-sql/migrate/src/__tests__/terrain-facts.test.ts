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
