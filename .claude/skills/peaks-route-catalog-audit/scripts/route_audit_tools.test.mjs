import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectDestinationIdentity } from "./fetch_destination_identity.mjs";
import {
  compareRouteSourceFacts,
  validateSourceFacts,
} from "./compare_route_source_facts.mjs";

const workerCheckoutResolver = fileURLToPath(
  new URL(
    "../../../../.agents/skills/peaks-route-factory/scripts/resolve_worker_checkout.sh",
    import.meta.url
  )
);

test("approved worker checkouts resolve by exact path", () => {
  const checkouts = [
    [
      "/Users/josiahm/projects/peaks/firebase",
      "canonical",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-factory",
      "route-factory",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-audit",
      "luna-route-audit-01",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-audit-02",
      "luna-route-audit-02",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-audit-03",
      "luna-route-audit-03",
    ],
    [
      "/Users/josiahm/projects/peaks/.workers/firebase-route-audit-04",
      "luna-route-audit-04",
    ],
  ];
  for (const [checkoutPath, expected] of checkouts) {
    const actual = execFileSync(
      workerCheckoutResolver,
      [checkoutPath],
      { encoding: "utf8" }
    ).trim();
    assert.equal(actual, expected);
  }
  for (const rejectedPath of [
    "/Users/josiahm/projects/peaks/.workers/firebase-route-audit-01",
    "/tmp/firebase-route-audit-04",
    "/Users/josiahm/projects/peaks/.workers/firebase-route-audit-05",
  ]) {
    assert.throws(
      () => execFileSync(
        workerCheckoutResolver,
        [rejectedPath],
        { encoding: "utf8", stdio: "pipe" }
      ),
      /Command failed/
    );
  }
});

const catalogAudit = {
  records: [
    {
      type: "identity",
      severity: "REVIEW",
      destination_id: "peak-1",
      destination_name: "대둔산",
      issues: ["localized_display_name_requires_source_review"],
      metrics: {
        stored_name: "대둔산",
        country_code: "KR",
        osm_id: "3819433157",
        wikidata_id: "Q5208179",
      },
    },
    {
      type: "selection",
      severity: "ERROR",
      destination_id: "peak-1",
      item_id: "route-1",
      issues: ["selected_route_has_errors"],
    },
    {
      type: "route",
      severity: "ERROR",
      destination_id: "peak-1",
      item_id: "route-1",
      item_name: "금남정맥",
      issues: ["legacy_route_coverage_import"],
      metrics: { status: "active", one_way_m: 52_000 },
    },
    {
      type: "route",
      severity: "ERROR",
      destination_id: "peak-1",
      item_id: "route-2",
      item_name: "금남정맥",
      issues: ["legacy_route_coverage_import"],
      metrics: { status: "active", one_way_m: 64_000 },
    },
  ],
};

const facts = {
  destination_id: "peak-1",
  preferred_display_name: "Daedunsan",
  local_names: ["대둔산"],
  aliases: ["Daedunsan Peak"],
  standard_route: {
    name: "Mount Daedunsan",
    aliases: ["Daedunsan parking lot–Macheondae"],
    trailhead_name: "Daedunsan Provincial Park",
    distance_m: 4_345,
    distance_basis: "round_trip",
    shape: "out_and_back",
    gain_m: 553,
    activity: "hike",
    access: "public park trail; check current closures",
  },
  sources: [
    {
      publisher: "AllTrails",
      url: "https://www.alltrails.com/example",
      retrieved_at: "2026-08-01",
      supports: [
        "route_identity", "trailhead", "distance", "shape", "gain", "activity",
      ],
      facts: {
        route_name: "Mount Daedunsan",
        trailhead_name: "Daedunsan Provincial Park",
        distance_m: 4_345,
        distance_basis: "round_trip",
        shape: "out_and_back",
        gain_m: 553,
        activity: "hike",
      },
    },
    {
      publisher: "OpenStreetMap",
      url: "https://www.openstreetmap.org/node/3819433157",
      retrieved_at: "2026-08-01",
      supports: ["route_identity", "trailhead", "access"],
      facts: {
        route_name: "Mount Daedunsan",
        trailhead_name: "Daedunsan Provincial Park",
        access: "public park trail; check current closures",
      },
    },
  ],
};

