import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { verifyStandardRoute } from "../standard-route-verification";

const route = {
  id: "route-1",
  name: "Peak via Trail",
  owner: "peaks",
  status: "active",
  provenance_valid: true,
  point_count: 20,
  elevation_string: Buffer.from(
    Array.from({ length: 20 }, (_, index) => String(1_000 + index)).join("|")
  ).toString("base64"),
  elevation_source:
    "AWS Open Data Terrain Tiles (Mapzen Terrarium z14)",
  elevation_source_url:
    "https://registry.opendata.aws/terrain-tiles/",
  elevation_attribution: "required attribution",
  elevation_license_url:
    "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
  elevation_retrieved_at: new Date("2026-08-03T12:34:56.000Z"),
  profile_count: 20,
  profile_hash: "profile-hash-1",
  verification_fingerprint: "profile-hash-1",
  profile_has_real_range: true,
  profile_stats_match: true,
  gain: 19,
  gain_loss: 0,
  summit_count: 1,
  summit_fault_count: 0,
  summit_max_gap_meters: 1.2,
  endpoint_gap_meters: 1.2,
  final_destination_features: ["summit", "volcano"],
  shape: "out_and_back",
  segment_count: 1,
  matching_segment_count: 1,
  usable_elevation_segment_count: 1,
  ordered_segment_count: 1,
  connected_segment_pair_count: 0,
  expected_segment_pair_count: 0,
  assembled_point_count: 20,
  matching_assembly_point_count: 20,
  publish_integrity_valid: true,
  destination_ids: ["trailhead-1", "peak-1"],
  destination_features: [["trailhead"], ["summit", "volcano"]],
};

const queryable = {
  async query<T extends Record<string, unknown>>() {
    return { rows: [route as unknown as T] };
  },
};

