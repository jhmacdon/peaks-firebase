import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  bathroomLeafCandidates,
  buildLocationIndex,
  buildRecSiteIndex,
  candidateNames,
  buildTrailheadAmenities,
  canonicalJson,
  chooseMatch,
  feeLeafCandidates,
  isOffSiteBathroomNote,
  mergeTrailheadAmenities,
  normalizeRegion,
  normalizeTrailheadName,
  pageLeafCandidates,
  PG_TRGM_NAME_THRESHOLD,
  resolveLeafConflicts,
  resolveLocation,
  TOKEN_OVERLAP_NAME_THRESHOLD,
  tokenOverlapSimilarity,
  type BathroomRow,
  type FeeRow,
  type LeafCandidate,
  type PageSectionRow,
  type RecSiteFacts,
} from "../trailhead-facts-utils";

function feeRow(overrides: Partial<FeeRow> = {}): FeeRow {
  return {
    source_dataset: "usfs_rec_sites",
    source_id: "10001010386",
    name: "GREYS LAKE TRAILHEAD",
    lat: 41.059,
    lng: -115.1534,
    fee_required: null,
    day_fee_usd: null,
    annual_fee_usd: null,
    passes_accepted: [],
    fee_waived_for: [],
    confidence: "high",
    verbatim_quote: null,
    as_of: "2026-08-19",
    ...overrides,
  };
}

function recSiteFacts(overrides: Partial<RecSiteFacts> = {}): RecSiteFacts {
  return {
    sourceId: "10001010386",
    feeCharged: null,
    feeType: null,
    publicName: null,
    region: "06",
    ...overrides,
  };
}

function bathroomRow(overrides: Partial<BathroomRow> = {}): BathroomRow {
  return {
    source_dataset: "usfs_rec_sites",
    source_id: "5278.007191",
    name: "MARILLA NCT TRAILHEAD",
    lat: 44.3738,
    lng: -85.8401,
    status: "present",
    type: "vault_pit",
    season_note: null,
    raw_string: "Vault toilet(s)",
    verbatim_quote: "Vault toilet(s)",
    as_of: "2026-08-19",
    ...overrides,
  };
}

function pageRow(overrides: Partial<PageSectionRow> = {}): PageSectionRow {
  return {
    url: "https://www.fs.usda.gov/r01/bitterroot/recreation/baker-lake-trailhead",
    capacity_estimate: null,
    fills_early_note: null,
    fee_text: null,
    restroom_text: null,
    road_text: null,
    fetched_at: "2026-08-19T20:43:51+00:00",
    ...overrides,
  };
}

// --- names ------------------------------------------------------------------

test("normalizes case, punctuation, and a trailing trailhead suffix", () => {
  assert.equal(normalizeTrailheadName("GREYS LAKE TRAILHEAD"), "greys lake");
  assert.equal(normalizeTrailheadName("Greys Lake TH"), "greys lake");
  assert.equal(normalizeTrailheadName("Mt. Si Trail Head"), "mt si");
  assert.equal(normalizeTrailheadName("  Snow   Lake  Trailhead "), "snow lake");
  assert.equal(normalizeTrailheadName("Ira Spring / Mason Lake Trailhead"), "ira spring mason lake");
});

test("a name that is only the suffix keeps something to match on", () => {
  assert.equal(normalizeTrailheadName("Trailhead"), "trailhead");
  assert.equal(normalizeTrailheadName(""), "");
  assert.equal(normalizeTrailheadName(null), "");
});

test("token overlap scores identical, partial, and disjoint names", () => {
  assert.equal(tokenOverlapSimilarity("snow lake", "snow lake"), 1);
  assert.equal(tokenOverlapSimilarity("baker lake", "baker creek"), 0.5);
  assert.equal(tokenOverlapSimilarity("lake serene", "lake serene trail"), 0.8);
  assert.equal(tokenOverlapSimilarity("snow lake", "mount si"), 0);
  assert.equal(tokenOverlapSimilarity("", "snow lake"), 0);
});

