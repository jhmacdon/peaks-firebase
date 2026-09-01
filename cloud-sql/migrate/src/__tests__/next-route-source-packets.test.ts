import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
  nearestOsmRouteSource,
  OsmRouteGraphSegment,
  OsmRoutePoint,
  reviewOsmRouteGeometry,
  reviewOsmRouteTopology,
} from "../osm-route-geometry";
import { canonicalJson } from "../standard-route-job-state";

interface GeometryExpectation {
  source_segment_count: number;
  source_topology_valid: boolean;
  start_connector_m: number;
  end_connector_m: number;
  start_connector_join_offset_m: number;
  end_connector_join_offset_m: number;
  core_sample_count: number;
  core_max_offset_m: number;
  core_p95_offset_m: number;
  core_coverage_pct: number;
  used_way_ids: number[];
}

interface RoutePacket {
  packet_id: string;
  packet_state: string;
  ready_for_import: boolean;
  destination_id: string;
  destination_name: string;
  trailhead_id: string;
  trailhead_name: string;
  job_id: string;
  job_state: string;
  job_blocker_code: string | null;
  job_blocker_message: string | null;
  job_last_error: string | null;
  pending_route_id: string | null;
  published_route_id: string | null;
  replacement_route_id: string | null;
  route_name: string;
  route_shape: string;
  candidate_sha256: string;
  candidate_point_count: number;
  candidate_distance_m: number;
  osm_way_ids: number[];
  osm_way_names: string[];
  source_replay_ids: string[];
  geometry_expectation: GeometryExpectation;
  current_blockers: string[];
  access_plan: {
    status: string;
    source_replay_ids: string[];
    required_access_source_url: string;
  };
  cover: { attribution: string; attribution_url: string };
  list_memberships: Array<{
    list_id: string;
    list_name: string;
    ordinal: number;
  }>;
}

interface OfficialSource {
  id: string;
  url: string;
  supported_facts: Array<{
    fact_id: string;
    paraphrase: string;
  }>;
}

interface Fixture {
  schema_version: number;
  packet_kind: string;
  route_coverage_base: Record<string, unknown>;
  source_packet_context: Record<string, unknown>;
  head_plan: Record<string, unknown>;
  mutation_guard: Record<string, boolean | number>;
  coverage: {
    current_read_only_capture: CoverageSummary;
    pull_request_198_conditional_after_independent_activation: {
      listed_destination_gain: number;
      publish_valid_listed_destinations: number;
      missing_publish_valid_route: number;
    };
    this_source_only_batch: {
      current_listed_destination_gain: number;
      target_count: number;
      list_membership_count: number;
    };
    combined_conditional_after_all_six_independent_activations: {
      listed_destination_gain_from_current: number;
      publish_valid_listed_destinations: number;
      missing_publish_valid_route: number;
    };
  };
  coverage_capture: {
    query_path: string;
    query_bytes: number;
    query_sha256: string;
    output_replay_id: string;
  };
  replay_bundle: { path: string; bytes: number; sha256: string };
  packets: RoutePacket[];
  official_sources: OfficialSource[];
  hard_exclusions: Array<{
    destination_id: string | null;
    route_id: string | null;
    name: string;
    reason: string;
  }>;
}

interface ReplayArtifact {
  id: string;
  source_url: string | null;
  fetched_at: string;
  http_status: number | null;
  source_media_type?: string;
  media_type: string;
  capture_transform: string;
  full_response_committed?: boolean;
  source_response_bytes: number;
  source_response_sha256: string;
  raw_bytes: number;
  raw_sha256: string;
  encoded_bytes: number;
  encoded_sha256: string;
  encoded_base64: string;
}

interface EvidenceEnvelope {
  schema_version: number;
  evidence_kind: string;
  source_url: string;
  fetched_at: string;
  full_response_committed: boolean;
  unrelated_content_omitted: boolean;
  republication_permission_claimed: boolean;
  fact_fragments: Array<{
    fact_id: string;
    exact_fragments: string[];
  }>;
}

interface ReplayBundle {
  schema_version: number;
  bundle_kind: string;
  encoding: string;
  deterministic_compression: string;
  raw_headers_committed: boolean;
  security_review: Record<string, unknown>;
  catalog_capture: {
    captured_at: string;
    transaction_read_only: string;
  };
  artifacts: ReplayArtifact[];
}

interface CoverageSummary {
  listed_destinations: number;
  publish_valid_listed_destinations: number;
  missing_publish_valid_route: number;
}

interface CatalogDestination {
  id: string;
  lat: number;
  lon: number;
  name: string;
  owner: string;
  features: string[];
  hero_image_present: boolean;
  hero_image_attribution: string | null;
  hero_image_attribution_url: string | null;
  cover_complete: boolean;
}

interface CatalogRoute {
  id: string;
  name: string;
  owner: string;
  status: string;
  shape: string | null;
  point_count: number;
  segment_count: number;
  destination_links: Array<{ destination_id: string; ordinal: number }>;
  provenance: Record<string, unknown> | null;
  summit_gap_m: number;
  machine_integrity_for_current_status: boolean;
}

interface CatalogJob {
  destination_id: string;
  state: string;
  trailhead_id: string;
  candidate_sha256: string;
  published_route_id: string | null;
  replacement_route_id: string | null;
  blocker_code: string | null;
  blocker_message: string | null;
  last_error: string | null;
  candidate: Record<string, unknown>;
  review: Record<string, unknown>;
}

