import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { outlineMetrics, type Outline } from "../glaciers/outline-geometry";
import { NEIGHBOUR_OVERLAP } from "../glaciers/outline-refresh";
import type { GlacierManifest } from "../import-glacier-manifest";

// Every glacier package in the repo, applied or not. A new region whose
// outlines overlap an existing package's fails here, before review.
const SRC = join(__dirname, "..");
const MODULES = readdirSync(SRC).filter(f => /^import-[a-z0-9-]+-glaciers\.ts$/.test(f)).sort();

type Box = [number, number, number, number];
const boxOf = (o: Outline): Box => {
  const pts = o.coordinates.flatMap(p => p[0]);
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
};
const meet = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

type Package = { module: string; manifest: GlacierManifest };
function crossPackageProblems(packages: Package[]): string[] {
  const owner = new Map<string, string>(), twice: string[] = [];
  for (const { module, manifest } of packages) for (const p of manifest.places) {
    for (const key of p.osm_keys ?? [p.osm_key]) {
      if (owner.has(key)) twice.push(`${key} (${p.name}) in ${owner.get(key)} and ${module}`);
      owner.set(key, module);
    }
  }
  const found: string[] = [...twice];
  for (let x = 0; x < packages.length; x++) for (let y = x + 1; y < packages.length; y++) {
    const a = packages[x], b = packages[y];
    // One equal-area projection between the two parents keeps both within the
    // metrics' local extent.
    const metrics = outlineMetrics({ lng: (a.manifest.parent.lng + b.manifest.parent.lng) / 2,
      lat: (a.manifest.parent.lat + b.manifest.parent.lat) / 2 });
    const boxes = new Map([...a.manifest.places, ...b.manifest.places].map(p => [p, boxOf(p.boundary)]));
    for (const p of a.manifest.places) for (const q of b.manifest.places) {
      if (!meet(boxes.get(p)!, boxes.get(q)!)) continue;
      const km2 = metrics.overlap(p.boundary, q.boundary).intersection_km2;
      const share = km2 / Math.min(metrics.area(p.boundary), metrics.area(q.boundary));
      if (share > NEIGHBOUR_OVERLAP.share || km2 > NEIGHBOUR_OVERLAP.km2)
        found.push(`${p.name} (${a.module}) × ${q.name} (${b.module}): ${km2.toFixed(4)} km², ${(100 * share).toFixed(1)}% of the smaller`);
    }
  }
  return found;
}

test("no glacier outline overlaps another package's, and no OSM feature is in two packages", async () => {
  const packages: Package[] = [];
  for (const file of MODULES) {
    const mod = await import(join(SRC, file)) as Record<string, unknown>;
    const loaders = Object.entries(mod).filter(([k, v]) => /^load\w*OutlineReview$/.test(k) && typeof v === "function");
    assert.equal(loaders.length, 1, `${file} must export one load*OutlineReview so this check covers it`);
    packages.push({ module: file, manifest: (loaders[0][1] as () => { manifest: GlacierManifest })().manifest });
  }
  assert.ok(packages.length >= 3, "Rainier, Baker and Glacier Peak at least");

  assert.deepEqual(crossPackageProblems(packages), []);
});

test("the cross-package check catches a shared OSM feature and an overlapping outline", async () => {
  const { loadBakerPackage } = await import("../import-baker-glaciers");
  const baker = loadBakerPackage(), copy = { ...baker, places: baker.places.slice(0, 1) };
  assert.match(crossPackageProblems([{ module: "a", manifest: baker }, { module: "b", manifest: copy }]).join("\n"), /in a and b/);
  const renamed = { ...copy, places: copy.places.map(p => ({ ...p, osm_key: "way:0" })) };
  assert.match(crossPackageProblems([{ module: "a", manifest: baker }, { module: "b", manifest: renamed }])[0], /100\.0% of the smaller/);
});
