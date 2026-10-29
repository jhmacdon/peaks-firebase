import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRainierOsmPackage, loadRainierOutlineReview, OUTLINE_DATA_DIR } from "../import-rainier-glaciers";
import { applyGlacierManifest, glacierPlaceProvenance, manifestSha256, readGlacierManifest, sha256, validateGlacierManifest } from "../import-glacier-manifest";
import { chooseOutline, loadOutlineSources, matchOutlineSource, normalizeGlacierName, outlineReportMarkdown, parseGlimsFeatures,
  refreshGlacierOutlines, type ExtentEvidence, type OutlineSource } from "../glaciers/outline-refresh";
import { outlineMetrics, type Outline } from "../glaciers/outline-geometry";
import { refreshOutlineManifest } from "../refresh-glacier-outlines";

const base = loadRainierOsmPackage();
const square = (x = -121.76, y = 46.85, size = .01): number[][][] => [[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]];
const outline = (...parts: number[][][][]): Outline => ({ type: "MultiPolygon", coordinates: parts });
const metrics = outlineMetrics(base.parent);
const place = (name = "Test Glaciers", boundary = outline(square())) => ({ ...base.places[0], id: "test", name, boundary, aliases: [] });
const source = (features: OutlineSource["features"]): OutlineSource => ({ key: "inventory", geometry_source: "GLIMS test inventory",
  observed_at: "2019-09-09", snapshot_at: "2026-10-28", source_sha256: "a".repeat(64), source_url: "https://example.org/inventory",
  credit: "Inventory authors", license: "CC0-1.0", license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  submission_id: "1", license_ok: true, features });
const evidence: ExtentEvidence = { observed_at: "1970-09-09", source_key: "old", iou: .8, candidate_iou: .4, basis: "Test dated extent evidence" };

test("name and overlap are both required; plural and explicit renames keep multipart inventory parts", () => {
  assert.equal(normalizeGlacierName("Pyramid Glaciers"), normalizeGlacierName("Pyramid Glacier"));
  const p = place(), a = square(-121.76,46.85,.003), b = square(-121.754,46.856,.002);
  const s = source([{ id: "2", glacier_id: "g2", name: "Test Glacier", boundary: outline(b) },
    { id: "1", glacier_id: "g1", name: "Test Glacier", boundary: outline(a) },
    { id: "3", glacier_id: "wrong", name: "Different Glacier", boundary: p.boundary }]);
  const matched = matchOutlineSource([p], s, metrics);
  assert.equal(matched.matches.length, 1);
  assert.deepEqual(matched.matches[0].feature_ids, ["1", "2"]);
  assert.equal(matched.matches[0].boundary.coordinates.length, 2);
  assert.equal(matched.unmatched[0].name, "Different Glacier", "overlap alone cannot cross a name");
  const renamed = { ...p, name: "New Name Glacier" };
  assert.equal(matchOutlineSource([renamed], s, metrics).matches.length, 0);
  assert.equal(matchOutlineSource([renamed], s, metrics, { "New Name Glacier": ["Test Glaciers"] }).matches.length, 1);
  const far = source([{ id: "x", glacier_id: "gx", name: p.name, boundary: outline(square(-121.5)) }]);
  assert.equal(matchOutlineSource([p], far, metrics).matches.length, 0, "name alone cannot match a distant outline");
  assert.match(matchOutlineSource([p], far, metrics).unmatched[0].reason, /spatial overlap/);
  const ambiguous = matchOutlineSource([p, { ...p, id: "second", name: "Test Glacier" }], s, metrics);
  assert.equal(ambiguous.matches.length, 0);
  assert.equal(ambiguous.ambiguous.length, 1);
  assert.throws(() => matchOutlineSource([p], source([s.features[0], s.features[0]]), metrics), /Duplicate/);
});

test("overlapping or edge-touching valid parts dissolve; invalid rings stay in the report", () => {
  const p = place(), s = source([
    { id: "1", glacier_id: "1", name: p.name, boundary: outline(square(-121.76,46.85,.006)) },
    { id: "2", glacier_id: "2", name: p.name, boundary: outline(square(-121.757,46.85,.006)) },
  ]);
  const result = matchOutlineSource([p], s, metrics);
  assert.equal(result.invalid.length, 0);
  assert.equal(result.matches[0].boundary.coordinates.length, 1);
  assert.ok(result.matches[0].area_km2 < s.features.reduce((sum, f) => sum + metrics.area(f.boundary), 0));
  const bowtie = outline([[[ -121.76,46.85],[-121.75,46.86],[-121.75,46.85],[-121.76,46.86],[-121.76,46.85]]]);
  assert.equal(matchOutlineSource([p], source([{ ...s.features[0], boundary: bowtie }]), metrics).invalid.length, 1);
});