test("the token-overlap threshold rejects a shared-word mismatch", () => {
  assert.ok(tokenOverlapSimilarity("baker lake", "baker creek") < TOKEN_OVERLAP_NAME_THRESHOLD);
  assert.ok(tokenOverlapSimilarity("lake serene", "lake serene trail") >= TOKEN_OVERLAP_NAME_THRESHOLD);
});

// --- match gate -------------------------------------------------------------

test("no candidate within the radius reports the distance gate", () => {
  assert.deepEqual(chooseMatch([], PG_TRGM_NAME_THRESHOLD), { kind: "no_nearby_trailhead" });
});

test("the best similarity wins and distance breaks a tie", () => {
  const outcome = chooseMatch(
    [
      { destinationId: "a", destinationName: "Snow Lake", distanceM: 20, similarity: 0.6, matchedName: "Snow Lake TH" },
      { destinationId: "b", destinationName: "Snow Lake Trailhead", distanceM: 200, similarity: 0.9, matchedName: "Snow Lake TH" },
    ],
    0.5
  );
  assert.equal(outcome.kind, "matched");
  assert.equal(outcome.kind === "matched" && outcome.candidate.destinationId, "b");

  const tie = chooseMatch(
    [
      { destinationId: "far", destinationName: "Snow Lake", distanceM: 200, similarity: 0.9, matchedName: "Snow Lake" },
      { destinationId: "near", destinationName: "Snow Lake", distanceM: 20, similarity: 0.9, matchedName: "Snow Lake" },
    ],
    0.5
  );
  assert.equal(tie.kind === "matched" && tie.candidate.destinationId, "near");
});

test("a nearby destination with a different name is rejected and reported", () => {
  const outcome = chooseMatch(
    [{ destinationId: "a", destinationName: "Baker Creek", distanceM: 30, similarity: 0.4, matchedName: "Baker Lake" }],
    0.5
  );
  assert.equal(outcome.kind, "name_below_threshold");
  assert.equal(outcome.kind === "name_below_threshold" && outcome.best.destinationId, "a");
});

// --- locating page rows -----------------------------------------------------

test("a page row borrows coordinates from the same-named EDW trailhead in its region", () => {
  const index = buildLocationIndex([
    { name: "BAKER LAKE TRAILHEAD", lat: 45.8, lng: -114.3, region: "01", publicName: "Baker Lake" },
    { name: "Baker Lake TH", lat: 45.80001, lng: -114.30001, region: "01" },
  ]);
  const located = resolveLocation(index, "Baker Lake Trailhead", "r01");
  assert.equal(located.kind, "located");
  assert.equal(located.kind === "located" && located.point.lat, 45.8);
  assert.equal(located.kind === "located" && located.point.publicName, "Baker Lake");
});

test("a page never borrows a point from another region", () => {
  const index = buildLocationIndex([
    { name: "Blue Hole Trailhead", lat: 35.6, lng: -83.5, region: "08" },
  ]);
  const mismatch = resolveLocation(index, "Blue Hole Trailhead", "r09");
  assert.equal(mismatch.kind, "region_mismatch");
  assert.deepEqual(mismatch.kind === "region_mismatch" && mismatch.regions, ["08"]);
  assert.equal(resolveLocation(index, "Blue Hole Trailhead", "r08").kind, "located");
});

test("a point of unknown region is never borrowed", () => {
  const index = buildLocationIndex([{ name: "Blue Hole Trailhead", lat: 35.6, lng: -83.5 }]);
  assert.equal(resolveLocation(index, "Blue Hole Trailhead", "r09").kind, "region_mismatch");
  assert.equal(resolveLocation(index, "Blue Hole Trailhead", null).kind, "region_mismatch");
});

test("a name shared by far-apart places in one region stays unlocated", () => {
  const index = buildLocationIndex([
    { name: "Baker Lake Trailhead", lat: 45.8, lng: -114.3, region: "06" },
    { name: "Baker Lake Trailhead", lat: 48.7, lng: -121.6, region: "06" },
  ]);
  assert.equal(resolveLocation(index, "Baker Lake Trailhead", "r06").kind, "ambiguous");
  assert.equal(resolveLocation(index, "Nowhere Trailhead", "r06").kind, "unknown_name");
});

