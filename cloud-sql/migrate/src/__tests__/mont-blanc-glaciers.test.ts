import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { DATA_DIR, loadMontBlancOutlineReview, SNAPSHOT_SHA256 } from "../import-mont-blanc-glaciers";
import { applyGlacierManifest, manifestSha256, sha256 } from "../import-glacier-manifest";

const review = loadMontBlancOutlineReview(), pkg = review.manifest;
const place = (key: string) => pkg.places.find(p => p.osm_key === key)!;

test("Mont Blanc has 91 relevant places, whole multipart identities and a stable reviewed hash", () => {
  assert.equal(pkg.places.length,91); assert.equal(new Set(pkg.places.map(p=>p.id)).size,91);
  const keys=pkg.places.flatMap(p=>p.osm_keys!); assert.equal(new Set(keys).size,keys.length);
  assert.equal(place("way:267756169").osm_keys!.length,3);
  assert.equal(place("way:30764493").osm_keys!.length,2);
  assert.ok(place("way:188343637").aliases.includes("Sea of Ice"));
  assert.equal(sha256(readFileSync(join(DATA_DIR,"mont-blanc-glaciers-overpass-de.json"))),SNAPSHOT_SHA256);
  assert.equal(manifestSha256(pkg),pkg.manifest_sha256);
  assert.equal(loadMontBlancOutlineReview().manifest.manifest_sha256,pkg.manifest_sha256);
  assert.equal(pkg.manifest_sha256,readFileSync(join(DATA_DIR,"manifest.sha256"),"utf8").trim());
  assert.ok(pkg.places.every(p=>p.container_area_key===null && p.country_codes!.includes(p.country_code!)));
});

test("the 1-to-many and 2-to-3 groups retain OSM and never copy combined facts onto branches",()=>{
  const mer=review.report.combined_inventory_rows!.find(g=>g.rows.some(r=>r.inventory_id==="3143"))!;
  assert.equal(mer.rows.length,1); assert.equal(mer.members.length,8); assert.equal(mer.area_km2,28.8028);
  const trient=review.report.combined_inventory_rows!.find(g=>g.rows.some(r=>r.inventory_id==="B90-02"))!;
  assert.deepEqual(trient.rows.map(r=>r.inventory_id).sort(),["B85-23","B90-02"]);
  assert.equal(trient.members.length,3); assert.equal(trient.area_km2,6.655772);
  assert.equal(trient.osm_ratio,0.944342327);
  for (const g of [mer,trient]) {
    assert.equal(g.flagged,false); assert.equal(g.chosen_source,"osm");
    for (const p of g.members) {
      const f=place(p.osm_key).facts;
      assert.equal(f.area_km2,null); assert.equal(f.observed_year,null); assert.equal(f.head_elevation_m,null); assert.equal(f.length_km,null);
      assert.equal(place(p.osm_key).geometry!.review!.facts_flag,"facts: combined rows");
      assert.equal(place(p.osm_key).geometry!.review!.flagged,false);
    }
  }
});

test("Taconnaz follows its complete neighbour group to OSM with no clip or per-place exception",()=>{
  const group=review.report.neighbour_overlaps!.find(g=>g.glaciers.includes("Glacier de Taconnaz"))!;
  assert.equal(group.glaciers.length,7); assert.equal(group.resolution,"all-osm");
  assert.equal(group.in_band.inventory,null); assert.equal(group.in_band.osm,2);
  assert.equal(place("way:31002694").geometry!.geometry_source,"OpenStreetMap");
  assert.equal(place("way:31002694").geometry!.review!.flagged,true);
  assert.ok(pkg.places.every(p=>!p.geometry!.clipped_against));
  assert.ok(group.pairs.some(p=>p.intersection_km2===2.14465548));
});

test("individual facts retain source units, dates and per-place credits; source aspect is not ice flow",()=>{
  const alps=JSON.parse(readFileSync(join(DATA_DIR,"derived/alps-inventory-valid.geojson"),"utf8"));
  const bossons=alps.features.find((f:{properties:{GLACIER_NR:number}})=>f.properties.GLACIER_NR===3176).properties;
  assert.equal(place("relation:106239").facts.area_km2,bossons.AREA_KM2);
  assert.equal(place("relation:106239").facts.head_elevation_m,bossons.ELEV_MAX);
  const swiss=JSON.parse(readFileSync(join(DATA_DIR,"derived/sgi2023.geojson"),"utf8"));
  const saleina=swiss.features.find((f:{properties:Record<string,unknown>})=>f.properties["sgi-id"]==="B85-16").properties;
  assert.equal(place("way:30764493").facts.area_km2,saleina.area_km2);
  assert.equal(place("way:30764493").facts.length_km,saleina.length_km);
  const tour=place("relation:106731");assert.equal(tour.facts.observed_year,2003);assert.equal(tour.facts.area_km2,8.12365700654927);
  assert.match(tour.facts_credit!,/RGI/);
  assert.ok(pkg.places.every(p=>p.facts.flow_direction_deg===null));
  const yearOnly=place("way:1394999703").geometry!;
  assert.equal(yearOnly.observed_at,null);assert.equal(yearOnly.observed_year,2023);assert.equal(yearOnly.observation_precision,"year");
  const counts=new Map<string,number>();for(const p of pkg.places) counts.set(p.parent_key!,1+(counts.get(p.parent_key!)??0));
  for(const [key,count] of counts) assert.equal(pkg.parents![key].mountain_context!.named_glacier_count,count);
});

test("input corruption and an unreviewed apply hash fail before any connection",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"mont-blanc-hash-test-"));
  try {
    writeFileSync(join(dir,"builder-inputs.sha256.json"),readFileSync(join(DATA_DIR,"builder-inputs.sha256.json")));
    writeFileSync(join(dir,"mont-blanc-glaciers-overpass-de.json"),'{}');
    assert.throws(()=>loadMontBlancOutlineReview(dir),/SHA-256/);
  } finally {rmSync(dir,{recursive:true,force:true});}
  await assert.rejects(applyGlacierManifest(pkg,["--apply"]),/expected-manifest-sha256/);
});
