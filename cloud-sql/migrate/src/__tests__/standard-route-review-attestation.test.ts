import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { verifyRouteReviewAttestation } from "../standard-route-review-attestation";
import { ROUTE_REVIEWER_WORKER_ID } from "../standard-route-job-state";

type JsonObject = Record<string, unknown>;

const packetModulePromise = import(
  pathToFileURL(
    join(
      __dirname,
      "../../../../.agents/skills/peaks-route-factory/scripts/build_route_review_packet.mjs"
    )
  ).href
) as Promise<{
  buildRouteReviewPacket: (input: JsonObject) => JsonObject;
}>;

const CANDIDATE_SHA256 = "c".repeat(64);

const candidateResult: JsonObject = {
  route_name: "Example Peak via Example Trail",
  route_shape: "out_and_back",
  discovery_checks: {
    alltrails: {
      status: "no_match",
      attempted_url: "https://www.alltrails.com/search?q=Example+Peak",
      checked_at: "2026-08-27T12:00:00.000Z",
      note: "No direct route match.",
    },
    peakbagger: {
      status: "matched",
      url: "https://www.peakbagger.com/peak.aspx?pid=1",
      checked_at: "2026-08-27T12:00:00.000Z",
    },
  },
  official_source_country_code: "US",
  official_source_attempts: {
    "usfs-nfs-trails": {
      status: "no_complete_geometry",
      attempted_url:
        "https://data-usfs.hub.arcgis.com/datasets/usfs::national-forest-system-trails-feature-layer",
      checked_at: "2026-08-27T12:00:00.000Z",
      note: "No complete official route was found.",
    },
  },
  identity_sources: [
    {
      type: "peakbagger",
      url: "https://www.peakbagger.com/peak.aspx?pid=1",
    },
    { type: "official", url: "https://www.nps.gov/example" },
  ],
  identity_conflicts: [],
  geometry: {
    source_kind: "openstreetmap",
    source_url: "https://www.openstreetmap.org/way/1",
    license: "ODbL 1.0",
  },
  access: { status: "open", source_url: "https://www.nps.gov/example" },
  comparison: { private_reference_used: false },
  map_review: { passed: true, notes: "The route reaches the summit." },
};

const sourceCheck: JsonObject = {
  verdict: "PASS",
  results: [
    {
      metrics: {
        start_connector_m: 2,
        end_connector_m: 3,
        core_max_offset_m: 4,
        core_p95_offset_m: 1,
        core_coverage_pct: 100,
      },
    },
  ],
};

async function reviewFixture(): Promise<{
  packet: JsonObject;
  result: JsonObject;
}> {
  const { buildRouteReviewPacket } = await packetModulePromise;
  const packet = buildRouteReviewPacket({
    candidate: candidateResult,
    sourceCheck,
    candidateSha256: CANDIDATE_SHA256,
    destinationId: "destination",
    destinationName: "Example Peak",
    destinationCountryCode: "US",
    trailheadId: "trailhead",
    trailheadName: "Example Trailhead",
    routeId: "route",
  });
  assert.equal(
    (packet.destination as JsonObject).country_code,
    "US"
  );
  assert.deepEqual(
    (packet.candidate as JsonObject).official_source_attempts,
    candidateResult.official_source_attempts
  );
  const template = packet.review_result_template as JsonObject;
  return {
    packet,
    result: {
      ...template,
      verdict: "PASS",
      gates: {
        route_identity: true,
        geometry_rights: true,
        access: true,
        map_review: true,
        source_geometry: true,
        pending_route: true,
        endpoints: true,
        provenance: true,
      },
    },
  };
}

function verifyInput(packet: JsonObject, result: JsonObject) {
  return {
    reviewPacket: packet,
    reviewResult: result,
    candidateResult,
    sourceCheck,
    candidateSha256: CANDIDATE_SHA256,
    destinationId: "destination",
    routeId: "route",
    reviewerId: ROUTE_REVIEWER_WORKER_ID,
  };
}

test("review packet exposes a destination country change as a required failure", async () => {
  const { buildRouteReviewPacket } = await packetModulePromise;
  const packet = buildRouteReviewPacket({
    candidate: candidateResult,
    sourceCheck,
    candidateSha256: CANDIDATE_SHA256,
    destinationId: "destination",
    destinationName: "Example Peak",
    destinationCountryCode: "CA",
    trailheadId: "trailhead",
    trailheadName: "Example Trailhead",
    routeId: "route",
  });
  assert.equal((packet.destination as JsonObject).country_code, "CA");
  assert.equal(
    (packet.candidate as JsonObject).official_source_country_code,
    "US"
  );
  assert.match(
    String(
      (packet.review_contract as JsonObject).official_source_country_rule
    ),
    /must fail/
  );
});

test("review attestation binds the reviewer to durable candidate and packet", async () => {
  const { packet, result } = await reviewFixture();
  const attestation = verifyRouteReviewAttestation(verifyInput(packet, result));

  assert.equal(attestation.destination_id, "destination");
  assert.equal(attestation.route_id, "route");
  assert.equal(attestation.reviewer_id, ROUTE_REVIEWER_WORKER_ID);
  assert.equal(attestation.candidate_sha256, CANDIDATE_SHA256);
  assert.match(attestation.candidate_result_sha256, /^[a-f0-9]{64}$/);
  assert.match(attestation.source_check_sha256, /^[a-f0-9]{64}$/);
  assert.match(attestation.review_packet_sha256, /^[a-f0-9]{64}$/);
});

test("review attestation rejects changed durable inputs", async () => {
  const { packet, result } = await reviewFixture();
  assert.throws(
    () =>
      verifyRouteReviewAttestation({
        ...verifyInput(packet, result),
        candidateSha256: "d".repeat(64),
      }),
    /does not match durable review inputs/
  );
  assert.throws(
    () =>
      verifyRouteReviewAttestation({
        ...verifyInput(packet, result),
        candidateResult: { ...candidateResult, route_name: "Changed route" },
      }),
    /does not match durable review inputs/
  );
  assert.throws(
    () =>
      verifyRouteReviewAttestation({
        ...verifyInput(packet, result),
        sourceCheck: { ...sourceCheck, verdict: "FAIL" },
      }),
    /source_check differs/
  );
});

test("review attestation rejects changed packet content or reviewer lease binding", async () => {
  const { packet, result } = await reviewFixture();
  const candidate = packet.candidate as JsonObject;
  assert.throws(
    () =>
      verifyRouteReviewAttestation(
        verifyInput(
          { ...packet, candidate: { ...candidate, route_name: "Changed route" } },
          result
        )
      ),
    /review packet checksum does not match/
  );
  assert.throws(
    () =>
      verifyRouteReviewAttestation(
        {
          ...verifyInput(packet, result),
          reviewerId: "luna-route-worker-01",
        }
      ),
    /does not match durable review inputs/
  );
  assert.throws(
    () =>
      verifyRouteReviewAttestation(
        verifyInput(packet, { ...result, review_packet_sha256: "e".repeat(64) })
      ),
    /did not copy the packet attestation/
  );
  const { candidate_sha256: _candidateSha256, ...missingBinding } = result;
  assert.throws(
    () => verifyRouteReviewAttestation(verifyInput(packet, missingBinding)),
    /candidate_sha256 must be a non-empty string/
  );
});
