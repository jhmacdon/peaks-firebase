import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
  Coordinate,
  haversineMeters,
  OfficialNetworkPath,
  reviewOfficialRouteGeometry,
} from "../official-route-geometry";
import {
  assertExactUsgsTrailObjectIds,
  buildUsgsTrailsQueryUrl,
  parseUsgsTrailsQueryUrl,
} from "../usgs-trails-source";

interface ReplayArtifact {
  id: string;
  path: string;
  fetched_at: string;
  http_status: number | null;
  raw_bytes: number;
  raw_sha256: string;
  encoded_bytes: number;
  encoded_sha256: string;
}

interface SupportedClaim {
  claim: string;
  exact_text: string;
}

interface UsgsFeaturePin {
  object_id: number;
  name: string;
  coordinate_count: number;
  coordinates_sha256: string;
  first_lon_lat: Coordinate;
  last_lon_lat: Coordinate;
}

interface RoutePlanPacket {
  packet_id: string;
  packet_state: string;
  route_id: string | null;
  route_name: string;
  route_shape: "out_and_back" | "loop" | "lollipop";
  ready_for_import: boolean;
  expected_listed_destination_gain_after_activation: number;
  destination_links: [string, string];
  saved_candidate_sha256?: string;
  prior_geometry_review_replayable?: boolean;
  geometry_plan?: {
    source_replay_id: string;
    source_url: string;
    traversal: Array<{
      object_id: number;
      direction: "forward" | "reverse";
    }>;
    path_point_count: number;
    path_coordinates_sha256: string;
    zero_length_source_join_segment_indexes: number[];
    path_distance_m: number;
    strict_trailhead_contact_m: number;
    strict_summit_contact_m: number;
    physical_start_connector_m: number;
    physical_summit_connector_m: number;
  };
  real_reviewer_expectation?: {
    function: string;
    internal_connector_segment_indexes: number[];
    source_topology_valid: boolean;
    used_object_ids: number[];
    unused_object_ids: number[];
    start_connector_m: number;
    end_connector_m: number;
    start_connector_join_offset_m: number;
    end_connector_join_offset_m: number;
    core_max_offset_m: number;
    core_p95_offset_m: number;
    core_coverage_pct: number;
  };
  saved_job_condition?: {
    exact_error: string;
    classification: string;
    blocks_source_packet: boolean;
    requires_fresh_publish_dry_run: boolean;
  };
}

interface Fixture {
  schema_version: number;
  packet_kind: string;
  base_ref: { pull_request: number; commit: string; branch: string };
  mutation_guard: Record<string, boolean | number>;
  coverage: {
    base_ref_listed_destinations: number;
    base_ref_publish_valid_listed_destinations: number;
    base_ref_missing_publish_valid_route: number;
    possible_only_after_independent_review_and_activation: {
      listed_destination_gain: number;
      list_membership_gain: number;
      publish_valid_listed_destinations: number;
      missing_publish_valid_route: number;
      destination_ids: string[];
    };
  };
  coverage_capture: {
    query_path: string;
    query_bytes: number;
    query_sha256: string;
    output_replay_id: string;
  };
  replay_bundle: {
    root: string;
    encoding: string;
    raw_headers_committed: boolean;
    security_review: {
      checked_for_credentials_and_session_material: boolean;
      catalog_fields_omitted: string[];
    };
    artifacts: ReplayArtifact[];
  };
  official_sources: {
    pilchuck_osm: {
      replay_id: string;
      expected_way: Record<string, unknown> & {
        id: number;
        node_count: number;
        coordinates_sha256: string;
      };
    };
    pilchuck_usfs_trail: {
      replay_id: string;
      expected_feature: Record<string, unknown> & {
        coordinate_count: number;
        coordinates_sha256: string;
      };
    };
    pilchuck_retired_brochure: {
      replay_id: string;
      status: string;
      expected_title: string;
    };
    grays_usfs_trailhead: {
      replay_id: string;
      url: string;
      supported_claims: SupportedClaim[];
    };
    grays_usfs_trail: {
      replay_id: string;
      url: string;
      supported_claims: SupportedClaim[];
    };
    usgs: { features: UsgsFeaturePin[] };
  };
  packets: RoutePlanPacket[];
  hard_exclusions: Array<{ route_id: string | null; name: string }>;
  later_review_risks: string[];
}

