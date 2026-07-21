/**
 * Read-only catalog coverage audit against named OpenStreetMap peaks.
 *
 * Examples:
 *   npm run audit:peak-coverage -- --state=WA
 *   npm run audit:peak-coverage -- --state=WA --bbox=-122,48.2,-120.5,49
 *   npm run audit:peak-coverage -- --state=WA --format=json --limit=200
 *   npm run audit:peak-coverage -- --state=WA --input=/tmp/wa-peaks-overpass.json
 *
 * The report never writes destination or session data. It matches reference
 * nodes to the catalog, then ranks unmatched nodes using aggregate proximity to
 * ended session paths. No user/session identifiers are emitted.
 */

import fs from "node:fs/promises";
import db from "./db";
import {
  buildGridCoverage,
  CatalogPeak,
  compareRankedCandidates,
  matchReferencePeak,
  parseElevationMeters,
  PeakMatch,
  rankCoverageCandidate,
  RankedCoverageCandidate,
  ReferencePeak,
} from "./peak-coverage";

type OutputFormat = "summary" | "json";

export interface BoundingBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

interface AuditArgs {
  stateCode: string;
  bbox: BoundingBox | null;
  input: string | null;
  format: OutputFormat;
  limit: number;
  minimumCandidateElevationM: number;
  minimumGridReferencePeaks: number;
}

interface OverpassElement {
  type: "node";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface CatalogRow {
  id: string;
  name: string | null;
  lat: string | number;
  lng: string | number;
  osm_id: string | null;
}

interface EvidenceRow {
  osm_id: string;
  sessions_30m: string | number;
  sessions_100m: string | number;
  sessions_250m: string | number;
}

interface CatalogHealthRow {
  summits: string | number;
  missing_country: string | number;
  missing_state: string | number;
  missing_external_ids: string | number;
}

const DEFAULT_OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export function parseArgs(argv = process.argv.slice(2)): AuditArgs {
  const value = (key: string) => argv.find((arg) => arg.startsWith(`--${key}=`))?.split("=", 2)[1];
  const stateCode = (value("state") ?? "WA").toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateCode)) throw new Error("--state must be a two-letter US state code");

  const format = (value("format") ?? "summary") as OutputFormat;
  if (format !== "summary" && format !== "json") {
    throw new Error("--format must be summary or json");
  }

  const positiveInteger = (key: string, fallback: number) => {
    const parsed = Number.parseInt(value(key) ?? String(fallback), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${key} must be a positive integer`);
    return parsed;
  };
  const nonnegativeNumber = (key: string, fallback: number) => {
    const parsed = Number.parseFloat(value(key) ?? String(fallback));
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${key} must be a non-negative number`);
    return parsed;
  };
  const bboxValue = value("bbox");
  let bbox: BoundingBox | null = null;
  if (bboxValue != null) {
    const coordinates = bboxValue.split(",").map(Number);
    if (coordinates.length !== 4 || coordinates.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error("--bbox must be minLng,minLat,maxLng,maxLat");
    }
    const [minLng, minLat, maxLng, maxLat] = coordinates;
    if (
      minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 ||
      minLng >= maxLng || minLat >= maxLat
    ) {
      throw new Error("--bbox must contain ordered longitude/latitude bounds in valid ranges");
    }
    bbox = { minLng, minLat, maxLng, maxLat };
  }

  return {
    stateCode,
    bbox,
    input: value("input") ?? null,
    format,
    limit: positiveInteger("limit", 50),
    minimumCandidateElevationM: nonnegativeNumber("min-elevation", 0),
    minimumGridReferencePeaks: positiveInteger("min-grid-reference", 10),
  };
}

export function buildOverpassQuery(stateCode: string, bbox: BoundingBox | null = null): string {
  if (bbox) {
    return `[out:json][timeout:180];
node["natural"="peak"]["name"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
out body;`;
  }
  return `[out:json][timeout:180];
area["ISO3166-2"="US-${stateCode}"]["boundary"="administrative"]->.region;
node(area.region)["natural"="peak"]["name"];
out body;`;
}

