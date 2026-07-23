/**
 * Audits one or more jurisdictions and optionally applies conservative peak
 * catalog additions plus safe OSM/Wikidata ID backfills.
 *
 * Dry-run is the default. Use --apply only after reviewing the report. Batch
 * runs are resumable with --cache-dir and emit one JSON report per scope.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import db from "./db";
import {
  AuditArgs,
  fetchOverpassPeaks,
  loadSessionEvidence,
  OverpassResponse,
  parseReferencePeaks,
} from "./audit-peak-coverage";
import {
  buildPeakCatalogIndex,
  CatalogPeak,
  haversineMeters,
  matchReferencePeakFromIndex,
  normalizePeakName,
  PeakMatch,
  ReferencePeak,
  reviewFlagsForCandidate,
  SessionProximityEvidence,
} from "./peak-coverage";
import {
  DEFAULT_MINIMUM_PROMINENCE_M,
  DEFAULT_POPULAR_WIKIPEDIA_SITELINKS,
  fetchWikidataPeakFacts,
  PeakSelection,
  selectPeakCandidate,
  WikidataPeakFacts,
} from "./peak-coverage-enrichment";
import { ISO_COUNTRY_CODES, US_STATE_CODES } from "./peak-coverage-jurisdictions";

export interface CoverageScope {
  key: string;
  label: string;
  stateCode: string | null;
  countryCode: string;
}

export interface ExpansionArgs {
  scopes: CoverageScope[];
  apply: boolean;
  resume: boolean;
  concurrency: number;
  cacheDir: string | null;
  reportDir: string | null;
  minimumProminenceM: number;
  popularWikipediaSitelinks: number;
  maxAdditionsPerScope: number | null;
  continueOnError: boolean;
}

export interface ExpansionCatalogPeak extends CatalogPeak {
  wikidataId: string | null;
}

export interface OsmIdBackfill {
  destinationId: string;
  destinationName: string;
  osmId: string;
  wikidataId: string | null;
  referenceName: string;
  method: string;
  distanceMeters: number;
}

interface AppliedChanges {
  inserted: Array<{ id: string; osmId: string }>;
  backfilled: Array<{ destinationId: string; osmId: string }>;
}

const value = (argv: string[], key: string) =>
  argv.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);

function parseCodes(raw: string | undefined, option: string): string[] {
  if (!raw) throw new Error(`--${option} requires a comma-separated value`);
  const codes = raw.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0 || codes.some((code) => !/^[A-Z]{2}$/.test(code))) {
    throw new Error(`--${option} must contain two-letter codes`);
  }
  return [...new Set(codes)];
}

function stateScope(stateCode: string): CoverageScope {
  return { key: `US-${stateCode}`, label: `US-${stateCode}`, stateCode, countryCode: "US" };
}

function countryScope(countryCode: string): CoverageScope {
  return { key: countryCode, label: countryCode, stateCode: null, countryCode };
}

export function parseExpansionArgs(argv = process.argv.slice(2)): ExpansionArgs {
  const modes = [
    value(argv, "state") != null,
    value(argv, "states") != null,
    argv.includes("--all-states"),
    value(argv, "country") != null,
    value(argv, "countries") != null,
    argv.includes("--all-countries"),
  ].filter(Boolean).length;
  if (modes !== 1) {
    throw new Error("Choose exactly one of --state, --states, --all-states, --country, --countries, or --all-countries");
  }

  let scopes: CoverageScope[];
  if (value(argv, "state")) scopes = parseCodes(value(argv, "state"), "state").map(stateScope);
  else if (value(argv, "states")) scopes = parseCodes(value(argv, "states"), "states").map(stateScope);
  else if (argv.includes("--all-states")) scopes = US_STATE_CODES.map(stateScope);
  else if (value(argv, "country")) scopes = parseCodes(value(argv, "country"), "country").map(countryScope);
  else if (value(argv, "countries")) scopes = parseCodes(value(argv, "countries"), "countries").map(countryScope);
  else scopes = ISO_COUNTRY_CODES.map(countryScope);

  const prominenceFeet = Number.parseFloat(value(argv, "prominence-feet") ?? "300");
  if (!Number.isFinite(prominenceFeet) || prominenceFeet < 0) {
    throw new Error("--prominence-feet must be a non-negative number");
  }
  const popularWikipediaSitelinks = Number.parseInt(
    value(argv, "popular-wikipedia-sitelinks") ?? String(DEFAULT_POPULAR_WIKIPEDIA_SITELINKS),
    10
  );
  if (!Number.isInteger(popularWikipediaSitelinks) || popularWikipediaSitelinks <= 0) {
    throw new Error("--popular-wikipedia-sitelinks must be a positive integer");
  }
  const maxRaw = value(argv, "max-additions");
  const maxAdditionsPerScope = maxRaw == null ? null : Number.parseInt(maxRaw, 10);
  if (maxAdditionsPerScope != null && (!Number.isInteger(maxAdditionsPerScope) || maxAdditionsPerScope <= 0)) {
    throw new Error("--max-additions must be a positive integer");
  }
  const concurrency = Number.parseInt(value(argv, "concurrency") ?? "1", 10);
  if (!Number.isInteger(concurrency) || concurrency <= 0 || concurrency > 4) {
    throw new Error("--concurrency must be an integer from 1 to 4");
  }
  const apply = argv.includes("--apply");
  const resume = argv.includes("--resume");
  const reportDir = value(argv, "report-dir") ?? null;
  if (resume && (!apply || !reportDir)) {
    throw new Error("--resume requires --apply and --report-dir");
  }

  return {
    scopes,
    apply,
    resume,
    concurrency,
    cacheDir: value(argv, "cache-dir") ?? null,
    reportDir,
    minimumProminenceM: prominenceFeet * 0.3048,
    popularWikipediaSitelinks,
    maxAdditionsPerScope,
    continueOnError: scopes.length > 1 && !argv.includes("--stop-on-error"),
  };
}

async function loadCatalog(): Promise<ExpansionCatalogPeak[]> {
  const result = await db.query<{
    id: string;
    name: string;
    lat: string | number;
    lng: string | number;
    osm_id: string | null;
    wikidata_id: string | null;
  }>(
    `SELECT id, name,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            external_ids->>'osm' AS osm_id,
            external_ids->>'wikidata' AS wikidata_id
     FROM destinations
     WHERE location IS NOT NULL
       AND name IS NOT NULL
       AND 'summit'::destination_feature = ANY(features)`
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    osmId: row.osm_id,
    wikidataId: row.wikidata_id,
  }));
}

async function loadScopeData(scope: CoverageScope, cacheDir: string | null): Promise<OverpassResponse> {
  if (!cacheDir) return fetchOverpassPeaks(scope.stateCode, scope.countryCode, null);
  const file = path.join(cacheDir, `${scope.key}.overpass.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as OverpassResponse;
    if (!Array.isArray(parsed.elements)) throw new Error(`Invalid cached Overpass response: ${file}`);
    console.error(`[peak-expand] ${scope.label}: using ${file}`);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const data = await fetchOverpassPeaks(scope.stateCode, scope.countryCode, null);
  await fs.mkdir(cacheDir, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data));
  await fs.rename(temporary, file);
  return data;
}

async function loadWikidataData(
  scope: CoverageScope,
  wikidataIds: string[],
  cacheDir: string | null
): Promise<Map<string, WikidataPeakFacts>> {
  const uniqueIds = [...new Set(wikidataIds)];
  if (!cacheDir) return fetchWikidataPeakFacts(uniqueIds);
  const file = path.join(cacheDir, `${scope.key}.wikidata.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { facts?: WikidataPeakFacts[] };
    if (!Array.isArray(parsed.facts)) throw new Error(`Invalid cached Wikidata response: ${file}`);
    console.error(`[peak-expand] ${scope.label}: using ${file}`);
    return new Map(parsed.facts.map((facts) => [facts.wikidataId, facts]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  console.error(`[peak-expand] ${scope.label}: fetching ${uniqueIds.length} Wikidata entities`);
  const facts = await fetchWikidataPeakFacts(uniqueIds);
  await fs.mkdir(cacheDir, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(
    temporary,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), facts: [...facts.values()] })}\n`
  );
  await fs.rename(temporary, file);
  return facts;
}

function numberValue(value: string | number | undefined): number {
  return value == null ? 0 : Number(value);
}

function evidenceFor(
  osmId: string,
  evidence: Awaited<ReturnType<typeof loadSessionEvidence>>
): SessionProximityEvidence {
  const row = evidence.get(osmId);
  return {
    sessionsWithin30m: numberValue(row?.sessions_30m),
    sessionsWithin100m: numberValue(row?.sessions_100m),
    sessionsWithin250m: numberValue(row?.sessions_250m),
  };
}

export function selectOsmIdBackfills(
  matches: PeakMatch[],
  catalog: ExpansionCatalogPeak[]
): { selected: OsmIdBackfill[]; ambiguousDestinationIds: string[] } {
  const catalogById = new Map(catalog.map((peak) => [peak.id, peak]));
  const grouped = new Map<string, OsmIdBackfill[]>();
  for (const match of matches) {
    if (!match.method || !match.destinationId || match.distanceMeters == null) continue;
    const destination = catalogById.get(match.destinationId);
    if (!destination || destination.osmId) continue;
    const sameName = normalizePeakName(destination.name) === normalizePeakName(match.reference.name);
    const flags = reviewFlagsForCandidate(match);
    const safe = (sameName && match.distanceMeters <= 500) ||
      (match.distanceMeters <= 30 && !flags.includes("possible_subpeak") && !flags.includes("generic_name"));
    if (!safe) continue;
    const candidate: OsmIdBackfill = {
      destinationId: destination.id,
      destinationName: destination.name,
      osmId: match.reference.osmId,
      wikidataId: match.reference.wikidataId,
      referenceName: match.reference.name,
      method: match.method,
      distanceMeters: match.distanceMeters,
    };
    grouped.set(destination.id, [...(grouped.get(destination.id) ?? []), candidate]);
  }

  const selected: OsmIdBackfill[] = [];
  const ambiguousDestinationIds: string[] = [];
  for (const [destinationId, candidates] of grouped) {
    if (candidates.length === 1) {
      selected.push(candidates[0]);
      continue;
    }
    const exactName = candidates.filter((candidate) =>
      normalizePeakName(candidate.destinationName) === normalizePeakName(candidate.referenceName)
    );
    if (exactName.length === 1) selected.push(exactName[0]);
    else ambiguousDestinationIds.push(destinationId);
  }
  return { selected, ambiguousDestinationIds };
}

function selectionPriority(lhs: PeakSelection, rhs: PeakSelection): number {
  return (rhs.prominenceM ?? -1) - (lhs.prominenceM ?? -1) ||
    rhs.wikipediaSitelinks - lhs.wikipediaSitelinks ||
    (rhs.elevationM ?? -1) - (lhs.elevationM ?? -1) ||
    lhs.match.reference.name.localeCompare(rhs.match.reference.name) ||
    Number(lhs.match.reference.osmId) - Number(rhs.match.reference.osmId);
}

export function deduplicatePeakSelections(
  selections: PeakSelection[],
  distanceMeters = 150
): { selected: PeakSelection[]; skipped: Array<{ skipped: PeakSelection; kept: PeakSelection }> } {
  const selected: PeakSelection[] = [];
  const skipped: Array<{ skipped: PeakSelection; kept: PeakSelection }> = [];
  for (const selection of [...selections].sort(selectionPriority)) {
    const duplicate = selected.find((kept) =>
      normalizePeakName(kept.match.reference.name) === normalizePeakName(selection.match.reference.name) &&
      haversineMeters(kept.match.reference, selection.match.reference) <= distanceMeters
    );
    if (duplicate) skipped.push({ skipped: selection, kept: duplicate });
    else selected.push(selection);
  }
  return { selected, skipped };
}

function deterministicDestinationId(osmId: string): string {
  return crypto.createHash("sha256").update(`osm:node:${osmId}`).digest("hex").slice(0, 20).toUpperCase();
}

async function applyChanges(
  scope: CoverageScope,
  selections: PeakSelection[],
  backfills: OsmIdBackfill[],
  minimumProminenceM: number
): Promise<AppliedChanges> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('peak-coverage-expansion'))");
    const backfillRows = backfills.map((backfill) => ({
      destination_id: backfill.destinationId,
      osm_id: backfill.osmId,
      wikidata_id: backfill.wikidataId,
      method: backfill.method,
      distance_meters: backfill.distanceMeters,
    }));
    const backfillResult = backfillRows.length === 0
      ? { rows: [] as Array<{ destination_id: string; osm_id: string }> }
      : await client.query<{ destination_id: string; osm_id: string }>(
        `WITH incoming AS (
           SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
             destination_id text, osm_id text, wikidata_id text,
             method text, distance_meters double precision
           )
         )
         UPDATE destinations d
         SET external_ids = jsonb_strip_nulls(
               COALESCE(d.external_ids, '{}'::jsonb) ||
               jsonb_build_object('osm', incoming.osm_id) ||
               CASE
                 WHEN COALESCE(d.external_ids, '{}'::jsonb) ? 'wikidata' THEN '{}'::jsonb
                 ELSE jsonb_build_object('wikidata', incoming.wikidata_id)
               END
             ),
             country_code = COALESCE(d.country_code, $2),
             state_code = COALESCE(d.state_code, $3),
             metadata = jsonb_set(
               COALESCE(d.metadata, '{}'::jsonb),
               '{coverage_backfills}',
               COALESCE(d.metadata->'coverage_backfills', '[]'::jsonb) ||
                 jsonb_build_array(jsonb_build_object(
                   'source', 'osm',
                   'jurisdiction', $4::text,
                   'matchMethod', incoming.method,
                   'distanceMeters', incoming.distance_meters,
                   'appliedAt', now()
                 )),
               true
             ),
             updated_at = now()
         FROM incoming
         WHERE d.id = incoming.destination_id
           AND NOT (COALESCE(d.external_ids, '{}'::jsonb) ? 'osm')
           AND NOT EXISTS (
             SELECT 1 FROM destinations other
             WHERE other.id <> d.id AND other.external_ids->>'osm' = incoming.osm_id
           )
         RETURNING d.id AS destination_id, d.external_ids->>'osm' AS osm_id`,
        [JSON.stringify(backfillRows), scope.countryCode, scope.stateCode, scope.key]
      );

    const insertRows = selections.map((selection) => {
      const reference = selection.match.reference;
      const selectionReasons = [
        ...(selection.prominenceM != null && selection.prominenceM > minimumProminenceM
          ? [`prominence_over_${Math.round(minimumProminenceM / 0.3048)}ft`]
          : []),
        ...selection.popularitySignals,
      ];
      return {
        id: deterministicDestinationId(reference.osmId),
        name: reference.name,
        search_name: normalizePeakName(reference.name),
        elevation: selection.elevationM,
        prominence: selection.prominenceM,
        lat: reference.lat,
        lng: reference.lng,
        osm_id: reference.osmId,
        wikidata_id: reference.wikidataId,
        prominence_source: selection.prominenceSource,
        wikipedia_sitelinks: selection.wikipediaSitelinks,
        popularity_signals: selection.popularitySignals,
        selection_reasons: selectionReasons,
      };
    });
    const insertResult = insertRows.length === 0
      ? { rows: [] as Array<{ id: string; osm_id: string }> }
      : await client.query<{ id: string; osm_id: string }>(
        `WITH incoming AS (
           SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
             id text, name text, search_name text, elevation double precision,
             prominence double precision, lat double precision, lng double precision,
             osm_id text, wikidata_id text, prominence_source text,
             wikipedia_sitelinks integer, popularity_signals jsonb, selection_reasons jsonb
           )
         ), prepared AS (
           SELECT incoming.*,
                  ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location
           FROM incoming
         )
         INSERT INTO destinations (
           id, name, search_name, elevation, prominence, location, geohash,
           type, activities, features, owner, country_code, state_code,
           external_ids, metadata, created_at, updated_at
         )
         SELECT
           prepared.id, prepared.name, prepared.search_name, prepared.elevation,
           prepared.prominence, prepared.location, NULL, 'point',
           ARRAY['outdoor-trek']::activity_type[], ARRAY['summit']::destination_feature[],
           'peaks', $2, $3,
           jsonb_strip_nulls(jsonb_build_object(
             'osm', prepared.osm_id, 'wikidata', prepared.wikidata_id
           )),
           jsonb_strip_nulls(jsonb_build_object(
             'source', 'osm',
             'catalog_audit', 'global-coverage-2026-07-21',
             'audit_jurisdiction', $4::text,
             'prominence_source', prepared.prominence_source,
             'wikipedia_sitelinks', prepared.wikipedia_sitelinks,
             'popularity_signals', prepared.popularity_signals,
             'selection_reasons', prepared.selection_reasons
           )),
           now(), now()
         FROM prepared
         WHERE NOT EXISTS (
           SELECT 1 FROM destinations d
           WHERE d.external_ids->>'osm' = prepared.osm_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM destinations d
           WHERE 'summit'::destination_feature = ANY(d.features)
             AND d.location IS NOT NULL
             AND ST_DWithin(d.location, prepared.location, 150)
         )
         AND NOT EXISTS (
           SELECT 1 FROM destinations d
           WHERE d.search_name = prepared.search_name
             AND d.location IS NOT NULL
             AND ST_DWithin(d.location, prepared.location, 1000)
         )
         ON CONFLICT (id) DO NOTHING
         RETURNING id, external_ids->>'osm' AS osm_id`,
        [JSON.stringify(insertRows), scope.countryCode, scope.stateCode, scope.key]
      );
    await client.query("COMMIT");
    return {
      inserted: insertResult.rows.map((row) => ({ id: row.id, osmId: row.osm_id })),
      backfilled: backfillResult.rows.map((row) => ({
        destinationId: row.destination_id,
        osmId: row.osm_id,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function deferredCounts(selections: PeakSelection[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const selection of selections) {
    for (const reason of selection.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

async function writeReport(
  reportDir: string | null,
  scope: CoverageScope,
  report: unknown,
  mode: "apply" | "dry-run"
): Promise<void> {
  if (!reportDir) return;
  await fs.mkdir(reportDir, { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(path.join(reportDir, `${scope.key}.${mode}.json`), serialized);
  await fs.writeFile(path.join(reportDir, `${scope.key}.json`), serialized);
}

async function loadCompletedApplyReport(
  reportDir: string | null,
  scope: CoverageScope
): Promise<Record<string, unknown> | null> {
  if (!reportDir) return null;
  const file = path.join(reportDir, `${scope.key}.apply.json`);
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    if (parsed.apply !== true && parsed.status !== "complete_empty") return null;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function runScope(
  scope: CoverageScope,
  args: ExpansionArgs,
  catalog: ExpansionCatalogPeak[]
): Promise<{ report: Record<string, unknown>; additions: ExpansionCatalogPeak[]; backfilled: AppliedChanges["backfilled"] }> {
  console.error(`[peak-expand] ${scope.label}: loading OSM reference peaks`);
  const data = await loadScopeData(scope, args.cacheDir);
  const reference = parseReferencePeaks(data, scope.stateCode);
  if (reference.length === 0) {
    const report = { jurisdiction: scope, status: "complete_empty", referencePeaks: 0 };
    await writeReport(args.reportDir, scope, report, args.apply ? "apply" : "dry-run");
    console.log(`${scope.label}: no named OSM peaks`);
    return { report, additions: [], backfilled: [] };
  }

  const catalogIndex = buildPeakCatalogIndex(catalog);
  const matches = reference.map((peak) => matchReferencePeakFromIndex(peak, catalogIndex));
  const unmatched = matches.filter((match) => match.method == null);
  const evidence = await loadSessionEvidence(matches);
  const wikidata = await loadWikidataData(
    scope,
    unmatched.flatMap((match) => match.reference.wikidataId ? [match.reference.wikidataId] : []),
    args.cacheDir
  );
  const elementById = new Map(data.elements.map((element) => [String(element.id), element]));
  const allSelections = unmatched.map((match) => selectPeakCandidate(
    match,
    evidenceFor(match.reference.osmId, evidence),
    elementById.get(match.reference.osmId),
    match.reference.wikidataId ? wikidata.get(match.reference.wikidataId) : undefined,
    args.minimumProminenceM,
    args.popularWikipediaSitelinks
  ));
  const eligibleBeforeReferenceDedup = allSelections
    .filter((selection) => selection.decision === "add")
    .sort(selectionPriority);
  const referenceDedup = deduplicatePeakSelections(eligibleBeforeReferenceDedup);
  const eligible = referenceDedup.selected;
  const selected = args.maxAdditionsPerScope == null
    ? eligible
    : eligible.slice(0, args.maxAdditionsPerScope);
  const backfillSelection = selectOsmIdBackfills(matches, catalog);
  const applied = args.apply
    ? await applyChanges(scope, selected, backfillSelection.selected, args.minimumProminenceM)
    : { inserted: [], backfilled: [] };
  const insertedOsmIds = new Set(applied.inserted.map((row) => row.osmId));
  const insertedSelections = selected.filter((selection) => insertedOsmIds.has(selection.match.reference.osmId));
  const additions: ExpansionCatalogPeak[] = insertedSelections.map((selection) => ({
    id: deterministicDestinationId(selection.match.reference.osmId),
    name: selection.match.reference.name,
    lat: selection.match.reference.lat,
    lng: selection.match.reference.lng,
    osmId: selection.match.reference.osmId,
    wikidataId: selection.match.reference.wikidataId,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    jurisdiction: scope,
    apply: args.apply,
    thresholds: {
      minimumProminenceM: args.minimumProminenceM,
      popularWikipediaSitelinks: args.popularWikipediaSitelinks,
    },
    totals: {
      referencePeaks: reference.length,
      matchedBefore: matches.length - unmatched.length,
      unmatchedBefore: unmatched.length,
      coverageBeforePercent: Math.round(((matches.length - unmatched.length) / matches.length) * 1_000) / 10,
      eligibleAdditions: eligible.length,
      duplicateReferenceNodesSkipped: referenceDedup.skipped.length,
      selectedAdditions: selected.length,
      inserted: applied.inserted.length,
      safeOsmIdBackfills: backfillSelection.selected.length,
      ambiguousOsmIdBackfills: backfillSelection.ambiguousDestinationIds.length,
      osmIdsBackfilled: applied.backfilled.length,
    },
    deferredByReason: deferredCounts(allSelections.filter((selection) => selection.decision === "defer")),
    additions: selected.map((selection) => ({
      osmId: selection.match.reference.osmId,
      name: selection.match.reference.name,
      elevationM: selection.elevationM,
      prominenceM: selection.prominenceM,
      prominenceSource: selection.prominenceSource,
      wikipediaSitelinks: selection.wikipediaSitelinks,
      popularitySignals: selection.popularitySignals,
      applied: insertedOsmIds.has(selection.match.reference.osmId),
    })),
    osmIdBackfills: backfillSelection.selected.map((backfill) => ({
      ...backfill,
      applied: applied.backfilled.some((row) => row.destinationId === backfill.destinationId),
    })),
    ambiguousOsmIdBackfillDestinationIds: backfillSelection.ambiguousDestinationIds,
    duplicateReferenceNodes: referenceDedup.skipped.map((duplicate) => ({
      skippedOsmId: duplicate.skipped.match.reference.osmId,
      keptOsmId: duplicate.kept.match.reference.osmId,
      name: duplicate.kept.match.reference.name,
      distanceMeters: haversineMeters(
        duplicate.skipped.match.reference,
        duplicate.kept.match.reference
      ),
    })),
  };
  await writeReport(args.reportDir, scope, report, args.apply ? "apply" : "dry-run");
  const totals = report.totals;
  console.log(
    `${scope.label}: ${totals.matchedBefore}/${totals.referencePeaks} matched before; ` +
    `${totals.eligibleAdditions} eligible, ${totals.inserted} inserted; ` +
    `${totals.safeOsmIdBackfills} safe ID backfills, ${totals.osmIdsBackfilled} applied`
  );
  return { report, additions, backfilled: applied.backfilled };
}

async function main(): Promise<void> {
  const args = parseExpansionArgs();
  const catalog = await loadCatalog();
  const failures: Array<{ jurisdiction: string; error: string }> = [];
  const resultByJurisdiction = new Map<string, Record<string, unknown>>();
  let nextScopeIndex = 0;
  let fatalError: unknown = null;
  try {
    const runWorker = async () => {
      while (nextScopeIndex < args.scopes.length && fatalError == null) {
        const scope = args.scopes[nextScopeIndex++];
        try {
          if (args.resume) {
            const completed = await loadCompletedApplyReport(args.reportDir, scope);
            if (completed) {
              resultByJurisdiction.set(scope.key, completed);
              console.error(`[peak-expand] ${scope.label}: resuming after completed apply report`);
              continue;
            }
          }
          const result = await runScope(scope, args, catalog);
          resultByJurisdiction.set(scope.key, result.report);
          catalog.push(...result.additions);
          for (const backfilled of result.backfilled) {
            const destination = catalog.find((peak) => peak.id === backfilled.destinationId);
            if (destination) destination.osmId = backfilled.osmId;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ jurisdiction: scope.key, error: message });
          const failureReport = {
            generatedAt: new Date().toISOString(),
            jurisdiction: scope,
            status: "failed",
            error: message,
          };
          resultByJurisdiction.set(scope.key, failureReport);
          await writeReport(
            args.reportDir,
            scope,
            failureReport,
            args.apply ? "apply" : "dry-run"
          );
          console.error(`[peak-expand] ${scope.label}: FAILED: ${message}`);
          if (!args.continueOnError) fatalError = error;
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(args.concurrency, args.scopes.length) },
        () => runWorker()
      )
    );
    if (fatalError != null) throw fatalError;
  } finally {
    await db.end();
  }
  const jurisdictionResults = args.scopes.flatMap((scope) => {
    const result = resultByJurisdiction.get(scope.key);
    return result ? [result] : [];
  });
  const scopeOrder = new Map(args.scopes.map((scope, index) => [scope.key, index]));
  failures.sort((left, right) =>
    (scopeOrder.get(left.jurisdiction) ?? 0) - (scopeOrder.get(right.jurisdiction) ?? 0)
  );
  if (args.reportDir) {
    const scopeHash = crypto.createHash("sha256")
      .update(args.scopes.map((scope) => scope.key).join(","))
      .digest("hex")
      .slice(0, 12);
    await fs.mkdir(args.reportDir, { recursive: true });
    await fs.writeFile(
      path.join(args.reportDir, `_batch-${args.apply ? "apply" : "dry-run"}-${scopeHash}.json`),
      `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        apply: args.apply,
        jurisdictionCount: args.scopes.length,
        completedCount: jurisdictionResults.length - failures.length,
        failureCount: failures.length,
        failures,
        jurisdictions: jurisdictionResults,
      }, null, 2)}\n`
    );
  }
  if (failures.length) {
    console.error(JSON.stringify({ failures }, null, 2));
    process.exitCode = 1;
  }
}

if (/(?:^|[/\\])expand-peak-coverage\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