interface GeoJsonFeature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

interface GeoJsonPayload {
  type: string;
  features: GeoJsonFeature[];
}

interface CatalogDestination {
  id: string;
  name: string;
  owner: string;
  features: string[];
  lat: number;
  lon: number;
  hero_image_attribution: string | null;
  hero_image_attribution_url: string | null;
}

interface CatalogSnapshot {
  schema_version: number;
  snapshot_kind: string;
  captured_at: string;
  transaction_read_only: string;
  omitted_sensitive_or_mutable_fields: string[];
  destinations: CatalogDestination[];
  list_memberships: Array<{
    destination_id: string;
    list_id: string;
    list_owner: string;
    ordinal: number;
  }>;
  routes: Array<{
    id: string;
    name: string;
    status: string;
    shape: string | null;
    point_count: number;
    segment_count: number;
    destination_links: Array<{ destination_id: string; ordinal: number }>;
  }>;
  jobs: Array<{
    destination_id: string;
    state: string;
    candidate_sha256: string | null;
    published_route_id: string | null;
    replacement_route_id: string | null;
    attempt_count: number;
    last_error: string | null;
  }>;
}

interface CoverageProof {
  schema_version: number;
  snapshot_kind: string;
  captured_at: string;
  transaction_read_only: string;
  coverage_summary: {
    listed_destinations: number;
    publish_valid_listed_destinations: number;
    missing_publish_valid_route: number;
  };
  target_publish_state: Array<{
    destination_id: string;
    name: string;
    current_publish_valid_route: boolean;
    publish_valid_route_ids: string[];
  }>;
  target_list_memberships: Array<{
    destination_id: string;
    list_id: string;
    list_name: string;
    list_owner: string;
    ordinal: number;
  }>;
  target_routes: CatalogSnapshot["routes"];
  target_jobs: CatalogSnapshot["jobs"];
}

const fixturePath = resolve(
  __dirname,
  "../../../../docs/data-audits/fixtures/" +
    "pilchuck-grays-torreys-route-source-packets-2026-09-01.json"
);
const fixtureDirectory = dirname(fixturePath);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function artifact(id: string): ReplayArtifact {
  const value = fixture.replay_bundle.artifacts.find((entry) => entry.id === id);
  assert.ok(value, `missing replay artifact ${id}`);
  return value;
}

function replayBytes(id: string): Buffer {
  const value = artifact(id);
  const encoded = readFileSync(
    join(fixtureDirectory, fixture.replay_bundle.root, value.path)
  );
  assert.equal(encoded.length, value.encoded_bytes);
  assert.equal(sha256(encoded), value.encoded_sha256);
  const raw = gunzipSync(encoded);
  assert.equal(raw.length, value.raw_bytes);
  assert.equal(sha256(raw), value.raw_sha256);
  return raw;
}

function parseJsonReplay<T>(id: string): T {
  return JSON.parse(replayBytes(id).toString("utf8")) as T;
}

function packet(id: string): RoutePlanPacket {
  const value = fixture.packets.find((entry) => entry.packet_id === id);
  assert.ok(value, `missing packet ${id}`);
  return value;
}

function objectId(feature: GeoJsonFeature): number {
  return Number(feature.properties.objectid ?? feature.properties.OBJECTID);
}

function featureLine(feature: GeoJsonFeature): Coordinate[] {
  assert.equal(feature.geometry.type, "LineString");
  assert.ok(Array.isArray(feature.geometry.coordinates));
  return feature.geometry.coordinates.map((value) => {
    assert.ok(Array.isArray(value));
    assert.ok(Number.isFinite(value[0]));
    assert.ok(Number.isFinite(value[1]));
    return [Number(value[0]), Number(value[1])] as Coordinate;
  });
}

function coordinatesEqual(left: Coordinate, right: Coordinate): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function toLatLng([lng, lat]: Coordinate): { lng: number; lat: number } {
  return { lng, lat };
}

function distanceMeters(points: readonly Coordinate[]): number {
  let distance = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    distance += haversineMeters(toLatLng(points[index]), toLatLng(points[index + 1]));
  }
  return distance;
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