test("linked OSM and Wikidata names expose an English display-name mismatch", async () => {
  const responses = new Map([
    [
      "https://api.openstreetmap.org/api/0.6/node/3819433157.json",
      {
        elements: [{
          type: "node",
          id: 3819433157,
          tags: {
            name: "대둔산",
            "name:en": "Daedunsan Peak",
            "name:ko": "대둔산",
          },
        }],
      },
    ],
    [
      "https://www.wikidata.org/wiki/Special:EntityData/Q5208179.json",
      {
        entities: {
          Q5208179: {
            labels: {
              en: { language: "en", value: "Daedunsan" },
              ko: { language: "ko", value: "대둔산" },
            },
            aliases: {},
          },
        },
      },
    ],
  ]);
  const fakeFetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => responses.get(String(url)),
  });

  const result = await collectDestinationIdentity(catalogAudit, fakeFetch);
  assert.deepEqual(result.english_candidates, ["Daedunsan Peak", "Daedunsan"]);
  assert.ok(result.findings.includes("stored_display_name_differs_from_english_sources"));
  assert.ok(!result.findings.includes("english_name_sources_disagree"));
});

test("source facts require two independent publishers", () => {
  assert.throws(
    () => validateSourceFacts({
      ...facts,
      sources: [facts.sources[0], { ...facts.sources[0] }],
    }),
    /two independent publishers/
  );
});

test("Daedunsan-scale legacy routes fail the external plausibility check", () => {
  const identityAudit = {
    destination_id: "peak-1",
    stored_name: "대둔산",
    english_candidates: ["Daedunsan Peak", "Daedunsan"],
    findings: [],
  };
  const result = compareRouteSourceFacts(catalogAudit, identityAudit, facts);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.standard_route.expected_one_way_m, 2_173);
  assert.ok(result.findings.some((finding) =>
    finding.type === "display_name_mismatch"
  ));
  assert.ok(result.findings.some((finding) =>
    finding.type === "no_plausible_standard_route"
  ));
  assert.deepEqual(result.routes.map((route) => route.action), [
    "supersede",
    "supersede",
  ]);
});

