/** Fetch z14 public terrain samples at unchanged OSM vertices. No database access. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOsmCandidate, sha256 } from "../../../src/trail-catalog/graph";
import { loadManifest, loadSourceSnapshots } from "../../../src/trail-catalog/sources";
import { sampleTerrariumProfile } from "../../../src/lib/terrarium-route-profile";
import { TERRARIUM_REQUIRED_ATTRIBUTION } from "../../../src/lib/terrarium-attribution";
import type { CatalogPlace } from "../../../src/trail-catalog/types";

async function main() {
  const baseDir = __dirname, manifestPath = resolve(baseDir,"manifest.json");
  const { manifest } = loadManifest(manifestPath);
  const evidencePath = resolve(baseDir,"source-evidence.json");
  const evidence = JSON.parse(readFileSync(evidencePath,"utf8"));
  const catalog = readFileSync(resolve(baseDir,"catalog-places.json"));
  if (sha256(catalog) !== evidence.catalogSnapshot.sha256) throw new Error("catalog_snapshot_hash_mismatch");
  const places = new Map<string,CatalogPlace>(JSON.parse(catalog.toString()).map((p:CatalogPlace) => [p.id,p]));
  const receiptsPath = resolve(baseDir,"terrain-tile-receipts.json");
  const receipts: {url:string;retrievedAt:string;sha256:string;bytes:number}[] = [];
  const nativeFetch = globalThis.fetch;
  const fetcher: typeof fetch = async (input,init) => {
    const url = String(input);
    if (!/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/14\/\d+\/\d+\.png$/.test(url)) throw new Error("unexpected_terrain_request");
    const result = await nativeFetch(input,init);
    if (result.ok) {
      const bytes = Buffer.from(await result.clone().arrayBuffer());
      receipts.push({url,retrievedAt:new Date().toISOString(),sha256:sha256(bytes),bytes:bytes.length});
    }
    return result;
  };
  for (const input of manifest.candidates) {
    if (input.elevation) {
      if (sha256(readFileSync(resolve(baseDir,input.elevation.path))) !== input.elevation.sha256) throw new Error(`saved_elevation_hash_mismatch:${input.sourceKey}`);
      if (!process.argv.includes("--verify-existing")) continue;
    }
    let built;
    try { built = buildOsmCandidate(input,loadSourceSnapshots(input.source.snapshots,baseDir).map(s=>s.value),{trailhead:places.get(input.trailheadId??"")!,objective:places.get(input.objectiveId??""),endTrailhead:places.get(input.endTrailheadId??"")}); }
    catch(error) { console.log(JSON.stringify({name:input.name,dem:"not_attempted",reason:error instanceof Error?error.message:String(error)})); continue; }
    const elevations = await sampleTerrariumProfile(built.points,{fetcher});
    const points = built.points.map((point,index)=>({...point,ele:elevations[index]}));
    if (input.elevation) {
      const saved = JSON.parse(readFileSync(resolve(baseDir,input.elevation.path),"utf8"));
      if (JSON.stringify(saved.points) !== JSON.stringify(points)) throw new Error(`terrain_resample_differs_requires_review:${input.sourceKey}`);
      console.log(JSON.stringify({name:input.name,dem:"verified_same_exact_samples",points:points.length,sha256:input.elevation.sha256}));
      continue;
    }
    const file = `elevation/${input.sourceKey.replaceAll(":","-")}.json`;
    const body = JSON.stringify({points,lineage:{source:"AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",sourceUrl:"https://registry.opendata.aws/terrain-tiles/",licenseUrl:"https://github.com/tilezen/joerd/blob/master/docs/attribution.md",attribution:TERRARIUM_REQUIRED_ATTRIBUTION,retrievedAt:new Date().toISOString(),profile:"terrain"}})+"\n";
    writeFileSync(resolve(baseDir,file),body);
    input.elevation = {path:file,sha256:sha256(body)};
    writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
    console.log(JSON.stringify({name:input.name,dem:"saved",points:points.length,sha256:input.elevation.sha256}));
  }
  if (receipts.length) {
    // Raw PNGs stay out of git. Exact sample files and tile hashes remain reviewable.
    let previous: typeof receipts = [];
    try { previous = JSON.parse(readFileSync(receiptsPath,"utf8")).tiles; } catch(error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const body = JSON.stringify({source:"AWS Open Data Terrain Tiles",zoom:14,tiles:[...previous,...receipts]},null,2)+"\n";
    writeFileSync(receiptsPath,body);
    evidence.terrainReceipts = {path:"terrain-tile-receipts.json",sha256:sha256(body)};
    writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+"\n");
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
