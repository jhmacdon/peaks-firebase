export const DESTINATION_SITEMAP_CHUNK_SIZE = 40_000;

// The catalog held 82,977 destinations on 2026-08-23, so three chunks are
// complete and leave room through 120,000 rows. Keep this index independent
// from Cloud SQL: it must remain available when the catalog is under load.
// Raise this count before the catalog reaches the current capacity.
export const DESTINATION_SITEMAP_CHUNK_COUNT = 3;

export const CATALOG_SITEMAP_IDS = ["areas", "routes", "lists"] as const;
export const STATIC_SITEMAP_IDS = ["landing", "static"] as const;

export function sitemapIds(): string[] {
  return [
    ...Array.from(
      { length: DESTINATION_SITEMAP_CHUNK_COUNT },
      (_, index) => `destinations-${index}`
    ),
    ...CATALOG_SITEMAP_IDS,
    ...STATIC_SITEMAP_IDS,
  ];
}

export function destinationSitemapChunkIndex(id: string): number | null {
  const match = /^destinations-(\d+)$/.exec(id);
  if (!match) return null;

  const index = Number(match[1]);
  return index >= 0 && index < DESTINATION_SITEMAP_CHUNK_COUNT ? index : null;
}

export function isKnownSitemapId(id: string): boolean {
  return sitemapIds().includes(id);
}

export interface SitemapUrlEntry {
  url: string;
  lastModified?: Date | string | null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildSitemapIndexXml(urls: string[]): string {
  const entries = urls
    .map(
      (url) =>
        `  <sitemap>\n    <loc>${escapeXml(url)}</loc>\n  </sitemap>`
    )
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    "</sitemapindex>",
    "",
  ].join("\n");
}

export function buildUrlSetXml(entries: SitemapUrlEntry[]): string {
  const urls = entries
    .map((entry) => {
      const lastModified = isoDate(entry.lastModified);
      return [
        "  <url>",
        `    <loc>${escapeXml(entry.url)}</loc>`,
        ...(lastModified ? [`    <lastmod>${lastModified}</lastmod>`] : []),
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}
