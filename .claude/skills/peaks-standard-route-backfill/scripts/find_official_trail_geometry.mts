#!/usr/bin/env node

import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";
import officialArcgisRequestImport from "../../../../cloud-sql/migrate/src/official-arcgis-request";
import officialTrailSourcesImport from "../../../../cloud-sql/migrate/src/official-trail-sources";

const { officialArcgisRequestOptions } = officialArcgisRequestImport;

const {
  getPublishableArcgisTrailSource,
  publishableArcgisTrailSourcesForCountry,
} = officialTrailSourcesImport;

const db =
  typeof (dbImport as { query?: unknown }).query === "function"
    ? dbImport
    : (dbImport as unknown as { default: typeof dbImport }).default;

type Source = NonNullable<
  ReturnType<typeof getPublishableArcgisTrailSource>
>;

type Place = {
  id: string;
  name: string;
  country_code: string | null;
  lat: number;
  lng: number;
};

type DiscoveryRow = {
  source_id: string;
  authority: string;
  feature_id: string;
  names: string[];
  access: string[];
};

const MAX_DISCOVERY_ROWS_PER_SOURCE = 200;
const MAX_DISPLAY_TEXT_LENGTH = 160;
const FREE_TEXT_ACCESS_FIELD = /(?:notes?|description|desc)$/i;

function usage(): never {
  console.log(
    "Usage: find_official_trail_geometry.mts --destination-id ID " +
      "[--source-id ID] [--radius-m 20000] [--format table|json]"
  );
  process.exit(0);
}

function valueAfter(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index < 0 ? "" : argv[index + 1] ?? "";
}

function propertyValue(
  properties: Record<string, unknown>,
  field: string
): unknown {
  if (Object.prototype.hasOwnProperty.call(properties, field)) {
    return properties[field];
  }
  const normalized = field.toLowerCase();
  const key = Object.keys(properties).find(
    (candidate) => candidate.toLowerCase() === normalized
  );
  return key === undefined ? undefined : properties[key];
}

function textValue(properties: Record<string, unknown>, field: string): string {
  const value = propertyValue(properties, field);
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : typeof value === "boolean"
          ? String(value)
          : "";
  if (!text) return "";
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DISPLAY_TEXT_LENGTH);
}

function uniqueText(
  properties: Record<string, unknown>,
  fields: readonly string[]
): string[] {
  return [
    ...new Set(fields.map((field) => textValue(properties, field)).filter(Boolean)),
  ];
}