test("quarantined legacy routes do not block a valid active standard route", () => {
  const repairedCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "REVIEW",
        issues: ["localized_display_name_requires_source_review"],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan daedunsan peak 대둔산",
          names: {
            english: "Daedunsan",
            local: ["대둔산"],
            aliases: ["Daedunsan Peak"],
          },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        item_name: "Mount Daedunsan",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Daedunsan Provincial Park",
        },
      },
      {
        ...catalogAudit.records[2],
        metrics: { status: "superseded", one_way_m: 52_000 },
      },
    ],
  };
  const repairedIdentity = {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    english_candidates: ["Daedunsan Peak", "Daedunsan"],
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  };
  const result = compareRouteSourceFacts(repairedCatalog, repairedIdentity, facts);
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.routes.map((route) => route.action), [
    "keep",
    "supersede",
  ]);

  const missingSearchCatalog = structuredClone(repairedCatalog);
  missingSearchCatalog.records[0].issues = ["missing_search_name"];
  missingSearchCatalog.records[0].metrics.search_name = null;
  const missingSearchResult = compareRouteSourceFacts(missingSearchCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    english_candidates: ["Daedunsan Peak", "Daedunsan"],
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(missingSearchResult.verdict, "REVIEW");
  assert.ok(missingSearchResult.findings.some((finding) =>
    finding.type === "unresolved_catalog_reviews"
  ));

  const mismatchedCompleteSource = structuredClone(facts);
  mismatchedCompleteSource.sources[0].facts.route_name = "Different Traverse";
  mismatchedCompleteSource.sources[0].facts.trailhead_name = "Other Trailhead";
  mismatchedCompleteSource.sources[0].facts.activity = "scramble";
  const mismatchedCompleteResult = compareRouteSourceFacts(
    repairedCatalog,
    repairedIdentity,
    mismatchedCompleteSource
  );
  assert.equal(mismatchedCompleteResult.verdict, "REVIEW");
  assert.ok(mismatchedCompleteResult.findings.some((finding) =>
    finding.type === "source_route_fact_conflicts"
  ));

  const inventedAccess = structuredClone(facts);
  inventedAccess.standard_route.access = "open year-round";
  const inventedAccessResult = compareRouteSourceFacts(
    repairedCatalog,
    repairedIdentity,
    inventedAccess
  );
  assert.equal(inventedAccessResult.verdict, "REVIEW");
  assert.ok(inventedAccessResult.findings.some((finding) =>
    finding.type === "source_route_fact_conflicts" &&
    finding.reviews.some((review) =>
      review.type === "no_access_source_matches_standard"
    )
  ));

  const oneWayPartialSource = structuredClone(facts);
  oneWayPartialSource.sources.push({
    publisher: "Partial Distance Source",
    url: "https://example.net/distance",
    retrieved_at: "2026-08-01",
    supports: ["distance"],
    facts: {
      distance_m: 2_173,
      distance_basis: "one_way",
    },
  });
  assert.doesNotThrow(() => validateSourceFacts(oneWayPartialSource));
  assert.equal(
    compareRouteSourceFacts(
      repairedCatalog,
      repairedIdentity,
      oneWayPartialSource
    ).verdict,
    "PASS"
  );

  const impossiblePartialSource = structuredClone(facts);
  impossiblePartialSource.sources.push({
    publisher: "Impossible Shape Source",
    url: "https://example.net/impossible",
    retrieved_at: "2026-08-01",
    supports: ["distance", "shape"],
    facts: {
      distance_m: 4_345,
      distance_basis: "round_trip",
      shape: "point_to_point",
    },
  });
  assert.throws(
    () => validateSourceFacts(impossiblePartialSource),
    /point_to_point source distance cannot be round_trip/
  );

  const conflictingPartialSource = structuredClone(facts);
  conflictingPartialSource.sources.push({
    publisher: "Long Variant Source",
    url: "https://example.net/long-variant",
    retrieved_at: "2026-08-01",
    supports: ["distance", "shape"],
    facts: {
      distance_m: 48_000,
      distance_basis: "one_way",
      shape: "out_and_back",
    },
  });
  const conflictingPartialResult = compareRouteSourceFacts(
    repairedCatalog,
    repairedIdentity,
    conflictingPartialSource
  );
  assert.equal(conflictingPartialResult.verdict, "REVIEW");
  assert.ok(conflictingPartialResult.findings.some((finding) =>
    finding.type === "source_route_fact_conflicts" &&
    finding.reviews.some((review) =>
      review.type === "source_facts_conflict_with_standard"
    )
  ));

  const zeroGainFacts = structuredClone(facts);
  zeroGainFacts.standard_route.gain_m = 0;
  zeroGainFacts.sources[0].facts.gain_m = 0;
  const zeroGainCatalog = structuredClone(repairedCatalog);
  zeroGainCatalog.records[2].metrics.gain_m = 0;
  assert.equal(
    compareRouteSourceFacts(
      zeroGainCatalog,
      repairedIdentity,
      zeroGainFacts
    ).verdict,
    "PASS"
  );
  zeroGainCatalog.records[2].metrics.gain_m = 1_000;
  const wrongZeroGainResult = compareRouteSourceFacts(
    zeroGainCatalog,
    repairedIdentity,
    zeroGainFacts
  );
  assert.equal(wrongZeroGainResult.verdict, "FAIL");
  assert.ok(wrongZeroGainResult.routes[0].findings.includes(
    "gain_far_from_standard"
  ));
});

