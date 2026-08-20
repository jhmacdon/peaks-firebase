import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildCountryViewpointOverpassQuery,
  buildRelationViewpointOverpassQuery,
  buildSubdivisionViewpointOverpassQuery,
  buildViewpointOverpassQuery,
  parseViewpointExpansionArgs,
} from "../expand-viewpoint-coverage";

test("defaults to a Washington dry-run", () => {
  const args = parseViewpointExpansionArgs([
    "--concurrency=4",
    "--cache-dir=/tmp/viewpoints",
    "--report=/tmp/viewpoints/report.json",
  ]);

  assert.equal(args.stateCode, "WA");
  assert.equal(args.countryCode, "US");
  assert.equal(args.subdivisionCode, "US-WA");
  assert.equal(args.scopeKey, "US-WA");
  assert.equal(args.bbox, null);
  assert.equal(args.osmRelationId, null);
  assert.equal(args.apply, false);
  assert.equal(args.concurrency, 4);
  assert.equal(args.input, null);
  assert.deepEqual(args.candidateReviews, []);
  assert.equal(args.supplement, null);
});

test("reads a protected-area relation scope", () => {
  const args = parseViewpointExpansionArgs([
    "--country=np",
    "--scope=sagarmatha",
    "--osm-relation=3531450",
    "--input=/tmp/sagarmatha.json",
  ]);

  assert.equal(args.countryCode, "NP");
  assert.equal(args.stateCode, null);
  assert.equal(args.scopeKey, "NP-sagarmatha");
  assert.equal(args.osmRelationId, "3531450");
});

test("reads a bounded country scope", () => {
  const args = parseViewpointExpansionArgs([
    "--country=it",
    "--scope=dolomites",
    "--bbox=46.20,10.80,47.20,13.10",
    "--input=/tmp/dolomites.json",
  ]);

  assert.equal(args.countryCode, "IT");
  assert.equal(args.stateCode, null);
  assert.equal(args.subdivisionCode, null);
  assert.equal(args.scopeKey, "IT-dolomites");
  assert.deepEqual(args.bbox, [46.2, 10.8, 47.2, 13.1]);
});

test("reads an ISO subdivision scope", () => {
  const args = parseViewpointExpansionArgs([
    "--subdivision=in-hp",
    "--input=/tmp/himachal.json",
  ]);

  assert.equal(args.countryCode, "IN");
  assert.equal(args.stateCode, "HP");
  assert.equal(args.subdivisionCode, "IN-HP");
  assert.equal(args.scopeKey, "IN-HP");
  assert.equal(args.bbox, null);
});

test("rejects unclear or invalid jurisdiction scopes", () => {
  assert.throws(() => parseViewpointExpansionArgs([
    "--country=IT",
    "--bbox=46.2,10.8,47.2,13.1",
  ]), /require --scope/);
  assert.throws(() => parseViewpointExpansionArgs([
    "--state=WA",
    "--country=IT",
  ]), /one of --state, --country, or --subdivision/);
  assert.throws(() => parseViewpointExpansionArgs(["--country=ZZ"]), /ISO 3166-1/);
  assert.throws(() => parseViewpointExpansionArgs([
    "--country=IT",
    "--scope=Dolomites",
  ]), /lowercase slug/);
  assert.throws(() => parseViewpointExpansionArgs([
    "--country=NP",
    "--scope=sagarmatha",
    "--bbox=27,86,29,88",
    "--osm-relation=3531450",
  ]), /either --bbox or --osm-relation/);
});

test("reads a complete reviewed import argument set", () => {
  const args = parseViewpointExpansionArgs([
    "--state=wa",
    "--input=/tmp/source.json",
    "--candidate-reviews=/tmp/one.json, /tmp/two.json",
    "--supplement=/tmp/supplement.json",
    "--apply",
    "--review-report=/tmp/report.json",
    `--expected-report-sha256=${"a".repeat(64)}`,
  ]);

  assert.equal(args.stateCode, "WA");
  assert.equal(args.apply, true);
  assert.equal(args.input, "/tmp/source.json");
  assert.deepEqual(args.candidateReviews, ["/tmp/one.json", "/tmp/two.json"]);
  assert.equal(args.supplement, "/tmp/supplement.json");
  assert.equal(args.reviewReport, "/tmp/report.json");
});

test("requires reviewed report data for apply", () => {
  assert.throws(() => parseViewpointExpansionArgs(["--apply"]), /review-report/);
  assert.throws(() => parseViewpointExpansionArgs([
    "--apply",
    "--review-report=/tmp/report.json",
    "--expected-report-sha256=bad",
  ]), /64-character/);
});

test("builds a narrow named-viewpoint Overpass query", () => {
  const query = buildViewpointOverpassQuery("WA");
  assert.match(query, /^\[out:json\]\[timeout:180\];/);
  assert.match(query, /area\["ISO3166-2"="US-WA"\]\["boundary"="administrative"\]->\.region;/);
  assert.match(query, /nwr\["tourism"="viewpoint"\]\["name"\]\(area\.region\);/);
  assert.match(query, /out tags center qt;/);
});

test("builds a country query with fixed regional bounds", () => {
  const query = buildCountryViewpointOverpassQuery("IT", [46.2, 10.8, 47.2, 13.1]);
  assert.match(query, /area\["ISO3166-1"="IT"\]\["boundary"="administrative"\]->\.region;/);
  assert.match(query, /nwr\["tourism"="viewpoint"\]\["name"\]\(area\.region\)\(46\.2,10\.8,47\.2,13\.1\);/);
});

test("builds a precise ISO subdivision query", () => {
  const query = buildSubdivisionViewpointOverpassQuery("IN-HP");
  assert.match(query, /area\["ISO3166-2"="IN-HP"\]\["boundary"="administrative"\]->\.region;/);
  assert.match(query, /nwr\["tourism"="viewpoint"\]\["name"\]\(area\.region\);/);
});

test("builds a protected-area relation query", () => {
  const query = buildRelationViewpointOverpassQuery("3531450");
  assert.match(query, /area\(id:3603531450\)->\.region;/);
  assert.match(query, /nwr\["tourism"="viewpoint"\]\["name"\]\(area\.region\);/);
});
