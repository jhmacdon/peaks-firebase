import type { MetadataRoute } from "next";
import { adminDb } from "../lib/firebase-admin";
import db from "../lib/db";
import { absoluteUrl } from "../lib/seo";

type SitemapRow = {
  id: string;
  updatedAt?: Date | string | null;
};

type FirestoreTimestampLike = {
  toDate?: () => Date;
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

function toIsoDateFromFirestore(
  value: Date | string | FirestoreTimestampLike | null | undefined
): string | undefined {
  if (!value) return undefined;
  if (typeof value === "object" && "toDate" in value && value.toDate) {
    return value.toDate().toISOString();
  }
  return toIsoDate(value as Date | string | null | undefined);
}

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [destinations, routes, lists, reports] = await Promise.all([
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
      adminDb.collection("tripReports").orderBy("updatedAt", "desc").get()
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
      ...reports.docs.map((doc) => {
        const data = doc.data() as {
          updatedAt?: Date | string | FirestoreTimestampLike | null;
        };

        return {
          url: absoluteUrl(`/reports/${doc.id}`),
          lastModified: toIsoDateFromFirestore(data.updatedAt),
        };
      })
    );
  }

  return entries;
}
