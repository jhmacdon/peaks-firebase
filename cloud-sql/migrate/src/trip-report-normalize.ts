type LegacyPhoto = {
  id: string;
  downloadURL: string;
  caption: string | null;
  takenAt: Date | null;
  ordinal: number;
};

export type NormalizedLegacyTripReport = {
  id: string;
  userId: string;
  authorName: string;
  title: string;
  body: string;
  activityDate: Date;
  destinationIds: string[];
  photos: LegacyPhoto[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  const item = record(value);
  if (item && typeof item.toDate === "function") {
    const date = (item.toDate as () => Date)();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function legacyBlocks(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(record)
    .filter((item): item is Record<string, unknown> => item !== null);
}

export function normalizeLegacyTripReport(
  id: string,
  data: Record<string, unknown>
): NormalizedLegacyTripReport | null {
  const userId = typeof data.userId === "string" ? data.userId.trim() : "";
  if (!id || !userId) return null;
  const date = asDate(data.date) ?? asDate(data.createdAt) ?? new Date(0);
  const title = (
    typeof data.title === "string" ? data.title
      : typeof data.name === "string" ? data.name
        : "Trip Report"
  ).trim().slice(0, 180) || "Trip Report";
  const rawName = data.userName ?? data.authorName;
  const authorName = typeof rawName === "string" && rawName.trim()
    ? rawName.trim().slice(0, 200)
    : "Peaks member";
  const destinations = Array.isArray(data.destinations)
    ? [...new Set(data.destinations.filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    ).map((value) => value.trim()))]
    : [];

  const header: Record<string, unknown>[] = legacyBlocks(data.headerPhotos)
    .map((block) => ({ ...block, placement: "header" }));
  const content = legacyBlocks(data.content);
  const webBlocks = legacyBlocks(data.blocks);
  const blocks = header.length > 0 || content.length > 0 ? [...header, ...content] : webBlocks;
  const text = blocks
    .filter((block) => block.type !== "photo")
    .map((block) => {
      const value = typeof block.text === "string" ? block.text : block.content;
      return typeof value === "string" ? value.trim() : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 20_000);
  const photos = blocks.flatMap((block, ordinal): LegacyPhoto[] => {
    if (block.type !== "photo") return [];
    const url = typeof block.image === "string" ? block.image
      : typeof block.url === "string" ? block.url
        : typeof block.content === "string" ? block.content
          : "";
    if (!url.startsWith("https://")) return [];
    const sourceId = typeof block.id === "string" ? block.id
      : typeof block.sourceId === "string" ? block.sourceId
        : `${id}-photo-${ordinal}`;
    return [{
      id: `${id}:${sourceId}`.slice(0, 200),
      downloadURL: url.slice(0, 3_000),
      caption: typeof block.caption === "string" ? block.caption.trim().slice(0, 500) || null : null,
      takenAt: asDate(block.created) ?? asDate(block.createdAt),
      ordinal,
    }];
  });

  if (!text && photos.length === 0) return null;
  return {
    id,
    userId,
    authorName,
    title,
    body: text,
    activityDate: date,
    destinationIds: destinations,
    photos,
  };
}
