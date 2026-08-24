export interface AreaCoverPhoto {
  imageUrl: string;
  focalX: number;
  focalY: number;
  attribution: string | null;
  attributionUrl: string | null;
}

const CURATED_AREA_COVERS: Readonly<Record<string, AreaCoverPhoto>> = {
  "padus-96976ad47b6e7a6cda92": {
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Coon_bluff_after_rain_1.jpg/1920px-Coon_bluff_after_rain_1.jpg",
    focalX: 38,
    focalY: 50,
    attribution: "Mkling98 · CC0",
    attributionUrl:
      "https://commons.wikimedia.org/wiki/File:Coon_bluff_after_rain_1.jpg",
  },
  "padus-cf223c37f730445322ed": {
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Aerial_view_of_Cibola_National_Forest_01.jpg/1920px-Aerial_view_of_Cibola_National_Forest_01.jpg",
    focalX: 50,
    focalY: 50,
    attribution: "Joe Mabel · CC BY 3.0",
    attributionUrl:
      "https://commons.wikimedia.org/wiki/File:Aerial_view_of_Cibola_National_Forest_01.jpg",
  },
  "padus-f583be301b5ba1ef23d3": {
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/8/85/Santa_Fe_NF_Fall.jpg",
    focalX: 50,
    focalY: 50,
    attribution: "Artotem · CC BY 2.0",
    attributionUrl: "https://commons.wikimedia.org/wiki/File:Santa_Fe_NF_Fall.jpg",
  },
  "padus-a6d65a378c81af3ad91f": {
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Gila_Wilderness_Rock_Formations_%288726014445%29.jpg/1920px-Gila_Wilderness_Rock_Formations_%288726014445%29.jpg",
    focalX: 50,
    focalY: 42,
    attribution: "Gila National Forest · CC BY-SA 2.0",
    attributionUrl:
      "https://commons.wikimedia.org/wiki/File:Gila_Wilderness_Rock_Formations_(8726014445).jpg",
  },
};

/**
 * Adds one cover-photo row to any area query whose selected-area alias is
 * `ranked`.
 *
 * Only the small set of areas already selected for display pays for this
 * lookup. The full PAD-US boundary never enters the ranked row.
 */
export function areaCoverPhotoSql(): string {
  return `
    cover.hero_image AS cover_image_url,
    cover.hero_image_focal_x AS cover_image_focal_x,
    cover.hero_image_focal_y AS cover_image_focal_y,
    cover.hero_image_attribution AS cover_image_attribution,
    cover.hero_image_attribution_url AS cover_image_attribution_url
    FROM ranked
    LEFT JOIN LATERAL (
      SELECT d.hero_image,
             d.hero_image_focal_x,
             d.hero_image_focal_y,
             d.hero_image_attribution,
             d.hero_image_attribution_url
      FROM destination_areas da
      JOIN destinations d ON d.id = da.destination_id
      WHERE da.area_id = ranked.id
        AND d.owner = 'peaks'
        AND NULLIF(d.hero_image, '') IS NOT NULL
      ORDER BY d.prominence DESC NULLS LAST,
               d.elevation DESC NULLS LAST,
               d.name ASC NULLS LAST,
               d.id ASC
      LIMIT 1
    ) cover
      ON TRUE`;
}

export function areaCoverPhotoFor(areaId: string, row: unknown): AreaCoverPhoto | null {
  return CURATED_AREA_COVERS[areaId] ?? parseAreaCoverPhoto(row);
}

function parseAreaCoverPhoto(row: unknown): AreaCoverPhoto | null {
  if (row == null || typeof row !== "object") return null;
  const fields = row as Record<string, unknown>;
  const imageUrl = textValue(fields.cover_image_url);
  if (!imageUrl) return null;

  return {
    imageUrl,
    focalX: focalValue(fields.cover_image_focal_x),
    focalY: focalValue(fields.cover_image_focal_y),
    attribution: textValue(fields.cover_image_attribution),
    attributionUrl: httpUrl(fields.cover_image_attribution_url),
  };
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function focalValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.round(parsed), 0), 100);
}

function httpUrl(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;

  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
