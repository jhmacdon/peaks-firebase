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

const COVER_CANDIDATE_LIMIT = 12;

/**
 * Adds ranked cover-photo candidates to any area query whose selected-area
 * alias is `ranked`.
 *
 * Only the small set of areas already selected for display pays for this
 * lookup. The full PAD-US boundary never enters the ranked row. Callers pick
 * distinct photos after the query so overlapping areas do not repeat the same
 * summit image in one result set.
 */
export function areaCoverPhotoSql(): string {
  return `
    cover.cover_photo_candidates AS cover_photo_candidates
    FROM ranked
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
               jsonb_build_object(
                 'imageUrl', candidate.hero_image,
                 'focalX', candidate.hero_image_focal_x,
                 'focalY', candidate.hero_image_focal_y,
                 'attribution', candidate.hero_image_attribution,
                 'attributionUrl', candidate.hero_image_attribution_url
               )
               ORDER BY candidate.prominence DESC NULLS LAST,
                        candidate.elevation DESC NULLS LAST,
                        candidate.name ASC NULLS LAST,
                        candidate.id ASC
             ) AS cover_photo_candidates
      FROM (
        SELECT d.hero_image,
               d.hero_image_focal_x,
               d.hero_image_focal_y,
               d.hero_image_attribution,
               d.hero_image_attribution_url,
               d.prominence,
               d.elevation,
               d.name,
               d.id
        FROM destination_areas da
        JOIN destinations d ON d.id = da.destination_id
        WHERE da.area_id = ranked.id
          AND d.owner = 'peaks'
          AND NULLIF(d.hero_image, '') IS NOT NULL
        ORDER BY d.prominence DESC NULLS LAST,
                 d.elevation DESC NULLS LAST,
                 d.name ASC NULLS LAST,
                 d.id ASC
        LIMIT ${COVER_CANDIDATE_LIMIT}
      ) candidate
    ) cover
      ON TRUE`;
}

export function areaCoverPhotoFor(areaId: string, row: unknown): AreaCoverPhoto | null {
  return areaCoverPhotoCandidatesFor(areaId, row)[0] ?? null;
}

/**
 * Picks the largest possible set of distinct photos while keeping each area's
 * candidates in rank order. The matching step may move an earlier area to its
 * second choice when a later area has no other photo, which keeps more cards
 * image-led without ever showing the same image twice.
 */
export function distinctAreaCoverPhotosFor(
  areas: readonly { areaId: string; row: unknown }[]
): Array<AreaCoverPhoto | null> {
  const candidatesByArea = areas.map(({ areaId, row }) =>
    areaCoverPhotoCandidatesFor(areaId, row)
  );
  const ownerByPhoto = new Map<string, number>();
  const selectedByArea: Array<AreaCoverPhoto | null> = areas.map(() => null);

  function assign(areaIndex: number, visitedPhotos: Set<string>): boolean {
    for (const candidate of candidatesByArea[areaIndex]) {
      const identity = coverPhotoIdentity(candidate);
      if (visitedPhotos.has(identity)) continue;
      visitedPhotos.add(identity);

      const currentOwner = ownerByPhoto.get(identity);
      if (currentOwner === undefined || assign(currentOwner, visitedPhotos)) {
        ownerByPhoto.set(identity, areaIndex);
        selectedByArea[areaIndex] = candidate;
        return true;
      }
    }

    return false;
  }

  for (let areaIndex = 0; areaIndex < areas.length; areaIndex += 1) {
    assign(areaIndex, new Set());
  }

  return selectedByArea;
}

function areaCoverPhotoCandidatesFor(
  areaId: string,
  row: unknown
): AreaCoverPhoto[] {
  const candidates = [
    ...(CURATED_AREA_COVERS[areaId] ? [CURATED_AREA_COVERS[areaId]] : []),
    ...parseAreaCoverPhotoCandidates(row),
  ];
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const identity = coverPhotoIdentity(candidate);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function parseAreaCoverPhotoCandidates(row: unknown): AreaCoverPhoto[] {
  if (row == null || typeof row !== "object") return [];
  const fields = row as Record<string, unknown>;
  const candidates = fields.cover_photo_candidates;
  if (Array.isArray(candidates)) {
    return candidates
      .map(parseCandidateCoverPhoto)
      .filter((candidate): candidate is AreaCoverPhoto => candidate !== null);
  }

  const legacyCover = parseAreaCoverPhoto(row);
  return legacyCover ? [legacyCover] : [];
}

function parseCandidateCoverPhoto(candidate: unknown): AreaCoverPhoto | null {
  if (candidate == null || typeof candidate !== "object") return null;
  const fields = candidate as Record<string, unknown>;
  const imageUrl = textValue(fields.imageUrl);
  if (!imageUrl) return null;

  return {
    imageUrl,
    focalX: focalValue(fields.focalX),
    focalY: focalValue(fields.focalY),
    attribution: textValue(fields.attribution),
    attributionUrl: httpUrl(fields.attributionUrl),
  };
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

function coverPhotoIdentity(photo: AreaCoverPhoto): string {
  try {
    const url = new URL(photo.imageUrl);
    url.hash = "";

    // Wikimedia serves the same file at many thumbnail sizes. Reduce those
    // URLs to the source-file path so two sizes still count as one photo.
    if (url.hostname.toLowerCase() === "upload.wikimedia.org") {
      const path = url.pathname.split("/");
      const thumbIndex = path.indexOf("thumb");
      if (thumbIndex >= 0 && path.length > thumbIndex + 4) {
        path.splice(thumbIndex, 1);
        path.pop();
        url.pathname = path.join("/");
      }
      url.search = "";
    }

    return url.toString();
  } catch {
    return photo.imageUrl.trim();
  }
}