interface CandidateArtifact {
  type: string;
  peaks_source: string;
  peaks_license: string;
  peaks_license_name: string;
  peaks_attribution: string;
  peaks_retrieval_source: string;
  peaks_retrieved_at: string;
  peaks_destination_id: string;
  peaks_trailhead_id: string;
  features: Array<{
    type: string;
    properties: {
      name: string;
      distance_m: number;
      destination_name: string;
      trailhead_name: string;
      trailhead_snap_m: number;
      summit_snap_m: number;
      osm_way_ids: number[];
      osm_way_urls: string[];
      osm_way_names: string[];
      osm_foot_access_override_way_ids: number[];
    };
    geometry: { type: string; coordinates: Array<[number, number]> };
  }>;
}

interface CatalogCapture {
  schema_version: number;
  snapshot_kind: string;
  captured_at: string;
  transaction_read_only: string;
  coverage_summary: CoverageSummary;
  target_publish_state: Array<{
    destination_id: string;
    name: string;
    current_publish_valid_route: boolean;
    publish_valid_route_ids: string[];
  }>;
  target_destinations: CatalogDestination[];
  target_list_memberships: Array<{
    destination_id: string;
    list_id: string;
    list_name: string;
    list_owner: string;
    ordinal: number;
  }>;
  target_routes: CatalogRoute[];
  target_jobs: CatalogJob[];
  candidate_artifacts: Array<{
    destination_id: string;
    candidate_sha256: string;
    candidate_artifact: CandidateArtifact;
  }>;
  hard_exclusions: Array<{
    destination_id: string;
    destination_name: string;
    route_id: string;
    route_name: string;
    owner: string;
    status: string;
    shape: string;
    point_count: number;
    machine_integrity_for_current_status: boolean;
  }>;
}

