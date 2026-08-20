import type { MetadataRoute } from "next";
import db from "../lib/db";
import { absoluteUrl } from "../lib/seo";
import {
  DESTINATION_CHUNK_SIZE,
  resolveDestinationChunkCount,
} from "../lib/sitemap-chunks";

const SITEMAP_IDS = {
  areas: "areas",
  routes: "routes",
  lists: "lists",
  static: "static",
} as const;

type SitemapRow = {
  id: string;
  updatedAt?: Date | string | null;
};

type CountRow = {
  count: number | string;
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

function destinationChunkIndex(id: string): number | null {
  const match = /^destinations-(\d+)$/.exec(id);
  if (!match) return null;
  return Number(match[1]);
}

export const dynamic = "force-dynamic";

export async function generateSitemaps(): Promise<Array<{ id: string }>> {
  const destinationChunkCount = await resolveDestinationChunkCount(async () => {
    const result = await db.query<CountRow>(
      "SELECT COUNT(*)::int AS count FROM destinations"
    );
    return Number(result.rows[0]?.count ?? 0);
  });

  return [
    ...Array.from({ length: destinationChunkCount }, (_, index) => ({
      id: `destinations-${index}`,
    })),
    { id: SITEMAP_IDS.areas },
    { id: SITEMAP_IDS.routes },
    { id: SITEMAP_IDS.lists },
    { id: SITEMAP_IDS.static },
  ];
}

export default async function sitemap({
  id,
}: {
  id: string;
}): Promise<MetadataRoute.Sitemap> {
  const chunkIndex = destinationChunkIndex(id);
  if (chunkIndex != null) {
    const destinations = await safeQuery(
      db.query<SitemapRow>(
        `SELECT id, updated_at AS "updatedAt"
         FROM destinations
         ORDER BY id ASC
         LIMIT $1 OFFSET $2`,
        [DESTINATION_CHUNK_SIZE, chunkIndex * DESTINATION_CHUNK_SIZE]
      )
    );

    return (destinations?.rows ?? []).map((row) => ({
      url: absoluteUrl(`/destinations/${row.id}`),
      lastModified: toIsoDate(row.updatedAt),
    }));
  }

  if (id === SITEMAP_IDS.areas) {
    const areas = await safeQuery(
      db.query<SitemapRow>(`
        SELECT id, updated_at AS "updatedAt"
        FROM areas
        ORDER BY id ASC
      `)
    );

    return (areas?.rows ?? []).map((row) => ({
      url: absoluteUrl(`/areas/${encodeURIComponent(row.id)}`),
      lastModified: toIsoDate(row.updatedAt),
    }));
  }

  if (id === SITEMAP_IDS.routes) {
    const routes = await safeQuery(
      db.query<SitemapRow>(`
        SELECT id, updated_at AS "updatedAt"
        FROM routes
        WHERE owner = 'peaks' AND status = 'active'
        ORDER BY id ASC
      `)
    );

    return (routes?.rows ?? []).map((row) => ({
      url: absoluteUrl(`/routes/${row.id}`),
      lastModified: toIsoDate(row.updatedAt),
    }));
  }

  if (id === SITEMAP_IDS.lists) {
    const lists = await safeQuery(
      db.query<SitemapRow>(`
        SELECT id, updated_at AS "updatedAt"
        FROM lists
        ORDER BY id ASC
      `)
    );

    return (lists?.rows ?? []).map((row) => ({
      url: absoluteUrl(`/lists/${row.id}`),
      lastModified: toIsoDate(row.updatedAt),
    }));
  }

  if (id === SITEMAP_IDS.static) {
    const lastModified = new Date();
    return [
      {
        url: absoluteUrl("/discover"),
        lastModified,
      },
      {
        url: absoluteUrl("/lists"),
        lastModified,
      },
    ];
  }

  return [];
}
