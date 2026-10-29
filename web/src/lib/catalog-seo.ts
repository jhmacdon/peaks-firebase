import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "./seo";

export type CatalogSearchParams = Record<string, string | string[] | undefined>;

export function firstSearchValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function catalogPageNumber(value: string | string[] | undefined): number {
  const raw = firstSearchValue(value);
  return /^\d+$/.test(raw) ? Math.max(1, Math.min(10_000, Number(raw))) : 1;
}

/** One URL for page one; stable parameter order; no tracking parameters. */
export function catalogPagePath(
  path: string,
  page: number,
  filters: Record<string, string> = {},
): string {
  const query = new URLSearchParams();
  for (const key of Object.keys(filters).sort()) {
    if (filters[key]) query.set(key, filters[key]);
  }
  if (page > 1) query.set("page", String(page));
  return `${path}${query.size ? `?${query}` : ""}`;
}

export function catalogPageMetadata({
  path, title, description, page, filters = {}, noindex = false,
}: {
  path: string;
  title: string;
  description: string;
  page: number;
  filters?: Record<string, string>;
  noindex?: boolean;
}): Metadata {
  const pageTitle = page > 1 ? `${title} — Page ${page}` : title;
  const pageDescription = page > 1 ? `Page ${page}. ${description}` : description;
  const url = absoluteUrl(catalogPagePath(path, page, filters));
  return {
    title: pageTitle,
    description: pageDescription,
    alternates: { canonical: url },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: pageTitle,
      description: pageDescription,
      url,
      siteName: siteConfig.name,
      type: "website",
      images: [{ url: absoluteUrl("/opengraph-image"), width: 1200, height: 630, alt: siteConfig.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description: pageDescription,
      images: [absoluteUrl("/twitter-image")],
    },
  };
}

// Apply at the HTTP layer so Discover can keep its static, cached browse
// HTML. Reading searchParams in generateMetadata would make every visit dynamic.
export const DISCOVER_SEARCH_PARAMETERS = [
  "q", "type", "state", "area", "activity", "difficulty", "maxDistance",
  "maxGain", "sort", "page", "nearLat", "nearLng",
] as const;
