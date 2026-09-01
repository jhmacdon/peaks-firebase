#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import officialRouteGeometryImport from "../../../../cloud-sql/migrate/src/official-route-geometry";
import officialTrailSourcesImport from "../../../../cloud-sql/migrate/src/official-trail-sources";
import usgsTrailsSourceImport from "../../../../cloud-sql/migrate/src/usgs-trails-source";

const {
  buildOfficialArcgisQueryUrl,
  haversineMeters,
  isSimpleClosedRoute,
  normalizeOfficialFeatureIds,
  reviewLollipopRetrace,
} = officialRouteGeometryImport;
const { getPublishableArcgisTrailSource } = officialTrailSourcesImport;
const {
  buildUsgsTrailAttribution,
  buildUsgsTrailsQueryUrl,
  parseUsgsTrailsQueryUrl,
  USGS_TRAILS_LICENSE_NAME,
  USGS_TRAILS_LICENSE_URL,
} = usgsTrailsSourceImport;

type GeoJson = {
  type: "FeatureCollection";
  peaks_destination_id: string;
  peaks_trailhead_id: string;
  peaks_source_kind?: string;
  peaks_source: string;
  peaks_retrieval_source?: string;
  peaks_source_authority?: string;
  peaks_license_name: string;
  peaks_license: string;
  peaks_attribution: string;
  peaks_retrieved_at: string;
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: {
      type: "LineString";
      coordinates: Array<[number, number]>;
    };
  }>;
};

