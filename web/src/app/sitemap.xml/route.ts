import { absoluteUrl } from "../../lib/seo";
import { generateSitemaps } from "../sitemap";

export const dynamic = "force-dynamic";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET(): Promise<Response> {
  const sitemaps = await generateSitemaps();
  const entries = sitemaps
    .map(({ id }) => {
      const url = absoluteUrl(`/sitemap/${encodeURIComponent(id)}.xml`);
      return `  <sitemap>\n    <loc>${escapeXml(url)}</loc>\n  </sitemap>`;
    })
    .join("\n");

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    "</sitemapindex>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "application/xml",
    },
  });
}