function buildPlannedPath(
  planPacket: RoutePlanPacket,
  snapshot: CatalogSnapshot
): {
  coordinates: Coordinate[];
  paths: OfficialNetworkPath[];
  citedIds: string[];
  zeroLengthSourceJoinSegmentIndexes: number[];
  trailhead: CatalogDestination;
  summit: CatalogDestination;
} {
  const plan = planPacket.geometry_plan;
  assert.ok(plan);
  const payload = parseJsonReplay<GeoJsonPayload>(plan.source_replay_id);
  const featuresById = new Map(
    payload.features.map((feature) => [objectId(feature), feature])
  );
  const sourceCoordinates: Coordinate[] = [];
  const zeroLengthSourceJoinSegmentIndexes: number[] = [];
  for (const [index, traversal] of plan.traversal.entries()) {
    const feature = featuresById.get(traversal.object_id);
    assert.ok(feature, `missing object ${traversal.object_id}`);
    const rawLine = featureLine(feature);
    const line =
      traversal.direction === "reverse" ? [...rawLine].reverse() : rawLine;
    if (index === 0) {
      sourceCoordinates.push(...line);
      continue;
    }
    assert.ok(
      coordinatesEqual(sourceCoordinates.at(-1)!, line[0]),
      `${planPacket.packet_id} source endpoint join must be exact`
    );
    zeroLengthSourceJoinSegmentIndexes.push(sourceCoordinates.length);
    sourceCoordinates.push(...line);
  }
  const [trailheadId, summitId] = planPacket.destination_links;
  const trailhead = snapshot.destinations.find(({ id }) => id === trailheadId);
  const summit = snapshot.destinations.find(({ id }) => id === summitId);
  assert.ok(trailhead);
  assert.ok(summit);
  const coordinates: Coordinate[] = [
    [trailhead.lon, trailhead.lat],
    ...sourceCoordinates,
    [summit.lon, summit.lat],
  ];
  const paths = plan.traversal.map(({ object_id }) => {
    const feature = featuresById.get(object_id)!;
    return {
      featureId: String(object_id),
      properties: feature.properties,
      coordinates: featureLine(feature),
      names: [],
      access: [],
    };
  });
  return {
    coordinates,
    paths,
    citedIds: plan.traversal.map(({ object_id }) => String(object_id)),
    zeroLengthSourceJoinSegmentIndexes,
    trailhead,
    summit,
  };
}

test("the packet is dry, split, and gains three only after later activation", () => {
  assert.equal(fixture.schema_version, 2);
  assert.equal(fixture.packet_kind, "source_only_route_review");
  assert.deepEqual(fixture.base_ref, {
    pull_request: 191,
    commit: "848fabe210b98c8ed4aeeb2e48906a212ef1a1fa",
    branch: "codex/maintain-active-route-cover-invariant-20260901",
  });
  const guard = fixture.mutation_guard;
  assert.equal(guard.source_only, true);
  assert.equal(guard.ready_for_import, false);
  assert.equal(guard.has_executable_apply_path, false);
  for (const key of [
    "writes_database",
    "queues_jobs",
    "runs_route_workers",
    "imports_routes",
    "approves_routes",
    "activates_routes",
  ]) {
    assert.equal(guard[key], false, `${key} must stay false`);
  }
  assert.equal(guard.current_listed_destination_gain, 0);
  assert.equal(guard.later_independent_review_and_activation_required, true);
  assert.equal(fixture.packets.length, 3);
  assert.ok(fixture.packets.every(({ ready_for_import }) => !ready_for_import));
  assert.ok(fixture.packets.every(({ route_shape }) => route_shape === "out_and_back"));
  assert.ok(fixture.packets.every(({ destination_links }) => destination_links.length === 2));

  const possible =
    fixture.coverage.possible_only_after_independent_review_and_activation;
  const proof = parseJsonReplay<CoverageProof>(
    fixture.coverage_capture.output_replay_id
  );
  const current = proof.coverage_summary;
  const summitIds = fixture.packets.map(({ destination_links }) => destination_links[1]);
  const capturedTargetIds = proof.target_publish_state.map(
    ({ destination_id }) => destination_id
  );
  assert.deepEqual(new Set(capturedTargetIds), new Set(summitIds));
  assert.deepEqual(new Set(possible.destination_ids), new Set(summitIds));
  assert.ok(
    proof.target_publish_state.every(
      ({ current_publish_valid_route, publish_valid_route_ids }) =>
        !current_publish_valid_route && publish_valid_route_ids.length === 0
    )
  );
  assert.equal(proof.target_list_memberships.length, 5);
  assert.ok(
    proof.target_list_memberships.every(({ destination_id, list_owner }) =>
      summitIds.includes(destination_id) && list_owner === "peaks"
    )
  );
  assert.equal(
    fixture.packets.reduce(
      (sum, entry) =>
        sum + entry.expected_listed_destination_gain_after_activation,
      0
    ),
    3
  );
  assert.equal(possible.listed_destination_gain, 3);
  assert.equal(possible.list_membership_gain, proof.target_list_memberships.length);
  assert.deepEqual(current, {
    listed_destinations: 1596,
    missing_publish_valid_route: 1529,
    publish_valid_listed_destinations: 67,
  });
  assert.equal(
    fixture.coverage.base_ref_listed_destinations,
    current.listed_destinations
  );
  assert.equal(
    fixture.coverage.base_ref_publish_valid_listed_destinations,
    current.publish_valid_listed_destinations
  );
  assert.equal(
    fixture.coverage.base_ref_missing_publish_valid_route,
    current.missing_publish_valid_route
  );
  assert.equal(
    current.publish_valid_listed_destinations + possible.listed_destination_gain,
    possible.publish_valid_listed_destinations
  );
  assert.equal(
    current.listed_destinations - possible.publish_valid_listed_destinations,
    possible.missing_publish_valid_route
  );
});

