/**
 * Backfill links from reviewed destination fixtures and completed route audits.
 *
 * Dry-run is the default. Route sources must name the stored route exactly,
 * and destination pages must use an exact stable ID or an exact name slug.
 *
 * Usage:
 *   npm run backfill:external-links
 *   npm run backfill:external-links -- --apply
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PoolClient } from "pg";
import db from "./db";

interface Args {
  apply: boolean;
  input: string;
  routeRepairs: string;
}

export interface ReviewedDestinationFixture {
  destinationId: string;
  name: string;
  peakbaggerId?: string;
  expectedExternalIds?: Record<string, string>;
  externalIds: Record<string, string>;
}

export interface DestinationAuditSource {
  destinationId: string;
  url: string;
}

interface CurrentDestination {
  id: string;
  name: string;
  externalIds: Record<string, unknown>;
}

export interface DestinationUpdate {
  destinationId: string;
  externalIds: Record<string, string>;
}

export interface RouteAuditSource {
  routeId: string;
  routeName: string;
  destinationName: string;
  action: string;
  findings: string[];
  publisher: string;
  url: string;
  supports: string[];
  sourceRouteName: string;
}

export interface ExternalLink {
  type: string;
  id: string;
}

export interface RouteUpdate {
  routeId: string;
  expectedLinks: ExternalLink[];
  links: ExternalLink[];
}

export interface RouteRepairFixture extends RouteUpdate {
  name: string;
}

interface CurrentRoute {
  id: string;
  name: string;
  links: ExternalLink[];
}

const DEFAULT_INPUT = path.resolve(
  __dirname,
  "../../../docs/data-audits/fixtures/destination-external-links-2026-08-22.json"
);
const DEFAULT_ROUTE_REPAIRS = path.resolve(
  __dirname,
  "../../../docs/data-audits/fixtures/route-external-link-repairs-2026-08-22.json"
);

function parseArgs(argv = process.argv.slice(2)): Args {
  let apply = false;
  let input = DEFAULT_INPUT;
  let routeRepairs = DEFAULT_ROUTE_REPAIRS;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--input=")) input = path.resolve(arg.slice("--input=".length));
    else if (arg.startsWith("--route-repairs=")) {
      routeRepairs = path.resolve(arg.slice("--route-repairs=".length));
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { apply, input, routeRepairs };
}

export function normalizeIdentityName(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function exactHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function destinationIdFromAuditSource(
  destinationName: string,
  rawUrl: string
): { provider: string; id: string } | null {
  const url = exactHttpsUrl(rawUrl);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "peakbagger.com" && url.pathname === "/peak.aspx") {
    const id = url.searchParams.get("pid");
    return id && /^[1-9]\d*$/.test(id) && [...url.searchParams.keys()].length === 1
      ? { provider: "peakbagger", id }
      : null;
  }

  if (host === "summitpost.org") {
    const match = url.pathname.match(/^\/([^/]+)\/([1-9]\d*)\/?$/);
    if (!match || ["mountain", "page"].includes(match[1].toLowerCase())) return null;
    return normalizeIdentityName(match[1]) === normalizeIdentityName(destinationName)
      ? { provider: "summitpost", id: match[2] }
      : null;
  }
  return null;
}

const PROVIDERS_BY_HOST: Record<string, string> = {
  "14ers.com": "14ers",
  "14ers.org": "colorado_fourteeners_initiative",
  "alltrails.com": "alltrails",
  "blueridgemtnguides.com": "blue_ridge_mountain_guides",
  "cmc.org": "colorado_mountain_club",
  "mountaineers.org": "mountaineers",
  "nhstateparks.org": "nh_state_parks",
  "nps.gov": "nps",
  "oregonencyclopedia.org": "oregon_encyclopedia",
  "shastaavalanche.org": "mount_shasta_avalanche_center",
  "summitpost.org": "summitpost",
  "thenextsummit.org": "the_next_summit",
  "wta.org": "wta",
};

function providerForSource(publisher: string, url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const matchedHost = Object.keys(PROVIDERS_BY_HOST).find(
    (value) => host === value || host.endsWith(`.${value}`)
  );
  if (matchedHost) return PROVIDERS_BY_HOST[matchedHost];
  const fallback = publisher.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z0-9][a-z0-9_]*$/.test(fallback) ? fallback : null;
}

export function exactRouteSourceLink(row: RouteAuditSource): ExternalLink | null {
  if (!["keep", "repair"].includes(row.action)) return null;
  if (row.findings.includes("route_name_differs_from_standard")) return null;
  if (!row.supports.includes("route_identity")) return null;
  const sourceName = normalizeIdentityName(row.sourceRouteName);
  if (!sourceName) return null;
  const routeName = normalizeIdentityName(row.routeName);
  const destinationRouteName = normalizeIdentityName(`${row.destinationName} ${row.routeName}`);
  if (sourceName !== routeName && sourceName !== destinationRouteName) return null;
  const url = exactHttpsUrl(row.url);
  if (!url) return null;
  const type = providerForSource(row.publisher, url);
  return type ? { type, id: url.toString() } : null;
}

export function buildDestinationUpdates(
  fixtures: ReviewedDestinationFixture[],
  auditSources: DestinationAuditSource[],
  current: CurrentDestination[]
): DestinationUpdate[] {
  const currentById = new Map(current.map((destination) => [destination.id, destination]));
  const desired = new Map<string, Map<string, string>>();
  const add = (destinationId: string, provider: string, id: string) => {
    const providers = desired.get(destinationId) ?? new Map<string, string>();
    const existing = providers.get(provider);
    if (existing && existing !== id) {
      throw new Error(`${destinationId} maps to ${provider} IDs ${existing} and ${id}`);
    }
    providers.set(provider, id);
    desired.set(destinationId, providers);
  };

  for (const fixture of fixtures) {
    const destination = currentById.get(fixture.destinationId);
    if (!destination) throw new Error(`Missing fixture destination ${fixture.destinationId}`);
    if (destination.name !== fixture.name) {
      throw new Error(`Fixture destination ${fixture.destinationId} is ${destination.name}, not ${fixture.name}`);
    }
    if (
      fixture.peakbaggerId != null &&
      String(destination.externalIds.peakbagger ?? "") !== fixture.peakbaggerId
    ) {
      throw new Error(`Fixture destination ${fixture.destinationId} has the wrong Peakbagger ID`);
    }
    for (const [provider, id] of Object.entries(fixture.expectedExternalIds ?? {})) {
      if (String(destination.externalIds[provider] ?? "") !== id) {
        throw new Error(`Fixture destination ${fixture.destinationId} has the wrong ${provider} ID`);
      }
    }
    for (const [provider, id] of Object.entries(fixture.externalIds)) add(fixture.destinationId, provider, id);
  }

  for (const source of auditSources) {
    const destination = currentById.get(source.destinationId);
    if (!destination) continue;
    const link = destinationIdFromAuditSource(destination.name, source.url);
    if (link) add(destination.id, link.provider, link.id);
  }

  const updates: DestinationUpdate[] = [];
  for (const [destinationId, providers] of desired) {
    const destination = currentById.get(destinationId);
    if (!destination) continue;
    const missing: Record<string, string> = {};
    for (const [provider, id] of providers) {
      const existing = destination.externalIds[provider];
      if (existing != null && String(existing) !== id) {
        throw new Error(`${destinationId} already has ${provider} ID ${String(existing)}, not ${id}`);
      }
      if (existing == null) missing[provider] = id;
    }
    if (Object.keys(missing).length > 0) updates.push({ destinationId, externalIds: missing });
  }
  return updates.sort((left, right) => left.destinationId.localeCompare(right.destinationId));
}

export function buildRouteUpdates(rows: RouteAuditSource[]): RouteUpdate[] {
  const linksByRoute = new Map<string, Map<string, ExternalLink>>();
  for (const row of rows) {
    const link = exactRouteSourceLink(row);
    if (!link) continue;
    const links = linksByRoute.get(row.routeId) ?? new Map<string, ExternalLink>();
    links.set(link.id, link);
    linksByRoute.set(row.routeId, links);
  }
  return [...linksByRoute.entries()]
    .map(([routeId, links]) => ({
      routeId,
      expectedLinks: [],
      links: [...links.values()].sort((left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => left.routeId.localeCompare(right.routeId));
}

function linksEqual(left: ExternalLink[], right: ExternalLink[]): boolean {
  return left.length === right.length && left.every((link, index) =>
    link.type === right[index]?.type && link.id === right[index]?.id
  );
}

export function buildRouteRepairUpdates(
  fixtures: RouteRepairFixture[],
  current: CurrentRoute[]
): RouteUpdate[] {
  const currentById = new Map(current.map((route) => [route.id, route]));
  return fixtures.flatMap((fixture) => {
    const route = currentById.get(fixture.routeId);
    if (!route) throw new Error(`Missing repair route ${fixture.routeId}`);
    if (route.name !== fixture.name) {
      throw new Error(`Repair route ${fixture.routeId} is ${route.name}, not ${fixture.name}`);
    }
    if (linksEqual(route.links, fixture.links)) return [];
    if (!linksEqual(route.links, fixture.expectedLinks)) {
      throw new Error(`Repair route ${fixture.routeId} links changed since review`);
    }
    return [{
      routeId: fixture.routeId,
      expectedLinks: fixture.expectedLinks,
      links: fixture.links,
    }];
  }).sort((left, right) => left.routeId.localeCompare(right.routeId));
}

async function loadDestinationAuditSources(client: PoolClient): Promise<DestinationAuditSource[]> {
  const result = await client.query<{ destination_id: string; url: string }>(
    `SELECT job.destination_id, source->>'url' AS url
       FROM route_catalog_audit_jobs job
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(job.final_result->'sources', '[]'::jsonb)) source
      WHERE job.final_result IS NOT NULL
        AND source->>'url' IS NOT NULL
        AND (source->>'url' LIKE '%peakbagger.com/%' OR source->>'url' LIKE '%summitpost.org/%')`
  );
  return result.rows.map((row) => ({ destinationId: row.destination_id, url: row.url }));
}

async function loadRouteAuditSources(client: PoolClient): Promise<RouteAuditSource[]> {
  const result = await client.query<{
    route_id: string;
    route_name: string;
    destination_name: string;
    action: string;
    findings: unknown;
    publisher: string;
    url: string;
    supports: unknown;
    source_route_name: string;
  }>(
    `SELECT route.id AS route_id,
            route.name AS route_name,
            job.destination_name,
            route_result->>'action' AS action,
            COALESCE(route_result->'findings', '[]'::jsonb) AS findings,
            source->>'publisher' AS publisher,
            source->>'url' AS url,
            COALESCE(source->'supports', '[]'::jsonb) AS supports,
            source->'facts'->>'route_name' AS source_route_name
       FROM route_catalog_audit_jobs job
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(job.final_result->'routes', '[]'::jsonb)) route_result
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(job.final_result->'sources', '[]'::jsonb)) source
       JOIN routes route ON route.id = route_result->>'route_id'
      WHERE job.final_result IS NOT NULL
        AND route.owner = 'peaks'
        AND route.status = 'active'
        AND COALESCE(route.external_links, '[]'::jsonb) = '[]'::jsonb
        AND source->>'url' IS NOT NULL`
  );
  const stringArray = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  return result.rows.map((row) => ({
    routeId: row.route_id,
    routeName: row.route_name,
    destinationName: row.destination_name,
    action: row.action,
    findings: stringArray(row.findings),
    publisher: row.publisher,
    url: row.url,
    supports: stringArray(row.supports),
    sourceRouteName: row.source_route_name,
  }));
}

async function loadCurrentDestinations(
  client: PoolClient,
  destinationIds: string[]
): Promise<CurrentDestination[]> {
  const result = await client.query<{
    id: string;
    name: string;
    external_ids: Record<string, unknown>;
  }>(
    `SELECT id, name, external_ids
       FROM destinations
      WHERE id = ANY($1::text[])`,
    [destinationIds]
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, externalIds: row.external_ids }));
}

async function loadCurrentRoutes(client: PoolClient, routeIds: string[]): Promise<CurrentRoute[]> {
  const result = await client.query<{ id: string; name: string; external_links: ExternalLink[] }>(
    `SELECT id, name, COALESCE(external_links, '[]'::jsonb) AS external_links
       FROM routes
      WHERE id = ANY($1::text[])`,
    [routeIds]
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, links: row.external_links }));
}

async function applyUpdates(
  client: PoolClient,
  destinations: DestinationUpdate[],
  routes: RouteUpdate[]
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('reviewed-external-link-backfill'))");
    if (destinations.length > 0) {
      const updated = await client.query(
        `WITH incoming AS (
           SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(destination_id text, external_ids jsonb)
         )
         UPDATE destinations destination
            SET external_ids = destination.external_ids || incoming.external_ids,
                updated_at = now()
           FROM incoming
          WHERE destination.id = incoming.destination_id
            AND NOT EXISTS (
              SELECT 1
                FROM jsonb_each_text(incoming.external_ids) entry
               WHERE destination.external_ids ? entry.key
                 AND destination.external_ids->>entry.key <> entry.value
            )
        RETURNING destination.id`,
        [JSON.stringify(destinations.map((update) => ({
          destination_id: update.destinationId,
          external_ids: update.externalIds,
        })))]
      );
      if (updated.rowCount !== destinations.length) throw new Error("Destination links changed during apply");
    }
    if (routes.length > 0) {
      const updated = await client.query(
         `WITH incoming AS (
           SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
             route_id text, expected_links jsonb, external_links jsonb
           )
         )
         UPDATE routes route
            SET external_links = incoming.external_links,
                updated_at = now()
           FROM incoming
          WHERE route.id = incoming.route_id
            AND route.owner = 'peaks'
            AND route.status = 'active'
            AND COALESCE(route.external_links, '[]'::jsonb) = incoming.expected_links
        RETURNING route.id`,
        [JSON.stringify(routes.map((update) => ({
          route_id: update.routeId,
          expected_links: update.expectedLinks,
          external_links: update.links,
        })))]
      );
      if (updated.rowCount !== routes.length) throw new Error("Route links changed during apply");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function providerCounts(values: Record<string, string>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) for (const provider of Object.keys(value)) counts[provider] = (counts[provider] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

async function main(): Promise<void> {
  const args = parseArgs();
  const fixtures = JSON.parse(await fs.readFile(args.input, "utf8")) as ReviewedDestinationFixture[];
  const routeRepairFixtures = JSON.parse(
    await fs.readFile(args.routeRepairs, "utf8")
  ) as RouteRepairFixture[];
  const client = await db.connect();
  try {
    const auditSources = await loadDestinationAuditSources(client);
    const destinationIds = [...new Set([
      ...fixtures.map((fixture) => fixture.destinationId),
      ...auditSources.map((source) => source.destinationId),
    ])];
    const currentDestinations = await loadCurrentDestinations(client, destinationIds);
    const destinationUpdates = buildDestinationUpdates(fixtures, auditSources, currentDestinations);
    const auditedRouteUpdates = buildRouteUpdates(await loadRouteAuditSources(client));
    const repairedRouteUpdates = buildRouteRepairUpdates(
      routeRepairFixtures,
      await loadCurrentRoutes(client, routeRepairFixtures.map((fixture) => fixture.routeId))
    );
    const duplicateRoute = auditedRouteUpdates.find((update) =>
      repairedRouteUpdates.some((repair) => repair.routeId === update.routeId)
    );
    if (duplicateRoute) throw new Error(`Route ${duplicateRoute.routeId} has two update plans`);
    const routeUpdates = [...auditedRouteUpdates, ...repairedRouteUpdates]
      .sort((left, right) => left.routeId.localeCompare(right.routeId));
    if (args.apply) await applyUpdates(client, destinationUpdates, routeUpdates);

    console.log(JSON.stringify({
      apply: args.apply,
      destinations: {
        updated: destinationUpdates.length,
        providers: providerCounts(destinationUpdates.map((update) => update.externalIds)),
        sampleIds: destinationUpdates.slice(0, 20).map((update) => update.destinationId),
      },
      routes: {
        updated: routeUpdates.length,
        links: routeUpdates.reduce((total, update) => total + update.links.length, 0),
        providers: providerCounts(routeUpdates.flatMap((update) =>
          update.links.map((link) => ({ [link.type]: link.id }))
        )),
        sampleIds: routeUpdates.slice(0, 20).map((update) => update.routeId),
      },
    }, null, 2));
  } finally {
    client.release();
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
