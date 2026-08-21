/**
 * Imports a small, reviewed set of Peakbagger lists from saved audit JSON.
 *
 * Dry-run is the default. The input is the browser audit export keyed by
 * Peakbagger list ID, with each value containing a `rows` array.
 *
 * Examples:
 *   npm run import:peakbagger-lists -- --input=/tmp/peakbagger-list-candidates.json
 *   npm run import:peakbagger-lists -- --input=/tmp/peakbagger-list-candidates.json --apply
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { PoolClient } from "pg";
import db from "./db";

export interface ImportArgs {
  input: string;
  apply: boolean;
}

export interface PeakbaggerSourcePeak {
  ordinal: number;
  peakbaggerPeakId: number;
  name: string;
  elevationFt: number;
  lat?: number;
  lng?: number;
}

interface PeakbaggerSourceList {
  rows: PeakbaggerSourcePeak[];
}

type PeakbaggerAudit = Record<string, PeakbaggerSourceList>;

export interface CatalogPeak {
  id: string;
  name: string;
  elevationM: number | null;
  lat: number;
  lng: number;
  osmId: string | null;
}

interface CuratedDestination {
  id: string;
  name: string;
  elevationM: number;
  lat: number;
  lng: number;
  countryCode: string;
  stateCode: string;
  osmId: string;
}

export interface CuratedList {
  listId: string;
  sourceListId: number;
  name: string;
  description: string;
  expectedCount: number;
  destinationOverrides: Record<number, string>;
  yearEstablished: number | null;
  /** Nullable by design: plain elevation/prominence cuts have no keeper. */
  organization: string | null;
  sourceName: string;
  sourceUrl: string;
  region: string;
}

export interface ListUpsertParams {
  listId: string;
  name: string;
  description: string;
  yearEstablished: number | null;
  organization: string | null;
  sourceName: string;
  sourceUrl: string;
  region: string;
}

export function buildListUpsertParams(list: CuratedList): ListUpsertParams {
  return {
    listId: list.listId,
    name: list.name,
    description: list.description,
    yearEstablished: list.yearEstablished,
    organization: list.organization,
    sourceName: list.sourceName,
    sourceUrl: list.sourceUrl,
    region: list.region,
  };
}

export interface ResolvedListMember {
  destinationId: string;
  ordinal: number;
  sourcePeakId: number;
  sourceName: string;
}

interface CurrentListMember {
  listId: string;
  destinationId: string;
  ordinal: number;
}

interface ListImportPlan {
  list: CuratedList;
  members: ResolvedListMember[];
  addedDestinationIds: string[];
  removedDestinationIds: string[];
  reorderedDestinationIds: string[];
}

const METERS_PER_FOOT = 0.3048;
const MAX_ELEVATION_DELTA_M = 100;
const MAX_SPATIAL_TIEBREAK_M = 5_000;

