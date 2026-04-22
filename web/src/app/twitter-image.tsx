import { ImageResponse } from "next/og";
import { SeoImage } from "../lib/seo-image";
import { siteConfig } from "../lib/seo";

export const size = {
  width: 1200,
  height: 600,
};

export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    (
      <SeoImage
        title={siteConfig.name}
        subtitle={siteConfig.description}
      />
    ),
    size
  );
}
