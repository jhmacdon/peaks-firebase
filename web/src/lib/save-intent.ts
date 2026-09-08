export const SAVE_INTENT_KEY = "peaks.save-intent";
export function parseSaveIntent(raw: string | null, now = Date.now()): { destinationId: string; returnPath: string } | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value.destinationId !== "string" || !/^[\w-]{1,160}$/.test(value.destinationId) || typeof value.returnPath !== "string" || !value.returnPath.startsWith("/") || value.returnPath.startsWith("//") || typeof value.createdAt !== "number" || value.createdAt > now || now - value.createdAt > 10 * 60 * 1000) return null;
    return { destinationId: value.destinationId, returnPath: value.returnPath };
  } catch { return null; }
}