export function deterministicListId(sourceListId: number): string {
  return crypto
    .createHash("sha256")
    .update(`peakbagger:list:${sourceListId}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
}

export function deterministicOsmDestinationId(osmId: string): string {
  return crypto
    .createHash("sha256")
    .update(`osm:node:${osmId}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
}

const HIGH_ROCK_OSM_ID = "356773747";
const HIGH_ROCK_ID = deterministicOsmDestinationId(HIGH_ROCK_OSM_ID);

export const CURATED_DESTINATIONS: CuratedDestination[] = [
  {
    id: HIGH_ROCK_ID,
    name: "High Rock",
    elevationM: 1359,
    lat: 35.9643538,
    lng: -82.5778551,
    countryCode: "US",
    stateCode: "TN",
    osmId: HIGH_ROCK_OSM_ID,
  },
];

export const CURATED_LISTS: CuratedList[] = [
  {
    listId: "ULCGhLnsWcYYRqXQ3aOo",
    sourceListId: 5044,
    name: "Cascade Volcanoes",
    description:
      "The Mountaineers' Tacoma branch created this peak pin in 2010 for climbers who reach all " +
      "twenty major Cascade volcanoes. The line runs from Mount Garibaldi in British Columbia " +
      "south to Lassen Peak in California. Every peak counts toward the pin; there is no partial credit.",
    expectedCount: 20,
    destinationOverrides: {},
    yearEstablished: 2010,
    organization: "The Mountaineers",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=5044",
    region: "Cascades",
  },
  {
    listId: "LAZcIKjluO0oT3o9g6MC",
    sourceListId: 21360,
    name: "Colorado 14ers",
    description:
      "Colorado holds fifty-three peaks above 14,000 feet that also rise 300 feet above the " +
      "saddle linking them to a higher neighbor. Other Colorado summits clear 14,000 feet but " +
      "fall short of that rise, so lists count them as shoulders rather than mountains of their " +
      "own. Mount Elbert is the highest of them, and the highest summit in the Rocky Mountains.",
    expectedCount: 53,
    destinationOverrides: {
      5907: "eBNZkjZzZV96xo5f36bx", // Crestone Peak East -> Crestone Peak
      5676: "PaeawK81bgByWN53rffv", // Mount Blue Sky -> Mount Evans
    },
    // Nullable by design: a plain elevation/prominence cut has no keeper. Peakbagger hosts
    // the list but is not its keeper; that fact lives in sourceName/sourceUrl instead.
    yearEstablished: null,
    organization: null,
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=21360",
    region: "Colorado",
  },
  {
    listId: "3S29a3viZKKnSMz4wzPQ",
    sourceListId: 21457,
    name: "Tennessee 4500ft Peaks",
    description:
      "Fifty-five summits in and around Tennessee reach 4,500 feet. Many sit on the crest of " +
      "the Great Smoky Mountains, where the state line follows the ridge shared with North " +
      "Carolina. Kuwohi, at 6,643 feet, is the highest of them and the highest point in Tennessee.",
    expectedCount: 55,
    destinationOverrides: {
      7764: "fC9zpl4WpEUZvU4HTsSI", // Kuwohi -> the existing Clingmans Dome row
      18611: HIGH_ROCK_ID,
    },
    // Nullable by design: another plain elevation cut with no keeper (see Colorado 14ers above).
    yearEstablished: null,
    organization: null,
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=21457",
    region: "Tennessee",
  },
  {
    listId: deterministicListId(50081),
    sourceListId: 50081,
    name: "California Fourteeners",
    description:
      "Steve Porcella and Cameron Burns counted fifteen California summits above 14,000 feet " +
      "in their guidebook, first published in 1991. Fourteen rise in the Sierra Nevada; White " +
      "Mountain Peak stands alone east of the Owens Valley. Mount Whitney is the highest of the " +
      "fifteen, and of the contiguous United States.",
    expectedCount: 15,
    destinationOverrides: {},
    yearEstablished: 1991,
    organization: "Porcella and Burns",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=50081",
    region: "California",
  },
  {
    listId: deterministicListId(50511),
    sourceListId: 50511,
    name: "Sierra Peaks Section Emblem Peaks",
    description:
      "The Sierra Club's Angeles Chapter founded the Sierra Peaks Section in 1955 and marked " +
      "fifteen summits on its peaks list as Emblem Peaks, the ones that dominate their part of " +
      "the range. A member earns the section emblem by climbing ten of the fifteen plus fifteen " +
      "more peaks from the full list. Mount Whitney, Mount Williamson, North Palisade, and Mount " +
      "Ritter are among them.",
    expectedCount: 15,
    destinationOverrides: {},
    yearEstablished: 1955,
    organization: "Sierra Club Angeles Chapter",
    sourceName: "Peakbagger",
    sourceUrl: "https://www.peakbagger.com/list.aspx?lid=50511",
    region: "Sierra Nevada",
  },
];

export function parseArgs(argv = process.argv.slice(2)): ImportArgs {
  const inputArg = argv.find((arg) => arg.startsWith("--input="));
  const input = inputArg?.slice("--input=".length).trim();
  if (!input) throw new Error("--input is required");
  const unknown = argv.filter((arg) => arg !== "--apply" && !arg.startsWith("--input="));
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
  return { input, apply: argv.includes("--apply") };
}

export function normalizeListPeakName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[\u2010-\u2015-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function haversineMeters(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number }
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(right.lng - left.lng);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function validateSourceList(list: CuratedList, source: PeakbaggerSourceList): void {
  if (!source || !Array.isArray(source.rows)) {
    throw new Error(`Peakbagger list ${list.sourceListId} is missing from the input`);
  }
  if (source.rows.length !== list.expectedCount) {
    throw new Error(
      `Peakbagger list ${list.sourceListId} has ${source.rows.length} rows; ` +
      `expected ${list.expectedCount}`
    );
  }
  const peakIds = new Set<number>();
  for (const row of source.rows) {
    if (!Number.isInteger(row.peakbaggerPeakId) || row.peakbaggerPeakId <= 0) {
      throw new Error(`List ${list.sourceListId} has an invalid peak ID`);
    }
    if (!Number.isInteger(row.ordinal) || row.ordinal <= 0) {
      throw new Error(`List ${list.sourceListId} peak ${row.peakbaggerPeakId} has an invalid ordinal`);
    }
    if (!row.name?.trim() || !Number.isFinite(row.elevationFt)) {
      throw new Error(`List ${list.sourceListId} peak ${row.peakbaggerPeakId} is incomplete`);
    }
    if (peakIds.has(row.peakbaggerPeakId)) {
      throw new Error(`List ${list.sourceListId} repeats peak ${row.peakbaggerPeakId}`);
    }
    peakIds.add(row.peakbaggerPeakId);
  }
}

function resolveExactNameCandidate(
  source: PeakbaggerSourcePeak,
  catalog: CatalogPeak[]
): CatalogPeak {
  const normalizedName = normalizeListPeakName(source.name);
  const sourceElevationM = source.elevationFt * METERS_PER_FOOT;
  let candidates = catalog.filter((peak) =>
    normalizeListPeakName(peak.name) === normalizedName &&
    peak.elevationM != null &&
    Math.abs(peak.elevationM - sourceElevationM) <= MAX_ELEVATION_DELTA_M
  );

  if (candidates.length > 1 && Number.isFinite(source.lat) && Number.isFinite(source.lng)) {
    candidates = candidates
      .map((peak) => ({ peak, distanceM: haversineMeters(source as Required<PeakbaggerSourcePeak>, peak) }))
      .filter(({ distanceM }) => distanceM <= MAX_SPATIAL_TIEBREAK_M)
      .sort((left, right) => left.distanceM - right.distanceM)
      .map(({ peak }) => peak);
  }

  if (candidates.length !== 1) {
    const details = candidates.map((peak) => `${peak.id}:${peak.name}`).join(", ") || "none";
    throw new Error(
      `List peak ${source.peakbaggerPeakId} ${source.name} resolved to ` +
      `${candidates.length} destinations (${details})`
    );
  }
  return candidates[0];
}

export function resolveListMembers(
  list: CuratedList,
  source: PeakbaggerSourceList,
  catalog: CatalogPeak[]
): ResolvedListMember[] {
  validateSourceList(list, source);
  const catalogById = new Map(catalog.map((peak) => [peak.id, peak]));
  const members = source.rows.map((row, index) => {
    const overrideId = list.destinationOverrides[row.peakbaggerPeakId];
    const destination = overrideId
      ? catalogById.get(overrideId)
      : resolveExactNameCandidate(row, catalog);
    if (!destination) {
      throw new Error(
        `List peak ${row.peakbaggerPeakId} ${row.name} has missing override ${overrideId}`
      );
    }
    return {
      destinationId: destination.id,
      ordinal: index,
      sourcePeakId: row.peakbaggerPeakId,
      sourceName: row.name,
    };
  });
  const destinationIds = new Set(members.map((member) => member.destinationId));
  if (destinationIds.size !== members.length) {
    throw new Error(`Peakbagger list ${list.sourceListId} resolves two peaks to one destination`);
  }
  return members.sort((left, right) => left.ordinal - right.ordinal || left.sourcePeakId - right.sourcePeakId);
}

export function buildListPlan(
  list: CuratedList,
  members: ResolvedListMember[],
  current: CurrentListMember[]
): ListImportPlan {
  const desiredById = new Map(members.map((member) => [member.destinationId, member]));
  const currentForList = current.filter((member) => member.listId === list.listId);
  const currentById = new Map(currentForList.map((member) => [member.destinationId, member]));
  return {
    list,
    members,
    addedDestinationIds: members
      .filter((member) => !currentById.has(member.destinationId))
      .map((member) => member.destinationId),
    removedDestinationIds: currentForList
      .filter((member) => !desiredById.has(member.destinationId))
      .map((member) => member.destinationId),
    reorderedDestinationIds: members
      .filter((member) => {
        const existing = currentById.get(member.destinationId);
        return existing != null && existing.ordinal !== member.ordinal;
      })
      .map((member) => member.destinationId),
  };
}

async function loadCatalog(client: PoolClient): Promise<CatalogPeak[]> {
  const result = await client.query<{
    id: string;
    name: string;
    elevation_m: string | number | null;
    lat: string | number;
    lng: string | number;
    osm_id: string | null;
  }>(
    `SELECT id, name, elevation AS elevation_m,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            external_ids->>'osm' AS osm_id
     FROM destinations
     WHERE location IS NOT NULL
       AND name IS NOT NULL
       AND 'summit'::destination_feature = ANY(features)`
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    elevationM: row.elevation_m == null ? null : Number(row.elevation_m),
    lat: Number(row.lat),
    lng: Number(row.lng),
    osmId: row.osm_id,
  }));
}