async function fetchOverpassState(
  stateCode: string,
  bbox: BoundingBox | null
): Promise<OverpassResponse> {
  const configured = process.env.OVERPASS_ENDPOINT?.trim();
  const endpoints = configured
    ? [configured, ...DEFAULT_OVERPASS_ENDPOINTS.filter((endpoint) => endpoint !== configured)]
    : DEFAULT_OVERPASS_ENDPOINTS;
  const query = buildOverpassQuery(stateCode, bbox);
  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const region = bbox
          ? `bbox ${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`
          : `US-${stateCode}`;
        console.error(`[peak-coverage] Fetching ${region} peaks from ${endpoint} (attempt ${attempt + 1})`);
        // Bound a stuck endpoint so the fallback list eventually advances.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 195_000);
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            body: `data=${encodeURIComponent(query)}`,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": "PeaksApp-coverage-audit/1.0 (https://github.com/jhmacdon/peaks-firebase)",
            },
            signal: controller.signal,
          });
          if (response.ok) {
            // Await the body before clearing the abort timer below; returning
            // the promise directly would stop covering response decoding.
            return await response.json() as OverpassResponse;
          }
          lastError = new Error(`Overpass HTTP ${response.status} from ${endpoint}`);
          if (response.status !== 429 && response.status < 500) throw lastError;
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All Overpass endpoints failed");
}

async function loadReferenceData(args: AuditArgs): Promise<OverpassResponse> {
  if (!args.input) return fetchOverpassState(args.stateCode, args.bbox);
  const raw = await fs.readFile(args.input, "utf8");
  const parsed = JSON.parse(raw) as Partial<OverpassResponse>;
  if (!Array.isArray(parsed.elements)) {
    throw new Error("--input must be an Overpass JSON response with an elements array");
  }
  return { elements: parsed.elements as OverpassElement[] };
}

export function parseReferencePeaks(
  data: OverpassResponse,
  stateCode: string,
  bbox: BoundingBox | null = null
): ReferencePeak[] {
  const peaks: ReferencePeak[] = [];
  const bareFeetThreshold = stateCode === "AK" ? null : 5_000;
  for (const element of data.elements) {
    const tags = element.tags ?? {};
    const name = tags.name?.trim();
    if (!name || element.lat == null || element.lon == null) continue;
    if (bbox && (
      element.lon < bbox.minLng || element.lon > bbox.maxLng ||
      element.lat < bbox.minLat || element.lat > bbox.maxLat
    )) continue;
    const elevationM = tags["ele:ft"]
      ? parseElevationMeters(`${tags["ele:ft"]} ft`)
      : parseElevationMeters(tags.ele, bareFeetThreshold);
    peaks.push({
      osmId: String(element.id),
      name,
      lat: element.lat,
      lng: element.lon,
      elevationM,
      wikidataId: tags.wikidata ?? null,
      wikipedia: tags.wikipedia ?? null,
    });
  }
  return peaks;
}

async function loadCatalog(): Promise<CatalogPeak[]> {
  const result = await db.query<CatalogRow>(
    `SELECT id, name,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            external_ids->>'osm' AS osm_id
     FROM destinations
     WHERE location IS NOT NULL
       AND 'summit'::destination_feature = ANY(features)`
  );
  return result.rows.flatMap((row) => row.name ? [{
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    osmId: row.osm_id,
  }] : []);
}

