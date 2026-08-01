import type { MetadataRoute } from "next";
import db from "../lib/db";
import { absoluteUrl } from "../lib/seo";

type SitemapRow = {
  id: string;
  updatedAt?: Date | string | null;
};

async function safeQuery<T>(task: Promise<T>): Promise<T | null> {
  try {
    return await task;
  } catch {
    return null;
  }
}

function toIsoDate(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [destinations, areas, routes, lists, reports] = await Promise.all([
    safeQuery(
      db.query<SitemapRow>(`
        SELECT id, updated_at AS "updatedAt"
        FROM destinations
        ORDER BY updated_at DESC
      `)
    ),
    safeQuery(
      db.query<SitemapRow>(`
        SELECT id, updated_at AS "updatedAt"
        FROM areas
        ORDER BY updated_at DESC
      `)
    ),
    safeQuery(
      db.query<SitemapRow>(`
        SELECT id, updated_at AS "updatedAt"
        FROM routes
        WHERE owner = 'peaks' AND status = 'active'
        ORDER BY updated_at DESC
      `)
    ),
    safeQuery(
      db.query<SitemapRow>(`
        SELECT id, updated_at AS "updatedAt"
        FROM lists
        ORDER BY updated_at DESC
      `)
    ),
    safeQuery(
      db.query<SitemapRow>(`
        SELECT id, updated_at AS "updatedAt"
        FROM trip_reports
        WHERE moderation_state = 'published'
        ORDER BY updated_at DESC
      `)
    ),
  ]);

  const entries: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl("/discover"),
      lastModified: new Date(),
    },
    {
      url: absoluteUrl("/lists"),
      lastModified: new Date(),
    },
  ];

  if (destinations) {
    entries.push(
      ...destinations.rows.map((row) => ({
        url: absoluteUrl(`/destinations/${row.id}`),
        lastModified: toIsoDate(row.updatedAt),
      }))
    );
  }

  if (areas) {
    entries.push(
      ...areas.rows.map((row) => ({
        url: absoluteUrl(`/areas/${encodeURIComponent(row.id)}`),
        lastModified: toIsoDate(row.updatedAt),
      }))
    );
  }

  if (routes) {
    entries.push(
      ...routes.rows.map((row) => ({
        url: absoluteUrl(`/routes/${row.id}`),
        lastModified: toIsoDate(row.updatedAt),
      }))
    );
  }

  if (lists) {
    entries.push(
      ...lists.rows.map((row) => ({
        url: absoluteUrl(`/lists/${row.id}`),
        lastModified: toIsoDate(row.updatedAt),
      }))
    );
  }

  if (reports) {
    entries.push(
      ...reports.rows.map((row) => ({
        url: absoluteUrl(`/reports/${row.id}`),
        lastModified: toIsoDate(row.updatedAt),
      }))
    );
  }

  return entries;
}
