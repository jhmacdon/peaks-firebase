import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  bathroomLeafCandidates,
  buildRecSiteIndex,
  candidateNames,
  buildTrailheadAmenities,
  canonicalJson,
  chooseMatch,
  CONTAINMENT_MIN_TOKENS,
  feeLeafCandidates,
  recSiteKey,
  isOffSiteBathroomNote,
  mergeTrailheadAmenities,
  nameTokensContained,
  normalizeTrailheadName,
  npsBathroomLeafCandidates,
  npsParkingLeafCandidates,
  pageLeafCandidates,
  PG_TRGM_NAME_THRESHOLD,
  resolveLeafConflicts,
  TOKEN_OVERLAP_NAME_THRESHOLD,
  tokenOverlapSimilarity,
  usableSourcePoint,
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
    name: "Baker Lake Trailhead",
    lat: 45.894398,
    lng: -114.241692,
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
      { destinationId: "a", destinationName: "Snow Lake", distanceM: 20, similarity: 0.6, matchedName: "Snow Lake TH", contained: false },
      { destinationId: "b", destinationName: "Snow Lake Trailhead", distanceM: 200, similarity: 0.9, matchedName: "Snow Lake TH", contained: false },
    ],
    0.5
  );
  assert.equal(outcome.kind, "matched");
  assert.equal(outcome.kind === "matched" && outcome.candidate.destinationId, "b");

  const tie = chooseMatch(
    [
      { destinationId: "far", destinationName: "Snow Lake", distanceM: 200, similarity: 0.9, matchedName: "Snow Lake", contained: false },
      { destinationId: "near", destinationName: "Snow Lake", distanceM: 20, similarity: 0.9, matchedName: "Snow Lake", contained: false },
    ],
    0.5
  );
  assert.equal(tie.kind === "matched" && tie.candidate.destinationId, "near");
});

test("a nearby destination with a different name is rejected and reported", () => {
  const outcome = chooseMatch(
    [{ destinationId: "a", destinationName: "Baker Creek", distanceM: 30, similarity: 0.4, matchedName: "Baker Lake", contained: false }],
    0.5
  );
  assert.equal(outcome.kind, "name_below_threshold");
  assert.equal(outcome.kind === "name_below_threshold" && outcome.best.destinationId, "a");
});

test("containment passes a name the threshold loses to a qualifier", () => {
  // Real near-misses from the production dry run: Peaks appends a qualifier
  // the agency does not, and trigram similarity punishes the length.
  const pairs: Array<[string, string]> = [
    ["Windy Peak Trailhead/Long Swamp", "Windy Peak Trailhead"],
    ["Talapus Lake Trailhead", "Talapus Lake Trailhead Parking Lot"],
    ["Coal Lake/Independence Lake Trailhead", "Coal Lake Trailhead"],
    ["Jack Lake Trailhead", "Jack Lake Trailhead (Canyon Creek Meadows)"],
  ];
  for (const [source, destination] of pairs) {
    assert.equal(
      nameTokensContained(normalizeTrailheadName(source), normalizeTrailheadName(destination)),
      true,
      `${source} ↔ ${destination}`
    );
  }
});

test("containment refuses names that merely share a word", () => {
  // The two pairs the production dry run named as known-bad.
  assert.equal(
    nameTokensContained(normalizeTrailheadName("WILLOW LAKE"), normalizeTrailheadName("Willow Creek Trailhead")),
    false
  );
  assert.equal(
    nameTokensContained(normalizeTrailheadName("APE CANYON TH"), normalizeTrailheadName("Lava Canyon Trailhead")),
    false
  );
});

test("a one-token name never passes containment", () => {
  // "Butte" sits inside "Driveway Butte" without being the same trailhead.
  assert.equal(
    nameTokensContained(normalizeTrailheadName("DRIVEWAY BUTTE"), normalizeTrailheadName("Butte Trailhead")),
    false
  );
  assert.equal(nameTokensContained("beverly", "beverly turnpike"), false);
  assert.equal(CONTAINMENT_MIN_TOKENS, 2);
});