async function loadCurrentMembers(client: PoolClient, listIds: string[]): Promise<CurrentListMember[]> {
  const result = await client.query<{
    list_id: string;
    destination_id: string;
    ordinal: number;
  }>(
    `SELECT list_id, destination_id, ordinal
     FROM list_destinations
     WHERE list_id = ANY($1::text[])`,
    [listIds]
  );
  return result.rows.map((row) => ({
    listId: row.list_id,
    destinationId: row.destination_id,
    ordinal: Number(row.ordinal),
  }));
}

function catalogWithCuratedDestinations(catalog: CatalogPeak[]): {
  catalog: CatalogPeak[];
  destinationsToAdd: CuratedDestination[];
} {
  const byOsmId = new Map(
    catalog.filter((peak) => peak.osmId).map((peak) => [peak.osmId as string, peak])
  );
  const byId = new Map(catalog.map((peak) => [peak.id, peak]));
  const destinationsToAdd: CuratedDestination[] = [];
  const additions: CatalogPeak[] = [];
  for (const destination of CURATED_DESTINATIONS) {
    const existingByOsm = byOsmId.get(destination.osmId);
    if (existingByOsm && existingByOsm.id !== destination.id) {
      throw new Error(
        `OSM node ${destination.osmId} already belongs to destination ${existingByOsm.id}`
      );
    }
    const existingById = byId.get(destination.id);
    if (existingById) {
      if (existingById.osmId !== destination.osmId) {
        throw new Error(`Curated destination ID ${destination.id} belongs to another source`);
      }
      continue;
    }
    const duplicate = catalog.find((peak) =>
      normalizeListPeakName(peak.name) === normalizeListPeakName(destination.name) &&
      haversineMeters(peak, destination) <= 150
    );
    if (duplicate) {
      throw new Error(
        `Curated destination ${destination.name} is within 150 m of ${duplicate.id}:${duplicate.name}`
      );
    }
    destinationsToAdd.push(destination);
    additions.push({
      id: destination.id,
      name: destination.name,
      elevationM: destination.elevationM,
      lat: destination.lat,
      lng: destination.lng,
      osmId: destination.osmId,
    });
  }
  return { catalog: [...catalog, ...additions], destinationsToAdd };
}

