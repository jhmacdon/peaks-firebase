import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
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
  assert.equal(args.apply, false);
  assert.equal(args.concurrency, 4);
  assert.equal(args.input, null);
  assert.deepEqual(args.candidateReviews, []);
  assert.equal(args.supplement, null);
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