interface OsmElement {
  type: "node" | "way" | string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

interface OsmPayload {
  version: string;
  generator: string;
  elements: OsmElement[];
}

const fixturePath = resolve(
  __dirname,
  "../../../../docs/data-audits/fixtures/" +
    "abercrombie-teneriffe-bierstadt-route-source-packets-2026-09-01.json"
);
const fixtureDirectory = dirname(fixturePath);
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as Fixture;
const replayPath = join(fixtureDirectory, fixture.replay_bundle.path);
const replayFileBytes = readFileSync(replayPath);
const replayBundle = JSON.parse(replayFileBytes.toString("utf8")) as ReplayBundle;

const EXPECTED_QUERY_BYTES = 8689;
const EXPECTED_QUERY_SHA256 =
  "02dfa5791559ee42bdd0001133c9f89546ffb9edfcf3bc41cce1f48e2f84db7a";
const EXPECTED_REPLAY_BYTES = 74580;
const EXPECTED_REPLAY_SHA256 =
  "b6878e6f162958366dd94c92f7f14f84809ae47f7f1c49d37977a282afe0e1d1";
const EVIDENCE_MEDIA_TYPE = "application/vnd.peaks.source-evidence+json";
const EVIDENCE_TRANSFORM =
  "compact factual evidence envelope; unrelated page content omitted; " +
  "no republication permission claimed or needed for narrow factual excerpts; " +
  "client keys and full response not retained";

const EXPECTED_ORIGINAL_RESPONSES: Record<
  string,
  { bytes: number; sha256: string }
> = {
  "abercrombie-usfs-trail": {
    bytes: 216318,
    sha256: "e4e4e96e593c8fb18ab485fd0f969c49f586a33fd9c985ed332bba959d02ca95",
  },
  "abercrombie-usfs-trailhead": {
    bytes: 221102,
    sha256: "8701710216e7cb092ead2aaa68bc4ed21fa388603d76aec49cfb886ef28d8d2c",
  },
  "abercrombie-wta": {
    bytes: 124815,
    sha256: "5c44a07747eb8f975c01ecf45d232805bbca542d18a5a572c5607943a18c31c9",
  },
  "teneriffe-dnr": {
    bytes: 287015,
    sha256: "d91052e94f9bb765cd1e10a097edb264b46118fc842e831e501e94265ced3474",
  },
  "bierstadt-cotrex": {
    bytes: 79540,
    sha256: "57e78e54471851600e0eb5cfe12cb6b1fbef6c41e3017dd6aacfe3b2d1e7777a",
  },
  "bierstadt-clear-creek": {
    bytes: 118352,
    sha256: "36b5800c848f62bf234521098c9b4ef03ca0b8d1bac9c9a238936d0e83a5978c",
  },
  "mount-angeles-wta": {
    bytes: 124534,
    sha256: "fe9cfc2adb0ea2de915a730ea2c22b8c26aedef416ee8734f4d79a1e7914966f",
  },
};

interface ExpectedRouteBinding {
  candidate_sha256: string;
  peaks_retrieved_at: string;
  cover: { attribution: string; attribution_url: string };
  ways: Array<{ id: number; name: string }>;
}

const EXPECTED_ROUTE_BINDINGS: Record<string, ExpectedRouteBinding> = {
  abercrombie: {
    candidate_sha256:
      "099f6500c6d296814e706cb1186b580b9900063937f9afb7a3b35dfa4cf3e274",
    peaks_retrieved_at: "2026-08-13T02:37:34.259Z",
    cover: {
      attribution: "James Jacobson / Attribution",
      attribution_url:
        "https://commons.wikimedia.org/wiki/File:Abercrombie_Mountain_WA.jpg",
    },
    ways: [
      { id: 1135479102, name: "Hartbauer Creek Road" },
      { id: 820116379, name: "Abercrombie Mountain Trail" },
      { id: 6212103, name: "Abercrombie Mountain Trail" },
      { id: 721776686, name: "Flume Creek Trail" },
    ],
  },
  teneriffe: {
    candidate_sha256:
      "90db27563c1590bcb2104316325c39b41b6d5bcdf6b0a0a399e6bbb519eb0767",
    peaks_retrieved_at: "2026-08-18T06:44:15.521Z",
    cover: {
      attribution: "Ron Clausen / CC BY-SA 4.0",
      attribution_url:
        "https://commons.wikimedia.org/wiki/" +
        "File:Mount_Teneriffe_from_Middle_Fork_Snoqualmie_River.jpg",
    },
    ways: [
      { id: 503602859, name: "Mount Teneriffe Trail" },
      { id: 902148139, name: "Mount Teneriffe Trail" },
      { id: 1315866433, name: "Mount Teneriffe Trail" },
      { id: 902148138, name: "Mount Teneriffe Trail" },
      { id: 666063556, name: "Mount Teneriffe Trail" },
      { id: 1081090531, name: "Mount Teneriffe Trail" },
      { id: 1081090530, name: "Mount Teneriffe Trail" },
      { id: 1081094830, name: "Mount Teneriffe Trail" },
      { id: 1081094829, name: "Mount Teneriffe Trail" },
      { id: 317707137, name: "Mount Teneriffe Trail" },
    ],
  },
  bierstadt: {
    candidate_sha256:
      "2f00bb3aa7b113256e18bc1eae5ccacefd29638cc7dd385f6176b7cb604dd8ae",
    peaks_retrieved_at: "2026-08-05T20:18:58.313Z",
    cover: {
      attribution:
        "David Herrera from Albuquerque, NM, Bernalillo / CC BY 2.0",
      attribution_url:
        "https://commons.wikimedia.org/wiki/" +
        "File:Mount_Bierstadt,_Sawtooth,_Mount_Evans_(10579983656).jpg",
    },
    ways: [
      { id: 218153569, name: "Mount Bierstadt Trail" },
      { id: 831383625, name: "Mount Bierstadt Trail" },
      { id: 831383624, name: "Mount Bierstadt Trail" },
    ],
  },
};

const EXPECTED_ACCESS_PLANS: Record<
  string,
  {
    source_replay_ids: string[];
    required_access_source_url: string;
  }
> = {
  abercrombie: {
    source_replay_ids: [
      "abercrombie-usfs-trail",
      "abercrombie-usfs-trailhead",
      "abercrombie-wta",
    ],
    required_access_source_url:
      "https://www.fs.usda.gov/r06/colville/recreation/abercrombie-trailhead",
  },
  teneriffe: {
    source_replay_ids: ["teneriffe-dnr"],
    required_access_source_url:
      "https://dnr.wa.gov/natural-areas/natural-resources-conservation-areas/" +
      "mount-si-natural-resources-conservation-area",
  },
  bierstadt: {
    source_replay_ids: ["bierstadt-cotrex", "bierstadt-clear-creek"],
    required_access_source_url:
      "https://clearcreekcounty.us/689/Guanella-Pass-Information",
  },
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function replayArtifact(id: string): ReplayArtifact {
  const value = replayBundle.artifacts.find((entry) => entry.id === id);
  assert.ok(value, `missing replay ${id}`);
  return value;
}

function replayBytes(id: string): Buffer {
  const value = replayArtifact(id);
  const encoded = Buffer.from(value.encoded_base64, "base64");
  assert.equal(encoded.length, value.encoded_bytes, `${id} gzip byte count`);
  assert.equal(sha256(encoded), value.encoded_sha256, `${id} gzip hash`);
  assert.ok(encoded.length >= 18, `${id} complete gzip stream`);
  assert.deepEqual(
    encoded.subarray(0, 4),
    Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
    `${id} gzip header without optional fields`
  );
  assert.equal(encoded.readUInt32LE(4), 0, `${id} zero gzip mtime`);
  const raw = gunzipSync(encoded);
  assert.equal(raw.length, value.raw_bytes, `${id} raw byte count`);
  assert.equal(sha256(raw), value.raw_sha256, `${id} raw hash`);
  return raw;
}

function jsonReplay<T>(id: string): T {
  return JSON.parse(replayBytes(id).toString("utf8")) as T;
}

function packet(id: string): RoutePacket {
  const value = fixture.packets.find((entry) => entry.packet_id === id);
  assert.ok(value, `missing packet ${id}`);
  return value;
}

function catalog(): CatalogCapture {
  return jsonReplay<CatalogCapture>(fixture.coverage_capture.output_replay_id);
}

function assertApprox(
  actual: number,
  expected: number,
  tolerance: number,
  label: string
): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} differs from ${expected}`
  );
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function sourceSegments(routePacket: RoutePacket): {
  segments: OsmRouteGraphSegment[];
  tagsByWay: Map<number, Record<string, string>>;
} {
  const segments: OsmRouteGraphSegment[] = [];
  const tagsByWay = new Map<number, Record<string, string>>();
  assert.equal(routePacket.source_replay_ids.length, routePacket.osm_way_ids.length);
  for (const [index, wayId] of routePacket.osm_way_ids.entries()) {
    const replayId = routePacket.source_replay_ids[index];
    const replay = replayArtifact(replayId);
    assert.equal(
      replay.source_url,
      `https://api.openstreetmap.org/api/0.6/way/${wayId}/full.json`
    );
    assert.equal(replay.capture_transform, "none");
    const payload = jsonReplay<OsmPayload>(replayId);
    const nodes = new Map<number, OsmRoutePoint>();
    for (const element of payload.elements) {
      if (
        element.type === "node" &&
        Number.isFinite(element.lat) &&
        Number.isFinite(element.lon)
      ) {
        nodes.set(element.id, { lat: element.lat!, lng: element.lon! });
      }
    }
    const way = payload.elements.find(
      (element) => element.type === "way" && element.id === wayId
    );
    assert.ok(way?.nodes, `missing OSM way ${wayId}`);
    tagsByWay.set(wayId, way.tags ?? {});
    for (let nodeIndex = 0; nodeIndex < way.nodes.length - 1; nodeIndex += 1) {
      const startNodeId = way.nodes[nodeIndex];
      const endNodeId = way.nodes[nodeIndex + 1];
      const start = nodes.get(startNodeId);
      const end = nodes.get(endNodeId);
      assert.ok(start, `missing OSM node ${startNodeId}`);
      assert.ok(end, `missing OSM node ${endNodeId}`);
      segments.push({ wayId, startNodeId, endNodeId, start, end });
    }
  }
  return { segments, tagsByWay };
}

