import type { MetadataRoute } from "next";
import { absoluteUrl } from "../lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /log/[id] activity pages carry their own page-level `noindex`
        // (see (public)/log/[id]/layout.tsx) rather than a robots.txt
        // disallow, so link unfurlers that respect robots.txt can still
        // fetch the page and read its Open Graph tags.
        disallow: [
          "/admin",
          "/account",
          "/plans",
          "/reports/new",
          "/map",
          "/login",
          "/register",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