async function insertDestinations(
  client: PoolClient,
  destinations: CuratedDestination[]
): Promise<void> {
  if (destinations.length === 0) return;
  await client.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
         id text, name text, elevation_m double precision,
         lat double precision, lng double precision,
         country_code text, state_code text, osm_id text
       )
     )
     INSERT INTO destinations (
       id, name, search_name, elevation, location, type, activities, features,
       owner, country_code, state_code, external_ids, metadata
     )
     SELECT incoming.id,
            incoming.name,
            lower(incoming.name),
            incoming.elevation_m,
            ST_SetSRID(ST_MakePoint(incoming.lng, incoming.lat, incoming.elevation_m), 4326)::geography,
            'point',
            ARRAY['outdoor-trek']::activity_type[],
            ARRAY['summit']::destination_feature[],
            'peaks',
            incoming.country_code,
            incoming.state_code,
            jsonb_build_object('osm', incoming.osm_id),
            jsonb_build_object(
              'source', 'osm',
              'catalog_audit', 'peakbagger-lists-2026-08-18',
              'names', jsonb_build_object('display', incoming.name, 'osm_default', incoming.name)
            )
     FROM incoming
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      elevation_m: destination.elevationM,
      lat: destination.lat,
      lng: destination.lng,
      country_code: destination.countryCode,
      state_code: destination.stateCode,
      osm_id: destination.osmId,
    })))]
  );
}

