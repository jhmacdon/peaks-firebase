#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";
import officialArcgisRequestImport from "../../../../cloud-sql/migrate/src/official-arcgis-request";
import officialRouteGeometryImport from "../../../../cloud-sql/migrate/src/official-route-geometry";
import officialTrailSourcesImport from "../../../../cloud-sql/migrate/src/official-trail-sources";

const { officialArcgisRequestOptions } = officialArcgisRequestImport;

const {
  buildOfficialArcgisQueryUrl,
  buildOfficialRoutePath,
  collectOfficialPathMetadata,
  normalizeOfficialFeatureIds,
  parseOfficialArcgisPaths,
} = officialRouteGeometryImport;
const {
  getPublishableArcgisTrailSource,
  reviewOfficialTrailAccess,
} = officialTrailSourcesImport;

const db =
  typeof (dbImport as { query?: unknown }).query === "function"
    ? dbImport
    : (dbImport as unknown as { default: typeof dbImport }).default;

type Options = {
  sourceId: string;
  featureIds: string[];
  destinationId: string;
  trailheadId: string;
  outputPath: string;
};

type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

function valuesAfter(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function valueAfter(argv: string[], flag: string): string {
  return valuesAfter(argv, flag)[0] ?? "";
}

function parseArgs(argv: string[]): Options {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "Usage: build_official_route_candidate.mts " +
        "--source-id ID --feature-id ID [--feature-id ID ...] " +
        "--destination-id ID --trailhead-id ID --output candidate.geojson"
    );
    process.exit(0);
  }
  const sourceId = valueAfter(argv, "--source-id");
  const destinationId = valueAfter(argv, "--destination-id");
  const trailheadId = valueAfter(argv, "--trailhead-id");
  for (const [label, value] of [
    ["--source-id", sourceId],
    ["--destination-id", destinationId],
    ["--trailhead-id", trailheadId],
  ] as const) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
      throw new Error(`${label} is required and contains unsupported characters`);
    }
  }
  const outputPath = valueAfter(argv, "--output");
  if (!outputPath) throw new Error("--output is required");
  return {
    sourceId,
    featureIds: normalizeOfficialFeatureIds(valuesAfter(argv, "--feature-id")),
    destinationId,
    trailheadId,
    outputPath,
  };
}

async function fetchOfficialPaths(
  queryUrl: URL,
  source: NonNullable<ReturnType<typeof getPublishableArcgisTrailSource>>,
  featureIds: string[]
) {
  const response = await fetch(
    queryUrl,
    officialArcgisRequestOptions(
      "Peaks official route research/1.0 " +
        "(https://github.com/jhmacdon/peaks-firebase)"
    )
  );
  if (!response.ok) {
    throw new Error(`${source.authority} returned HTTP ${response.status}`);
  }
  return parseOfficialArcgisPaths(
    (await response.json()) as unknown,
    source.service,
    featureIds
  );
}

const options = parseArgs(process.argv.slice(2));

try {
  const source = getPublishableArcgisTrailSource(options.sourceId);
  if (!source) {
    throw new Error(`official ArcGIS source is unknown or not publishable: ${options.sourceId}`);
  }
  const placesResult = await db.query<Place>(
    `SELECT id, name,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE id = ANY($1::text[])`,
    [[options.destinationId, options.trailheadId]]
  );
  const places = new Map(placesResult.rows.map((place) => [place.id, place]));
  const destination = places.get(options.destinationId);
  const trailhead = places.get(options.trailheadId);
  if (!destination) throw new Error("Destination was not found");
  if (!trailhead) throw new Error("Trailhead was not found");

  const retrievalUrl = buildOfficialArcgisQueryUrl(
    source.service,
    options.featureIds
  );
  const networkPaths = await fetchOfficialPaths(
    retrievalUrl,
    source,
    options.featureIds
  );
  const route = buildOfficialRoutePath(
    networkPaths,
    { lat: trailhead.lat, lng: trailhead.lng },
    { lat: destination.lat, lng: destination.lng }
  );
  const accessReview = reviewOfficialTrailAccess(source, route.usedPaths);
  if (!accessReview.passed) {
    throw new Error(
      `Official source access policy rejected the route: ${accessReview.errors.join(
        "; "
      )}`
    );
  }
  const publishedSourceUrl = buildOfficialArcgisQueryUrl(
    source.service,
    route.usedFeatureIds
  );
  const metadata = collectOfficialPathMetadata(route.usedPaths);
  const output = {
    type: "FeatureCollection",
    peaks_destination_id: destination.id,
    peaks_trailhead_id: trailhead.id,
    peaks_source_kind: source.id,
    peaks_source: publishedSourceUrl.toString(),
    peaks_retrieval_source: retrievalUrl.toString(),
    peaks_source_authority: source.authority,
    peaks_license_name: source.license.name,
    peaks_license: source.license.url,
    peaks_attribution: source.license.attribution,
    peaks_retrieved_at: new Date().toISOString(),
    features: [
      {
        type: "Feature",
        properties: {
          name: `${destination.name} official route candidate`,
          trailhead_name: trailhead.name,
          destination_name: destination.name,
          distance_m: route.distanceM,
          trailhead_snap_m: route.trailheadSnapM,
          summit_snap_m: route.summitSnapM,
          osm_way_ids: [],
          osm_way_urls: [],
          official_source_id: source.id,
          official_source_kind: source.sourceKind,
          official_authority: source.authority,
          official_feature_ids: route.usedFeatureIds,
          official_requested_feature_ids: options.featureIds,
          official_names: metadata.names,
          official_access: metadata.access,
          largest_connection_m: route.largestConnectionM,
        },
        geometry: {
          type: "LineString",
          coordinates: route.coordinates,
        },
      },
    ],
  };
  await writeFile(options.outputPath, `${JSON.stringify(output)}\n`);
  console.log(
    `Wrote ${options.outputPath}: ${(route.distanceM / 1609.344).toFixed(2)} mi; ` +
      `snaps ${route.trailheadSnapM.toFixed(1)} m / ` +
      `${route.summitSnapM.toFixed(1)} m; largest selected-line connection ` +
      `${route.largestConnectionM.toFixed(1)} m`
  );
  console.log(`Source: ${source.authority}; ${publishedSourceUrl}`);
  console.log(`Attribution: ${source.license.attribution}`);
  console.log(`License: ${source.license.name}; ${source.license.url}`);
} finally {
  await db.end();
}