test("area and intersection preserve holes, concavity, disjoint parts, winding and tangencies", () => {
  const p = outline(square()), hole = square(-121.757,46.853,.002);
  const holed = outline([p.coordinates[0][0], hole[0].slice().reverse()]);
  const insideHole = outline(square(-121.7568,46.8532,.001));
  assert.equal(metrics.overlap(holed, insideHole).intersection_km2, 0);
  const reversed = outline([p.coordinates[0][0].slice().reverse()]);
  assert.ok(Math.abs(metrics.overlap(p,reversed).iou - 1) < 1e-10);
  const concave = outline([[[-121.76,46.85],[-121.75,46.85],[-121.75,46.854],[-121.756,46.854],[-121.756,46.86],[-121.76,46.86],[-121.76,46.85]]]);
  const cutout = outline(square(-121.755,46.855,.003));
  assert.equal(metrics.overlap(concave,cutout).intersection_km2,0);
  const separate = outline(square(-121.76,46.85,.002),square(-121.754,46.856,.002));
  assert.ok(metrics.overlap(p,separate).candidate_share > .999);
  assert.throws(() => metrics.validate(outline([[[0,0],[1,0],[1,1],[0,0]]])), /nonlocal/);
  assert.throws(() => metrics.validate(outline([p.coordinates[0][0],square(-121.70)[0]])), /Orphan/);
});

test("selection band is inclusive; newest eligible requires strict improvement, cleared rights and newer extent", () => {
  const candidate = { key: "new", area_km2: 1, observed_at: "2019-09-09", license_ok: true };
  for (const area of [.67,1,1.5]) assert.equal(chooseOutline(area,1,[candidate],evidence).chosen_source,"osm");
  for (const area of [.67-1e-8,1.5+1e-8]) assert.equal(chooseOutline(area,1,[candidate],evidence).chosen_source,"new");
  assert.equal(chooseOutline(6,1,[candidate],null).chosen_source,"osm");
  assert.equal(chooseOutline(6,null,[candidate],evidence).chosen_source,"osm");
  assert.equal(chooseOutline(6,1,[{...candidate,license_ok:false}],evidence).chosen_source,"osm");
  assert.equal(chooseOutline(6,1,[{...candidate,observed_at:evidence.observed_at}],evidence).chosen_source,"osm");
  assert.equal(chooseOutline(6,1,[{...candidate,area_km2:6}],evidence).chosen_source,"osm");
  const newer = { ...candidate,key:"newer",area_km2:1.4,observed_at:"2021-09-09" };
  assert.equal(chooseOutline(6,1,[candidate,newer],evidence).chosen_source,"newer","prefer date over the smallest error");
  assert.equal(chooseOutline(6,1,[{...candidate,area_km2:2}],evidence).flagged,true,"a better candidate can remain outside the band");
});

test("real WFS cohort is pinned, complete and consistent, including every named part", () => {
  const config = join(OUTLINE_DATA_DIR,"outline-sources.json");
  const { sources,references } = loadOutlineSources(config);
  const raw = JSON.parse(readFileSync(join(OUTLINE_DATA_DIR,"glims-wfs-rainier.json"),"utf8"));
  assert.equal(raw.features.length,430);
  assert.equal(sources[0].features.length,126);
  assert.equal(references[0].features.length,169);
  assert.equal(sources[0].observed_at,"2019-09-09");
  assert.equal(sources[0].submission_id,"814");
  assert.equal(sources[0].features.filter(f=>f.name==="Pyramid Glacier").length,4);
  assert.equal(sources[0].features.filter(f=>f.name==="Van Trump Glacier").length,10);
  assert.throws(()=>parseGlimsFeatures({...raw,numberReturned:1},{...sources[0],chief_affl:"Portland State University"}),/Incomplete/);
  assert.throws(()=>parseGlimsFeatures(raw,{observed_at:"2026-01-01",submission_id:"814",chief_affl:"Portland State University"}),/Empty/);
});

