import { absoluteUrl } from "../../lib/seo";
import { buildSitemapIndexXml, sitemapIds } from "../../lib/sitemap-xml";

export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const body = buildSitemapIndexXml(
    sitemapIds().map((id) => absoluteUrl(`/sitemap/${encodeURIComponent(id)}.xml`))
  );

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