test("the exact coverage query and output prove a read-only live capture", () => {
  const query = readFileSync(
    join(fixtureDirectory, fixture.coverage_capture.query_path)
  );
  assert.equal(query.length, fixture.coverage_capture.query_bytes);
  assert.equal(sha256(query), fixture.coverage_capture.query_sha256);
  const queryText = query.toString("utf8");
  assert.match(
    queryText,
    /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/
  );
  assert.match(queryText, /CURRENT_SETTING\('transaction_read_only'\)/);
  assert.match(queryText, /peaks_route_passes_publish_integrity\(/);
  assert.match(queryText, /ROLLBACK;/);
  assert.doesNotMatch(
    queryText,
    /^\s*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/im
  );
  for (const routePacket of fixture.packets) {
    assert.ok(queryText.includes(`'${routePacket.destination_links[1]}'::text`));
  }

  const proof = parseJsonReplay<CoverageProof>(
    fixture.coverage_capture.output_replay_id
  );
  assert.equal(proof.schema_version, 1);
  assert.equal(
    proof.snapshot_kind,
    "listed_route_coverage_read_only_capture"
  );
  assert.equal(proof.captured_at, "2026-09-01T04:39:03.565080Z");
  assert.equal(proof.transaction_read_only, "on");
  assert.equal(proof.target_routes.length, 9);
  assert.equal(proof.target_jobs.length, 3);
  assert.equal(
    JSON.stringify(proof).includes("firebasestorage.googleapis.com"),
    false
  );
  for (const job of proof.target_jobs) {
    for (const field of [
      "lease_owner",
      "lease_token",
      "lease_expires_at",
      "candidate_path",
      "candidate_artifact",
    ]) {
      assert.equal(Object.prototype.hasOwnProperty.call(job, field), false);
    }
  }
});

test("all replay files decode to their exact pinned bytes", () => {
  assert.equal(fixture.replay_bundle.encoding, "gzip");
  assert.equal(fixture.replay_bundle.raw_headers_committed, false);
  assert.equal(
    fixture.replay_bundle.security_review.checked_for_credentials_and_session_material,
    true
  );
  assert.equal(fixture.replay_bundle.artifacts.length, 9);
  for (const value of fixture.replay_bundle.artifacts) {
    assert.match(value.raw_sha256, /^[a-f0-9]{64}$/);
    assert.match(value.encoded_sha256, /^[a-f0-9]{64}$/);
    assert.match(value.fetched_at, /^2026-09-01T\d{2}:\d{2}:\d{2}/);
    replayBytes(value.id);
  }
});

test("the durable snapshot pins read-only catalog and job state without secrets", () => {
  const snapshot = parseJsonReplay<CatalogSnapshot>("catalog-job-snapshot");
  assert.equal(snapshot.schema_version, 1);
  assert.equal(snapshot.snapshot_kind, "compact_read_only_route_catalog_and_jobs");
  assert.equal(snapshot.captured_at, "2026-09-01T04:06:54.569283Z");
  assert.equal(snapshot.transaction_read_only, "on");
  assert.deepEqual(snapshot.omitted_sensitive_or_mutable_fields, [
    "lease_owner",
    "lease_token",
    "lease_expires_at",
    "candidate_path",
    "candidate_artifact",
    "hero_image",
  ]);
  assert.equal(snapshot.destinations.length, 5);
  assert.equal(snapshot.list_memberships.length, 5);
  assert.equal(snapshot.routes.length, 9);
  assert.equal(snapshot.jobs.length, 3);
  const graysPendingRoute = snapshot.routes.find(
    ({ id }) => id === "Lr8czzLjpc2GKkulapJ3"
  );
  assert.ok(graysPendingRoute);
  assert.equal(graysPendingRoute.point_count, 818);
  assert.ok(snapshot.destinations.every(({ owner }) => owner === "peaks"));
  assert.ok(snapshot.list_memberships.every(({ list_owner }) => list_owner === "peaks"));
  assert.equal(
    JSON.stringify(snapshot).includes("firebasestorage.googleapis.com"),
    false
  );
  for (const destination of snapshot.destinations) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(destination, "hero_image"),
      false
    );
  }
  for (const job of snapshot.jobs) {
    for (const field of [
      "lease_owner",
      "lease_token",
      "lease_expires_at",
      "candidate_path",
      "candidate_artifact",
    ]) {
      assert.equal(Object.prototype.hasOwnProperty.call(job, field), false);
    }
  }

  const pilchuck = snapshot.jobs.find(
    ({ destination_id }) => destination_id === "iAD3EhqmkKVKXBjJjprj"
  );
  assert.ok(pilchuck);
  assert.equal(pilchuck.state, "approved");
  assert.equal(pilchuck.attempt_count, 37);
  assert.equal(
    pilchuck.candidate_sha256,
    "5a050e4c0e6905ba5a3d1efc2134e313df63e96e0a4a44f244c329eb7d6e1d84"
  );
  const pilchuckPacket = packet("mount-pilchuck-trail-700");
  assert.equal(pilchuckPacket.packet_state, "existing_pending_job_and_source_pinned");
  assert.equal(pilchuckPacket.saved_candidate_sha256, pilchuck.candidate_sha256);
  assert.equal(pilchuckPacket.prior_geometry_review_replayable, false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(pilchuckPacket, "existing_review"),
    false
  );
  assert.equal(
    pilchuck.last_error,
    "Publish dry run failed again: PostgreSQL statement timeout 57014 in findCandidateSegments"
  );
  assert.deepEqual(pilchuckPacket.saved_job_condition, {
    exact_error:
      "Publish dry run failed again: PostgreSQL statement timeout 57014 in findCandidateSegments",
    classification: "rerun_only",
    blocks_source_packet: false,
    requires_fresh_publish_dry_run: true,
  });

  const grays = snapshot.jobs.find(
    ({ destination_id }) => destination_id === "bRE1ayiwpfQlXiLJkLLI"
  );
  const torreys = snapshot.jobs.find(
    ({ destination_id }) => destination_id === "29XhN18XdxRgJrDN3ORu"
  );
  assert.equal(grays?.state, "researching");
  assert.equal(grays?.attempt_count, 40);
  assert.equal(
    grays?.candidate_sha256,
    "e9cfac5f753a7e51c8d07349ff2599e9860665536b6c6d259e2c0215b659ed4d"
  );
  assert.equal(torreys?.state, "researching");
  assert.equal(torreys?.attempt_count, 1);
  assert.equal(torreys?.candidate_sha256, null);

  const listedIds = new Set(snapshot.list_memberships.map(({ destination_id }) => destination_id));
  assert.deepEqual(
    listedIds,
    new Set([
      "iAD3EhqmkKVKXBjJjprj",
      "bRE1ayiwpfQlXiLJkLLI",
      "29XhN18XdxRgJrDN3ORu",
    ])
  );
  assert.ok(snapshot.destinations.filter(({ features }) => features.includes("summit")).every(
    ({ hero_image_attribution, hero_image_attribution_url }) =>
      Boolean(hero_image_attribution && hero_image_attribution_url)
  ));
});