const review = loadRainierOutlineReview();
test("real snapshot decisions, provenance and report are stable and retain OSM identities", () => {
  const { manifest,report } = review;
  assert.deepEqual(report.decisions.filter(d=>d.chosen_source!=="osm").map(d=>d.glacier).sort(),
    ["Ohanapecosh Glacier","Paradise Glacier","Pyramid Glaciers","Van Trump Glacier"]);
  const decisions = new Map(report.decisions.map(d=>[d.glacier,d]));
  for (const [name,area] of [["Pyramid Glaciers",.295383], ["Van Trump Glacier",.324114], ["Ohanapecosh Glacier",.801983],
    ["Paradise Glacier",.453730], ["Success Glacier",.772607], ["Sarvant Glacier",.325252], ["Emmons Glacier",11.244643]] as const)
    assert.ok(Math.abs(decisions.get(name)!.glims_area_km2!-area)<1e-6,name);
  assert.equal(decisions.get("Emmons Glacier")!.chosen_source,"osm");
  assert.equal(decisions.get("Success Glacier")!.chosen_source,"osm");
  assert.match(decisions.get("Success Glacier")!.reason,/no licence-OK, newer candidate.*closer/);
  assert.equal(decisions.get("Sarvant Glacier")!.extent_evidence,null);
  assert.match(decisions.get("Sarvant Glacier")!.reason,/no dated evidence/);
  assert.equal(decisions.get("Pyramid Glaciers")!.flagged,true);
  assert.equal(decisions.get("Van Trump Glacier")!.flagged,true);
  assert.equal(report.sources[0].audit.ambiguous.length,0);
  assert.equal(report.sources[0].audit.invalid.length,0);
  assert.equal(report.sources[0].audit.unmatched.length,55);
  assert.deepEqual(report.sources[0].audit.unmatched.filter(x=>x.name!=="WA" && x.name.trim()).map(x=>x.name),["The Turtle","Williwakas Glacier","Stevens Glacier"]);
  for (const p of manifest.places) {
    const original = base.places.find(x=>x.id===p.id)!;
    assert.deepEqual(p.external_ids,original.external_ids);
    assert.equal(p.osm_key,original.osm_key);
    const serialized = JSON.parse(JSON.stringify(glacierPlaceProvenance(manifest,p)));
    assert.deepEqual(serialized.facts.provenance.outline,p.geometry);
    assert.equal(serialized.facts.provenance.report_sha256,original.facts.provenance.report_sha256);
    assert.equal(serialized.catalog.credit,p.geometry!.credit);
    assert.equal(serialized.catalog.snapshot_sha256,p.geometry!.source_sha256);
    if (decisions.get(p.name)!.chosen_source==="osm") {
      assert.deepEqual(p.boundary,original.boundary,"unchanged places keep exact geometry bytes");
      assert.equal(p.geometry!.credit,"© OpenStreetMap contributors");
      assert.equal(p.geometry!.observed_at,null);
      assert.equal(p.geometry!.snapshot_at,"2026-10-28");
    } else {
      assert.equal(p.geometry!.observed_at,"2019-09-09");
      assert.equal(p.geometry!.license,"CC0-1.0");
      assert.equal(p.geometry!.credit,"Fountain, Glenn & McNeil (2023), via GLIMS");
      assert.equal(p.geometry!.source_sha256,"b005393ed0fa69e7ace07700bddeaa352ac4f85bca484e5294e88cde6da06842");
      metrics.validate(p.boundary);
    }
  }
  const again=loadRainierOutlineReview();
  assert.equal(again.manifest.manifest_sha256,manifest.manifest_sha256);
  assert.equal(JSON.stringify(again.report),JSON.stringify(report));
  const md=outlineReportMarkdown(report);
  assert.match(md,/Pyramid Glaciers.*glims-2019-09-09/);
  assert.match(md,/Sarvant Glacier.*no dated evidence/);
  assert.match(md,/Emmons Glacier.*within/);
  assert.equal(manifestSha256(manifest),manifest.manifest_sha256);
  assert.equal(sha256(JSON.stringify({...report,output_manifest_sha256:""})),manifest.outline_refresh!.review_sha256);
  const {sources,references,aliases}=loadOutlineSources(join(OUTLINE_DATA_DIR,"outline-sources.json"));
  assert.throws(()=>refreshGlacierOutlines(manifest,sources,references,aliases),/original default-source manifest/);
  assert.equal(report.sources[0].audit.matches.flatMap(m=>m.feature_ids).length+
    report.sources[0].audit.unmatched.flatMap(m=>m.feature_ids).length,126,"every September feature is accounted for");
});