function discoveryUrl(source: Source, place: Place, radiusM: number): URL {
  const url = new URL(source.service.queryUrl);
  const fields = [
    source.service.idField,
    ...source.service.nameFields,
    ...source.service.accessFields.filter(
      (field) => !FREE_TEXT_ACCESS_FIELD.test(field)
    ),
  ];
  url.searchParams.set("where", "1=1");
  url.searchParams.set("geometry", `${place.lng},${place.lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("distance", String(radiusM));
  url.searchParams.set("units", "esriSRUnit_Meter");
  url.searchParams.set("outFields", [...new Set(fields)].join(","));
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set(
    "resultRecordCount",
    String(MAX_DISCOVERY_ROWS_PER_SOURCE)
  );
  url.searchParams.set("f", "json");
  return url;
}

async function discover(
  source: Source,
  place: Place,
  radiusM: number
): Promise<DiscoveryRow[]> {
  const response = await fetch(
    discoveryUrl(source, place, radiusM),
    officialArcgisRequestOptions(
      "Peaks official trail discovery/1.0 " +
        "(https://github.com/jhmacdon/peaks-firebase)"
    )
  );
  if (!response.ok) {
    throw new Error(`${source.authority} returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    error?: { code?: unknown; message?: unknown };
    exceededTransferLimit?: boolean;
    features?: Array<{ attributes?: Record<string, unknown> }>;
  };
  if (payload.error) {
    throw new Error(
      `${source.authority} returned ArcGIS error ${String(
        payload.error.code ?? "unknown"
      )}: ${String(payload.error.message ?? "unknown")}`
    );
  }
  if (payload.exceededTransferLimit) {
    throw new Error(
      `${source.authority} exceeded its result limit; narrow --radius-m`
    );
  }
  if ((payload.features?.length ?? 0) > MAX_DISCOVERY_ROWS_PER_SOURCE) {
    throw new Error(
      `${source.authority} returned more than ${MAX_DISCOVERY_ROWS_PER_SOURCE} ` +
        "features; narrow --radius-m"
    );
  }
  const grouped = new Map<string, DiscoveryRow>();
  for (const feature of payload.features ?? []) {
    const attributes = feature.attributes ?? {};
    const featureId = textValue(attributes, source.service.idField);
    if (!featureId) continue;
    const prior = grouped.get(featureId);
    const names = uniqueText(attributes, source.service.nameFields);
    const access = uniqueText(
      attributes,
      source.service.accessFields.filter(
        (field) => !FREE_TEXT_ACCESS_FIELD.test(field)
      )
    );
    grouped.set(featureId, {
      source_id: source.id,
      authority: source.authority,
      feature_id: featureId,
      names: [...new Set([...(prior?.names ?? []), ...names])].sort(),
      access: [...new Set([...(prior?.access ?? []), ...access])].sort(),
    });
  }
  return [...grouped.values()].sort((left, right) =>
    left.feature_id.localeCompare(right.feature_id)
  );
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) usage();
const destinationId = valueAfter(argv, "--destination-id");
const sourceId = valueAfter(argv, "--source-id");
const format = valueAfter(argv, "--format") || "table";
const radiusM = Number(valueAfter(argv, "--radius-m") || "20000");
if (!/^[A-Za-z0-9_-]+$/.test(destinationId)) {
  throw new Error("--destination-id is required");
}
if (sourceId && !/^[A-Za-z0-9_-]+$/.test(sourceId)) {
  throw new Error("--source-id contains unsupported characters");
}
if (!Number.isInteger(radiusM) || radiusM < 500 || radiusM > 50_000) {
  throw new Error("--radius-m must be an integer from 500 through 50000");
}
if (format !== "table" && format !== "json") {
  throw new Error("--format must be table or json");
}

try {
  const result = await db.query<Place>(
    `SELECT id, name, country_code,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng
     FROM destinations
     WHERE id = $1`,
    [destinationId]
  );
  const place = result.rows[0];
  if (!place) throw new Error(`Destination was not found: ${destinationId}`);
  const sources = sourceId
    ? [getPublishableArcgisTrailSource(sourceId)].filter(
        (source): source is Source => source != null
      )
    : place.country_code
      ? publishableArcgisTrailSourcesForCountry(place.country_code)
      : [];
  if (sources.length === 0) {
    throw new Error(
      sourceId
        ? `official ArcGIS source is unknown or not publishable: ${sourceId}`
        : `no publishable official ArcGIS source covers ${
            place.country_code ?? "this destination"
          }`
    );
  }
  const settled = await Promise.allSettled(
    sources.map((source) => discover(source, place, radiusM))
  );
  const sourceErrors = settled.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            source_id: sources[index].id,
            error: (result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
            )
              .replace(/[\u0000-\u001f\u007f]+/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, MAX_DISPLAY_TEXT_LENGTH),
          },
        ]
      : []
  );
  if (sourceErrors.length === sources.length) {
    throw new Error(
      `every applicable official source failed: ${sourceErrors
        .map(({ source_id, error }) => `${source_id}: ${error}`)
        .join("; ")}`
    );
  }
  const rows = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  if (format === "json") {
    console.log(
      JSON.stringify({
        destination: {
          id: place.id,
          name: place.name,
          country_code: place.country_code,
        },
        radius_m: radiusM,
        sources: sources.map(({ id, authority }) => ({ id, authority })),
        source_errors: sourceErrors,
        features: rows,
      })
    );
  } else {
    for (const { source_id, error } of sourceErrors) {
      console.error(`SOURCE ERROR ${source_id}: ${error}`);
    }
    console.log("source_id\tfeature_id\tnames\taccess");
    for (const row of rows) {
      console.log(
        [
          row.source_id,
          row.feature_id,
          row.names.join(" | "),
          row.access.join(" | "),
        ].join("\t")
      );
    }
  }
} finally {
  await db.end();
}