test("a matching-distance wrong route cannot pass", () => {
  const wrongCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan daedunsan peak 대둔산",
          names: {
            english: "Daedunsan",
            local: ["대둔산"],
            aliases: ["Daedunsan Peak"],
          },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "wrong-route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "wrong-route",
        item_name: "Wrong Traverse",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Wrong Trailhead",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts(wrongCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(result.verdict, "REVIEW");
  assert.equal(result.routes[0].action, "needs human review");
  assert.ok(result.findings.some((finding) =>
    finding.type === "active_route_source_conflicts"
  ));
});

test("one plausible route does not hide a far-longer active route", () => {
  const mixedCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan daedunsan peak 대둔산",
          names: {
            english: "Daedunsan",
            local: ["대둔산"],
            aliases: ["Daedunsan Peak"],
          },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        item_name: "Mount Daedunsan",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Daedunsan Provincial Park",
        },
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "wrong-long-route",
        item_name: "Mount Daedunsan",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 20_000,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Daedunsan Provincial Park",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts(mixedCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.routes[1].action, "supersede");
  assert.ok(result.findings.some((finding) =>
    finding.type === "active_routes_require_supersede"
  ));
});

test("wrong stored shape and gain require repair", () => {
  const wrongStatsCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan daedunsan peak 대둔산",
          names: {
            english: "Daedunsan",
            local: ["대둔산"],
            aliases: ["Daedunsan Peak"],
          },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "wrong-stats-route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "wrong-stats-route",
        item_name: "Mount Daedunsan",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 50,
          shape: "loop",
          trailhead: "Daedunsan Provincial Park",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts(wrongStatsCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.routes[0].action, "repair");
  assert.ok(result.routes[0].findings.includes("shape_differs_from_standard"));
  assert.ok(result.routes[0].findings.includes("gain_far_from_standard"));
});

test("missing searchable local names cannot pass", () => {
  const missingNamesCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan",
          names: { english: "Daedunsan" },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "standard-route",
        item_name: "Mount Daedunsan",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Daedunsan Provincial Park",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts(missingNamesCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(result.verdict, "FAIL");
  assert.ok(result.findings.some((finding) =>
    finding.type === "catalog_names_not_searchable"
  ));
});

test("incomplete public evidence reaches a terminal human-review result", () => {
  const result = compareRouteSourceFacts({
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
        },
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "unknown-route",
        item_name: "Unknown Route",
        issues: [],
        metrics: { status: "active", one_way_m: 2_000 },
      },
    ],
  }, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
  }, {
    destination_id: "peak-1",
    preferred_display_name: "Daedunsan",
    local_names: ["대둔산"],
    aliases: ["Daedunsan Peak"],
    standard_route: null,
    sources: [],
    evidence_gaps: ["no second independent public route source"],
  });
  assert.equal(result.verdict, "REVIEW");
  assert.equal(result.state, "needs_human");
  assert.equal(result.routes[0].action, "needs human review");
});

test("a stale linked identity source becomes review evidence", async () => {
  const fakeFetch = async (url) => {
    if (String(url).includes("openstreetmap")) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        entities: {
          Q5208179: {
            labels: {
              en: { language: "en", value: "Daedunsan" },
              ko: { language: "ko", value: "대둔산" },
            },
            aliases: {},
          },
        },
      }),
    };
  };
  const result = await collectDestinationIdentity(catalogAudit, fakeFetch);
  assert.equal(result.osm, null);
  assert.equal(result.source_errors.length, 1);
  assert.ok(result.findings.includes("identity_source_errors"));
  assert.equal(result.wikidata.labels.en, "Daedunsan");
});