test("regions normalize across the registry and raw spellings", () => {
  assert.equal(normalizeRegion("r09"), "09");
  assert.equal(normalizeRegion("09"), "09");
  assert.equal(normalizeRegion(9), "09");
  assert.equal(normalizeRegion("R6"), "06");
  assert.equal(normalizeRegion(null), null);
  assert.equal(normalizeRegion(""), null);
});

// --- raw EDW enrichment -----------------------------------------------------

test("the raw pull indexes by site_cn, the normalized rows' source_id", () => {
  const index = buildRecSiteIndex([
    {
      site_cn: "5927010263",
      site_name: "MARTIN BRIDGE TRAILHEAD",
      public_site_name: "Eagle Forks Trailhead",
      region: "06",
      fee_charged: "n",
      fee_type: null,
    },
    { site_cn: null, site_name: "no id" },
  ]);
  assert.equal(index.size, 1);
  const facts = index.get("5927010263");
  assert.equal(facts?.publicName, "Eagle Forks Trailhead");
  assert.equal(facts?.region, "06");
  assert.equal(facts?.feeCharged, "N", "fee_charged is compared upper-case");
});

test("both names go through the gate, deduplicated", () => {
  assert.deepEqual(
    candidateNames("MARTIN BRIDGE TRAILHEAD", {
      sourceId: "1",
      feeCharged: null,
      feeType: null,
      publicName: "Eagle Forks Trailhead",
      region: "06",
    }),
    ["MARTIN BRIDGE TRAILHEAD", "Eagle Forks Trailhead"]
  );
  assert.deepEqual(
    candidateNames("SNOW LAKE TRAILHEAD", {
      sourceId: "1",
      feeCharged: null,
      feeType: null,
      publicName: "Snow Lake TH",
      region: "06",
    }),
    ["SNOW LAKE TRAILHEAD"],
    "names that normalize the same are one name"
  );
  assert.deepEqual(candidateNames("Snow Lake Trailhead", null), ["Snow Lake Trailhead"]);
});

// --- fee leaves -------------------------------------------------------------

test("a fee row becomes sourced parking leaves with the dataset service url", () => {
  const { leaves, refusals } = feeLeafCandidates(
    feeRow({
      fee_required: true,
      day_fee_usd: 5,
      annual_fee_usd: 30,
      passes_accepted: ["Northwest Forest"],
      fee_waived_for: ["Senior/Access/Military"],
      verbatim_quote: "$5 per vehicle per day",
    })
  );
  assert.deepEqual(refusals, []);
  assert.deepEqual(
    leaves.map((leaf) => leaf.leaf),
    ["fee_required", "day_fee_usd", "annual_fee_usd", "passes_accepted", "fee_waived_for"]
  );
  const feeLeaf = leaves[0];
  assert.equal(feeLeaf.block, "parking");
  assert.equal(feeLeaf.sourced.value, true);
  assert.equal(feeLeaf.sourced.source.kind, "usfs_edw");
  assert.equal(feeLeaf.sourced.source.name, "US Forest Service");
  assert.equal(
    feeLeaf.sourced.source.url,
    "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0"
  );
  assert.equal(feeLeaf.sourced.source.external_id, "10001010386");
  assert.equal(feeLeaf.sourced.retrieved_at, "2026-08-19");
});

test("the recreation-opportunities dataset carries its own service url", () => {
  const { leaves } = feeLeafCandidates(
    feeRow({ source_dataset: "usfs_recreation_opportunities", fee_required: true })
  );
  assert.equal(
    leaves[0].sourced.source.url,
    "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0"
  );
});

