/**
 * Read-only coverage and integrity report for catalog links.
 *
 * Usage:
 *   npm run audit:external-links
 *   npm run audit:external-links -- --format=json --sample-limit=25
 */

import db from "./db";

interface CatalogRow {
  kind: "destination" | "route";
  id: string;
  name: string | null;
  features: string[];
  external_ids: unknown;
  external_links: unknown;
}

interface AuditOptions {
  format: "text" | "json";
  sampleLimit: number;
}

interface LinkIssue {
  kind: CatalogRow["kind"];
  id: string;
  name: string | null;
  reason: string;
}

interface KindReport {
  total: number;
  linked: number;
  missing: number;
  coveragePercent: number;
  providers: Record<string, number>;
}

interface AuditReport {
  generatedAt: string;
  destinations: KindReport;
  routes: KindReport;
  destinationFeatures: Record<string, KindReport>;
  issueCount: number;
  issues: LinkIssue[];
}

const PROVIDER_ALIASES: Record<string, string> = {
  "all-trails": "alltrails",
  all_trails: "alltrails",
  lists_of_john: "listsofjohn",
  "lists-of-john": "listsofjohn",
  loj: "listsofjohn",
  openstreetmap: "osm",
  summit_post: "summitpost",
  "summit-post": "summitpost",
};

function parseOptions(argv: string[]): AuditOptions {
  let format: AuditOptions["format"] = "text";
  let sampleLimit = 20;
  for (const arg of argv) {
    if (arg === "--format=json") format = "json";
    else if (arg === "--format=text") format = "text";
    else if (arg.startsWith("--sample-limit=")) {
      sampleLimit = Number(arg.slice("--sample-limit=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 500) {
    throw new Error("--sample-limit must be an integer from 0 to 500");
  }
  return { format, sampleLimit };
}

function providerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) return null;
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

function valueString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function httpsUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function catalogLinkUrl(provider: unknown, value: unknown): string | null {
  const type = providerName(provider);
  const id = valueString(value);
  if (!type || !id) return null;
  const direct = httpsUrl(id);
  if (direct) return direct;

  switch (type) {
  case "peakbagger":
    return /^-?[1-9]\d*$/.test(id) ? `https://www.peakbagger.com/peak.aspx?pid=${id}` : null;
  case "summitpost":
    return /^[1-9]\d*$/.test(id) ? `https://www.summitpost.org/page/${id}` : null;
  case "listsofjohn":
    return /^[1-9]\d*$/.test(id) ? `https://listsofjohn.com/peak/${id}` : null;
  case "wikidata":
    return /^Q[1-9]\d*$/i.test(id) ? `https://www.wikidata.org/wiki/${id.toUpperCase()}` : null;
  case "gnis":
    return /^\d+$/.test(id)
      ? `https://edits.nationalmap.gov/apps/gaz-domestic/public/summary/${id}`
      : null;
  case "osm_node":
  case "osm_way":
  case "osm_relation":
    return /^\d+$/.test(id)
      ? `https://www.openstreetmap.org/${type.slice(4)}/${id}`
      : null;
  case "wta":
    return /^[a-z0-9][a-z0-9-]*$/i.test(id)
      ? `https://www.wta.org/go-hiking/hikes/${id}`
      : null;
  case "alltrails": {
    const path = id.replace(/^\/+/, "");
    return /^(?:[a-z]{2}(?:-[a-z]{2})?\/)?trail\/[a-z0-9/_-]+$/i.test(path)
      ? `https://www.alltrails.com/${path}`
      : null;
  }
  case "strava":
    return /^[1-9]\d*$/.test(id) ? `https://www.strava.com/routes/${id}` : null;
  case "caltopo":
    return /^[a-z0-9]+$/i.test(id) ? `https://caltopo.com/m/${id}` : null;
  case "gaia":
    return /^[a-z0-9_-]+$/i.test(id) ? `https://www.gaiagps.com/public/${id}` : null;
  case "wikiloc":
    return /^[1-9]\d*$/.test(id)
      ? `https://www.wikiloc.com/wikiloc/view.do?id=${id}`
      : null;
  case "hiking_project":
    return /^[1-9]\d*$/.test(id)
      ? `https://www.hikingproject.com/trail/${id}`
      : null;
  default:
    return null;
  }
}

function emptyKindReport(): KindReport {
  return { total: 0, linked: 0, missing: 0, coveragePercent: 0, providers: {} };
}

function addProvider(report: KindReport, provider: string): void {
  report.providers[provider] = (report.providers[provider] ?? 0) + 1;
}

function linksForRow(row: CatalogRow, issues: LinkIssue[]): Map<string, string> {
  const links = new Map<string, string>();
  const stored = row.external_links;
  if (!Array.isArray(stored)) {
    issues.push({ kind: row.kind, id: row.id, name: row.name, reason: "external_links is not an array" });
  } else {
    for (const value of stored) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        issues.push({ kind: row.kind, id: row.id, name: row.name, reason: "external_links contains a non-object" });
        continue;
      }
      const raw = value as Record<string, unknown>;
      const provider = providerName(raw.type ?? raw.provider ?? raw.source);
      const url = catalogLinkUrl(provider, raw.id ?? raw.url ?? raw.href);
      if (!provider || !url) {
        issues.push({ kind: row.kind, id: row.id, name: row.name, reason: "external_links contains an invalid provider or URL" });
        continue;
      }
      if (links.has(url)) {
        issues.push({ kind: row.kind, id: row.id, name: row.name, reason: `duplicate link: ${url}` });
        continue;
      }
      links.set(url, provider);
    }
  }

  if (row.external_ids && typeof row.external_ids === "object" && !Array.isArray(row.external_ids)) {
    for (const [rawProvider, rawId] of Object.entries(row.external_ids)) {
      const provider = providerName(rawProvider);
      const url = catalogLinkUrl(provider, rawId);
      if (provider && url && !links.has(url)) links.set(url, provider);
    }
  } else if (row.kind === "destination") {
    issues.push({ kind: row.kind, id: row.id, name: row.name, reason: "external_ids is not an object" });
  }
  return links;
}