async function loadSessionEvidence(matches: PeakMatch[]): Promise<Map<string, EvidenceRow>> {
  const unmatched = matches.filter((match) => match.method == null).map((match) => ({
    osm_id: match.reference.osmId,
    lat: match.reference.lat,
    lng: match.reference.lng,
  }));
  if (unmatched.length === 0) return new Map();

  const result = await db.query<EvidenceRow>(
    `WITH reference AS (
       SELECT osm_id, lat, lng,
              ST_SetSRID(ST_MakePoint(lng, lat, 0), 4326)::geography AS location
       FROM jsonb_to_recordset($1::jsonb)
         AS peak(osm_id text, lat double precision, lng double precision)
     )
     SELECT reference.osm_id,
            count(DISTINCT sessions.id) FILTER (
              WHERE ST_DWithin(sessions.path, reference.location, 30)
            )::int AS sessions_30m,
            count(DISTINCT sessions.id) FILTER (
              WHERE ST_DWithin(sessions.path, reference.location, 100)
            )::int AS sessions_100m,
            count(DISTINCT sessions.id)::int AS sessions_250m
     FROM reference
     LEFT JOIN tracking_sessions sessions
       ON sessions.ended = true
      AND sessions.path IS NOT NULL
      AND ST_DWithin(sessions.path, reference.location, 250)
     GROUP BY reference.osm_id`,
    [JSON.stringify(unmatched)]
  );
  return new Map(result.rows.map((row) => [row.osm_id, row]));
}

async function loadCatalogHealth(): Promise<CatalogHealthRow> {
  const result = await db.query<CatalogHealthRow>(
    `SELECT count(*)::int AS summits,
            count(*) FILTER (WHERE country_code IS NULL)::int AS missing_country,
            count(*) FILTER (WHERE state_code IS NULL)::int AS missing_state,
            count(*) FILTER (WHERE external_ids = '{}'::jsonb)::int AS missing_external_ids
     FROM destinations
     WHERE 'summit'::destination_feature = ANY(features)`
  );
  return result.rows[0];
}

function numberValue(value: string | number | undefined): number {
  return value == null ? 0 : Number(value);
}