test("Pilchuck source facts and the retired 404 replay parse from exact bytes", () => {
  const osmPayload = parseJsonReplay<{
    elements: Array<Record<string, unknown>>;
  }>(fixture.official_sources.pilchuck_osm.replay_id);
  const wayPin = fixture.official_sources.pilchuck_osm.expected_way;
  const way = osmPayload.elements.find(
    (element) => element.type === "way" && element.id === wayPin.id
  );
  assert.ok(way);
  const nodeById = new Map(
    osmPayload.elements
      .filter((element) => element.type === "node")
      .map((element) => [Number(element.id), element])
  );
  const wayNodeIds = way.nodes as number[];
  const coordinates = wayNodeIds.map((id) => {
    const node = nodeById.get(id);
    assert.ok(node);
    return [Number(node.lon), Number(node.lat)] as Coordinate;
  });
  assert.equal(coordinates.length, wayPin.node_count);
  assert.equal(sha256(JSON.stringify(coordinates)), wayPin.coordinates_sha256);
  assert.equal(way.version, wayPin.version);
  assert.equal(way.timestamp, wayPin.timestamp);
  assert.equal(way.changeset, wayPin.changeset);
  for (const [key, expected] of [
    ["name", wayPin.name],
    ["highway", wayPin.highway],
    ["foot", wayPin.foot],
    ["surface", wayPin.surface],
    ["bicycle", wayPin.bicycle],
    ["horse", wayPin.horse],
  ]) {
    assert.equal((way.tags as Record<string, unknown>)[key as string], expected);
  }

  const trailPayload = parseJsonReplay<GeoJsonPayload>(
    fixture.official_sources.pilchuck_usfs_trail.replay_id
  );
  assert.equal(trailPayload.features.length, 1);
  const trailFeature = trailPayload.features[0];
  const trailPin = fixture.official_sources.pilchuck_usfs_trail.expected_feature;
  for (const key of [
    "globalid",
    "trail_name",
    "trail_no",
    "allowed_terra_use",
    "hiker_pedestrian_managed",
    "hiker_pedestrian_restricted",
  ]) {
    assert.equal(trailFeature.properties[key], trailPin[key]);
  }
  const trailCoordinates = featureLine(trailFeature);
  assert.equal(trailCoordinates.length, trailPin.coordinate_count);
  assert.equal(
    sha256(JSON.stringify(trailCoordinates)),
    trailPin.coordinates_sha256
  );

  const brochure = replayBytes(
    fixture.official_sources.pilchuck_retired_brochure.replay_id
  ).toString("utf8");
  assert.equal(fixture.official_sources.pilchuck_retired_brochure.status, "unavailable_not_relied_upon");
  assert.ok(
    brochure.includes(
      `<title>${fixture.official_sources.pilchuck_retired_brochure.expected_title}</title>`
    )
  );
  assert.equal(artifact("pilchuck-usfs-brochure-404").http_status, 404);

  const auditDocument = readFileSync(
    join(
      fixtureDirectory,
      "..",
      "pilchuck-grays-torreys-route-source-packets-2026-09-01.md"
    ),
    "utf8"
  );
  assert.doesNotMatch(auditDocument, /its reviewed OSM way/i);
  assert.match(
    auditDocument,
    /does not contain the candidate, path, or prior review bytes/
  );
  assert.ok(
    fixture.later_review_risks.includes(
      "The Pilchuck candidate, path, and prior review bytes are absent; later work must rerun the full geometry and source review plus a fresh publish dry run before import."
    )
  );
});

