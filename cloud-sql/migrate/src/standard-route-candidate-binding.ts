import { createHash } from "node:crypto";
import path from "node:path";
import type { PoolClient } from "pg";
import { canonicalJson } from "./standard-route-job-state";

type JsonObject = Record<string, unknown>;

export interface DurableCandidateBindingInput {
  routeId: string;
  destinationId: string;
  trailheadId: string | null;
  candidatePath: string | null;
  candidateSha256: string | null;
  candidateResult: JsonObject;
  candidateArtifact: JsonObject | null;
  importerResult: JsonObject;
}

export interface PendingRouteBinding {
  routeName: string;
  routeShape: "out_and_back" | "loop" | "lollipop";
  officialSourceCountryCode: string;
  destinations: Array<{ destinationId: string; ordinal: number }>;
  identitySources: Array<{ type: string; id: string }>;
  geometrySource: JsonObject;
  geometry: JsonObject;
}

interface PendingRouteBindingRow {
  route_name_matches: boolean;
  route_shape_matches: boolean;
  identity_sources_match: boolean;
  geometry_source_matches: boolean;
  candidate_path_matches: boolean;
}

interface PendingRouteDestinationRow {
  destination_id: string;
  ordinal: number;
}

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function routeNameValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("saved candidate route_name must be a non-empty string");
  }
  return value;
}

function officialSourceCountryCodeValue(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) {
    throw new Error(
      "saved candidate official_source_country_code must be two uppercase letters"
    );
  }
  return value;
}