test("verification passes only when the public route record matches Cloud SQL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(route), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await verifyStandardRoute(queryable, {
      routeId: "route-1",
      destinationId: "peak-1",
      trailheadId: "trailhead-1",
      publicBaseUrl: "https://example.test",
    });
    assert.equal(result.verdict, "PASS");
    assert.equal(
      result.public_url,
      "https://example.test/api/public/routes/route-1?elevation_fingerprint=profile-hash-1"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a malformed public array fails closed instead of crashing verification", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      ...route,
      final_destination_features: { value: "summit" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await verifyStandardRoute(queryable, {
      routeId: "route-1",
      destinationId: "peak-1",
      trailheadId: "trailhead-1",
      publicBaseUrl: "https://example.test",
    });
    assert.equal(result.verdict, "FAIL");
    assert.equal(result.gates.public_http, false);
    assert.ok(result.errors.includes("public_http"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wrong or malformed nested destination features fail public parity", async (t) => {
  const cases: Array<{ name: string; destinationFeatures: unknown }> = [
    {
      name: "missing final feature",
      destinationFeatures: [["trailhead"], ["summit"]],
    },
    {
      name: "wrong inner order",
      destinationFeatures: [["trailhead"], ["volcano", "summit"]],
    },
    {
      name: "wrong destination order",
      destinationFeatures: [["summit", "volcano"], ["trailhead"]],
    },
    {
      name: "outer value is not an array",
      destinationFeatures: { trailhead: ["trailhead"] },
    },
    {
      name: "inner value is not an array",
      destinationFeatures: ["trailhead", ["summit", "volcano"]],
    },
    {
      name: "inner feature is not a string",
      destinationFeatures: [["trailhead"], ["summit", 1]],
    },
  ];

  for (const { name, destinationFeatures } of cases) {
    await t.test(name, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            ...route,
            destination_features: destinationFeatures,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      try {
        const result = await verifyStandardRoute(queryable, {
          routeId: "route-1",
          destinationId: "peak-1",
          trailheadId: "trailhead-1",
          publicBaseUrl: "https://example.test",
        });
        assert.equal(result.gates.public_http, false);
        assert.ok(result.errors.includes("public_http"));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test("a Bierstadt-like 30.6 metre miss fails summit contact", async () => {
  const shortRoute = {
    ...route,
    summit_fault_count: 1,
    summit_max_gap_meters: 30.6,
    endpoint_gap_meters: 30.6,
    publish_integrity_valid: false,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(shortRoute), { status: 200 });
  try {
    const result = await verifyStandardRoute(
      { async query<T extends Record<string, unknown>>() { return { rows: [shortRoute as unknown as T] }; } },
      { routeId: "route-1", destinationId: "peak-1", trailheadId: "trailhead-1", publicBaseUrl: "https://example.test" }
    );
    assert.equal(result.gates.summit_contact, false);
    assert.equal(result.verdict, "FAIL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("flat or missing canonical elevation fails the elevation profile gate", async () => {
  const flatRoute = {
    ...route,
    elevation_string: null,
    profile_count: 0,
    publish_integrity_valid: false,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(flatRoute), { status: 200 });
  try {
    const result = await verifyStandardRoute(
      { async query<T extends Record<string, unknown>>() { return { rows: [flatRoute as unknown as T] }; } },
      { routeId: "route-1", destinationId: "peak-1", trailheadId: "trailhead-1", publicBaseUrl: "https://example.test" }
    );
    assert.equal(result.gates.elevation_profile, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a loop may contact its summit internally without ending there", async () => {
  const loopRoute = {
    ...route,
    shape: "loop",
    endpoint_gap_meters: 30.6,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(loopRoute), { status: 200 });
  try {
    const result = await verifyStandardRoute(
      { async query<T extends Record<string, unknown>>() { return { rows: [loopRoute as unknown as T] }; } },
      { routeId: "route-1", destinationId: "peak-1", trailheadId: "trailhead-1", publicBaseUrl: "https://example.test" }
    );
    assert.equal(result.gates.summit_contact, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("one shared route verifies each linked summit", async () => {
  const sharedRoute = {
    ...route,
    summit_count: 2,
    destination_ids: ["trailhead-1", "peak-a", "peak-b"],
    destination_features: [
      ["trailhead"],
      ["summit"],
      ["summit", "volcano"],
    ],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(sharedRoute), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const sharedQueryable = {
      async query<T extends Record<string, unknown>>() {
        return { rows: [sharedRoute as unknown as T] };
      },
    };
    for (const destinationId of ["peak-a", "peak-b"]) {
      const result = await verifyStandardRoute(sharedQueryable, {
        routeId: "route-1",
        destinationId,
        trailheadId: "trailhead-1",
        publicBaseUrl: "https://example.test",
      });
      assert.equal(result.gates.destination_order, true, destinationId);
      assert.equal(result.verdict, "PASS", destinationId);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a summit without a catalog location fails closed", async () => {
  const missingLocation = {
    ...route,
    summit_fault_count: 1,
    summit_max_gap_meters: null,
    publish_integrity_valid: false,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(missingLocation), { status: 200 });
  try {
    const result = await verifyStandardRoute(
      { async query<T extends Record<string, unknown>>() { return { rows: [missingLocation as unknown as T] }; } },
      { routeId: "route-1", destinationId: "peak-1", trailheadId: "trailhead-1", publicBaseUrl: "https://example.test" }
    );
    assert.equal(result.gates.summit_contact, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the canonical publish predicate cannot pass by matching false parity", async () => {
  const internallyInvalid = { ...route, publish_integrity_valid: false };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(internallyInvalid), { status: 200 });
  try {
    const result = await verifyStandardRoute(
      { async query<T extends Record<string, unknown>>() { return { rows: [internallyInvalid as unknown as T] }; } },
      { routeId: "route-1", destinationId: "peak-1", trailheadId: "trailhead-1", publicBaseUrl: "https://example.test" }
    );
    assert.equal(result.gates.segments, false);
    assert.equal(result.gates.public_http, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activation and public payload use the strict shared integrity contract", () => {
  const root = path.resolve(__dirname, "../../../..");
  const actions = fs.readFileSync(path.join(root, "web/src/lib/actions/routes.ts"), "utf8");
  const api = fs.readFileSync(path.join(root, "web/src/app/api/public/routes/[id]/route.ts"), "utf8");
  const wrapper = fs.readFileSync(path.join(root, ".claude/skills/peaks-standard-route-backfill/scripts/accept_pending_route_with_segments.mts"), "utf8");
  const migration = fs.readFileSync(path.join(root, "cloud-sql/migrations/20260803_route_integrity_repairs.sql"), "utf8");
  const calls = actions.match(/assertRoutePublishIntegrity\(/g) ?? [];
  assert.ok(calls.length >= 4, "helper definition plus all three activation paths");
  assert.match(actions, /peaks_route_passes_publish_integrity/);
  assert.match(actions, /settle_route_integrity_replacement/);
  assert.match(
    actions,
    /assertRoutePublishIntegrity[\s\S]+?UPDATE routes SET status = 'active'/
  );
  assert.match(
    migration,
    /WHERE route_id = old_route_id[\s\S]+?destination_id = current_destination_id[\s\S]+?state <> 'covered'/
  );
  assert.match(migration, /requeued_invalid_coverage/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION peaks_route_passes_publish_integrity/);
  assert.match(migration, /ST_DWithin\([\s\S]+?summit[\s\S]+?,\s*5\s*\)/);
  assert.match(migration, /encode_route_elevation_profile\(c\.path\)/);
  assert.match(migration, /encode_route_elevation_profile\(path\) IS NOT NULL/);
  assert.match(migration, /abs\(ST_Z\(route_points\.geom\) - ST_Z\(assembled_points\.geom\)\) <= 0\.01/);
  assert.match(api, /elevation_string/);
  assert.match(api, /elevation_source/);
  assert.match(api, /elevation_source_url/);
  assert.match(api, /elevation_attribution/);
  assert.match(api, /elevation_license_url/);
  assert.match(api, /elevation_retrieved_at/);
  assert.match(api, /profile_count/);
  assert.match(api, /profile_hash/);
  assert.match(api, /r\.gain/);
  assert.match(api, /r\.gain_loss/);
  assert.match(api, /summit_fault_count/);
  assert.match(api, /endpoint_gap_meters/);
  assert.match(api, /matching_assembly_point_count/);
  assert.match(api, /cache-control.*s-maxage=300/i);
  assert.doesNotMatch(api, /cache-control.*no-store/i);
  assert.doesNotMatch(api, /ST_AsGeoJSON|ST_AsText|\blat(?:itude)?\b|\blng\b|\blongitude\b/i);
  assert.match(wrapper, /current_link_covered/);
  assert.match(wrapper, /remaining_repair_links/);
});

test("public verification rejects a same-count wrong profile or wrong stats", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const publicRoute of [
      { ...route, elevation_string: Buffer.from("wrong|profile").toString("base64") },
      { ...route, gain: route.gain + 1 },
      { ...route, gain_loss: route.gain_loss + 1 },
    ]) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify(publicRoute), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      const result = await verifyStandardRoute(queryable, {
        routeId: "route-1",
        destinationId: "peak-1",
        trailheadId: "trailhead-1",
        publicBaseUrl: "https://example.test",
      });
      assert.equal(result.gates.public_http, false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public verification rejects wrong or missing elevation lineage", async () => {
  const originalFetch = globalThis.fetch;
  const {
    elevation_license_url: _missingLicenseUrl,
    ...missingLineage
  } = route;
  try {
    for (const publicRoute of [
      { ...route, elevation_source: "wrong source" },
      { ...route, elevation_source_url: "https://example.test/wrong" },
      { ...route, elevation_attribution: "wrong attribution" },
      {
        ...route,
        elevation_license_url: "https://example.test/wrong-license",
      },
      {
        ...route,
        elevation_retrieved_at: "2026-08-03T12:35:56.000Z",
      },
      missingLineage,
    ]) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify(publicRoute), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      const result = await verifyStandardRoute(queryable, {
        routeId: "route-1",
        destinationId: "peak-1",
        trailheadId: "trailhead-1",
        publicBaseUrl: "https://example.test",
      });
      assert.equal(result.gates.public_http, false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a constant nonzero placeholder profile fails the elevation gate", async () => {
  const placeholder = {
    ...route,
    elevation_string: Buffer.from(new Array(20).fill("1200").join("|")).toString("base64"),
    profile_has_real_range: false,
    publish_integrity_valid: false,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(placeholder), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await verifyStandardRoute(
      {
        async query<T extends Record<string, unknown>>() {
          return { rows: [placeholder as unknown as T] };
        },
      },
      {
        routeId: "route-1",
        destinationId: "peak-1",
        trailheadId: "trailhead-1",
        publicBaseUrl: "https://example.test",
      }
    );
    assert.equal(result.gates.elevation_profile, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public verification uses a profile fingerprint cache key", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (input) => {
    requested = String(input);
    return new Response(JSON.stringify(route), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await verifyStandardRoute(queryable, {
      routeId: "route-1",
      destinationId: "peak-1",
      trailheadId: "trailhead-1",
      publicBaseUrl: "https://example.test",
    });
    assert.match(requested, /elevation_fingerprint=profile-hash-1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an unrelated HTTP 200 shell cannot pass public verification", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "other-route" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await verifyStandardRoute(queryable, {
      routeId: "route-1",
      destinationId: "peak-1",
      trailheadId: "trailhead-1",
      publicBaseUrl: "https://example.test",
    });
    assert.equal(result.verdict, "FAIL");
    assert.equal(result.gates.public_http, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verification query serializes destination feature arrays as JSON", async () => {
  let queryText = "";
  let queryValues: unknown[] | undefined;
  const recordingQueryable = {
    async query<T extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queryText = text;
      queryValues = values;
      return { rows: [route as unknown as T] };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(route), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    await verifyStandardRoute(recordingQueryable, {
      routeId: "route-1",
      destinationId: "peak-1",
      trailheadId: "trailhead-1",
      publicBaseUrl: "https://example.test",
    });
    assert.match(
      queryText,
      /SELECT\s+to_jsonb\(final_destination\.features\)[\s\S]+?AS final_destination_features/
    );
    assert.match(queryText, /JSONB_AGG\(to_jsonb\(d\.features\)/);
    assert.doesNotMatch(queryText, /ARRAY_AGG\(d\.features::text\[\]/);
    assert.match(
      queryText,
      /peaks_route_passes_publish_integrity\(r\.id, \$2, 'active'\)/
    );
    assert.deepEqual(queryValues, ["route-1", "peak-1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public route query serializes final destination features as JSON", () => {
  const root = path.resolve(__dirname, "../../../..");
  const api = fs.readFileSync(
    path.join(root, "web/src/app/api/public/routes/[id]/route.ts"),
    "utf8"
  );

  assert.match(
    api,
    /SELECT\s+to_jsonb\(final_destination\.features\)[\s\S]+?AS final_destination_features/
  );
});