test("manifest provenance validation and review hash fail before a DB connection", async () => {
  const { manifest } = review, first=manifest.places[0];
  for (const change of [{credit:" "},{source_url:"file:///tmp/source"},{observed_at:"2019-02-30"},{source_sha256:"bad"},{geometry_sha256:"a".repeat(64)}])
    assert.throws(()=>validateGlacierManifest({...manifest,places:[{...first,geometry:{...first.geometry!,...change}}]}),/geometry provenance/);
  assert.throws(()=>validateGlacierManifest({...manifest,places:[{...first,facts:{...first.facts,provenance:{outline:{wrong:true}}}}]}),/conflicting/);
  const reordered=Object.fromEntries(Object.entries(first.geometry!).reverse());
  assert.doesNotThrow(()=>validateGlacierManifest({...manifest,places:[{...first,facts:{...first.facts,
    provenance:{...first.facts.provenance,outline:reordered}}}]}),"JSON key order does not change provenance meaning");
  await assert.rejects(applyGlacierManifest(manifest,["--apply","--expected-manifest-sha256=wrong"]),/reviewed/);
  await assert.rejects(applyGlacierManifest({...manifest,mountain_context:{changed:true}},["--apply",`--expected-manifest-sha256=${manifest.manifest_sha256}`]),/changed after review/);
  assert.equal(sha256(JSON.stringify(first.boundary)),first.geometry!.geometry_sha256);
});