function catalogCountInsideReferenceBounds(catalog: CatalogPeak[], reference: ReferencePeak[]): number {
  if (reference.length === 0) return 0;
  const lats = reference.map((peak) => peak.lat);
  const lngs = reference.map((peak) => peak.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return catalog.filter((peak) =>
    peak.lat >= minLat && peak.lat <= maxLat && peak.lng >= minLng && peak.lng <= maxLng
  ).length;
}

async function buildReport(args: AuditArgs) {
  const data = await loadReferenceData(args);
  const reference = parseReferencePeaks(data, args.stateCode, args.bbox);
  if (reference.length === 0) {
    throw new Error(
      `Coverage audit found zero usable named peaks for US-${args.stateCode}; ` +
      "refusing to emit a misleading empty report"
    );
  }
  const catalog = await loadCatalog();
  const matches = reference.map((peak) => matchReferencePeak(peak, catalog));
  const evidenceByOsmId = await loadSessionEvidence(matches);
  const catalogHealth = await loadCatalogHealth();
  const candidates: RankedCoverageCandidate[] = matches
    .filter((match) =>
      match.method == null &&
      (match.reference.elevationM == null || match.reference.elevationM >= args.minimumCandidateElevationM)
    )
    .map((match) => {
      const evidence = evidenceByOsmId.get(match.reference.osmId);
      return rankCoverageCandidate(match, {
        sessionsWithin30m: numberValue(evidence?.sessions_30m),
        sessionsWithin100m: numberValue(evidence?.sessions_100m),
        sessionsWithin250m: numberValue(evidence?.sessions_250m),
      });
    })
    .sort(compareRankedCandidates);
  const grids = buildGridCoverage(matches);
  const highElevationGrids = buildGridCoverage(
    matches.filter((match) => (match.reference.elevationM ?? -1) >= 1_000)
  );
  const matchedByMethod = matches.reduce<Record<string, number>>((counts, match) => {
    const key = match.method ?? "unmatched";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const matched = matches.length - (matchedByMethod.unmatched ?? 0);

  return {
    generatedAt: new Date().toISOString(),
    stateCode: args.stateCode,
    bbox: args.bbox,
    source: args.input
      ? { type: "overpass_json", path: args.input }
      : { type: "overpass", natural: "peak", bbox: args.bbox },
    thresholds: {
      spatialMatchMeters: 150,
      sameNameMatchMeters: 1_000,
      sessionEvidenceMeters: [30, 100, 250],
      gridDegrees: 0.5,
      candidateMinimumElevationM: args.minimumCandidateElevationM,
    },
    totals: {
      referencePeaks: reference.length,
      catalogPeaksInReferenceBounds: catalogCountInsideReferenceBounds(catalog, reference),
      matchedPeaks: matched,
      unmatchedPeaks: matches.length - matched,
      coveragePercent: reference.length === 0 ? 0 : Math.round((matched / reference.length) * 1_000) / 10,
      matchedByMethod,
    },
    catalogHealth: {
      summits: numberValue(catalogHealth.summits),
      missingCountry: numberValue(catalogHealth.missing_country),
      missingState: numberValue(catalogHealth.missing_state),
      missingExternalIds: numberValue(catalogHealth.missing_external_ids),
    },
    grids: grids.filter((grid) => grid.referencePeaks >= args.minimumGridReferencePeaks),
    highElevationGrids: highElevationGrids.filter(
      (grid) => grid.referencePeaks >= args.minimumGridReferencePeaks
    ),
    candidates: candidates.slice(0, args.limit),
    candidateCountAfterElevationFilter: candidates.length,
  };
}

function printSummary(report: Awaited<ReturnType<typeof buildReport>>): void {
  const { totals, catalogHealth } = report;
  console.log(`Peak coverage audit — US-${report.stateCode}`);
  if (report.bbox) {
    console.log(
      `Bounds: ${report.bbox.minLng},${report.bbox.minLat} to ` +
      `${report.bbox.maxLng},${report.bbox.maxLat}`
    );
  }
  console.log(`Reference: ${totals.referencePeaks} named OSM peaks`);
  console.log(
    `Matched: ${totals.matchedPeaks} (${totals.coveragePercent}%) · ` +
    `Unmatched: ${totals.unmatchedPeaks} · Catalog in bounds: ${totals.catalogPeaksInReferenceBounds}`
  );
  console.log(
    `Catalog provenance: ${catalogHealth.missingExternalIds}/${catalogHealth.summits} summits missing external IDs; ` +
    `${catalogHealth.missingState} missing state`
  );

  console.log("\nTop unmatched candidates");
  for (const candidate of report.candidates) {
    const elevation = candidate.reference.elevationM == null
      ? "elev ?"
      : `${Math.round(candidate.reference.elevationM)} m`;
    const nearest = candidate.distanceMeters == null
      ? "no catalog summit"
      : `${Math.round(candidate.distanceMeters)} m from ${candidate.destinationName}`;
    const flags = candidate.reviewFlags.length ? ` · ${candidate.reviewFlags.join(",")}` : "";
    console.log(
      `- ${candidate.reference.name} [${candidate.confidence}] · ${elevation} · ` +
      `sessions 30/100/250m=${candidate.sessionsWithin30m}/${candidate.sessionsWithin100m}/${candidate.sessionsWithin250m} · ` +
      `${nearest} · OSM ${candidate.reference.osmId}${flags}`
    );
  }

  console.log("\nLargest high-elevation grid gaps (>=1,000 m)");
  for (const grid of report.highElevationGrids.slice(0, 15)) {
    console.log(
      `- ${grid.grid}: ${grid.missingPeaks}/${grid.referencePeaks} missing ` +
      `(${grid.coveragePercent}% covered)`
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  try {
    const report = await buildReport(args);
    if (args.format === "json") console.log(JSON.stringify(report, null, 2));
    else printSummary(report);
  } finally {
    await db.end();
  }
}

if (/(?:^|[/\\])audit-peak-coverage\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