test("direct Forest Service pages support only their pinned qualified facts", () => {
  const fixtureText = readFileSync(fixturePath, "utf8");
  assert.doesNotMatch(fixtureText, /\/visit\/destinations\?.*page=384/);
  for (const page of [
    fixture.official_sources.grays_usfs_trailhead,
    fixture.official_sources.grays_usfs_trail,
  ]) {
    const html = replayBytes(page.replay_id).toString("utf8");
    assert.ok(html.includes(`<link rel="canonical" href="${page.url}" />`));
    assert.equal(artifact(page.replay_id).http_status, 200);
    for (const evidence of page.supported_claims) {
      assert.ok(evidence.claim.length > 20);
      assert.ok(
        html.includes(evidence.exact_text),
        `${page.replay_id} does not contain ${evidence.exact_text}`
      );
    }
  }
  assert.equal(artifact("grays-usfs-trailhead").fetched_at, "2026-09-01T03:54:33Z");
  assert.equal(artifact("grays-usfs-trail").fetched_at, "2026-09-01T03:55:00Z");
});

test("route-specific USGS replays contain exactly the selected source vertices", () => {
  const pins = new Map(
    fixture.official_sources.usgs.features.map((feature) => [
      feature.object_id,
      feature,
    ])
  );
  for (const routePacket of [
    packet("grays-peak-trail-54-out-and-back"),
    packet("torreys-peak-standard-out-and-back"),
  ]) {
    const plan = routePacket.geometry_plan!;
    const payload = parseJsonReplay<GeoJsonPayload>(plan.source_replay_id);
    assert.equal(payload.type, "FeatureCollection");
    const returnedIds = payload.features.map(objectId);
    const urlIds = parseUsgsTrailsQueryUrl(plan.source_url);
    assertExactUsgsTrailObjectIds(urlIds, returnedIds);
    assert.equal(plan.source_url, buildUsgsTrailsQueryUrl(urlIds).toString());
    assert.deepEqual(
      new Set(returnedIds),
      new Set(plan.traversal.map(({ object_id }) => object_id))
    );
    for (const feature of payload.features) {
      const id = objectId(feature);
      const expected = pins.get(id);
      assert.ok(expected);
      const line = featureLine(feature);
      assert.equal(
        `${String(feature.properties.name)} ${String(feature.properties.trailnumber)}`,
        expected.name
      );
      assert.equal(line.length, expected.coordinate_count);
      assert.equal(sha256(JSON.stringify(line)), expected.coordinates_sha256);
      assert.deepEqual(line[0], expected.first_lon_lat);
      assert.deepEqual(line.at(-1), expected.last_lon_lat);
    }
  }
});

