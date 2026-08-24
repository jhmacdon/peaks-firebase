import {
  INDEXABLE_ACTIVITY_LANDING_TYPES,
  INDEXABLE_US_STATE_CODES,
} from "../../../lib/landing-copy";
import { usStateSlugFromCode } from "../../../lib/regions";
import { absoluteUrl } from "../../../lib/seo";
import {
  DESTINATION_SITEMAP_CHUNK_SIZE,
  buildUrlSetXml,
  destinationSitemapChunkIndex,
  isKnownSitemapId,
  type SitemapUrlEntry,
} from "../../../lib/sitemap-xml";

export const dynamic = "force-dynamic";

const SUCCESS_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

type SitemapRow = {
  id: string;
  updatedAt?: Date | string | null;
};

const STATIC_URLS = [
  "/",
  "/discover",
  "/features",
  "/peaks",
  "/areas",
  "/lists",
  "/about",
  "/privacy",
  "/terms",
] as const;

function xmlResponse(entries: SitemapUrlEntry[]): Response {
  return new Response(buildUrlSetXml(entries), {
    headers: {
      "Cache-Control": SUCCESS_CACHE_CONTROL,
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}

function unavailableResponse(): Response {
  return new Response("Sitemap data is temporarily unavailable.\n", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": "300",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: pathId } = await params;
  if (!pathId.endsWith(".xml")) {
    return new Response("Not found\n", { status: 404 });
  }

  const id = pathId.slice(0, -4);
  if (!isKnownSitemapId(id)) {
    return new Response("Not found\n", { status: 404 });
  }

  if (id === "static") {
    return xmlResponse(STATIC_URLS.map((path) => ({ url: absoluteUrl(path) })));
  }

  if (id === "landing") {
    const activities = INDEXABLE_ACTIVITY_LANDING_TYPES.map((type) => ({
      url: absoluteUrl(`/activities/${type}`),
    }));
    const states = INDEXABLE_US_STATE_CODES.map((code) => usStateSlugFromCode(code))
      .filter((slug): slug is string => slug !== null)
      .map((slug) => ({ url: absoluteUrl(`/peaks/${slug}`) }));
    return xmlResponse([...activities, ...states]);
  }

  try {
    // Keep the static and landing sitemaps independent from connector setup.
    // Catalog sitemaps load the database only after the ID is known to need it.
    const { default: db } = await import("../../../lib/db");
    const chunkIndex = destinationSitemapChunkIndex(id);

    if (chunkIndex != null) {
      const result = await db.query<SitemapRow>(
        `SELECT id, updated_at AS "updatedAt"
         FROM destinations
         ORDER BY id ASC
         LIMIT $1 OFFSET $2`,
        [
          DESTINATION_SITEMAP_CHUNK_SIZE,
          chunkIndex * DESTINATION_SITEMAP_CHUNK_SIZE,
        ]
      );
      return xmlResponse(
        result.rows.map((row) => ({
          url: absoluteUrl(`/destinations/${row.id}`),
          lastModified: row.updatedAt,
        }))
      );
    }

    if (id === "areas") {
      const result = await db.query<SitemapRow>(`
        SELECT id, updated_at AS "updatedAt"
        FROM areas
        ORDER BY id ASC
      `);
      return xmlResponse(
        result.rows.map((row) => ({
          url: absoluteUrl(`/areas/${encodeURIComponent(row.id)}`),
          lastModified: row.updatedAt,
        }))
      );
    }

    if (id === "routes") {
      const result = await db.query<SitemapRow>(`
        SELECT id, updated_at AS "updatedAt"
        FROM routes
        WHERE owner = 'peaks' AND status = 'active'
        ORDER BY id ASC
      `);
      return xmlResponse(
        result.rows.map((row) => ({
          url: absoluteUrl(`/routes/${row.id}`),
          lastModified: row.updatedAt,
        }))
      );
    }

    const result = await db.query<SitemapRow>(`
      SELECT id, updated_at AS "updatedAt"
      FROM lists
      ORDER BY id ASC
    `);
    return xmlResponse(
      result.rows.map((row) => ({
        url: absoluteUrl(`/lists/${row.id}`),
        lastModified: row.updatedAt,
      }))
    );
  } catch (error) {
    console.error(`[sitemap] ${id} failed`, error);
    return unavailableResponse();
  }
}
