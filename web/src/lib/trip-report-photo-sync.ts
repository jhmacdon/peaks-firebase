/**
 * Pure block↔row translation for `trip_report_photos`, extracted out of
 * `actions/trip-reports.ts` (which can only export `async` functions, being
 * a `"use server"` file) so it's usable from `node --test` directly.
 *
 * `createTripReport`/`updateTripReport` call `buildPhotoSyncPlan` to decide
 * what to insert/update/delete; the report-detail read path (`mapReport`)
 * calls `photoRowToBlock` to go the other way. Round-tripping a block
 * through both is what the tests below assert.
 */

import { normalizeReportPhoto } from "./report-photo-url";

export interface ExistingPhotoRow {
  id: string;
  storagePath: string | null;
}

export interface IncomingPhotoBlock {
  sourceId?: string;
  content: string;
  caption?: string;
}

export interface PhotoUpsert {
  id: string;
  isNew: boolean;
  downloadUrl: string;
  storagePath: string;
  caption: string | null;
  ordinal: number;
}

export interface PhotoSyncPlan {
  /** Rows to INSERT (`isNew: true`) or UPDATE (`isNew: false`) — order
   * matches the incoming photo blocks, filtered to the ones that resolved
   * to a real Peaks Storage URL. */
  upserts: PhotoUpsert[];
  /** Existing row ids to delete: present before the sync but not
   * referenced (by `sourceId`) by any surviving incoming block. */
  removedIds: string[];
}

/**
 * A block whose `content` isn't (or is no longer) a URL from the
 * configured Peaks Storage bucket is dropped rather than persisted —
 * matches `normalizeReportPhoto`'s job of gating what actually gets
 * rendered/stored. If that block carried a `sourceId`, the row it
 * pointed at is treated as unreferenced and ends up in `removedIds`.
 */
export function buildPhotoSyncPlan(
  existingRows: readonly ExistingPhotoRow[],
  incomingBlocks: readonly IncomingPhotoBlock[],
  generateId: () => string
): PhotoSyncPlan {
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const keptIds = new Set<string>();
  const upserts: PhotoUpsert[] = [];

  incomingBlocks.forEach((block, ordinal) => {
    const normalized = normalizeReportPhoto(block.content);
    if (!normalized) return;

    const caption = block.caption?.trim() || null;
    const existing = block.sourceId ? existingById.get(block.sourceId) : undefined;

    if (existing) {
      keptIds.add(existing.id);
      upserts.push({
        id: existing.id,
        isNew: false,
        downloadUrl: normalized.url,
        storagePath: normalized.storagePath,
        caption,
        ordinal,
      });
    } else {
      const id = generateId();
      keptIds.add(id);
      upserts.push({
        id,
        isNew: true,
        downloadUrl: normalized.url,
        storagePath: normalized.storagePath,
        caption,
        ordinal,
      });
    }
  });

  const removedIds = existingRows
    .map((row) => row.id)
    .filter((id) => !keptIds.has(id));

  return { upserts, removedIds };
}

export interface StoredPhotoRow {
  id: string;
  downloadUrl: string;
  caption: string | null;
  /** Already ISO-stringified by the caller — `trip_report_photos.taken_at`
   * is a `TIMESTAMPTZ`, and Date→ISO conversion isn't this module's job. */
  createdAt?: string | null;
}

export interface PhotoBlock {
  type: "photo";
  content: string;
  caption?: string;
  sourceId: string;
  createdAt?: string;
}

/** The read-side inverse of `buildPhotoSyncPlan`'s upserts: a stored
 * `trip_report_photos` row back into the block shape the editor and the
 * report-detail page both consume. */
export function photoRowToBlock(row: StoredPhotoRow): PhotoBlock {
  return {
    type: "photo",
    content: row.downloadUrl,
    caption: row.caption ?? undefined,
    sourceId: row.id,
    createdAt: row.createdAt ?? undefined,
  };
}