test("the real reviewer passes both endpoint-only out-and-back plans", () => {
  const snapshot = parseJsonReplay<CatalogSnapshot>("catalog-job-snapshot");
  for (const routePacket of [
    packet("grays-peak-trail-54-out-and-back"),
    packet("torreys-peak-standard-out-and-back"),
  ]) {
    const plan = routePacket.geometry_plan!;
    const expected = routePacket.real_reviewer_expectation!;
    const built = buildPlannedPath(routePacket, snapshot);
    assert.equal(built.coordinates.length, plan.path_point_count);
    assert.equal(
      sha256(JSON.stringify(built.coordinates)),
      plan.path_coordinates_sha256
    );
    assert.deepEqual(
      built.zeroLengthSourceJoinSegmentIndexes,
      plan.zero_length_source_join_segment_indexes
    );
    const zeroLengthSegmentIndexes = built.coordinates
      .slice(0, -1)
      .map((coordinate, index) =>
        coordinatesEqual(coordinate, built.coordinates[index + 1]) ? index : -1
      )
      .filter((index) => index >= 0);
    assert.deepEqual(
      zeroLengthSegmentIndexes,
      plan.zero_length_source_join_segment_indexes
    );
    for (const index of plan.zero_length_source_join_segment_indexes) {
      assert.deepEqual(built.coordinates[index], built.coordinates[index + 1]);
      assert.equal(
        haversineMeters(
          toLatLng(built.coordinates[index]),
          toLatLng(built.coordinates[index + 1])
        ),
        0
      );
    }
    if (routePacket.packet_id === "grays-peak-trail-54-out-and-back") {
      const capturedRoute = snapshot.routes.find(
        ({ id }) => id === routePacket.route_id
      );
      assert.ok(capturedRoute);
      assert.equal(capturedRoute.point_count, 818);
      assert.equal(capturedRoute.point_count, built.coordinates.length);
    }
    assertApprox(
      distanceMeters(built.coordinates),
      plan.path_distance_m,
      0.001,
      `${routePacket.packet_id} distance`
    );

    const exactTrailhead: Coordinate = [built.trailhead.lon, built.trailhead.lat];
    const exactSummit: Coordinate = [built.summit.lon, built.summit.lat];
    assert.deepEqual(built.coordinates[0], exactTrailhead);
    assert.deepEqual(built.coordinates.at(-1), exactSummit);
    assert.equal(
      haversineMeters(toLatLng(built.coordinates[0]), toLatLng(exactTrailhead)),
      plan.strict_trailhead_contact_m
    );
    assert.equal(
      haversineMeters(toLatLng(built.coordinates.at(-1)!), toLatLng(exactSummit)),
      plan.strict_summit_contact_m
    );

    const review = reviewOfficialRouteGeometry(
      built.coordinates.map(toLatLng),
      built.paths,
      built.citedIds,
      { internalConnectorSegmentIndexes: [] }
    );
    assert.equal(expected.function, "reviewOfficialRouteGeometry");
    assert.deepEqual(expected.internal_connector_segment_indexes, []);
    assert.equal(review.sourceTopologyValid, true);
    assert.deepEqual(review.usedFeatureIds.map(Number), expected.used_object_ids);
    assert.deepEqual(review.unusedFeatureIds.map(Number), expected.unused_object_ids);
    assert.ok(review.startConnectorM <= 125);
    assert.ok(review.endConnectorM <= 125);
    assert.ok(review.startConnectorJoinOffsetM <= 5);
    assert.ok(review.endConnectorJoinOffsetM <= 5);
    assert.ok(review.coreMaxOffsetM <= 5);
    assert.ok(review.coreP95OffsetM <= 2);
    assert.ok(review.coreCoveragePct >= 99);
    assertApprox(review.startConnectorM, expected.start_connector_m, 1e-6, "start connector");
    assertApprox(review.endConnectorM, expected.end_connector_m, 1e-6, "end connector");
    assertApprox(
      review.startConnectorJoinOffsetM,
      expected.start_connector_join_offset_m,
      1e-6,
      "start connector join"
    );
    assertApprox(
      review.endConnectorJoinOffsetM,
      expected.end_connector_join_offset_m,
      1e-6,
      "end connector join"
    );
    assertApprox(review.coreMaxOffsetM, expected.core_max_offset_m, 1e-6, "core max");
    assertApprox(review.coreP95OffsetM, expected.core_p95_offset_m, 1e-6, "core p95");
    assertApprox(review.coreCoveragePct, expected.core_coverage_pct, 1e-9, "coverage");
  }
});

