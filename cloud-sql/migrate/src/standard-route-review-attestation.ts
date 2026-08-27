import { createHash } from "node:crypto";
import { canonicalJson } from "./standard-route-job-state";

type JsonObject = Record<string, unknown>;

export interface RouteReviewAttestation {
  destination_id: string;
  route_id: string;
  reviewer_id: string;
  candidate_sha256: string;
  candidate_result_sha256: string;
  source_check_sha256: string;
  review_packet_sha256: string;
}

export interface VerifyRouteReviewAttestationInput {
  reviewPacket: JsonObject;
  reviewResult: JsonObject;
  candidateResult: JsonObject;
  sourceCheck: JsonObject;
  candidateSha256: string;
  destinationId: string;
  routeId: string;
  reviewerId: string;
}

const ATTESTATION_KEYS = [
  "candidate_result_sha256",
  "candidate_sha256",
  "destination_id",
  "review_packet_sha256",
  "reviewer_id",
  "route_id",
  "source_check_sha256",
] as const;

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function sha256Value(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sha256String(value: unknown, label: string): string {
  const digest = stringValue(value, label);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return digest;
}

function exactAttestation(value: unknown, label: string): RouteReviewAttestation {
  const object = objectValue(value, label);
  const keys = Object.keys(object).sort();
  if (canonicalJson(keys) !== canonicalJson([...ATTESTATION_KEYS].sort())) {
    throw new Error(`${label} must contain only route review binding fields`);
  }
  return {
    destination_id: stringValue(object.destination_id, `${label}.destination_id`),
    route_id: stringValue(object.route_id, `${label}.route_id`),
    reviewer_id: stringValue(object.reviewer_id, `${label}.reviewer_id`),
    candidate_sha256: sha256String(
      object.candidate_sha256,
      `${label}.candidate_sha256`
    ),
    candidate_result_sha256: sha256String(
      object.candidate_result_sha256,
      `${label}.candidate_result_sha256`
    ),
    source_check_sha256: sha256String(
      object.source_check_sha256,
      `${label}.source_check_sha256`
    ),
    review_packet_sha256: sha256String(
      object.review_packet_sha256,
      `${label}.review_packet_sha256`
    ),
  };
}

function packetDigestBody(packet: JsonObject): JsonObject {
  const {
    attestation: _attestation,
    review_result_template: reviewResultTemplateValue,
    ...body
  } = packet;
  const template = objectValue(
    reviewResultTemplateValue,
    "review result template"
  );
  return {
    ...body,
    review_result_template: Object.fromEntries(
      Object.entries(template).filter(
        ([key]) => !ATTESTATION_KEYS.includes(key as (typeof ATTESTATION_KEYS)[number])
      )
    ),
  };
}

function reviewPacketSha256(
  packet: JsonObject,
  binding: Pick<
    RouteReviewAttestation,
    | "reviewer_id"
    | "candidate_sha256"
    | "candidate_result_sha256"
    | "source_check_sha256"
  >
): string {
  return sha256Value({
    reviewer_id: binding.reviewer_id,
    candidate_sha256: binding.candidate_sha256,
    candidate_result_sha256: binding.candidate_result_sha256,
    source_check_sha256: binding.source_check_sha256,
    packet: packetDigestBody(packet),
  });
}

function copiedAttestation(
  value: JsonObject,
  label: string
): RouteReviewAttestation {
  const copy = Object.fromEntries(
    ATTESTATION_KEYS.map((key) => [key, value[key]])
  );
  return exactAttestation(copy, label);
}

/**
 * Bind a reviewer result to the exact durable candidate and compact evidence
 * packet it reviewed. This checks identity only; the queue must still apply
 * the reviewer gates and rerun its live route and source checks.
 */
export function verifyRouteReviewAttestation(
  input: VerifyRouteReviewAttestationInput
): RouteReviewAttestation {
  const packet = objectValue(input.reviewPacket, "review packet");
  if (packet.schema_version !== 3) {
    throw new Error("review packet schema_version must be 3");
  }
  const destination = objectValue(packet.destination, "review packet destination");
  if (
    destination.id !== input.destinationId ||
    packet.route_id !== input.routeId
  ) {
    throw new Error("review packet is not bound to this destination and route");
  }

  const durableCandidateSha256 = sha256String(
    input.candidateSha256,
    "durable candidate_sha256"
  );
  const candidateResultSha256 = sha256Value(input.candidateResult);
  const sourceCheckSha256 = sha256Value(input.sourceCheck);
  if (
    sha256Value(objectValue(packet.source_check, "review packet source_check")) !==
    sourceCheckSha256
  ) {
    throw new Error("review packet source_check differs from the supplied source check");
  }

  const attestation = exactAttestation(
    packet.attestation,
    "review packet attestation"
  );
  if (
    attestation.destination_id !== input.destinationId ||
    attestation.route_id !== input.routeId ||
    attestation.reviewer_id !== input.reviewerId ||
    attestation.candidate_sha256 !== durableCandidateSha256 ||
    attestation.candidate_result_sha256 !== candidateResultSha256 ||
    attestation.source_check_sha256 !== sourceCheckSha256
  ) {
    throw new Error("review packet attestation does not match durable review inputs");
  }
  const expectedPacketSha256 = reviewPacketSha256(packet, attestation);
  if (attestation.review_packet_sha256 !== expectedPacketSha256) {
    throw new Error("review packet checksum does not match its contents");
  }

  const template = objectValue(
    packet.review_result_template,
    "review result template"
  );
  const templateAttestation = copiedAttestation(
    template,
    "review result template attestation"
  );
  const resultAttestation = copiedAttestation(
    objectValue(input.reviewResult, "review result"),
    "review result attestation"
  );
  if (
    canonicalJson(templateAttestation) !== canonicalJson(attestation) ||
    canonicalJson(resultAttestation) !== canonicalJson(attestation)
  ) {
    throw new Error("review result did not copy the packet attestation");
  }
  return attestation;
}
