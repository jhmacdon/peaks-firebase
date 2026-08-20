import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildLakeOverpassQuery, parseLakeExpansionArgs } from "../expand-lake-coverage";

test("parses one-state dry-run arguments", () => {
  const args = parseLakeExpansionArgs([
    "--state=wa",
    "--concurrency=3",
    "--cache-dir=/tmp/lakes",
    "--report-dir=/tmp/reports",
  ]);

  assert.equal(args.apply, false);
  assert.equal(args.concurrency, 3);
  assert.deepEqual(args.scopes, [{ key: "US-WA", stateCode: "WA", countryCode: "US" }]);
  assert.equal(args.cacheDir, "/tmp/lakes");
  assert.equal(args.reportDir, "/tmp/reports");
  assert.equal(args.input, null);
});

test("requires one scope and review information for apply", () => {
  assert.throws(() => parseLakeExpansionArgs([]), /exactly one/);
  assert.throws(() => parseLakeExpansionArgs(["--state=WA", "--all-states"]), /exactly one/);
  assert.throws(() => parseLakeExpansionArgs(["--state=WA", "--apply"]), /review-report/);
});

test("builds the high-precision Washington Overpass query", () => {
  const query = buildLakeOverpassQuery("WA");

  assert.match(query, /^\[out:json\]\[timeout:240\];/);
  assert.match(query, /area\["ISO3166-2"="US-WA"\]\["boundary"="administrative"\]->\.region;/);
  assert.match(query, /nwr\["natural"="water"\]\["water"="lake"\]\["name"\]\(area\.region\);/);
  assert.match(query, /out body geom qt;/);
  assert.equal(query.includes('water"="reservoir'), false);
});
