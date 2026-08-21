export const DESTINATION_CHUNK_SIZE = 40_000;

const DESTINATION_FALLBACK_CHUNK_COUNT = 2;
const DESTINATION_COUNT_ERROR =
  "[sitemap] Destination count failed; falling back to two chunks.";

export async function resolveDestinationChunkCount(
  loadDestinationCount: () => Promise<number>,
  logError: (message: string, error: unknown) => void = console.error
): Promise<number> {
  try {
    const destinationCount = await loadDestinationCount();
    return Math.max(1, Math.ceil(destinationCount / DESTINATION_CHUNK_SIZE));
  } catch (error) {
    logError(DESTINATION_COUNT_ERROR, error);
    return DESTINATION_FALLBACK_CHUNK_COUNT;
  }
}
