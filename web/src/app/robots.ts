import type { MetadataRoute } from "next";
import { absoluteUrl } from "../lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/account",
          "/log",
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