test("fee_required=false without a verbatim quote is refused", () => {
  const { leaves, refusals } = feeLeafCandidates(feeRow({ fee_required: false, verbatim_quote: null }));
  assert.deepEqual(leaves, []);
  assert.deepEqual(refusals, ["fee_required_false_without_quote"]);

  const blank = feeLeafCandidates(feeRow({ fee_required: false, verbatim_quote: "   " }));
  assert.deepEqual(blank.leaves, []);
  assert.deepEqual(blank.refusals, ["fee_required_false_without_quote"]);
});

test("fee_required=false with a verbatim quote is written", () => {
  const { leaves, refusals } = feeLeafCandidates(
    feeRow({ fee_required: false, verbatim_quote: "No fees are required for this site" }),
    recSiteFacts({ feeCharged: "N" })
  );
  assert.deepEqual(refusals, []);
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].sourced.value, false);
});

test("fee_required=false is refused when the raw row says the site charges", () => {
  // The quote guard alone is vacuous: 2,551 of the 3,254 false rows carry the
  // EDW boilerplate "No fees are required for this site", and 66 of them sit on
  // records the same dataset marks fee_charged='Y'.
  const { leaves, refusals } = feeLeafCandidates(
    feeRow({ fee_required: false, verbatim_quote: "No fees are required for this site" }),
    recSiteFacts({ feeCharged: "Y", feeType: "STANDARD AMENITY FEE" })
  );
  assert.deepEqual(leaves, []);
  assert.deepEqual(refusals, ["fee_required_false_contradicted_by_fee_charged"]);
});

test("a fee_charged=Y row still writes its other fee facts and a true claim", () => {
  const { leaves, refusals } = feeLeafCandidates(
    feeRow({ fee_required: false, verbatim_quote: "free", day_fee_usd: 5 }),
    recSiteFacts({ feeCharged: "Y" })
  );
  assert.deepEqual(
    leaves.map((leaf) => leaf.leaf),
    ["day_fee_usd"]
  );
  assert.deepEqual(refusals, ["fee_required_false_contradicted_by_fee_charged"]);

  const claimed = feeLeafCandidates(feeRow({ fee_required: true }), recSiteFacts({ feeCharged: "Y" }));
  assert.equal(claimed.leaves[0].sourced.value, true);
  assert.deepEqual(claimed.refusals, []);
});

test("empty pass lists and null amounts produce no leaves", () => {
  const { leaves } = feeLeafCandidates(feeRow({ fee_required: null }));
  assert.deepEqual(leaves, []);
});

// --- bathroom leaves --------------------------------------------------------

test("an unknown bathroom status writes nothing", () => {
  const { leaves, refusals } = bathroomLeafCandidates(bathroomRow({ status: "unknown", type: null }));
  assert.deepEqual(leaves, []);
  assert.deepEqual(refusals, ["status_unknown"]);
});

test("a present vault toilet writes status and type", () => {
  const { leaves } = bathroomLeafCandidates(bathroomRow());
  assert.deepEqual(
    leaves.map((leaf) => [leaf.leaf, leaf.sourced.value]),
    [
      ["status", "present"],
      ["type", "vault_pit"],
    ]
  );
  assert.equal(leaves[0].block, "bathrooms");
  assert.equal(leaves[0].sourced.source.kind, "usfs_edw");
});

test("the off-site pattern matches the real restroom strings", () => {
  assert.ok(isOffSiteBathroomNote("Restrooms available nearby"));
  assert.ok(isOffSiteBathroomNote("Vault toilet at Upper End Campground"));
  assert.ok(isOffSiteBathroomNote("Two vault toilets available at adjacent BLM Liberty Recreation Site."));
  assert.ok(isOffSiteBathroomNote("nearest restroom is 1/4 mile down the road at the turnaround."));
  assert.ok(isOffSiteBathroomNote("Available at Spruce Picnic Area"));
  assert.equal(isOffSiteBathroomNote("Vault toilet(s)"), false);
  assert.equal(isOffSiteBathroomNote("No restroom available"), false);
  assert.equal(isOffSiteBathroomNote(null), false);
});