test("offline CLI writes JSON, markdown and a readable manifest with the reviewed hash", () => {
  const dir=mkdtempSync(join(tmpdir(),"glacier-outline-test-"));
  try {
    const input=join(dir,"osm.json"), output=join(dir,"refreshed.json"), prefix=join(dir,"report");
    writeFileSync(input,JSON.stringify(base));
    refreshOutlineManifest([`--manifest=${input}`,`--config=${join(OUTLINE_DATA_DIR,"outline-sources.json")}`,`--report-prefix=${prefix}`,`--write-manifest=${output}`]);
    assert.equal(readGlacierManifest(output).manifest_sha256,review.manifest.manifest_sha256);
    assert.equal(JSON.parse(readFileSync(`${prefix}.json`,"utf8")).decisions.length,29);
    assert.equal(readFileSync(`${prefix}.md`,"utf8"),outlineReportMarkdown(review.report));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("verified OSM observations take priority over historical-fit inferences", () => {
  const p=place(), boundary=p.boundary, geometry={ ...glacierPlaceProvenance(base,p).geometry,observed_at:"2024-01-01" };
  const m={...base,places:[{...p,geometry,facts:{...p.facts,area_km2:metrics.area(boundary)/3}}]};
  const s=source([{id:"1",glacier_id:"1",name:p.name,boundary:outline(square(-121.76,46.85,.006))}]);
  const r=refreshGlacierOutlines(m,[s]);
  assert.equal(r.report.decisions[0].extent_evidence!.observed_at,"2024-01-01");
  assert.equal(r.report.decisions[0].chosen_source,"osm","a 2019 candidate is older than verified 2024 imagery");
});

test("manifest hashes survive last-digit metric differences (libm differs between platforms)", async () => {
  const { rawOutlineMetrics, stableMetric, METRIC_DECIMALS } = await import("../glaciers/outline-geometry");
  const { loadBakerOsmPackage, OUTLINE_DATA_DIR: BAKER_OUTLINE_DIR } = await import("../import-baker-glaciers");
  assert.equal(METRIC_DECIMALS, 9);
  assert.equal(stableMetric(1.1297744327013741), 1.129774433);
  assert.equal(stableMetric(-1e-12), 0);
  assert.equal(stableMetric(stableMetric(0.123456789499)), stableMetric(0.123456789499), "rounding is idempotent");
  // Scale every raw output by a few ulps, alternating sign, as another libm would.
  const perturbed = (origin: { lat: number; lng: number }, scale: number) => {
    const raw = rawOutlineMetrics(origin);
    let n = 0;
    const nudge = (x: number) => x * (1 + scale * (n++ % 2 ? -1 : 1));
    return { ...raw, area: (o: Outline) => nudge(raw.area(o)),
      overlap: (a: Outline, b: Outline) => { const o = raw.overlap(a, b);
        return { intersection_km2: nudge(o.intersection_km2), iou: nudge(o.iou), osm_share: nudge(o.osm_share), candidate_share: nudge(o.candidate_share) }; } };
  };
  for (const [osm, dir] of [[base, OUTLINE_DATA_DIR], [loadBakerOsmPackage(), BAKER_OUTLINE_DIR]] as const) {
    const { manifest_sha256: _hash, ...body } = osm;
    const { sources, references, aliases } = loadOutlineSources(join(dir, "outline-sources.json"));
    const reference = refreshGlacierOutlines(body, sources, references, aliases);
    for (const scale of [4e-16, 3e-15, -2e-14]) {
      const shifted = refreshGlacierOutlines(body, sources, references, aliases, perturbed(body.parent, scale));
      assert.equal(shifted.manifest.manifest_sha256, reference.manifest.manifest_sha256, `${body.parent.name} at ${scale}`);
      assert.equal(JSON.stringify(shifted.report), JSON.stringify(reference.report));
    }
    const p = body.places[0];
    assert.notEqual(perturbed(body.parent, 3e-15).area(p.boundary), rawOutlineMetrics(body.parent).area(p.boundary), "the nudge reaches raw outputs");
    assert.deepEqual(JSON.stringify(reference.report).match(/\d\.\d{10,}/g) ?? [], [], "computed metrics carry at most 9 decimals");
  }
});

test("holes and parts may touch at a shared vertex; a hole outside its exterior still fails", async () => {
  const { parseOsmGlaciers } = await import("../glaciers/osm");
  const [x, y] = [-121.76, 46.85], d = .01;
  const outer = [[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]];
  const touching = [[x,y],[x+d/2,y+d/4],[x+d/4,y+d/2],[x,y]]; // starts on the exterior's corner
  assert.doesNotThrow(() => metrics.validate(outline([outer, touching])));
  assert.ok(metrics.area(outline([outer, touching])) < metrics.area(outline([outer])));
  assert.throws(() => metrics.validate(outline([outer, [[x+2*d,y],[x+3*d,y],[x+3*d,y+d],[x+2*d,y]]])), /Orphan/);
  assert.throws(() => metrics.validate(outline([outer, outer.slice().reverse()])), /Orphan|Self-intersection|Degenerate/);
  const way = (ref: number, pts: number[][]) => ({ type: "way", ref, geometry: pts.map(([lon, lat]) => ({ lon, lat })) });
  const parsed = parseOsmGlaciers({ elements: [{ type: "relation", id: 7, tags: { natural: "glacier", name: "Touching Glacier" },
    members: [{ ...way(1, outer), role: "outer" }, { ...way(2, touching), role: "inner" }] }] });
  assert.equal(parsed[0].boundary.coordinates[0].length, 2, "the touching hole stays with its outer ring");
});

test("WFS rows that share an anlys_id form one multi-part analysis; conflicting rows fail", () => {
  const row = (fid: string, anlys_id: number, glac_id: string, name: string, x: number) => ({ id: fid, type: "Feature",
    geometry: { type: "Polygon", coordinates: square(x) }, properties: { line_type: "glac_bound", anlys_id, glac_id, glac_name: name,
      db_area: .01, src_date: "1987-09-09T00:00:00Z", subm_id: 744, chief_affl: "Portland State University" } });
  const fc = (rows: ReturnType<typeof row>[]) => ({ type: "FeatureCollection", features: rows, numberMatched: rows.length, numberReturned: rows.length });
  const cohort = { observed_at: "1987-09-09", submission_id: "744", chief_affl: "Portland State University" };
  const parsed = parseGlimsFeatures(fc([row("a", 1, "G1", "WA", -121.76), row("b", 1, "G1", "WA", -121.70), row("c", 2, "G2", "X", -121.6)]), cohort);
  assert.deepEqual(parsed.map(f => [f.id, f.boundary.coordinates.length]), [["1", 2], ["2", 1]]);
  assert.deepEqual(parsed[0].boundary.coordinates[1], square(-121.70), "WFS order kept");
  assert.throws(() => parseGlimsFeatures(fc([row("a", 1, "G1", "WA", -121.76), row("b", 1, "G9", "WA", -121.70)]), cohort), /Conflicting GLIMS rows/);
});

