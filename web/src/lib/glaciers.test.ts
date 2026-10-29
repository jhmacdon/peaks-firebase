import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGlacierJsonLd,
  describeGlacier,
  describeGlacierMountain,
  directionName,
  formatAreaKm2,
  formatAreaMi2,
  formatPercentChange,
  formatVolumeMi3,
  glacierAreaChange,
  glacierFactRows,
  glacierFaqs,
  glacierLeadParagraph,
  glacierMountainFaqs,
  glacierPageTitle,
  historyScopeNote,
  parseGlacierFactsRow,
  parseGlacierMountainRows,
  parseGlacierSummaryRow,
  rosterOutlineCredits,
  slugify,
} from "./glaciers";

// The Emmons row from docs/glaciers-api-contract.md, as Postgres returns it
// (numeric columns may arrive as strings).
const emmonsRow = {
  id: "B5B5E8E3D1BFB7A3126D",
  name: "Emmons Glacier",
  kind: "glacier",
  parent_id: "rainier",
  parent_name: "Mount Rainier",
  parent_elevation: "4392",
  inventory_name: "Emmons",
  observed_year: 2021,
  area_km2: 10.959203,
  area_uncertainty_km2: 0.575333,
  head_elevation_m: 4312,
  terminus_elevation_m: 1488,
  elevation_range_m: 2824,
  length_km: 7.32,
  average_slope_deg: 24,
  flow_direction_deg: 55,
  flow_direction_label: "NE",
  type_code: "S",
  type_label: "Glacier Head Near Summit",
  estimated_volume_km3: 0.659213186,
  volume_uncertainty_km3: 0.230724615,
  rank_on_mountain: 1,
  area_history: [
    { year: 2021, area_km2: 10.959, uncertainty_km2: 0.575 },
    { year: 1896, area_km2: 17.458, uncertainty_km2: 0.907 },
    { year: 1913, area_km2: 12.622, uncertainty_km2: 0.66 },
  ],
  area_history_scope: "Emmons",
  percent_change_since_earliest: -37.2264864245618,
  facts_credit: "Beason et al. (2023), National Park Service",
  facts_source_url: "https://doi.org/10.36967/2299328",
  geometry_credit: "© OpenStreetMap contributors",
  geometry_license: "ODbL-1.0",
  outline_source_url: "https://www.openstreetmap.org/relation/5535843",
  outline_mapped_at: "2026-10-28",
  outline: { observed_at: null, snapshot_at: "2026-10-28", license_url: "https://www.openstreetmap.org/copyright" },
  report: { url: "https://doi.org/10.36967/2299328", doi: "10.36967/2299328", license: "U.S. Government work" },
  mountain_context: { observed_year: 2021, named_glacier_count: 28, area_km2: 75.496, history_start_year: 1896, percent_change_since_history_start: -41.6 },
  boundary: { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] },
  updated_at: new Date("2026-10-28T00:00:00Z"),
};

test("facts parse SI values, sort history, and keep nulls null", () => {
  const facts = parseGlacierFactsRow(emmonsRow);
  assert.equal(facts.parent.elevation, 4392);
  assert.deepEqual(facts.area_history.map((p) => p.year), [1896, 1913, 2021]);
  assert.equal(facts.boundary?.type, "MultiPolygon");
  assert.equal(facts.updated_at, "2026-10-28T00:00:00.000Z");

  const empty = parseGlacierFactsRow({ id: "muir", name: "Muir Snowfield", kind: "snowfield", parent_id: "r", parent_name: "Mount Rainier" });
  assert.equal(empty.kind, "snowfield");
  assert.equal(empty.area_km2, null);
  assert.deepEqual(glacierFactRows(empty), [], "a facts-less snowfield prints no placeholder rows");
  assert.equal(glacierAreaChange(empty), null);
});

test("units match the iOS presentation", () => {
  assert.equal(formatAreaMi2(10.959203, 0.575333), "4.23 ± 0.22 mi²");
  assert.equal(formatAreaKm2(10.959203, 0.575333), "10.96 ± 0.58 km²");
  assert.equal(formatVolumeMi3(0.659213186), "0.158 mi³");
  assert.equal(formatPercentChange(-37.2), "−37%");
  assert.equal(formatPercentChange(4.4), "+4%");
  assert.equal(formatPercentChange(0.2), "0%");
  assert.equal(directionName("NE"), "Northeast");
  assert.equal(directionName("SSW"), "South-southwest");
  assert.equal(directionName("up"), null);
});

test("fact rows read plainly with the mountain rank from the facts row", () => {
  const rows = glacierFactRows(parseGlacierFactsRow(emmonsRow));
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  assert.equal(byKey.area.value, "4.23 ± 0.22 mi²");
  assert.equal(byKey.head.value, "14,147 ft");
  assert.equal(byKey.flow.value, "Northeast");
  assert.equal(byKey.begins.value, "Near summit");
  assert.equal(byKey.rank.value, "#1 of 28");
  assert.equal(byKey.inventory, undefined, "an inventory name that is just the short form is not repeated");
});

test("a combined survey history is never presented as one glacier's loss", () => {
  const facts = parseGlacierFactsRow({ ...emmonsRow, name: "Ingraham Glacier", inventory_name: "Ingraham", area_history_scope: "Cowlitz-Ingraham" });
  assert.equal(historyScopeNote(facts), "Cowlitz and Ingraham are measured together");
  const answer = glacierFaqs(facts, "Washington", []).find((f) => f.question.startsWith("How much"))!.answer;
  assert.match(answer, /Cowlitz and Ingraham, measured together, shrank by 37%/);
  assert.match(answer, /does not separate Ingraham Glacier/);
  assert.match(describeGlacier(facts, "Washington"), /Cowlitz and Ingraham together down 37% since 1896/);
});