test("the gate reports which rule carried the match", () => {
  const contained = chooseMatch(
    [
      {
        destinationId: "dest-windy",
        destinationName: "Windy Peak Trailhead",
        distanceM: 0,
        similarity: 0.344,
        matchedName: "Windy Peak Trailhead/Long Swamp",
        contained: true,
        containedName: "Windy Peak Trailhead/Long Swamp",
      },
    ],
    0.5
  );
  assert.equal(contained.kind, "matched");
  assert.equal(contained.kind === "matched" && contained.rule, "containment");

  const scored = chooseMatch(
    [
      {
        destinationId: "dest-snow",
        destinationName: "Snow Lake Trailhead",
        distanceM: 10,
        similarity: 0.9,
        matchedName: "Snow Lake",
        contained: false,
      },
    ],
    0.5
  );
  assert.equal(scored.kind === "matched" && scored.rule, "threshold");
});

test("a containment match wins even when a higher-scoring candidate fails both rules", () => {
  const outcome = chooseMatch(
    [
      {
        destinationId: "dest-loud",
        destinationName: "Willow Creek Trailhead",
        distanceM: 5,
        similarity: 0.4,
        matchedName: "Willow Lake",
        contained: false,
      },
      {
        destinationId: "dest-right",
        destinationName: "Willow Lake Trailhead Parking",
        distanceM: 40,
        similarity: 0.35,
        matchedName: "Willow Lake",
        contained: true,
        containedName: "Willow Lake",
      },
    ],
    0.5
  );
  assert.equal(outcome.kind, "matched");
  assert.equal(outcome.kind === "matched" && outcome.candidate.destinationId, "dest-right");
  assert.equal(outcome.kind === "matched" && outcome.candidate.matchedName, "Willow Lake");
});

test("nothing passing either rule still reports the best candidate", () => {
  const outcome = chooseMatch(
    [
      {
        destinationId: "dest-a",
        destinationName: "Lava Canyon Trailhead",
        distanceM: 164,
        similarity: 0.438,
        matchedName: "Ape Canyon",
        contained: false,
      },
    ],
    0.5
  );
  assert.equal(outcome.kind, "name_below_threshold");
  assert.equal(outcome.kind === "name_below_threshold" && outcome.best.destinationId, "dest-a");
});

// --- page coordinates -------------------------------------------------------

test("a page point is used only when it is a real coordinate", () => {
  assert.deepEqual(usableSourcePoint(45.894398, -114.241692), {
    lat: 45.894398,
    lng: -114.241692,
  });
  // The 23 Alaska pages are real places, and no US-bounds assumption may
  // quietly drop them: they leave here as points and fail the distance gate.
  assert.deepEqual(usableSourcePoint(60.99542101, -149.27770625), {
    lat: 60.99542101,
    lng: -149.27770625,
  });
  assert.equal(usableSourcePoint(null, -114.2), null, "a page with no coordinate");
  assert.equal(usableSourcePoint(undefined, undefined), null);
  assert.equal(usableSourcePoint("45.8", -114.2), null, "a string is not a coordinate");
  assert.equal(usableSourcePoint(Number.NaN, -114.2), null);
  // ST_MakePoint takes a latitude of 200 and the geography cast turns it into
  // some point on the globe, so the range check is what keeps a wrong
  // coordinate from coming back as a confident distance.
  assert.equal(usableSourcePoint(200, -114.2), null);
  assert.equal(usableSourcePoint(45.8, -400), null);
});

test("the raw index is keyed by dataset, so ids never cross datasets", () => {
  const index = buildRecSiteIndex([
    { site_cn: "5001", site_name: "SHARED ID TRAILHEAD", fee_charged: "Y" },
  ]);
  assert.equal(index.get(recSiteKey("usfs_rec_sites", "5001"))?.feeCharged, "Y");
  assert.equal(index.get(recSiteKey("usfs_recreation_opportunities", "5001")), undefined);
});

test("a no-fee claim with no raw row to check is written but counted", () => {
  const { leaves, refusals, notices } = feeLeafCandidates(
    feeRow({ source_dataset: "usfs_recreation_opportunities", fee_required: false, verbatim_quote: "No fee" }),
    null
  );
  assert.equal(leaves[0].sourced.value, false);
  assert.deepEqual(refusals, []);
  assert.deepEqual(notices, ["fee_required_false_quote_only"]);

  const corroborated = feeLeafCandidates(
    feeRow({ fee_required: false, verbatim_quote: "No fee" }),
    recSiteFacts({ feeCharged: "N" })
  );
  assert.deepEqual(corroborated.notices, [], "a fee_charged='N' row is cross-checked, not quote-only");
});

// --- raw EDW enrichment -----------------------------------------------------