function httpsUrl(value: unknown, label: string): string {
  const raw = stringValue(value, label);
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`);
  }
  return parsed.toString();
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item)
  ) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return (value as string[]).map((item) => item.trim());
}

function safeIntegerArray(value: unknown, label: string): number[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => !Number.isSafeInteger(item) || Number(item) <= 0)
  ) {
    throw new Error(`${label} must contain positive safe integers`);
  }
  return value as number[];
}

function licenseMatchesCandidateLabel(
  sourceKind: string,
  candidateLicense: string,
  artifactLicense: string
): boolean {
  return (
    candidateLicense === artifactLicense ||
    (sourceKind === "openstreetmap" &&
      candidateLicense === "ODbL 1.0" &&
      artifactLicense ===
        "Open Data Commons Open Database License (ODbL) 1.0")
  );
}

export function buildPendingRouteBinding(
  input: DurableCandidateBindingInput
): PendingRouteBinding {
  if (
    !input.candidatePath ||
    path.extname(input.candidatePath).toLowerCase() !== ".geojson"
  ) {
    throw new Error("pending_review requires the saved candidate GeoJSON path");
  }
  if (!input.candidateArtifact || !input.candidateSha256) {
    throw new Error("pending_review requires the saved candidate artifact");
  }
  const actualSha256 = createHash("sha256")
    .update(canonicalJson(input.candidateArtifact))
    .digest("hex");
  if (actualSha256 !== input.candidateSha256) {
    throw new Error("Saved candidate checksum does not match");
  }

  const artifact = objectValue(
    input.candidateArtifact,
    "saved candidate artifact"
  );
  if (artifact.peaks_destination_id !== input.destinationId) {
    throw new Error("Saved candidate destination does not match the job");
  }
  if (
    !input.trailheadId ||
    artifact.peaks_trailhead_id !== input.trailheadId
  ) {
    throw new Error("Saved candidate trailhead does not match the job");
  }

  const routeName = routeNameValue(input.candidateResult.route_name);
  const routeShape = input.candidateResult.route_shape;
  if (
    routeShape !== "out_and_back" &&
    routeShape !== "loop" &&
    routeShape !== "lollipop"
  ) {
    throw new Error("Saved candidate route_shape is invalid");
  }
  if (input.importerResult.route_name !== routeName) {
    throw new Error("Importer route name does not match the saved candidate");
  }
  const officialSourceCountryCode = officialSourceCountryCodeValue(
    input.candidateResult.official_source_country_code
  );

  if (
    !Array.isArray(input.candidateResult.identity_sources) ||
    input.candidateResult.identity_sources.length === 0
  ) {
    throw new Error("Saved candidate identity_sources are missing");
  }
  const identitySources = input.candidateResult.identity_sources.map(
    (rawSource, index) => {
      const source = objectValue(
        rawSource,
        `saved candidate identity_sources[${index}]`
      );
      const type = stringValue(
        source.type,
        `saved candidate identity_sources[${index}].type`
      );
      if (!/^[a-z0-9_-]+$/i.test(type)) {
        throw new Error(
          `saved candidate identity_sources[${index}].type is invalid`
        );
      }
      return {
        type,
        id: httpsUrl(
          source.url,
          `saved candidate identity_sources[${index}].url`
        ),
      };
    }
  );

  const sourceKind =
    typeof artifact.peaks_source_kind === "string"
      ? artifact.peaks_source_kind.trim()
      : "openstreetmap";
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(sourceKind)) {
    throw new Error("Saved candidate peaks_source_kind is invalid");
  }
  const sourceUrl = httpsUrl(
    artifact.peaks_source,
    "saved candidate peaks_source"
  );
  const licenseName = stringValue(
    artifact.peaks_license_name,
    "saved candidate peaks_license_name"
  );
  const licenseUrl = stringValue(
    artifact.peaks_license,
    "saved candidate peaks_license"
  );
  if (new URL(licenseUrl).protocol !== "https:") {
    throw new Error("saved candidate peaks_license must use HTTPS");
  }
  const attribution = stringValue(
    artifact.peaks_attribution,
    "saved candidate peaks_attribution"
  );
  const retrievedAt = new Date(
    stringValue(
      artifact.peaks_retrieved_at,
      "saved candidate peaks_retrieved_at"
    )
  );
  if (Number.isNaN(retrievedAt.getTime())) {
    throw new Error("Saved candidate peaks_retrieved_at is invalid");
  }

  const candidateGeometry = objectValue(
    input.candidateResult.geometry,
    "saved candidate geometry"
  );
  if (
    stringValue(
      candidateGeometry.source_kind,
      "saved candidate geometry.source_kind"
    ) !== sourceKind ||
    httpsUrl(
      candidateGeometry.source_url,
      "saved candidate geometry.source_url"
    ) !== sourceUrl ||
    !licenseMatchesCandidateLabel(
      sourceKind,
      stringValue(
        candidateGeometry.license,
        "saved candidate geometry.license"
      ),
      licenseName
    )
  ) {
    throw new Error(
      "Saved candidate geometry metadata does not match its GeoJSON artifact"
    );
  }

  if (!Array.isArray(artifact.features) || artifact.features.length !== 1) {
    throw new Error("Saved candidate must contain one GeoJSON feature");
  }
  const feature = objectValue(
    artifact.features[0],
    "saved candidate feature"
  );
  const geometry = objectValue(
    feature.geometry,
    "saved candidate feature geometry"
  );
  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    throw new Error("Saved candidate path must be a GeoJSON LineString");
  }
  const properties = objectValue(
    feature.properties,
    "saved candidate feature properties"
  );
  const osmWayIds = safeIntegerArray(
    properties.osm_way_ids,
    "saved candidate osm_way_ids"
  );
  const osmWayUrls = stringArray(
    properties.osm_way_urls,
    "saved candidate osm_way_urls"
  );

  return {
    routeName,
    routeShape,
    officialSourceCountryCode,
    destinations: [
      { destinationId: input.trailheadId, ordinal: 0 },
      { destinationId: input.destinationId, ordinal: 1 },
    ],
    identitySources,
    geometrySource: {
      source_kind: sourceKind,
      source_url: sourceUrl,
      license_name: licenseName,
      license_url: licenseUrl,
      attribution,
      retrieved_at: retrievedAt.toISOString(),
      osm_way_ids: osmWayIds,
      osm_way_urls: osmWayUrls,
      contains_osm_geometry: sourceKind === "openstreetmap",
    },
    geometry,
  };
}

export async function assertPendingRouteMatchesCandidate(
  client: PoolClient,
  input: DurableCandidateBindingInput
): Promise<PendingRouteBinding> {
  const binding = buildPendingRouteBinding(input);
  const result = await client.query<PendingRouteBindingRow>(
    `SELECT r.name = $2 AS route_name_matches,
            r.shape::text = $3 AS route_shape_matches,
            r.external_links = $4::jsonb AS identity_sources_match,
            jsonb_build_object(
              'source_kind', r.provenance->'source_kind',
              'source_url', r.provenance->'source_url',
              'license_name', r.provenance->'license_name',
              'license_url', r.provenance->'license_url',
              'attribution', r.provenance->'attribution',
              'retrieved_at', r.provenance->'retrieved_at',
              'osm_way_ids', r.provenance->'osm_way_ids',
              'osm_way_urls', r.provenance->'osm_way_urls',
              'contains_osm_geometry',
                r.provenance->'contains_osm_geometry'
            ) = $5::jsonb AS geometry_source_matches,
            encode(
              ST_AsEWKB(ST_Force2D(r.path::geometry)),
              'hex'
            ) = encode(
              ST_AsEWKB(
                ST_Force2D(
                  ST_SetSRID(ST_GeomFromGeoJSON($6::text), 4326)
                )
              ),
              'hex'
            ) AS candidate_path_matches
     FROM routes r
     WHERE r.id = $1
     FOR UPDATE OF r`,
    [
      input.routeId,
      binding.routeName,
      binding.routeShape,
      JSON.stringify(binding.identitySources),
      JSON.stringify(binding.geometrySource),
      JSON.stringify(binding.geometry),
    ]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Imported pending route was not found");
  }
  // The route lock blocks new foreign-key links. Lock each current link next,
  // then compare the full ordered set so a concurrent delete or update cannot
  // change the reviewed trailhead or summit before this transaction commits.
  const destinations = await client.query<PendingRouteDestinationRow>(
    `SELECT rd.destination_id, rd.ordinal
     FROM route_destinations rd
     JOIN destinations d ON d.id = rd.destination_id
     WHERE rd.route_id = $1
     ORDER BY rd.ordinal, rd.destination_id
     FOR UPDATE OF rd, d`,
    [input.routeId]
  );
  const destinationsMatch =
    destinations.rows.length === binding.destinations.length &&
    binding.destinations.every((expected, index) => {
      const actual = destinations.rows[index];
      return (
        actual?.destination_id === expected.destinationId &&
        Number(actual.ordinal) === expected.ordinal
      );
    });
  const mismatches = [
    ["route_name", row.route_name_matches],
    ["route_shape", row.route_shape_matches],
    ["destinations", destinationsMatch],
    ["identity_sources", row.identity_sources_match],
    ["geometry_source", row.geometry_source_matches],
    ["candidate_path", row.candidate_path_matches],
  ]
    .filter(([, matches]) => matches !== true)
    .map(([field]) => field);
  if (mismatches.length > 0) {
    throw new Error(
      `Imported pending route does not match the durable candidate: ` +
        mismatches.join(", ")
    );
  }
  return binding;
}