test("history change starts at the first measured year", () => {
  const facts = parseGlacierFactsRow({
    ...emmonsRow,
    area_history: [{ year: 1896, area_km2: null }, { year: 1913, area_km2: 10 }, { year: 2021, area_km2: 6.28 }],
  });
  assert.equal(glacierAreaChange(facts)?.fromYear, 1913);
});

test("title, description and lead stay factual and bounded", () => {
  const facts = parseGlacierFactsRow(emmonsRow);
  assert.equal(glacierPageTitle(facts), "Emmons Glacier, Mount Rainier: size, retreat & map");
  const description = describeGlacier(facts, "Washington");
  assert.ok(description.length <= 165, description);
  assert.match(description, /^Emmons Glacier is a glacier on Mount Rainier, Washington: 4\.23 mi² \(10\.96 km²\) in 2021, from 14,147 to 4,882 ft\./);
  assert.match(glacierLeadParagraph(facts, "Washington"), /the largest of Mount Rainier’s 28 named glaciers/);
});

test("FAQ answers exist only for facts the row carries", () => {
  const facts = parseGlacierFactsRow(emmonsRow);
  const questions = glacierFaqs(facts, "Washington", [
    { id: "dc", name: "Disappointment Cleaver", distance: 1, gain: 1, pass_count: 1, on_ice_m: 1, min_elevation_m: 1, max_elevation_m: 2 },
  ]).map((f) => f.question);
  assert.deepEqual(questions, [
    "Where is Emmons Glacier?",
    "How big is Emmons Glacier?",
    "How much has Emmons Glacier shrunk?",
    "How high is Emmons Glacier?",
    "How much ice is in Emmons Glacier?",
    "Which routes cross Emmons Glacier?",
  ]);
  const bare = parseGlacierFactsRow({ id: "p", name: "Pinnacle Glacier", kind: "glacier", parent_id: "r", parent_name: "Mount Rainier" });
  assert.deepEqual(glacierFaqs(bare, null, []).map((f) => f.question), ["Where is Pinnacle Glacier?"]);
});

test("JSON-LD is a Landform on its mountain with SI properties", () => {
  const facts = parseGlacierFactsRow(emmonsRow);
  const data = buildGlacierJsonLd({
    facts,
    url: "https://getpeaks.app/destinations/e",
    parentUrl: "https://getpeaks.app/destinations/rainier",
    description: "d",
    latitude: 46.88,
    longitude: -121.7,
  });
  assert.equal(data["@type"], "Landform");
  assert.equal(data.additionalType, "https://www.wikidata.org/wiki/Q35666");
  assert.deepEqual(data.containedInPlace, { "@type": "Mountain", name: "Mount Rainier", url: "https://getpeaks.app/destinations/rainier" });
  const area = (data.additionalProperty as Array<Record<string, unknown>>).find((p) => p.unitCode === "KMK");
  assert.equal(area?.value, 10.959203);
  assert.equal(data.citation, "https://doi.org/10.36967/2299328");
});

test("mountain slugs are stable and never collide", () => {
  assert.equal(slugify("Mount Rainier"), "mount-rainier");
  assert.equal(slugify("Mount St. Helens"), "mount-st-helens");
  const mountains = parseGlacierMountainRows([
    { id: "a", name: "Glacier Peak", glacier_count: 16 },
    { id: "B2", name: "Glacier Peak", glacier_count: 2 },
  ]);
  assert.deepEqual(mountains.map((m) => m.slug), ["glacier-peak", "glacier-peak-b2"]);
});

test("mountain copy uses the inventory count and states the roster separately", () => {
  const [mountain] = parseGlacierMountainRows([
    {
      id: "rainier",
      name: "Mount Rainier",
      glacier_count: 28,
      snowfield_count: 1,
      context: { observed_year: 2021, named_glacier_count: 28, area_km2: 75.496, history_start_year: 1896, percent_change_since_history_start: -41.6 },
    },
  ]);
  assert.ok(describeGlacierMountain(mountain, "Washington").length <= 165);
  const glaciers = [parseGlacierSummaryRow({ id: "e", name: "Emmons Glacier", kind: "glacier", area_km2: 10.96, observed_year: 2021 })];
  const faqs = glacierMountainFaqs(mountain, glaciers, "Washington");
  assert.match(faqs[0].answer, /counts 28 named glaciers .* Peaks maps the outlines of 1 named glacier there, plus 1 permanent snowfield/);
  assert.match(faqs[1].answer, /Emmons Glacier is the largest/);
  assert.match(faqs.at(-1)!.answer, /fell 42% between 1896 and 2021/);
});

test("roster credits group by source, most used first", () => {
  const rows = [
    { id: "a", geometry_credit: "© OpenStreetMap contributors", geometry_license: "ODbL-1.0" },
    { id: "b", geometry_credit: "Fountain, Glenn & McNeil (2023), via GLIMS", geometry_license: "CC0-1.0" },
    { id: "c", geometry_credit: "© OpenStreetMap contributors", geometry_license: "ODbL-1.0" },
  ].map(parseGlacierSummaryRow);
  assert.deepEqual(rosterOutlineCredits(rows).map((c) => [c.credit, c.count]), [
    ["© OpenStreetMap contributors", 2],
    ["Fountain, Glenn & McNeil (2023), via GLIMS", 1],
  ]);
});
