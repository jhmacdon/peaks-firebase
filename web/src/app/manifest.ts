import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Peaks",
    short_name: "Peaks",
    description:
      "An iPhone peak-bagging tracker and public guide for peaks, routes, lists, and trip reports.",
    start_url: "/discover",
    scope: "/",
    display: "standalone",
    background_color: "#181816",
    theme_color: "#181816",
    lang: "en",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
