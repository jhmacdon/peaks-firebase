import assert from "node:assert/strict";
import test from "node:test";
import { verifyStandardRoute } from "../standard-route-verification";

const route = {
  id: "route-1",
  name: "Peak via Trail",
  owner: "peaks",
  status: "active",
  provenance_valid: true,
  point_count: 20,
  segment_count: 1,
  matching_segment_count: 1,
  destination_ids: ["trailhead-1", "peak-1"],
  destination_features: [["trailhead"], ["summit"]],
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
    assert.equal(result.public_url, "https://example.test/api/public/routes/route-1");
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

test("verification query aggregates variable destination features as JSON", async () => {
  let queryText = "";
  const recordingQueryable = {
    async query<T extends Record<string, unknown>>(text: string) {
      queryText = text;
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
    assert.match(queryText, /JSONB_AGG\(to_jsonb\(d\.features\)/);
    assert.doesNotMatch(queryText, /ARRAY_AGG\(d\.features::text\[\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