test("unresolved active catalog warnings cannot pass", () => {
  const warningCatalog = {
    records: [
      {
        ...catalogAudit.records[0],
        severity: "INFO",
        issues: [],
        metrics: {
          ...catalogAudit.records[0].metrics,
          stored_name: "Daedunsan",
          search_name: "daedunsan daedunsan peak 대둔산",
          names: {
            english: "Daedunsan",
            local: ["대둔산"],
            aliases: ["Daedunsan Peak"],
          },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "peak-1",
        item_id: "warning-route",
        issues: [],
      },
      {
        type: "route",
        severity: "WARN",
        destination_id: "peak-1",
        item_id: "warning-route",
        item_name: "Mount Daedunsan",
        issues: ["point_jump_gt_250m"],
        metrics: {
          status: "active",
          one_way_m: 2_175,
          gain_m: 553,
          shape: "out_and_back",
          trailhead: "Daedunsan Provincial Park",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts(warningCatalog, {
    destination_id: "peak-1",
    stored_name: "Daedunsan",
    findings: [],
    known_names: ["Daedunsan", "Daedunsan Peak", "대둔산"],
  }, facts);
  assert.equal(result.verdict, "REVIEW");
  assert.equal(result.routes[0].action, "needs human review");
  assert.ok(result.routes[0].findings.includes("point_jump_gt_250m"));
  assert.ok(result.findings.some((finding) =>
    finding.type === "unresolved_catalog_reviews"
  ));
});

test("standard facts cannot mix two different source route variants", () => {
  const mixedSourceFacts = {
    destination_id: "vaalserberg",
    preferred_display_name: "Vaalserberg",
    local_names: ["Vaalserberg"],
    aliases: [],
    standard_route: {
      name: "Drielandenpunt loop",
      aliases: [],
      trailhead_name: "Bellevue flat parking area",
      distance_m: 5_100,
      distance_basis: "round_trip",
      shape: "loop",
      gain_m: 200,
      activity: "hike",
      access: "open year-round",
    },
    sources: [
      {
        publisher: "Visit Zuid-Limburg",
        url: "https://example.com/official",
        retrieved_at: "2026-08-01",
        supports: [
          "route_identity", "trailhead", "distance", "shape", "access",
        ],
        facts: {
          route_name: "Drielandenpunt route",
          trailhead_name: "Drielandenpunt",
          distance_m: 5_100,
          distance_basis: "round_trip",
          shape: "loop",
          access: "public route",
        },
      },
      {
        publisher: "AllTrails",
        url: "https://example.org/alltrails",
        retrieved_at: "2026-08-01",
        supports: [
          "route_identity", "trailhead", "distance", "shape", "gain",
          "activity",
        ],
        facts: {
          route_name: "Vaals–Drielandenpunt loop",
          trailhead_name: "Bellevue flat parking area",
          distance_m: 6_400,
          distance_basis: "round_trip",
          shape: "loop",
          gain_m: 200,
          activity: "hike",
        },
      },
    ],
  };
  const result = compareRouteSourceFacts({
    records: [
      {
        type: "identity",
        severity: "INFO",
        destination_id: "vaalserberg",
        issues: [],
        metrics: {
          stored_name: "Vaalserberg",
          search_name: "vaalserberg",
          names: { english: "Vaalserberg", local: ["Vaalserberg"] },
        },
      },
      {
        type: "selection",
        severity: "PASS",
        destination_id: "vaalserberg",
        item_id: "route",
        issues: [],
      },
      {
        type: "route",
        severity: "PASS",
        destination_id: "vaalserberg",
        item_id: "route",
        item_name: "Drielandenpunt loop",
        issues: [],
        metrics: {
          status: "active",
          one_way_m: 5_100,
          gain_m: 200,
          shape: "loop",
          trailhead: "Bellevue flat parking area",
        },
      },
    ],
  }, {
    destination_id: "vaalserberg",
    stored_name: "Vaalserberg",
    findings: [],
    known_names: ["Vaalserberg"],
  }, mixedSourceFacts);
  assert.equal(result.verdict, "REVIEW");
  assert.ok(result.findings.some((finding) =>
    finding.type === "source_route_fact_conflicts" &&
    finding.reviews.some((review) =>
      review.type === "standard_route_combines_source_variants"
    )
  ));
});