async function applyPlans(
  client: PoolClient,
  plans: ListImportPlan[],
  destinationsToAdd: CuratedDestination[]
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('peakbagger-list-import'))");
    await insertDestinations(client, destinationsToAdd);
    for (const plan of plans) {
      const params = buildListUpsertParams(plan.list);
      await client.query(
        `INSERT INTO lists (
           id, name, description, owner,
           year_established, organization, source_name, source_url, region
         )
         VALUES ($1, $2, $3, 'peaks', $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           owner = EXCLUDED.owner,
           year_established = EXCLUDED.year_established,
           organization = EXCLUDED.organization,
           source_name = EXCLUDED.source_name,
           source_url = EXCLUDED.source_url,
           region = EXCLUDED.region,
           updated_at = now()`,
        [
          params.listId,
          params.name,
          params.description,
          params.yearEstablished,
          params.organization,
          params.sourceName,
          params.sourceUrl,
          params.region,
        ]
      );
      const desiredIds = plan.members.map((member) => member.destinationId);
      await client.query(
        `DELETE FROM list_destinations
         WHERE list_id = $1
           AND NOT (destination_id = ANY($2::text[]))`,
        [plan.list.listId, desiredIds]
      );
      await client.query(
        `WITH incoming AS (
           SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
             list_id text, destination_id text, ordinal int
           )
         )
         INSERT INTO list_destinations (list_id, destination_id, ordinal)
         SELECT list_id, destination_id, ordinal FROM incoming
         ON CONFLICT (list_id, destination_id) DO UPDATE
           SET ordinal = EXCLUDED.ordinal`,
        [JSON.stringify(plan.members.map((member) => ({
          list_id: plan.list.listId,
          destination_id: member.destinationId,
          ordinal: member.ordinal,
        })))]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const audit = JSON.parse(await fs.readFile(args.input, "utf8")) as PeakbaggerAudit;
  const client = await db.connect();
  try {
    const liveCatalog = await loadCatalog(client);
    const { catalog, destinationsToAdd } = catalogWithCuratedDestinations(liveCatalog);
    const current = await loadCurrentMembers(client, CURATED_LISTS.map((list) => list.listId));
    const plans = CURATED_LISTS.map((list) => {
      const source = audit[String(list.sourceListId)];
      const members = resolveListMembers(list, source, catalog);
      return buildListPlan(list, members, current);
    });

    if (args.apply) await applyPlans(client, plans, destinationsToAdd);

    const nameById = new Map(catalog.map((peak) => [peak.id, peak.name]));
    console.log(JSON.stringify({
      apply: args.apply,
      source: "Peakbagger",
      destinationsToAdd: destinationsToAdd.map((destination) => ({
        id: destination.id,
        name: destination.name,
        osmId: destination.osmId,
      })),
      lists: plans.map((plan) => ({
        id: plan.list.listId,
        sourceListId: plan.list.sourceListId,
        name: plan.list.name,
        yearEstablished: plan.list.yearEstablished,
        organization: plan.list.organization,
        sourceName: plan.list.sourceName,
        sourceUrl: plan.list.sourceUrl,
        region: plan.list.region,
        destinationCount: plan.members.length,
        added: plan.addedDestinationIds.map((id) => ({ id, name: nameById.get(id) })),
        removed: plan.removedDestinationIds.map((id) => ({ id, name: nameById.get(id) })),
        reorderedCount: plan.reorderedDestinationIds.length,
      })),
    }, null, 2));
  } finally {
    client.release();
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