test("an off-site restroom keeps type unspecified and records the note", () => {
  const { leaves } = bathroomLeafCandidates(
    bathroomRow({ raw_string: "Vault toilet at Upper End Campground", type: "vault_pit" })
  );
  assert.deepEqual(
    leaves.map((leaf) => [leaf.leaf, leaf.sourced.value]),
    [
      ["status", "present"],
      ["location_note", "Vault toilet at Upper End Campground"],
      ["type", "unspecified"],
    ]
  );
});

test("an absent row with an off-site note records the note but claims no type", () => {
  const { leaves } = bathroomLeafCandidates(
    bathroomRow({
      status: "absent",
      type: null,
      raw_string: "No restroom available; nearest restroom is 1/4 mile down the road at the turnaround.",
    })
  );
  assert.deepEqual(
    leaves.map((leaf) => leaf.leaf),
    ["status", "location_note"]
  );
  assert.equal(leaves[0].sourced.value, "absent");
});

test("a season note becomes its own leaf", () => {
  const { leaves } = bathroomLeafCandidates(bathroomRow({ season_note: "May 1 to October 31" }));
  assert.deepEqual(
    leaves.map((leaf) => leaf.leaf),
    ["status", "type", "season_note"]
  );
});

// --- page leaves ------------------------------------------------------------

test("a page section becomes parking capacity and the fills-early note", () => {
  const { leaves, refusals } = pageLeafCandidates(
    pageRow({ capacity_estimate: 12, fills_early_note: "Parking is limited on busy days." })
  );
  assert.deepEqual(refusals, []);
  assert.deepEqual(
    leaves.map((leaf) => [leaf.leaf, leaf.sourced.value]),
    [
      ["capacity_vehicles", 12],
      ["fills_early_note", "Parking is limited on busy days."],
    ]
  );
  assert.equal(leaves[0].sourced.source.kind, "usfs_web");
  assert.equal(leaves[0].sourced.source.url, pageRow().url);
  assert.equal(leaves[0].sourced.retrieved_at, "2026-08-19T20:43:51+00:00");
});

test("a page section with no structured fact is refused", () => {
  const { leaves, refusals } = pageLeafCandidates(pageRow({ restroom_text: "No restroom available" }));
  assert.deepEqual(leaves, []);
  assert.deepEqual(refusals, ["no_structured_facts"]);
});

// --- conflicts --------------------------------------------------------------

function leaf(
  block: "parking" | "bathrooms",
  name: string,
  value: unknown,
  kind: string,
  source: LeafCandidate["source"]
): LeafCandidate {
  return {
    block,
    leaf: name as LeafCandidate["leaf"],
    source,
    rowKey: `${source}:${name}:${kind}`,
    sourced: { value, source: { kind, name: "US Forest Service" }, retrieved_at: "2026-08-19" },
  };
}

test("fee_required=true beats false whichever order they arrive in", () => {
  const first = resolveLeafConflicts([
    leaf("parking", "fee_required", false, "usfs_edw", "usfs_fees"),
    leaf("parking", "fee_required", true, "usfs_edw", "usfs_fees"),
  ]);
  assert.equal(first.chosen.length, 1);
  assert.equal(first.chosen[0].sourced.value, true);
  assert.equal(first.conflicts[0].reason, "fee_required_true_wins");

  const second = resolveLeafConflicts([
    leaf("parking", "fee_required", true, "usfs_edw", "usfs_fees"),
    leaf("parking", "fee_required", false, "usfs_edw", "usfs_fees"),
  ]);
  assert.equal(second.chosen[0].sourced.value, true);
});

test("an explicit page capacity beats any other source", () => {
  const { chosen } = resolveLeafConflicts([
    leaf("parking", "capacity_vehicles", 30, "usfs_edw", "usfs_fees"),
    leaf("parking", "capacity_vehicles", 12, "usfs_web", "usfs_pages"),
  ]);
  assert.equal(chosen[0].sourced.value, 12);
  assert.equal(chosen[0].sourced.source.kind, "usfs_web");
});