test("the raw pull indexes by site_cn, the normalized rows' source_id", () => {
  const index = buildRecSiteIndex([
    {
      site_cn: "5927010263",
      site_name: "MARTIN BRIDGE TRAILHEAD",
      public_site_name: "Eagle Forks Trailhead",
      fee_charged: "n",
      fee_type: null,
    },
    { site_cn: null, site_name: "no id" },
  ]);
  assert.equal(index.size, 1);
  const facts = index.get(recSiteKey("usfs_rec_sites", "5927010263"));
  assert.equal(facts?.publicName, "Eagle Forks Trailhead");
  assert.equal(facts?.feeCharged, "N", "fee_charged is compared upper-case");
});

test("both names go through the gate, deduplicated", () => {
  assert.deepEqual(
    candidateNames("MARTIN BRIDGE TRAILHEAD", {
      sourceId: "1",
      feeCharged: null,
      feeType: null,
      publicName: "Eagle Forks Trailhead",
    }),
    ["MARTIN BRIDGE TRAILHEAD", "Eagle Forks Trailhead"]
  );
  assert.deepEqual(
    candidateNames("SNOW LAKE TRAILHEAD", {
      sourceId: "1",
      feeCharged: null,
      feeType: null,
      publicName: "Snow Lake TH",
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
    }),
    recSiteFacts({ feeCharged: "Y" })
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
    feeRow({ source_dataset: "usfs_recreation_opportunities", fee_required: true }),
    null
  );
  assert.equal(
    leaves[0].sourced.source.url,
    "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0"
  );
});

test("fee_required=false without a verbatim quote is refused", () => {
  const { leaves, refusals } = feeLeafCandidates(feeRow({ fee_required: false, verbatim_quote: null }), null);
  assert.deepEqual(leaves, []);
  assert.deepEqual(refusals, ["fee_required_false_without_quote"]);

  const blank = feeLeafCandidates(feeRow({ fee_required: false, verbatim_quote: "   " }), null);
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
  const { leaves } = feeLeafCandidates(feeRow({ fee_required: null }), null);
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
  assert.equal(leaves[0].sourced.source.name, "US Forest Service");
  assert.equal(leaves[0].sourced.source.url, pageRow().url);
  assert.equal(leaves[0].sourced.source.license, "public domain (US federal government)");
  // The page row records the instant it was fetched; every other source in this
  // importer stamps a day, and the clients read a day.
  assert.equal(leaves[0].sourced.retrieved_at, "2026-08-19");
  assert.equal(leaves[0].rowKey, pageRow().url);
});

test("a page section with no structured fact is refused", () => {
  const { leaves, refusals } = pageLeafCandidates(pageRow({ restroom_text: "No restroom available" }));
  assert.deepEqual(leaves, []);
  assert.deepEqual(refusals, ["no_structured_facts"]);
});

test("the page's prose and its evidence are read and never imported", () => {
  // Every one of these is on the row and none of them is a parking fact. The
  // fee, restroom and road text describe what the EDW, MVUM and RoadCore
  // datasets already publish as fields; the verbatim spans are the extraction's
  // evidence, for a person auditing it.
  const { leaves } = pageLeafCandidates(
    pageRow({
      capacity_estimate: 12,
      fee_text: "No fees are required for this site",
      restroom_text: "Vault toilet available",
      road_text: "Follow FS 363 for 7.5 miles to the trailhead.",
      elevation_ft: 6200,
      verbatim_spans: {
        capacity: "Parking for 12 vehicles",
        coordinates: "Latitude: 45.894398 Longitude: -114.241692",
        fee: "No fees are required for this site",
      },
    })
  );
  assert.deepEqual(
    leaves.map((leaf) => leaf.leaf),
    ["capacity_vehicles"]
  );
  const serialized = JSON.stringify(leaves);
  for (const absent of ["verbatim", "Latitude", "restroom", "elevation", "FS 363", "No fees"]) {
    assert.equal(serialized.includes(absent), false, `${absent} stayed out of the leaf`);
  }
});

test("a page whose fetched_at is not a real day is refused, not trimmed", () => {
  for (const fetchedAt of ["", "yesterday", "2026-13-02T00:00:00+00:00", "26-08-19"]) {
    const { leaves, refusals } = pageLeafCandidates(
      pageRow({ capacity_estimate: 12, fetched_at: fetchedAt })
    );
    assert.deepEqual(leaves, [], `${fetchedAt || "(empty)"} carries no leaf`);
    assert.deepEqual(refusals, ["fetched_at_not_iso"]);
  }
});