function finalize(report: KindReport): void {
  report.missing = report.total - report.linked;
  report.coveragePercent = report.total === 0
    ? 0
    : Number(((report.linked / report.total) * 100).toFixed(1));
  report.providers = Object.fromEntries(
    Object.entries(report.providers).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  );
}

export function buildExternalLinkAudit(rows: CatalogRow[], sampleLimit = 20): AuditReport {
  const destinations = emptyKindReport();
  const routes = emptyKindReport();
  const destinationFeatures: Record<string, KindReport> = {};
  const allIssues: LinkIssue[] = [];

  for (const row of rows) {
    const report = row.kind === "destination" ? destinations : routes;
    report.total++;
    const links = linksForRow(row, allIssues);
    if (links.size > 0) report.linked++;
    for (const provider of new Set(links.values())) addProvider(report, provider);

    if (row.kind === "destination") {
      const features = row.features.length > 0 ? row.features : ["unclassified"];
      for (const feature of features) {
        const featureReport = destinationFeatures[feature] ??= emptyKindReport();
        featureReport.total++;
        if (links.size > 0) featureReport.linked++;
        for (const provider of new Set(links.values())) addProvider(featureReport, provider);
      }
    }
  }

  finalize(destinations);
  finalize(routes);
  for (const report of Object.values(destinationFeatures)) finalize(report);

  return {
    generatedAt: new Date().toISOString(),
    destinations,
    routes,
    destinationFeatures: Object.fromEntries(
      Object.entries(destinationFeatures).sort((left, right) => right[1].total - left[1].total)
    ),
    issueCount: allIssues.length,
    issues: allIssues.slice(0, sampleLimit),
  };
}

async function loadRows(): Promise<CatalogRow[]> {
  const result = await db.query<CatalogRow>(
    `SELECT 'destination'::text AS kind,
            d.id, d.name, COALESCE(d.features::text[], ARRAY[]::text[]) AS features,
            COALESCE(d.external_ids, '{}'::jsonb) AS external_ids,
            COALESCE(to_jsonb(d)->'external_links', '[]'::jsonb) AS external_links
       FROM destinations d
     UNION ALL
     SELECT 'route'::text AS kind,
            r.id, r.name, ARRAY[]::text[] AS features,
            '{}'::jsonb AS external_ids,
            COALESCE(r.external_links, '[]'::jsonb) AS external_links
       FROM routes r
      WHERE r.owner = 'peaks'
        AND r.status = 'active'
      ORDER BY kind, id`
  );
  return result.rows;
}

function printKind(label: string, report: KindReport): void {
  console.log(`${label}: ${report.linked}/${report.total} linked (${report.coveragePercent}%), ${report.missing} missing`);
  for (const [provider, count] of Object.entries(report.providers)) {
    console.log(`  ${provider}: ${count}`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  try {
    const report = buildExternalLinkAudit(await loadRows(), options.sampleLimit);
    if (options.format === "json") {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    printKind("Destinations", report.destinations);
    printKind("Routes", report.routes);
    console.log("Destination coverage by feature:");
    for (const [feature, featureReport] of Object.entries(report.destinationFeatures)) {
      console.log(`  ${feature}: ${featureReport.linked}/${featureReport.total} (${featureReport.coveragePercent}%)`);
    }
    console.log(`Integrity issues: ${report.issueCount}`);
    for (const issue of report.issues) {
      console.log(`  ${issue.kind} ${issue.id} ${issue.name ?? "(unnamed)"}: ${issue.reason}`);
    }
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