test("technical alternatives stay outside every selected route", () => {
  const exclusions = new Map(
    fixture.hard_exclusions.map(({ route_id, name }) => [route_id, name])
  );
  assert.equal(exclusions.get("AOCSvgvnhW5nd8dPei6J"), "Grays Peak Kelso Ridge");
  assert.equal(exclusions.get("gCscJF593nTsMdp1Z6EE"), "Kelso Ridge");
  assert.equal(exclusions.get("fSHZk8ioXWIjUNPnTgMU"), "Dead Dog Couloir");
  const bannedRouteIds = new Set(
    fixture.hard_exclusions.flatMap(({ route_id }) =>
      route_id === null ? [] : [route_id]
    )
  );
  for (const routePacket of fixture.packets) {
    assert.doesNotMatch(routePacket.route_name, /kelso|dead dog|couloir|ridge/i);
    if (routePacket.route_id !== null) {
      assert.equal(bannedRouteIds.has(routePacket.route_id), false);
    }
  }

  const snapshot = parseJsonReplay<CatalogSnapshot>("catalog-job-snapshot");
  const torreysJob = snapshot.jobs.find(
    ({ destination_id }) => destination_id === "29XhN18XdxRgJrDN3ORu"
  );
  assert.ok(torreysJob);
  assert.equal(torreysJob.published_route_id, "fSHZk8ioXWIjUNPnTgMU");
  assert.equal(torreysJob.replacement_route_id, "fSHZk8ioXWIjUNPnTgMU");
  assert.equal(bannedRouteIds.has(torreysJob.published_route_id!), true);
  assert.equal(bannedRouteIds.has(torreysJob.replacement_route_id!), true);
  assert.equal(packet("torreys-peak-standard-out-and-back").ready_for_import, false);
  assert.ok(
    fixture.later_review_risks.includes(
      "The current Torreys job points at a hard-excluded technical replacement route; a later write task must correct the guarded replacement binding before import."
    )
  );
});
