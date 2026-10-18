import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assertSegmentSplitsHaveNoCatalogSource } from "./segment-split-source";

test("source split preflight checks all parents and rejects catalog sources before writes", async () => {
  const calls: string[] = [];
  await assert.rejects(assertSegmentSplitsHaveNoCatalogSource({ query: async (sql, values) => {
    calls.push(sql); assert.deepEqual(values, [["catalog", "personal"]]);
    return { rows: [{ id: "catalog", requires_source_proof: true }, { id: "personal", requires_source_proof: false }] };
  } }, [{ originalSegmentId: "personal" }, { originalSegmentId: "catalog" }]), /catalog_segment_split_requires_source_proof:catalog/);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /s.provenance IS NOT NULL OR EXISTS/);
  assert.match(calls[0], /r.owner='peaks'/);
  assert.match(calls[0], /FOR UPDATE OF s/);
  assert.doesNotMatch(calls[0], /INSERT INTO|DELETE FROM|UPDATE segments/);
});

test("personal unattributed splits remain supported, but missing parents fail", async () => {
  let reads = 0;
  const client = { query: async () => { reads++; return { rows: [{ id: "personal", requires_source_proof: false }] }; } };
  await assertSegmentSplitsHaveNoCatalogSource(client, []); assert.equal(reads, 0);
  await assertSegmentSplitsHaveNoCatalogSource(client, [{ originalSegmentId: "personal" }]);
  await assert.rejects(assertSegmentSplitsHaveNoCatalogSource(client, [{ originalSegmentId: "missing" }]), /segment_split_missing:missing/);
});

test("both manual split writers run source preflight before their first segment mutation", () => {
  for (const file of ["routes.ts", "segment-matcher.ts"]) {
    const source = readFileSync(join(__dirname, "actions", file), "utf8");
    const start = source.indexOf(file === "routes.ts" ? "async function acceptRouteWithSegmentsUnchecked" : "export async function saveRouteWithSegments");
    const writer = source.slice(start);
    const check = writer.indexOf("await assertSegmentSplitsHaveNoCatalogSource(client, decomposition.splits)");
    assert.ok(check >= 0, `${file} runs split preflight`);
    const mutation = writer.search(/(?:DELETE FROM route_segments|INSERT INTO segments)/);
    assert.ok(mutation > check, `${file} checks before segment writes`);
  }
});