function valueAfter(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? "" : "";
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function numberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(item))) {
    throw new Error(`${label} must be an integer array`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function uniqueStrings(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  key: string
): string[] {
  return [
    ...new Set([
      ...stringArray(first[key], `outbound ${key}`),
      ...stringArray(second[key], `return ${key}`),
    ]),
  ];
}

function uniqueNumbers(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  key: string
): number[] {
  return [
    ...new Set([
      ...numberArray(first[key], `outbound ${key}`),
      ...numberArray(second[key], `return ${key}`),
    ]),
  ];
}

type CandidateKind = "openstreetmap" | "usgs-national-map" | "official";

function candidateKind(
  properties: Record<string, unknown>
): CandidateKind {
  if (typeof properties.official_source_id === "string") return "official";
  if (Array.isArray(properties.usgs_object_ids)) return "usgs-national-map";
  if (Array.isArray(properties.osm_way_ids)) return "openstreetmap";
  throw new Error("Candidate has no supported geometry source metadata");
}

function matchingText(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  key: string
): string {
  const left = first[key];
  const right = second[key];
  if (typeof left !== "string" || left !== right) {
    throw new Error(`Candidate ${key} metadata does not match`);
  }
  return left;
}

function distanceM(a: [number, number], b: [number, number]): number {
  return haversineMeters(
    { lng: a[0], lat: a[1] },
    { lng: b[0], lat: b[1] }
  );
}

async function load(path: string): Promise<GeoJson> {
  const value = JSON.parse(await readFile(path, "utf8")) as GeoJson;
  if (
    value.type !== "FeatureCollection" ||
    value.features?.length !== 1 ||
    value.features[0].geometry?.type !== "LineString"
  ) {
    throw new Error(`${path} is not a one-line candidate`);
  }
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "Usage: merge_route_loop_candidates.mts --outbound ascent.geojson " +
        "--return descent-reversed.geojson --trailhead-id ID " +
        "[--route-shape loop|lollipop] --output loop.geojson"
    );
    return;
  }
  const outboundPath = valueAfter(argv, "--outbound");
  const returnPath = valueAfter(argv, "--return");
  const trailheadId = valueAfter(argv, "--trailhead-id");
  const routeShape = valueAfter(argv, "--route-shape") || "loop";
  const outputPath = valueAfter(argv, "--output");
  if (!outboundPath || !returnPath || !trailheadId || !outputPath) {
    throw new Error(
      "Usage: merge_route_loop_candidates.mts --outbound ascent.geojson " +
      "--return descent-reversed.geojson --trailhead-id ID " +
      "[--route-shape loop|lollipop] --output loop.geojson"
    );
  }
  if (!["loop", "lollipop"].includes(routeShape)) {
    throw new Error("--route-shape must be loop or lollipop");
  }

  const outbound = await load(outboundPath);
  const returnLeg = await load(returnPath);
  if (
    outbound.peaks_destination_id !== returnLeg.peaks_destination_id ||
    outbound.peaks_trailhead_id !== returnLeg.peaks_trailhead_id ||
    outbound.peaks_trailhead_id !== trailheadId ||
    outbound.peaks_license_name !== returnLeg.peaks_license_name ||
    outbound.peaks_license !== returnLeg.peaks_license
  ) {
    throw new Error("Candidate source or destination metadata does not match");
  }

  const outboundFeature = outbound.features[0];
  const returnFeature = returnLeg.features[0];
  const outboundCoordinates = outboundFeature.geometry.coordinates;
  const returnCoordinates = returnFeature.geometry.coordinates;
  if (
    distanceM(outboundCoordinates[0], returnCoordinates[0]) > 20 ||
    distanceM(
      outboundCoordinates[outboundCoordinates.length - 1],
      returnCoordinates[returnCoordinates.length - 1]
    ) > 20
  ) {
    throw new Error("Candidate trailhead or summit endpoints do not match");
  }

  const outboundProperties = outboundFeature.properties;
  const returnProperties = returnFeature.properties;
  const kind = candidateKind(outboundProperties);
  if (candidateKind(returnProperties) !== kind) {
    throw new Error("Candidate geometry source kinds do not match");
  }
  let peaksSource = outbound.peaks_source;
  let peaksRetrievalSource = outbound.peaks_retrieval_source;
  let peaksAttribution = outbound.peaks_attribution;
  let sourceProperties: Record<string, unknown>;
  if (kind === "openstreetmap") {
    if (
      (outbound.peaks_source_kind !== undefined &&
        outbound.peaks_source_kind !== "openstreetmap") ||
      (returnLeg.peaks_source_kind !== undefined &&
        returnLeg.peaks_source_kind !== "openstreetmap") ||
      outbound.peaks_source !== returnLeg.peaks_source ||
      outbound.peaks_retrieval_source !== returnLeg.peaks_retrieval_source ||
      outbound.peaks_attribution !== returnLeg.peaks_attribution
    ) {
      throw new Error("OpenStreetMap candidate source metadata does not match");
    }
    const wayIds = uniqueNumbers(
      outboundProperties,
      returnProperties,
      "osm_way_ids"
    );
    sourceProperties = {
      osm_way_ids: wayIds,
      osm_way_urls: wayIds.map(
        (id) => `https://www.openstreetmap.org/way/${id}`
      ),
      osm_way_names: uniqueStrings(
        outboundProperties,
        returnProperties,
        "osm_way_names"
      ),
      osm_foot_access_override_way_ids: uniqueNumbers(
        outboundProperties,
        returnProperties,
        "osm_foot_access_override_way_ids"
      ),
    };
  } else if (kind === "usgs-national-map") {
    if (
      outbound.peaks_source_kind !== "usgs-national-map" ||
      returnLeg.peaks_source_kind !== "usgs-national-map"
    ) {
      throw new Error("USGS candidate source kind metadata does not match");
    }
    parseUsgsTrailsQueryUrl(outbound.peaks_source);
    parseUsgsTrailsQueryUrl(returnLeg.peaks_source);
    const outboundOriginators = stringArray(
      outboundProperties.usgs_originators,
      "outbound usgs_originators"
    );
    const returnOriginators = stringArray(
      returnProperties.usgs_originators,
      "return usgs_originators"
    );
    if (
      outbound.peaks_license_name !== USGS_TRAILS_LICENSE_NAME ||
      outbound.peaks_license !== USGS_TRAILS_LICENSE_URL ||
      outbound.peaks_attribution !==
        buildUsgsTrailAttribution(outboundOriginators) ||
      returnLeg.peaks_attribution !==
        buildUsgsTrailAttribution(returnOriginators)
    ) {
      throw new Error("USGS candidate rights metadata is invalid");
    }
    const objectIds = uniqueNumbers(
      outboundProperties,
      returnProperties,
      "usgs_object_ids"
    ).sort((left, right) => left - right);
    peaksSource = buildUsgsTrailsQueryUrl(objectIds).toString();
    peaksRetrievalSource = peaksSource;
    const originators = uniqueStrings(
      outboundProperties,
      returnProperties,
      "usgs_originators"
    );
    peaksAttribution = buildUsgsTrailAttribution(originators);
    sourceProperties = {
      usgs_object_ids: objectIds,
      usgs_requested_object_ids: uniqueNumbers(
        outboundProperties,
        returnProperties,
        "usgs_requested_object_ids"
      ).sort((left, right) => left - right),
      usgs_names: uniqueStrings(
        outboundProperties,
        returnProperties,
        "usgs_names"
      ),
      usgs_originators: originators,
      usgs_source_feature_ids: uniqueStrings(
        outboundProperties,
        returnProperties,
        "usgs_source_feature_ids"
      ),
      usgs_source_dataset_ids: uniqueStrings(
        outboundProperties,
        returnProperties,
        "usgs_source_dataset_ids"
      ),
    };
  } else {
    const sourceId = matchingText(
      outboundProperties,
      returnProperties,
      "official_source_id"
    );
    if (
      outbound.peaks_source_kind !== sourceId ||
      returnLeg.peaks_source_kind !== sourceId
    ) {
      throw new Error("Official candidate source kind metadata does not match");
    }
    const source = getPublishableArcgisTrailSource(sourceId);
    if (!source) {
      throw new Error(`Official source is unknown or not publishable: ${sourceId}`);
    }
    if (
      outbound.peaks_license_name !== source.license.name ||
      outbound.peaks_license !== source.license.url ||
      outbound.peaks_attribution !== source.license.attribution ||
      returnLeg.peaks_attribution !== source.license.attribution
    ) {
      throw new Error("Official candidate rights metadata does not match the registry");
    }
    const sourceKind = matchingText(
      outboundProperties,
      returnProperties,
      "official_source_kind"
    );
    const authority = matchingText(
      outboundProperties,
      returnProperties,
      "official_authority"
    );
    if (
      sourceKind !== source.sourceKind ||
      authority !== source.authority ||
      outbound.peaks_source_authority !== source.authority ||
      returnLeg.peaks_source_authority !== source.authority
    ) {
      throw new Error("Official candidate metadata does not match the registry");
    }
    const featureIds = normalizeOfficialFeatureIds(
      uniqueStrings(
        outboundProperties,
        returnProperties,
        "official_feature_ids"
      )
    );
    peaksSource = buildOfficialArcgisQueryUrl(
      source.service,
      featureIds
    ).toString();
    const requestedFeatureIds = normalizeOfficialFeatureIds(
      uniqueStrings(
        outboundProperties,
        returnProperties,
        "official_requested_feature_ids"
      )
    );
    peaksRetrievalSource = buildOfficialArcgisQueryUrl(
      source.service,
      requestedFeatureIds
    ).toString();
    sourceProperties = {
      official_source_id: sourceId,
      official_source_kind: sourceKind,
      official_authority: authority,
      official_feature_ids: featureIds,
      official_requested_feature_ids: requestedFeatureIds,
      official_names: uniqueStrings(
        outboundProperties,
        returnProperties,
        "official_names"
      ),
      official_access: uniqueStrings(
        outboundProperties,
        returnProperties,
        "official_access"
      ),
    };
  }
  const coordinates = [
    ...outboundCoordinates,
    ...[...returnCoordinates].reverse().slice(
      distanceM(
        outboundCoordinates[outboundCoordinates.length - 1],
        returnCoordinates[returnCoordinates.length - 1]
      ) <= 0.25
        ? 1
        : 0
    ),
  ];
  if (distanceM(coordinates[0], coordinates[coordinates.length - 1]) <= 0.25) {
    coordinates[coordinates.length - 1] = coordinates[0];
  } else {
    coordinates.push(coordinates[0]);
  }
  const routePoints = coordinates.map(([lng, lat]) => ({ lng, lat }));
  if (routeShape === "loop" && !isSimpleClosedRoute(routePoints)) {
    throw new Error("Merged loop is not a simple closed route");
  }
  if (
    routeShape === "lollipop" &&
    !reviewLollipopRetrace(routePoints).valid
  ) {
    throw new Error(
      "Merged lollipop lacks one safe retraced stem and a non-retraced loop"
    );
  }
  const retrievedTimes = [
    Date.parse(outbound.peaks_retrieved_at),
    Date.parse(returnLeg.peaks_retrieved_at),
  ];
  if (retrievedTimes.some((value) => !Number.isFinite(value))) {
    throw new Error("Candidate retrieval times are invalid");
  }
  const mergedDistanceM = coordinates.slice(1).reduce(
    (total, coordinate, index) =>
      total + distanceM(coordinates[index], coordinate),
    0
  );
  const connectionValues = [
    outboundProperties.largest_connection_m,
    returnProperties.largest_connection_m,
  ].filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)
  );
  const result: GeoJson = {
    ...outbound,
    peaks_trailhead_id: trailheadId,
    peaks_source: peaksSource,
    peaks_retrieval_source: peaksRetrievalSource,
    peaks_attribution: peaksAttribution,
    peaks_retrieved_at: new Date(
      Math.max(...retrievedTimes)
    ).toISOString(),
    features: [
      {
        type: "Feature",
        properties: {
          ...outboundProperties,
          ...sourceProperties,
          name:
            `${String(outboundProperties.destination_name)} ${routeShape} ` +
            `route candidate`,
          distance_m: mergedDistanceM,
          trailhead_snap_m: Math.max(
            numberValue(outboundProperties.trailhead_snap_m, "outbound trailhead snap"),
            numberValue(returnProperties.trailhead_snap_m, "return trailhead snap")
          ),
          summit_snap_m: Math.max(
            numberValue(outboundProperties.summit_snap_m, "outbound summit snap"),
            numberValue(returnProperties.summit_snap_m, "return summit snap")
          ),
          ...(connectionValues.length > 0
            ? { largest_connection_m: Math.max(...connectionValues) }
            : {}),
          route_shape: routeShape,
        },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
  await writeFile(outputPath, `${JSON.stringify(result)}\n`);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
