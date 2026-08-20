import type { MetadataRoute } from "next";
import db from "../lib/db";
import { ACTIVITY_LANDING_TYPES } from "../lib/landing-copy";
import { usStateSlugFromCode } from "../lib/regions";
import { absoluteUrl } from "../lib/seo";
import {
  DESTINATION_CHUNK_SIZE,
  resolveDestinationChunkCount,
} from "../lib/sitemap-chunks";

const SITEMAP_IDS = {
  areas: "areas",
  routes: "routes",
  lists: "lists",
  landing: "landing",
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
    { id: SITEMAP_IDS.landing },
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

  if (id === SITEMAP_IDS.landing) {
    // Same threshold as peaks/[state]'s own generateStaticParams — a state
    // sitemap entry only worth publishing once the page has real content to
    // rank on. Degrades to just the four activity URLs (never zero) if the
    // catalog query fails; the next crawl picks the states back up once the
    // database is reachable again.
    const activityUrls = ACTIVITY_LANDING_TYPES.map((type) => ({
      url: absoluteUrl(`/activities/${type}`),
    }));

    const stateCodes = await safeQuery(
      db.query<{ state_code: string }>(
        `SELECT state_code
         FROM destinations
         WHERE country_code = 'US' AND state_code IS NOT NULL
         GROUP BY state_code
         HAVING COUNT(*) > 50`
      )
    );

    const stateUrls = (stateCodes?.rows ?? [])
      .map((row) => usStateSlugFromCode(row.state_code))
      .filter((slug): slug is string => slug !== null)
      .map((slug) => ({ url: absoluteUrl(`/peaks/${slug}`) }));

    return [...activityUrls, ...stateUrls];
  }

  if (id === SITEMAP_IDS.static) {
    const lastModified = new Date();
    return [
      {
        url: absoluteUrl("/"),
        lastModified,
      },
      {
        url: absoluteUrl("/discover"),
        lastModified,
      },
      {
        url: absoluteUrl("/features"),
        lastModified,
      },
      {
        url: absoluteUrl("/areas"),
        lastModified,
      },
      {
        url: absoluteUrl("/lists"),
        lastModified,
      },
      {
        url: absoluteUrl("/about"),
        lastModified,
      },
      {
        url: absoluteUrl("/privacy"),
        lastModified,
      },
      {
        url: absoluteUrl("/terms"),
        lastModified,
      },
    ];
  }

  return [];
}