test("the batch stays source-only and reports current, #198, and combined coverage", () => {
  assert.equal(fixture.schema_version, 1);
  assert.equal(fixture.packet_kind, "source_only_next_route_batch");
  assert.deepEqual(fixture.route_coverage_base, {
    pull_request: 191,
    commit: "848fabe210b98c8ed4aeeb2e48906a212ef1a1fa",
    branch: "codex/maintain-active-route-cover-invariant-20260901",
  });
  assert.deepEqual(fixture.source_packet_context, {
    pull_request: 198,
    commit: "5ce1931c2589be04a915e75e7325908142caff62",
    branch: "codex/add-pilchuck-grays-torreys-route-source-packets-20260901",
  });
  assert.equal(
    fixture.head_plan.current_branch,
    "codex/add-abercrombie-teneriffe-bierstadt-route-packets-20260901"
  );
  assert.equal(
    fixture.head_plan.current_base_commit,
    "5ce1931c2589be04a915e75e7325908142caff62"
  );

  const guard = fixture.mutation_guard;
  assert.equal(guard.source_only, true);
  assert.equal(guard.ready_for_import, false);
  assert.equal(guard.has_executable_apply_path, false);
  for (const key of [
    "writes_database",
    "queues_jobs",
    "runs_route_workers",
    "imports_routes",
    "requeues_routes",
    "reviews_routes",
    "approves_routes",
    "activates_routes",
  ]) {
    assert.equal(guard[key], false, `${key} must stay false`);
  }
  assert.equal(guard.current_listed_destination_gain, 0);
  assert.equal(guard.later_independent_review_and_activation_required, true);
  assert.equal(fixture.packets.length, 3);
  assert.ok(fixture.packets.every(({ ready_for_import }) => !ready_for_import));
  assert.ok(
    fixture.packets.every(({ route_shape }) => route_shape === "out_and_back")
  );

  const current = fixture.coverage.current_read_only_capture;
  assert.deepEqual(current, {
    listed_destinations: 1596,
    publish_valid_listed_destinations: 67,
    missing_publish_valid_route: 1529,
  });
  const pr198 =
    fixture.coverage.pull_request_198_conditional_after_independent_activation;
  assert.deepEqual(pr198, {
    listed_destination_gain: 3,
    publish_valid_listed_destinations: 70,
    missing_publish_valid_route: 1526,
  });
  assert.deepEqual(fixture.coverage.this_source_only_batch, {
    current_listed_destination_gain: 0,
    target_count: 3,
    list_membership_count: 4,
  });
  const combined =
    fixture.coverage.combined_conditional_after_all_six_independent_activations;
  assert.deepEqual(combined, {
    listed_destination_gain_from_current: 6,
    publish_valid_listed_destinations: 73,
    missing_publish_valid_route: 1523,
  });
  assert.equal(
    current.publish_valid_listed_destinations + pr198.listed_destination_gain,
    pr198.publish_valid_listed_destinations
  );
  assert.equal(
    current.publish_valid_listed_destinations +
      combined.listed_destination_gain_from_current,
    combined.publish_valid_listed_destinations
  );
  assert.equal(
    fixture.packets.flatMap(({ list_memberships }) => list_memberships).length,
    4
  );
});

