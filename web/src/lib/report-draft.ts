import type { TripReportBlock } from "./actions/trip-reports";

/** Mirrors the report's persisted reading order: one text body, then photos. */
export function prepareReportDraft(title: string, blocks: TripReportBlock[]) {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length > 180) throw new Error("Use a title between 1 and 180 characters.");
  const body = blocks.filter((block) => block.type === "text").map((block) => block.content.trim()).filter(Boolean).join("\n\n");
  if (!body || body.length > 20000) throw new Error("Add a report between 1 and 20,000 characters.");
  if (blocks.some((block) => block.type === "photo" && !block.content.trim())) throw new Error("Choose a photo or remove its empty space before saving.");
  const cleanBlocks: TripReportBlock[] = [{ type: "text", content: body }, ...blocks.filter((block) => block.type === "photo" && block.content.trim())];
  return { title: cleanTitle, blocks: cleanBlocks };
}
