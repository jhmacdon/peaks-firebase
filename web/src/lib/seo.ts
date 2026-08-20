export const siteConfig = {
  name: "Peaks",
  description: "Track peaks, routes, lists, and trip reports.",
  locale: "en_US",
};

function normalizeSiteUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function getSiteUrl(): URL {
  const rawUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_URL ??
    "http://localhost:3000";

  return new URL(normalizeSiteUrl(rawUrl));
}

export function absoluteUrl(path: string): string {
  return new URL(path, getSiteUrl()).toString();
}

export function formatFeet(meters: number | null | undefined): string | null {
  if (meters == null) return null;
  return `${Math.round(meters * 3.28084).toLocaleString("en-US")} ft`;
}

export function formatMiles(meters: number | null | undefined): string | null {
  if (meters == null) return null;
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

export function summarizeText(
  parts: Array<string | null | undefined>,
  maxLength: number = 160
): string | null {
  const text = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** " · "-joined stat line for an OG image or card subtitle. Drops empty
 * parts instead of printing a blank slot between separators. */
export function joinStats(
  parts: Array<string | null | undefined>,
  separator: string = "  ·  "
): string | null {
  const filtered = parts.filter((part): part is string => Boolean(part && part.trim()));
  if (filtered.length === 0) return null;
  return filtered.join(separator);
}