test("the SQL and catalog replay prove one forced read-only capture", () => {
  const query = readFileSync(
    join(fixtureDirectory, fixture.coverage_capture.query_path)
  );
  assert.equal(fixture.coverage_capture.query_bytes, EXPECTED_QUERY_BYTES);
  assert.equal(fixture.coverage_capture.query_sha256, EXPECTED_QUERY_SHA256);
  assert.equal(query.length, EXPECTED_QUERY_BYTES);
  assert.equal(sha256(query), EXPECTED_QUERY_SHA256);
  assert.equal(query.length, fixture.coverage_capture.query_bytes);
  assert.equal(sha256(query), fixture.coverage_capture.query_sha256);
  const queryText = query.toString("utf8");
  assert.match(queryText, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
  assert.match(queryText, /CURRENT_SETTING\('transaction_read_only'\)/);
  assert.match(queryText, /peaks_route_passes_publish_integrity\(/);
  assert.match(queryText, /hero_image_present/);
  assert.match(queryText, /cover_complete/);
  assert.match(queryText, /ROLLBACK;/);
  assert.doesNotMatch(
    queryText,
    /^\s*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/im
  );
  for (const routePacket of fixture.packets) {
    assert.ok(queryText.includes(`'${routePacket.destination_id}'::text`));
  }
  assert.ok(queryText.includes("'jCNuGRP8FNyO8h4QuGIg'::text"));

  const proof = catalog();
  assert.equal(proof.schema_version, 1);
  assert.equal(proof.snapshot_kind, "next_route_source_packets_read_only_capture");
  assert.equal(proof.transaction_read_only, "on");
  assert.equal(proof.captured_at, replayBundle.catalog_capture.captured_at);
  assert.equal(replayBundle.catalog_capture.transaction_read_only, "on");
  assert.deepEqual(proof.coverage_summary, fixture.coverage.current_read_only_capture);
  assert.equal(proof.target_publish_state.length, 3);
  assert.ok(
    proof.target_publish_state.every(
      ({ current_publish_valid_route, publish_valid_route_ids }) =>
        !current_publish_valid_route && publish_valid_route_ids.length === 0
    )
  );
  assert.equal(proof.target_destinations.length, 6);
  assert.equal(proof.target_list_memberships.length, 4);
  assert.equal(proof.target_jobs.length, 3);
  assert.equal(proof.candidate_artifacts.length, 3);
});

test("every inline gzip replay decodes, hashes, and stays free of secret material", () => {
  assert.equal(fixture.replay_bundle.bytes, EXPECTED_REPLAY_BYTES);
  assert.equal(fixture.replay_bundle.sha256, EXPECTED_REPLAY_SHA256);
  assert.equal(replayFileBytes.length, EXPECTED_REPLAY_BYTES);
  assert.equal(sha256(replayFileBytes), EXPECTED_REPLAY_SHA256);
  assert.equal(replayFileBytes.length, fixture.replay_bundle.bytes);
  assert.equal(sha256(replayFileBytes), fixture.replay_bundle.sha256);
  assert.equal(replayBundle.schema_version, 1);
  assert.equal(replayBundle.bundle_kind, "read_only_route_source_replays");
  assert.equal(replayBundle.encoding, "base64-encoded deterministic gzip");
  assert.equal(replayBundle.raw_headers_committed, false);
  assert.deepEqual(replayBundle.security_review, {
    raw_database_fields_omitted: [
      "lease_owner",
      "lease_token",
      "lease_expires_at",
      "candidate_path",
      "hero_image",
    ],
    official_html_transform:
      "Only compact factual-evidence envelopes are committed. Full pages, " +
      "scripts, styles, client keys, and unrelated content are omitted. No " +
      "republication permission is claimed or needed for the narrow factual " +
      "excerpts.",
    full_official_responses_committed: false,
  });
  assert.equal(replayBundle.artifacts.length, 25);
  assert.equal(
    new Set(replayBundle.artifacts.map(({ id }) => id)).size,
    replayBundle.artifacts.length
  );
  assert.deepEqual(
    replayBundle.artifacts
      .filter(({ full_response_committed }) => full_response_committed === false)
      .map(({ id }) => id)
      .sort(),
    Object.keys(EXPECTED_ORIGINAL_RESPONSES).sort()
  );

  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bASIA[0-9A-Z]{16}\b/,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\bBearer\s+[A-Za-z0-9._~-]{20,}/i,
    /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
    /\bpk\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  ];
  for (const entry of replayBundle.artifacts) {
    assert.match(entry.fetched_at, /^2026-09-01T/);
    const raw = replayBytes(entry.id);
    const text = raw.toString("utf8");
    for (const pattern of secretPatterns) {
      assert.doesNotMatch(text, pattern, `${entry.id} must not contain secrets`);
    }
    if (entry.capture_transform === "none") {
      assert.equal(entry.source_response_bytes, entry.raw_bytes);
      assert.equal(entry.source_response_sha256, entry.raw_sha256);
    } else {
      const expectedOriginal = EXPECTED_ORIGINAL_RESPONSES[entry.id];
      assert.ok(expectedOriginal, `${entry.id} original response must be pinned`);
      assert.equal(entry.source_response_bytes, expectedOriginal.bytes);
      assert.equal(entry.source_response_sha256, expectedOriginal.sha256);
      assert.equal(entry.source_media_type, "text/html");
      assert.equal(entry.media_type, EVIDENCE_MEDIA_TYPE);
      assert.equal(entry.capture_transform, EVIDENCE_TRANSFORM);
      assert.equal(entry.full_response_committed, false);
      assert.ok(entry.raw_bytes < 1024, `${entry.id} envelope must stay compact`);
      assert.ok(entry.source_response_bytes > entry.raw_bytes);

      const evidence = JSON.parse(text) as EvidenceEnvelope;
      assert.equal(evidence.schema_version, 1);
      assert.equal(evidence.evidence_kind, "compact_factual_excerpt");
      assert.equal(evidence.source_url, entry.source_url);
      assert.equal(evidence.fetched_at, entry.fetched_at);
      assert.equal(evidence.full_response_committed, false);
      assert.equal(evidence.unrelated_content_omitted, true);
      assert.equal(evidence.republication_permission_claimed, false);
      assert.doesNotMatch(text, /<(?:html|body|script|style)\b/i);

      const source = fixture.official_sources.find(({ id }) => id === entry.id);
      assert.ok(source, `${entry.id} must have a fact manifest`);
      assert.deepEqual(
        evidence.fact_fragments.map(({ fact_id }) => fact_id),
        source.supported_facts.map(({ fact_id }) => fact_id)
      );
      const fragments = evidence.fact_fragments.flatMap(
        ({ exact_fragments }) => exact_fragments
      );
      assert.ok(fragments.every((fragment) => fragment.trim().length > 0));
      assert.equal(new Set(fragments).size, fragments.length);
      const quotedWordCount = fragments.reduce(
        (count, fragment) => count + (fragment.match(/\S+/g)?.length ?? 0),
        0
      );
      assert.ok(
        quotedWordCount <= 25,
        `${entry.id} has ${quotedWordCount} quoted source words`
      );
      assert.ok(
        source.supported_facts.every(
          ({ paraphrase }) =>
            paraphrase.trim().length > 0 && !fragments.includes(paraphrase)
        )
      );
    }
  }
});

test("candidate hashes, route bindings, cover credit, and four memberships replay", () => {
  const proof = catalog();
  const summitIds = new Set(fixture.packets.map(({ destination_id }) => destination_id));
  const capturedSummits = proof.target_destinations.filter(({ id }) =>
    summitIds.has(id)
  );
  assert.equal(capturedSummits.length, 3);
  for (const summit of capturedSummits) {
    assert.equal(summit.hero_image_present, true, `${summit.name} image`);
    assert.equal(summit.cover_complete, true, `${summit.name} complete cover`);
    assert.ok(summit.hero_image_attribution?.trim());
    assert.match(summit.hero_image_attribution_url ?? "", /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  }

  for (const routePacket of fixture.packets) {
    const expected = EXPECTED_ROUTE_BINDINGS[routePacket.packet_id];
    assert.ok(expected, `missing route binding ${routePacket.packet_id}`);
    assert.equal(routePacket.candidate_sha256, expected.candidate_sha256);
    assert.deepEqual(routePacket.cover, expected.cover);

    const job = proof.target_jobs.find(
      ({ destination_id }) => destination_id === routePacket.job_id
    );
    assert.ok(job, `missing job ${routePacket.job_id}`);
    assert.equal(job.destination_id, routePacket.destination_id);
    assert.equal(job.state, routePacket.job_state);
    assert.equal(job.trailhead_id, routePacket.trailhead_id);
    assert.equal(job.candidate_sha256, routePacket.candidate_sha256);
    assert.equal(job.published_route_id, routePacket.published_route_id);
    assert.equal(job.replacement_route_id, routePacket.replacement_route_id);
    assert.equal(job.blocker_code, routePacket.job_blocker_code);
    assert.equal(job.blocker_message, routePacket.job_blocker_message);
    assert.equal(job.last_error, routePacket.job_last_error);

    const saved = proof.candidate_artifacts.find(
      ({ destination_id }) => destination_id === routePacket.destination_id
    );
    assert.ok(saved, `missing candidate ${routePacket.destination_id}`);
    assert.equal(saved.candidate_sha256, routePacket.candidate_sha256);
    assert.equal(
      sha256(canonicalJson(saved.candidate_artifact)),
      routePacket.candidate_sha256
    );
    const artifact = saved.candidate_artifact;
    assert.equal(artifact.type, "FeatureCollection");
    assert.equal(artifact.peaks_destination_id, routePacket.destination_id);
    assert.equal(artifact.peaks_trailhead_id, routePacket.trailhead_id);
    assert.equal(artifact.peaks_source, "https://www.openstreetmap.org/");
    assert.equal(
      artifact.peaks_license,
      "https://opendatacommons.org/licenses/odbl/1-0/"
    );
    assert.equal(
      artifact.peaks_license_name,
      "Open Data Commons Open Database License (ODbL) 1.0"
    );
    assert.equal(artifact.peaks_attribution, "© OpenStreetMap contributors");
    assert.equal(
      artifact.peaks_retrieval_source,
      "https://api.openstreetmap.org/api/0.6"
    );
    assert.equal(artifact.peaks_retrieved_at, expected.peaks_retrieved_at);
    assert.equal(artifact.features.length, 1);
    const feature = artifact.features[0];
    assert.equal(feature.geometry.type, "LineString");
    assert.equal(feature.geometry.coordinates.length, routePacket.candidate_point_count);
    assert.equal(feature.properties.distance_m, routePacket.candidate_distance_m);
    assert.equal(feature.properties.destination_name, routePacket.destination_name);
    assert.equal(feature.properties.trailhead_name, routePacket.trailhead_name);
    assert.deepEqual(
      feature.properties.osm_way_ids,
      expected.ways.map(({ id }) => id)
    );
    assert.deepEqual(routePacket.osm_way_ids, expected.ways.map(({ id }) => id));
    assert.deepEqual(
      feature.properties.osm_way_urls,
      expected.ways.map(({ id }) => `https://www.openstreetmap.org/way/${id}`)
    );
    assert.deepEqual(
      feature.properties.osm_way_names,
      [...new Set(expected.ways.map(({ name }) => name))]
    );
    assert.deepEqual(routePacket.osm_way_names, [
      ...new Set(expected.ways.map(({ name }) => name)),
    ]);
    assert.deepEqual(feature.properties.osm_foot_access_override_way_ids, []);

    const trailhead = proof.target_destinations.find(
      ({ id }) => id === routePacket.trailhead_id
    );
    const summit = proof.target_destinations.find(
      ({ id }) => id === routePacket.destination_id
    );
    assert.ok(trailhead);
    assert.ok(summit);
    assert.deepEqual(feature.geometry.coordinates[0], [trailhead.lon, trailhead.lat]);
    assert.deepEqual(feature.geometry.coordinates.at(-1), [summit.lon, summit.lat]);

    const cover = summit;
    assert.equal(cover.hero_image_attribution, expected.cover.attribution);
    assert.equal(
      cover.hero_image_attribution_url,
      expected.cover.attribution_url
    );

    const capturedMemberships = proof.target_list_memberships
      .filter(({ destination_id }) => destination_id === routePacket.destination_id)
      .map(({ list_id, list_name, list_owner, ordinal }) => ({
        list_id,
        list_name,
        list_owner,
        ordinal,
      }));
    assert.deepEqual(
      capturedMemberships,
      routePacket.list_memberships.map((membership) => ({
        ...membership,
        list_owner: "peaks",
      }))
    );

    if (routePacket.pending_route_id) {
      const pending = proof.target_routes.find(
        ({ id }) => id === routePacket.pending_route_id
      );
      assert.ok(pending, `missing pending route ${routePacket.pending_route_id}`);
      assert.equal(pending.status, "pending");
      assert.equal(pending.owner, "peaks");
      assert.equal(pending.shape, "out_and_back");
      assert.equal(pending.point_count, routePacket.candidate_point_count);
      assert.equal(pending.segment_count, 1);
      assert.equal(pending.summit_gap_m, 0);
      assert.equal(pending.machine_integrity_for_current_status, true);
      assert.deepEqual(pending.destination_links, [
        { destination_id: routePacket.trailhead_id, ordinal: 0 },
        { destination_id: routePacket.destination_id, ordinal: 1 },
      ]);
      assert.deepEqual(
        pending.provenance?.osm_way_ids,
        routePacket.osm_way_ids
      );
    } else {
      assert.equal(routePacket.packet_id, "abercrombie");
      const stale = proof.target_routes.find(
        ({ id }) => id === routePacket.replacement_route_id
      );
      assert.ok(stale);
      assert.equal(stale.status, "superseded");
      assert.equal(stale.machine_integrity_for_current_status, false);
    }
  }
});

test("current OSM replays pass the real geometry and nontechnical source gates", () => {
  const proof = catalog();
  for (const routePacket of fixture.packets) {
    const expected = EXPECTED_ROUTE_BINDINGS[routePacket.packet_id];
    assert.ok(expected, `missing route binding ${routePacket.packet_id}`);
    const saved = proof.candidate_artifacts.find(
      ({ destination_id }) => destination_id === routePacket.destination_id
    );
    assert.ok(saved);
    const points = saved.candidate_artifact.features[0].geometry.coordinates.map(
      ([lng, lat]) => ({ lat, lng })
    );
    const { segments, tagsByWay } = sourceSegments(routePacket);
    const expectation = routePacket.geometry_expectation;
    assert.equal(segments.length, expectation.source_segment_count);

    const geometry = reviewOsmRouteGeometry(points, segments);
    const topology = reviewOsmRouteTopology(points, segments);
    assert.equal(topology.valid, expectation.source_topology_valid);
    assert.equal(topology.valid, true);
    assertApprox(
      geometry.startConnectorM,
      expectation.start_connector_m,
      1e-6,
      `${routePacket.packet_id} start connector`
    );
    assertApprox(
      geometry.endConnectorM,
      expectation.end_connector_m,
      1e-6,
      `${routePacket.packet_id} end connector`
    );
    assertApprox(
      geometry.startConnectorJoinOffsetM,
      expectation.start_connector_join_offset_m,
      1e-6,
      `${routePacket.packet_id} start join`
    );
    assertApprox(
      geometry.endConnectorJoinOffsetM,
      expectation.end_connector_join_offset_m,
      1e-6,
      `${routePacket.packet_id} end join`
    );
    assert.equal(geometry.coreSamples.length, expectation.core_sample_count);

    const offsets = geometry.coreSamples.map(
      (point) => nearestOsmRouteSource(point, segments).distance
    );
    const maximum = Math.max(...offsets);
    const p95 = percentile(offsets, 0.95);
    const coverage =
      (offsets.filter((offset) => offset <= 3).length / offsets.length) * 100;
    assertApprox(maximum, expectation.core_max_offset_m, 1e-6, "core max");
    assertApprox(p95, expectation.core_p95_offset_m, 1e-6, "core p95");
    assertApprox(coverage, expectation.core_coverage_pct, 1e-9, "coverage");
    assert.ok(geometry.startConnectorM <= 125);
    assert.ok(geometry.endConnectorM <= 125);
    assert.ok(geometry.startConnectorJoinOffsetM <= 5);
    assert.ok(geometry.endConnectorJoinOffsetM <= 5);
    assert.ok(maximum <= 5);
    assert.ok(p95 <= 2);
    assert.ok(coverage >= 99);

    const usedWayIds = routePacket.osm_way_ids.filter((wayId) =>
      geometry.coreSamples.some(
        (point) =>
          nearestOsmRouteSource(
            point,
            segments.filter((segment) => segment.wayId === wayId)
          ).distance <= 5
      )
    );
    assert.deepEqual(usedWayIds, expectation.used_way_ids);
    assert.deepEqual(usedWayIds, routePacket.osm_way_ids);

    for (const wayId of routePacket.osm_way_ids) {
      const tags = tagsByWay.get(wayId);
      assert.ok(tags);
      const expectedWay = expected.ways.find(({ id }) => id === wayId);
      assert.ok(expectedWay, `unexpected OSM way ${wayId}`);
      assert.equal(tags.name, expectedWay.name);
      assert.ok(
        tags.highway === "path" || tags.highway === "track",
        `${wayId} must be a walking path or track`
      );
      assert.notEqual(tags.foot, "no");
      assert.notEqual(tags.foot, "private");
      assert.ok(
        tags.sac_scale === undefined || tags.sac_scale === "mountain_hiking",
        `${wayId} must not cite an alpine or climbing line`
      );
    }
  }
});

test("official evidence binds every access source and keeps every packet dry", () => {
  const proof = catalog();
  for (const source of fixture.official_sources) {
    const replay = replayArtifact(source.id);
    assert.equal(replay.source_url, source.url);
    assert.equal(replay.http_status, 200);
    assert.equal(replay.source_media_type, "text/html");
    assert.equal(replay.media_type, EVIDENCE_MEDIA_TYPE);
  }

  for (const routePacket of fixture.packets) {
    const expected = EXPECTED_ACCESS_PLANS[routePacket.packet_id];
    assert.ok(expected, `missing access plan ${routePacket.packet_id}`);
    assert.deepEqual(routePacket.access_plan.source_replay_ids, expected.source_replay_ids);
    assert.equal(
      routePacket.access_plan.required_access_source_url,
      expected.required_access_source_url
    );
    assert.ok(
      expected.source_replay_ids.some(
        (id) => replayArtifact(id).source_url === expected.required_access_source_url
      ),
      `${routePacket.packet_id} required URL must name a bound replay`
    );
    for (const replayId of expected.source_replay_ids) {
      const source = fixture.official_sources.find(({ id }) => id === replayId);
      assert.ok(source, `${replayId} must be in the official source manifest`);
      assert.equal(replayArtifact(replayId).source_url, source.url);
    }
  }

  const aber = packet("abercrombie");
  assert.equal(aber.access_plan.status, "open");
  assert.ok(aber.current_blockers.some((value) => value.includes("superseded")));
  const teneriffe = packet("teneriffe");
  assert.equal(teneriffe.access_plan.status, "open");
  const teneriffeJob = proof.target_jobs.find(
    ({ destination_id }) => destination_id === teneriffe.destination_id
  );
  assert.ok(teneriffeJob);
  assert.equal(teneriffeJob.blocker_code, "official_access_evidence_missing");
  const bierstadt = packet("bierstadt");
  assert.equal(bierstadt.access_plan.status, "seasonal");
  const bierstadtJob = proof.target_jobs.find(
    ({ destination_id }) => destination_id === bierstadt.destination_id
  );
  assert.ok(bierstadtJob);
  assert.equal(bierstadtJob.blocker_code, "access-evidence");
  assert.deepEqual(bierstadtJob.candidate.access, {
    status: "permit_required",
    source_url:
      "https://www.cmc.org/education-adventure/trips/routes-places/mt-bierstadt",
  });
  assert.notEqual(bierstadt.access_plan.status, "permit_required");
  assert.ok(fixture.packets.every(({ ready_for_import }) => !ready_for_import));
});

test("Mount Angeles is hard-rejected even though its pending route passes machine integrity", () => {
  const proof = catalog();
  const rejection = fixture.hard_exclusions.find(
    ({ route_id }) => route_id === "jCNuGRP8FNyO8h4QuGIg"
  );
  assert.deepEqual(rejection, {
    destination_id: "7nJmKhZy74iFjKUJqtkx",
    route_id: "jCNuGRP8FNyO8h4QuGIg",
    name: "Mount Angeles via Switchback Trail",
    reason:
      "The cited WTA page says the summit requires an experienced class 3 scramble and warns of a rough fall.",
  });
  assert.deepEqual(proof.hard_exclusions, [
    {
      owner: "peaks",
      shape: "out_and_back",
      status: "pending",
      route_id: "jCNuGRP8FNyO8h4QuGIg",
      route_name: "Mount Angeles via Switchback Trail",
      point_count: 215,
      destination_id: "7nJmKhZy74iFjKUJqtkx",
      destination_name: "Mount Angeles",
      machine_integrity_for_current_status: true,
    },
  ]);
  const angelesEvidence = jsonReplay<EvidenceEnvelope>("mount-angeles-wta");
  assert.deepEqual(
    angelesEvidence.fact_fragments.map(({ fact_id }) => fact_id),
    ["scramble_identity", "required_experience", "fall_hazard"]
  );
  assert.ok(!fixture.packets.some(({ destination_id }) => destination_id === rejection.destination_id));

  const requiredInheritedExclusions = [
    "High Knott",
    "Williamson's Monument",
    "Pillar Rock exposed climb",
    "DoBIH firing-range hills 2711, 2713, 2735, and 2877",
    "Any technical or exposed line",
  ];
  for (const name of requiredInheritedExclusions) {
    assert.ok(fixture.hard_exclusions.some((entry) => entry.name === name));
  }
});