test("otherwise the agency dataset beats the web page", () => {
  const { chosen, conflicts } = resolveLeafConflicts([
    leaf("parking", "fills_early_note", "from the web page", "usfs_web", "usfs_pages"),
    leaf("parking", "fills_early_note", "from the dataset", "usfs_edw", "usfs_fees"),
  ]);
  assert.equal(chosen[0].sourced.value, "from the dataset");
  assert.equal(conflicts[0].reason, "edw_over_web");
});

test("resolution keeps one leaf per name and preserves first-seen order", () => {
  const { chosen } = resolveLeafConflicts([
    leaf("parking", "fee_required", true, "usfs_edw", "usfs_fees"),
    leaf("bathrooms", "status", "present", "usfs_edw", "usfs_bathrooms"),
    leaf("parking", "fee_required", true, "usfs_edw", "usfs_fees"),
  ]);
  assert.deepEqual(
    chosen.map((c) => `${c.block}.${String(c.leaf)}`),
    ["parking.fee_required", "bathrooms.status"]
  );
});

// --- building and merging ---------------------------------------------------

test("chosen leaves become nested blocks", () => {
  const amenities = buildTrailheadAmenities([
    leaf("parking", "fee_required", true, "usfs_edw", "usfs_fees"),
    leaf("bathrooms", "status", "present", "usfs_edw", "usfs_bathrooms"),
  ]);
  assert.equal(amenities.parking?.fee_required?.value, true);
  assert.equal(amenities.bathrooms?.status?.value, "present");
});

test("merging preserves unrelated blocks and reports the change", () => {
  const existing = { toilet: "vault", drinking_water: "no", road_access: { surface: { value: "gravel" } } };
  const merge = mergeTrailheadAmenities(
    existing,
    buildTrailheadAmenities([leaf("parking", "fee_required", true, "usfs_edw", "usfs_fees")])
  );
  assert.equal(merge.changed, true);
  assert.deepEqual(merge.appliedLeaves, ["parking.fee_required"]);
  assert.equal(merge.merged.toilet, "vault");
  assert.deepEqual(merge.merged.road_access, { surface: { value: "gravel" } });
  assert.equal((merge.merged.parking as Record<string, { value: unknown }>).fee_required.value, true);
});

test("re-running the same facts changes nothing", () => {
  const incoming = buildTrailheadAmenities([
    leaf("parking", "fee_required", true, "usfs_edw", "usfs_fees"),
    leaf("bathrooms", "status", "absent", "usfs_edw", "usfs_bathrooms"),
  ]);
  const first = mergeTrailheadAmenities(null, incoming);
  assert.equal(first.changed, true);
  const second = mergeTrailheadAmenities(first.merged, incoming);
  assert.equal(second.changed, false);
  assert.equal(canonicalJson(second.merged), canonicalJson(first.merged));
});

test("a re-run updates a leaf this importer owns", () => {
  const before = mergeTrailheadAmenities(
    null,
    buildTrailheadAmenities([leaf("parking", "capacity_vehicles", 12, "usfs_web", "usfs_pages")])
  );
  const after = mergeTrailheadAmenities(
    before.merged,
    buildTrailheadAmenities([leaf("parking", "capacity_vehicles", 20, "usfs_web", "usfs_pages")])
  );
  assert.equal(after.changed, true);
  assert.equal((after.merged.parking as Record<string, { value: unknown }>).capacity_vehicles.value, 20);
});

test("a leaf owned by another source is left alone", () => {
  const existing = {
    parking: {
      capacity_vehicles: {
        value: 8,
        source: { kind: "human_survey", name: "Ranger district call" },
        retrieved_at: "2026-01-01",
      },
    },
  };
  const merge = mergeTrailheadAmenities(
    existing,
    buildTrailheadAmenities([leaf("parking", "capacity_vehicles", 20, "usfs_web", "usfs_pages")])
  );
  assert.equal(merge.changed, false);
  assert.deepEqual(merge.preservedLeaves, ["parking.capacity_vehicles"]);
  assert.deepEqual(merge.appliedLeaves, []);
  assert.equal((merge.merged.parking as Record<string, { value: unknown }>).capacity_vehicles.value, 8);
});

test("canonical json ignores key order", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
});
