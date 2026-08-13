import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  chooseActivationSegmentReference,
  existingSegmentReuseCheckPasses,
  insertRouteSpecificActivationSegment,
  type ExistingSegmentReuseCheck,
} from "./route-segment-reuse";

const points = [
  { lat: 47.0, lng: -121.0, ele: 900, dist: 0 },
  { lat: 47.0005, lng: -121.0005, ele: 910, dist: 67 },
];

function clientReturning(reusable: boolean): {
  client: PoolClient;
  queries: Array<{ text: string; values: unknown[] | undefined }>;
} {
  const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes("FOR UPDATE")) {
        return { rows: [{ id: "shared" }] };
      }
      return {
        rows: [
          reusable
            ? {
                profile_valid: true,
                stats_match: true,
                provenance_matches: true,
                segment_points: 2,
                slice_points: 2,
                matching_points: 2,
                endpoint_gap_m: 0,
                endpoint_z_delta_m: 0,
              }
            : {
                profile_valid: true,
                stats_match: true,
                provenance_matches: false,
                segment_points: 2,
                slice_points: 6,
                matching_points: 1,
                endpoint_gap_m: 28.255,
                endpoint_z_delta_m: 3.6,
              },
        ],
      };
    },
  } as unknown as PoolClient;
  return { client, queries };
}

test("keeps an exact compatible shared segment", async () => {
  const { client, queries } = clientReturning(true);
  let materialized = false;

  const reference = await chooseActivationSegmentReference({
    client,
    existingSegmentId: "shared",
    points,
    direction: "reverse",
    routeProvenance: '{"geometry":{"source":"osm"}}',
    createRouteSpecificSegment: async () => {
      materialized = true;
      return "new";
    },
  });

  assert.deepEqual(reference, {
    segmentId: "shared",
    direction: "reverse",
  });
  assert.equal(materialized, false);
  assert.equal(queries.length, 2);
  assert.match(queries[1].text, /candidate\.provenance IS NOT DISTINCT FROM \$4::jsonb/);
  assert.match(queries[1].text, /abs\(ST_X\(segment_points\.geom\) - ST_X\(slice_points\.geom\)\) <= 1e-9/);
  assert.match(queries[1].text, /abs\(ST_Z\(segment_points\.geom\) - ST_Z\(slice_points\.geom\)\) <= 0\.01/);
  assert.match(queries[1].text, /candidate\.stored_gain IS NOT DISTINCT FROM candidate\.computed_gain/);
  assert.equal(queries[1].values?.[2], "reverse");
});

test("materializes a Tooth-like route slice when a 30 m match is unsafe", async () => {
  const { client } = clientReturning(false);
  let materialized = 0;

  const reference = await chooseActivationSegmentReference({
    client,
    existingSegmentId: "nearby-but-different",
    points,
    direction: "reverse",
    routeProvenance: '{"geometry":{"source":"osm"}}',
    createRouteSpecificSegment: async () => {
      materialized += 1;
      return "route-specific";
    },
  });

  assert.deepEqual(reference, {
    segmentId: "route-specific",
    direction: "forward",
  });
  assert.equal(materialized, 1);
});

test("Tooth-like geometry and source differences reject reuse", () => {
  const toothLikeCheck: ExistingSegmentReuseCheck = {
    profile_valid: true,
    stats_match: true,
    provenance_matches: false,
    segment_points: 2,
    slice_points: 6,
    matching_points: 1,
    endpoint_gap_m: 28.255,
    endpoint_z_delta_m: 3.6,
  };

  assert.equal(existingSegmentReuseCheckPasses(toothLikeCheck), false);
});

test("exact reverse XYZ geometry with the same source can be reused", () => {
  const exactReverseCheck: ExistingSegmentReuseCheck = {
    profile_valid: true,
    stats_match: true,
    provenance_matches: true,
    segment_points: 6,
    slice_points: 6,
    matching_points: 6,
    endpoint_gap_m: 0,
    endpoint_z_delta_m: 0,
  };

  assert.equal(existingSegmentReuseCheckPasses(exactReverseCheck), true);
});

test("stored elevation stat drift rejects otherwise exact reuse", () => {
  const staleStatsCheck: ExistingSegmentReuseCheck = {
    profile_valid: true,
    stats_match: false,
    provenance_matches: true,
    segment_points: 6,
    slice_points: 6,
    matching_points: 6,
    endpoint_gap_m: 0,
    endpoint_z_delta_m: 0,
  };

  assert.equal(existingSegmentReuseCheckPasses(staleStatsCheck), false);
});

test("route-specific segments use the publish gate's elevation stats", async () => {
  const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows: [] };
    },
  } as unknown as PoolClient;

  const id = await insertRouteSpecificActivationSegment({
    client,
    name: "South Face candidate slice",
    points,
    distance: 67,
    routeProvenance: '{"geometry":{"source":"osm"}}',
  });

  assert.match(id, /^[A-Za-z0-9]{20}$/);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /route_elevation_stats\(geometry\.path\)/);
  assert.match(queries[0].text, /elevation_stats\.gain, elevation_stats\.loss/);
  assert.equal(queries[0].values?.[1], "South Face candidate slice");
  assert.equal(queries[0].values?.[4], 67);
});

test("does not query a standalone segment deleted during activation", async () => {
  const { client, queries } = clientReturning(true);

  const reference = await chooseActivationSegmentReference({
    client,
    existingSegmentId: "deleted-standalone",
    points,
    direction: "reverse",
    routeProvenance: null,
    forceRouteSpecific: true,
    createRouteSpecificSegment: async () => "replacement",
  });

  assert.deepEqual(reference, {
    segmentId: "replacement",
    direction: "forward",
  });
  assert.equal(queries.length, 0);
});

test("does not hide a failed reuse check", async () => {
  const client = {
    async query() {
      throw new Error("reuse check unavailable");
    },
  } as unknown as PoolClient;

  await assert.rejects(
    chooseActivationSegmentReference({
      client,
      existingSegmentId: "shared",
      points,
      direction: "forward",
      routeProvenance: null,
      createRouteSpecificSegment: async () => "replacement",
    }),
    /reuse check unavailable/
  );
});