test("a page url that is not an http link never becomes a tappable source", () => {
  const { leaves, refusals } = pageLeafCandidates(
    pageRow({ capacity_estimate: 12, url: "javascript:alert(1)" })
  );
  assert.deepEqual(leaves, []);
  assert.deepEqual(refusals, ["page_url_unusable"]);
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

// --- National Park Service leaves -------------------------------------------

const NPS_POIS_SOURCE = {
  kind: "nps_pois",
  name: "National Park Service",
  url: "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_POIs/FeatureServer/0/query",
  license: "public domain (US federal government)",
};
const NPS_PARKING_SOURCE = { ...NPS_POIS_SOURCE, kind: "nps_parking" };

function npsLeaf(value: unknown, source: Record<string, unknown>): Record<string, unknown> {
  return { value, source, retrieved_at: "2026-08-19" };
}

test("an NPS bathroom block becomes present, its type, and its season note", () => {
  const { leaves, refusals } = npsBathroomLeafCandidates({
    destination_id: "dest-paradise",
    bathrooms: {
      status: npsLeaf("present", NPS_POIS_SOURCE),
      type: npsLeaf("vault_pit", NPS_POIS_SOURCE),
      season_note: npsLeaf("May 1 - Oct 31 (check park website)", NPS_POIS_SOURCE),
    },
  });
  assert.deepEqual(refusals, []);
  assert.deepEqual(
    leaves.map((entry) => [entry.block, entry.leaf, entry.sourced.value]),
    [
      ["bathrooms", "status", "present"],
      ["bathrooms", "type", "vault_pit"],
      ["bathrooms", "season_note", "May 1 - Oct 31 (check park website)"],
    ]
  );
  assert.equal(leaves[0].source, "nps_pois");
  assert.equal(leaves[0].rowKey, "dest-paradise");
});

test("an NPS bathroom status of absent is refused, and takes the block with it", () => {
  // NPS is presence-only. A trailhead with no toilet POI near it is one nobody
  // surveyed, so `absent` cannot come from this source at all.
  const { leaves, refusals } = npsBathroomLeafCandidates({
    destination_id: "dest-paradise",
    bathrooms: {
      status: npsLeaf("absent", NPS_POIS_SOURCE),
      type: npsLeaf("vault_pit", NPS_POIS_SOURCE),
    },
  });
  assert.deepEqual(leaves, []);
  assert.deepEqual(refusals, ["bathroom_status_not_present"]);
});

test("an NPS envelope is rebuilt field by field, and drops what it does not know", () => {
  const { leaves } = npsBathroomLeafCandidates({
    destination_id: "dest-paradise",
    bathrooms: {
      status: {
        value: "present",
        source: { ...NPS_POIS_SOURCE, external_id: "{ABC}", trust_me: true },
        retrieved_at: "2026-08-19",
        last_verified_at: "2026-08-19",
      },
    },
  });
  assert.deepEqual(Object.keys(leaves[0].sourced).sort(), ["retrieved_at", "source", "value"]);
  assert.deepEqual(Object.keys(leaves[0].sourced.source).sort(), ["kind", "license", "name", "url"]);
});

test("an NPS leaf with a bad retrieval date is refused", () => {
  const { leaves, refusals } = npsBathroomLeafCandidates({
    destination_id: "dest-paradise",
    bathrooms: { status: { value: "present", source: NPS_POIS_SOURCE, retrieved_at: "August 2026" } },
  });
  assert.deepEqual(leaves, []);
  assert.deepEqual(refusals, ["bathroom_status_source_unusable"]);
});

test("a javascript: url never becomes a source link", () => {
  const { leaves } = npsBathroomLeafCandidates({
    destination_id: "dest-paradise",
    bathrooms: {
      status: npsLeaf("present", { ...NPS_POIS_SOURCE, url: "javascript:alert(1)" }),
    },
  });
  assert.equal("url" in leaves[0].sourced.source, false);
});

test("an NPS parking block becomes a lot and its note", () => {
  const { leaves, refusals } = npsParkingLeafCandidates({
    destination_id: "dest-paradise",
    parking: {
      type: npsLeaf("lot", NPS_PARKING_SOURCE),
      location_note: npsLeaf("PARADISE PARKING (UPPER LOT)", NPS_PARKING_SOURCE),
    },
  });
  assert.deepEqual(refusals, []);
  assert.deepEqual(
    leaves.map((entry) => [entry.leaf, entry.sourced.value, entry.source]),
    [
      ["type", "lot", "nps_parking"],
      ["location_note", "PARADISE PARKING (UPPER LOT)", "nps_parking"],
    ]
  );
});

test("a capacity on an NPS parking leaf is refused by name", () => {
  const { leaves, refusals } = npsParkingLeafCandidates({
    destination_id: "dest-paradise",
    parking: {
      type: npsLeaf("lot", NPS_PARKING_SOURCE),
      capacity_vehicles: npsLeaf(29, NPS_PARKING_SOURCE),
    },
  });
  assert.deepEqual(refusals, ["unexpected_parking_leaf_capacity_vehicles"]);
  assert.deepEqual(
    leaves.map((entry) => entry.leaf),
    ["type"]
  );
});

test("a bathroom leaf wearing the parking service's kind is refused", () => {
  const { leaves, refusals } = npsBathroomLeafCandidates({
    destination_id: "dest-paradise",
    bathrooms: { status: npsLeaf("present", NPS_PARKING_SOURCE) },
  });
  assert.deepEqual(leaves, []);
  assert.deepEqual(refusals, ["bathroom_status_source_unusable"]);
});

test("a row with no block at all yields nothing and refuses nothing", () => {
  assert.deepEqual(npsBathroomLeafCandidates({ destination_id: "dest-paradise" }), {
    leaves: [],
    refusals: [],
    notices: [],
  });
  assert.deepEqual(npsParkingLeafCandidates({ destination_id: "dest-paradise" }), {
    leaves: [],
    refusals: [],
    notices: [],
  });
});

test("an explicit agency claim beats an NPS spatial join on the same leaf", () => {
  const { chosen, conflicts } = resolveLeafConflicts([
    leaf("bathrooms", "type", "unspecified", "nps_pois", "nps_pois"),
    leaf("bathrooms", "type", "vault_pit", "usfs_edw", "usfs_bathrooms"),
  ]);
  assert.equal(chosen[0].sourced.value, "vault_pit");
  assert.equal(conflicts[0].reason, "explicit_over_nps_join");

  // And in the other arrival order, since resolution must not depend on it.
  const reversed = resolveLeafConflicts([
    leaf("bathrooms", "type", "vault_pit", "usfs_edw", "usfs_bathrooms"),
    leaf("bathrooms", "type", "unspecified", "nps_pois", "nps_pois"),
  ]);
  assert.equal(reversed.chosen[0].sourced.value, "vault_pit");
  assert.equal(reversed.conflicts[0].reason, "explicit_over_nps_join");
});

test("two NPS leaves fall back to the ordinary rule", () => {
  const { chosen } = resolveLeafConflicts([
    leaf("parking", "location_note", "first", "nps_parking", "nps_parking"),
    leaf("parking", "location_note", "second", "nps_parking", "nps_parking"),
  ]);
  assert.equal(chosen[0].sourced.value, "first");
});

test("an NPS leaf does not overwrite an agency claim already on the row", () => {
  const existing = {
    bathrooms: {
      type: { value: "vault_pit", source: { kind: "usfs_edw", name: "US Forest Service" }, retrieved_at: "2026-08-19" },
    },
  };
  const merge = mergeTrailheadAmenities(
    existing,
    buildTrailheadAmenities([
      leaf("bathrooms", "type", "unspecified", "nps_pois", "nps_pois"),
      leaf("bathrooms", "status", "present", "nps_pois", "nps_pois"),
    ])
  );
  assert.deepEqual(merge.deferredLeaves, ["bathrooms.type"]);
  assert.deepEqual(merge.appliedLeaves, ["bathrooms.status"]);
  const bathrooms = merge.merged.bathrooms as Record<string, { value: unknown }>;
  assert.equal(bathrooms.type.value, "vault_pit");
  assert.equal(bathrooms.status.value, "present");
});

test("an NPS leaf does overwrite the NPS leaf it wrote last quarter", () => {
  const existing = {
    parking: {
      location_note: {
        value: "PARADISE PARKING (LOWER LOT)",
        source: { kind: "nps_parking", name: "National Park Service" },
        retrieved_at: "2026-05-01",
      },
    },
  };
  const merge = mergeTrailheadAmenities(
    existing,
    buildTrailheadAmenities([
      leaf("parking", "location_note", "PARADISE PARKING (UPPER LOT)", "nps_parking", "nps_parking"),
    ])
  );
  assert.deepEqual(merge.deferredLeaves, []);
  const parking = merge.merged.parking as Record<string, { value: unknown }>;
  assert.equal(parking.location_note.value, "PARADISE PARKING (UPPER LOT)");
});
