import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_MINIMUM_PROMINENCE_M,
  parseOsmProminenceMeters,
  parseWikidataEntity,
  parseWikidataQuantityMeters,
  selectPeakCandidate,
  WikidataPeakFacts,
} from "../peak-coverage-enrichment";
import { matchReferencePeak, ReferencePeak } from "../peak-coverage";

function reference(overrides: Partial<ReferencePeak> = {}): ReferencePeak {
  return {
    osmId: "123",
    name: "Independent Mountain",
    lat: 47,
    lng: -121,
    elevationM: 1_500,
    wikidataId: "Q123",
    wikipedia: null,
    ...overrides,
  };
}

function wikidata(overrides: Partial<WikidataPeakFacts> = {}): WikidataPeakFacts {
  return {
    wikidataId: "Q123",
    prominenceM: null,
    elevationM: null,
    wikipediaSitelinks: 0,
    ...overrides,
  };
}

const noSessions = {
  sessionsWithin30m: 0,
  sessionsWithin100m: 0,
  sessionsWithin250m: 0,
};

test("converts Wikidata metre and foot quantities", () => {
  assert.equal(parseWikidataQuantityMeters({
    amount: "+120",
    unit: "http://www.wikidata.org/entity/Q11573",
  }), 120);
  assert.ok(Math.abs((parseWikidataQuantityMeters({
    amount: "+300",
    unit: "http://www.wikidata.org/entity/Q3710",
  }) ?? 0) - DEFAULT_MINIMUM_PROMINENCE_M) < 0.0001);
  assert.equal(parseWikidataQuantityMeters({ amount: "+1", unit: "1" }), null);
});

test("parses preferred prominence, elevation, and Wikipedia sitelinks", () => {
  const facts = parseWikidataEntity("Q123", {
    claims: {
      P2660: [{ rank: "normal", mainsnak: { datavalue: { value: {
        amount: "+100", unit: "http://www.wikidata.org/entity/Q11573",
      } } } }],
      P2044: [{ rank: "preferred", mainsnak: { datavalue: { value: {
        amount: "+5000", unit: "http://www.wikidata.org/entity/Q3710",
      } } } }],
    },
    sitelinks: { enwiki: {}, frwiki: {}, commonswiki: {}, specieswiki: {} },
  });
  assert.equal(facts.prominenceM, 100);
  assert.ok(Math.abs((facts.elevationM ?? 0) - 1_524) < 0.001);
  assert.equal(facts.wikipediaSitelinks, 2);
});

test("parses explicit OSM prominence units", () => {
  assert.ok(Math.abs((parseOsmProminenceMeters({
    type: "node",
    id: 1,
    tags: { "prominence:ft": "500" },
  }) ?? 0) - 152.4) < 0.001);
  assert.equal(parseOsmProminenceMeters({
    type: "node",
    id: 2,
    tags: { prominence: "120" },
  }), 120);
});

test("automatically selects a primary peak over 300 feet prominence", () => {
  const selection = selectPeakCandidate(
    matchReferencePeak(reference(), []),
    noSessions,
    undefined,
    wikidata({ prominenceM: DEFAULT_MINIMUM_PROMINENCE_M + 0.01 })
  );
  assert.equal(selection.decision, "add");
  assert.equal(selection.prominenceSource, "wikidata");
});

test("selects a popular peak without sufficient prominence", () => {
  const selection = selectPeakCandidate(
    matchReferencePeak(reference({ wikipedia: "en:Independent Mountain" }), []),
    noSessions,
    undefined,
    wikidata({ prominenceM: 20 })
  );
  assert.equal(selection.decision, "add");
  assert.deepEqual(selection.popularitySignals, ["osm_wikipedia"]);
});

test("keeps alias and subpeak guardrails even when prominence is high", () => {
  const selection = selectPeakCandidate(
    matchReferencePeak(reference({ name: "Independent Mountain West Peak" }), []),
    noSessions,
    undefined,
    wikidata({ prominenceM: 500 })
  );
  assert.equal(selection.decision, "defer");
  assert.ok(selection.reasons.includes("possible_subpeak"));
});

test("requires an elevation and defers conflicting prominence sources", () => {
  const selection = selectPeakCandidate(
    matchReferencePeak(reference({ elevationM: null }), []),
    noSessions,
    { type: "node", id: 123, tags: { prominence: "200" } },
    wikidata({ prominenceM: 100, elevationM: null })
  );
  assert.equal(selection.decision, "defer");
  assert.ok(selection.reasons.includes("missing_elevation"));
  assert.ok(selection.reasons.includes("prominence_source_conflict"));
});
