import { absoluteUrl } from "./seo";

interface CatalogSharePhoto {
  imageUrl: string | null;
  attribution: string | null;
  attributionUrl: string | null;
}

export interface CatalogShareImage {
  url: string;
  alt: string;
  width?: number;
  height?: number;
  type?: string;
}

/** Use the existing catalog photo without cropping or drawing over it. */
export function catalogShareImage(
  name: string,
  canonicalPath: string,
  photo: CatalogSharePhoto
): CatalogShareImage {
  const imageUrl = publicHttpUrl(photo.imageUrl);
  const attribution = photo.attribution?.trim();
  if (imageUrl && attribution && publicHttpUrl(photo.attributionUrl)) {
    return {
      url: imageUrl,
      alt: `${name}. Photo: ${attribution}`,
    };
  }

  return {
    url: absoluteUrl(`${canonicalPath}/share-image`),
    width: 1200,
    height: 630,
    type: "image/png",
    alt: `${name} on Peaks`,
  };
}

function publicHttpUrl(value: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
