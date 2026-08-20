"use server";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { adminDb } from "../firebase-admin";
import { verifyToken } from "../auth-actions";
import db from "../db";
import { buildPhotoSyncPlan, photoRowToBlock } from "../trip-report-photo-sync";

export interface TripReportCondition {
  code: string;
  severity: "info" | "notable" | "serious";
  context?: string;
}

export interface TripReport {
  id: string;
  userId: string;
  userName: string;
  sessionId: string | null;
  date: string;
  title: string;
  destinations: string[];
  routes: string[];
  conditions: TripReportCondition[];
  blocks: TripReportBlock[];
  createdAt: string;
  updatedAt: string;
}

export interface TripReportBlock {
  type: "text" | "photo";
  content: string;
  caption?: string;
  placement?: "header" | "content";
  sourceId?: string;
  createdAt?: string;
}

export interface TripReportEligibleSession {
  id: string;
  name: string;
  date: string;
}

type ReportRow = {
  id: string;
  source_session_id: string | null;
  user_id: string;
  author_name: string;
  title: string;
  body: string;
  activity_date: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  destination_ids: string[];
  route_ids: string[];
  conditions: TripReportCondition[];
  photos: Array<{
    id: string;
    download_url: string;
    caption: string | null;
    taken_at: Date | string | null;
  }>;
};

const REPORT_SELECT = `
  SELECT tr.id, tr.source_session_id, tr.user_id, tr.author_name,
         tr.title, tr.body, tr.activity_date, tr.created_at, tr.updated_at,
         COALESCE((
           SELECT json_agg(rd.destination_id ORDER BY rd.destination_id)
           FROM trip_report_destinations rd WHERE rd.report_id = tr.id
         ), '[]'::json) AS destination_ids,
         COALESCE((
           SELECT json_agg(rr.route_id ORDER BY rr.route_id)
           FROM trip_report_routes rr WHERE rr.report_id = tr.id
         ), '[]'::json) AS route_ids,
         COALESCE((
           SELECT json_agg(json_build_object(
             'code', c.code, 'severity', c.severity, 'context', c.context
           ) ORDER BY c.ordinal, c.code)
           FROM trip_report_conditions c WHERE c.report_id = tr.id
         ), '[]'::json) AS conditions,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', p.id, 'download_url', p.download_url,
             'storage_path', p.storage_path,
             'caption', p.caption, 'taken_at', p.taken_at
           ) ORDER BY p.ordinal, p.id)
           FROM trip_report_photos p WHERE p.report_id = tr.id
         ), '[]'::json) AS photos
  FROM trip_reports tr
`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapReport(row: ReportRow): TripReport {
  const blocks: TripReportBlock[] = [];
  if (row.body) blocks.push({ type: "text", content: row.body });
  for (const photo of row.photos ?? []) {
    blocks.push(
      photoRowToBlock({
        id: photo.id,
        downloadUrl: photo.download_url,
        caption: photo.caption,
        createdAt: photo.taken_at ? iso(photo.taken_at) : undefined,
      })
    );
  }
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.author_name,
    sessionId: row.source_session_id,
    date: iso(row.activity_date),
    title: row.title,
    destinations: row.destination_ids ?? [],
    routes: row.route_ids ?? [],
    conditions: row.conditions ?? [],
    blocks,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function limit(value: number, fallback: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), maximum) : fallback;
}

function title(value: string): string {
  const result = value.trim();
  if (!result || result.length > 180) throw new Error("Title must be 1–180 characters");
  return result;
}

function bodyFromBlocks(blocks: TripReportBlock[]): string {
  if (!Array.isArray(blocks)) throw new Error("Report content is invalid");
  const body = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!body || body.length > 20_000) throw new Error("Report text must be 1–20,000 characters");
  return body;
}

/**
 * Persist `photo` blocks into `trip_report_photos` — the table
 * `REPORT_SELECT`/`mapReport` (and so the report-detail page) actually
 * reads photos from. Without this, photo blocks only ever lived in the
 * in-memory block array and silently vanished on save. Shared by
 * `createTripReport` (a fresh report has no existing rows, so this is a
 * pure insert) and `updateTripReport` (rows can be updated in place,
 * added, or removed). Must run inside the caller's transaction.
 */
async function syncTripReportPhotos(
  client: PoolClient,
  reportId: string,
  blocks: TripReportBlock[]
): Promise<void> {
  const photoBlocks = blocks.filter((block) => block.type === "photo");
  const existing = await client.query(
    "SELECT id, storage_path FROM trip_report_photos WHERE report_id = $1",
    [reportId]
  );
  const existingRows = existing.rows.map((row) => ({
    id: row.id as string,
    storagePath: (row.storage_path as string | null) ?? null,
  }));

  const plan = buildPhotoSyncPlan(existingRows, photoBlocks, () => randomUUID());

  for (const upsert of plan.upserts) {
    if (upsert.isNew) {
      await client.query(
        `INSERT INTO trip_report_photos (id, report_id, storage_path, download_url, caption, ordinal)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (storage_path) DO NOTHING`,
        [upsert.id, reportId, upsert.storagePath, upsert.downloadUrl, upsert.caption, upsert.ordinal]
      );
    } else {
      await client.query(
        `UPDATE trip_report_photos
         SET download_url = $1, storage_path = $2, caption = $3, ordinal = $4
         WHERE id = $5 AND report_id = $6`,
        [upsert.downloadUrl, upsert.storagePath, upsert.caption, upsert.ordinal, upsert.id, reportId]
      );
    }
  }

  if (plan.removedIds.length > 0) {
    // Same queue-then-delete pattern as deleteTripReport: the actual
    // Storage object is removed by whatever drains
    // trip_report_photo_deletions, not synchronously here.
    await client.query(
      `INSERT INTO trip_report_photo_deletions (storage_path)
       SELECT storage_path FROM trip_report_photos
       WHERE report_id = $1 AND id = ANY($2::text[]) AND storage_path IS NOT NULL
       ON CONFLICT DO NOTHING`,
      [reportId, plan.removedIds]
    );
    await client.query(
      `DELETE FROM trip_report_photos WHERE report_id = $1 AND id = ANY($2::text[])`,
      [reportId, plan.removedIds]
    );
  }
}

export async function getTripReportsForDestination(
  destinationId: string,
  requestedLimit = 10
): Promise<TripReport[]> {
  const result = await db.query(
    `${REPORT_SELECT}
     JOIN trip_report_destinations rd_scope ON rd_scope.report_id = tr.id
     WHERE rd_scope.destination_id = $1 AND tr.moderation_state = 'published'
     ORDER BY tr.activity_date DESC, tr.id DESC LIMIT $2`,
    [destinationId, limit(requestedLimit, 10, 10)]
  );
  return result.rows.map((row) => mapReport(row as ReportRow));
}

/** Reports older than this aren't "recent" — the discover page drops the
 * section entirely rather than call a years-old report recent. */
const RECENT_TRIP_REPORT_WINDOW = "18 months";

export async function getRecentTripReports(requestedLimit = 6): Promise<TripReport[]> {
  const result = await db.query(
    `${REPORT_SELECT}
     WHERE tr.moderation_state = 'published'
       AND tr.activity_date >= now() - $2::interval
     ORDER BY tr.activity_date DESC, tr.id DESC LIMIT $1`,
    [limit(requestedLimit, 6, 6), RECENT_TRIP_REPORT_WINDOW]
  );
  return result.rows.map((row) => mapReport(row as ReportRow));
}

export async function getTripReportCountForDestination(destinationId: string): Promise<number> {
  const result = await db.query(
    `SELECT count(*)::int AS count
     FROM trip_report_destinations rd
     JOIN trip_reports tr ON tr.id = rd.report_id
     WHERE rd.destination_id = $1 AND tr.moderation_state = 'published'`,
    [destinationId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function getTripReport(reportId: string): Promise<TripReport | null> {
  const result = await db.query(
    `${REPORT_SELECT}
     WHERE tr.id = $1 AND tr.moderation_state = 'published'`,
    [reportId]
  );
  return result.rows[0] ? mapReport(result.rows[0] as ReportRow) : null;
}

export async function canEditTripReport(token: string, reportId: string): Promise<boolean> {
  const user = await verifyToken(token);
  if (!user) return false;
  const result = await db.query(
    "SELECT 1 FROM trip_reports WHERE id = $1 AND user_id = $2",
    [reportId, user.uid]
  );
  return result.rows.length > 0;
}

export async function getTripReportForEdit(
  token: string,
  reportId: string
): Promise<TripReport | null> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");
  const result = await db.query(
    `${REPORT_SELECT} WHERE tr.id = $1 AND tr.user_id = $2`,
    [reportId, user.uid]
  );
  return result.rows[0] ? mapReport(result.rows[0] as ReportRow) : null;
}

export async function getTripReportEligibleSessions(
  token: string
): Promise<TripReportEligibleSession[]> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");
  const result = await db.query(
    `SELECT s.id, COALESCE(NULLIF(s.name, ''), 'Activity') AS name, s.start_time
     FROM tracking_sessions s
     LEFT JOIN trip_reports tr ON tr.source_session_id = s.id
     WHERE s.user_id = $1 AND s.ended = true
       AND s.processing_state = 'completed' AND s.processed_at IS NOT NULL
       AND tr.id IS NULL
     ORDER BY s.start_time DESC LIMIT 50`,
    [user.uid]
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    date: iso(row.start_time),
  }));
}

export async function createTripReport(
  token: string,
  data: {
    sessionId?: string;
    title: string;
    date?: string;
    destinations?: string[];
    blocks: TripReportBlock[];
  }
): Promise<{ id: string }> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");
  if (!data.sessionId) throw new Error("Choose a completed activity");
  const reportTitle = title(data.title);
  const body = bodyFromBlocks(data.blocks);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const session = await client.query(
      `SELECT id, name, activity_type, start_time
       FROM tracking_sessions
       WHERE id = $1 AND user_id = $2 AND ended = true
         AND processing_state = 'completed' AND processed_at IS NOT NULL
       FOR UPDATE`,
      [data.sessionId, user.uid]
    );
    if (!session.rows[0]) throw new Error("Activity is not ready for a Trip Report");
    const existing = await client.query(
      "SELECT id FROM trip_reports WHERE source_session_id = $1",
      [data.sessionId]
    );
    if (existing.rows[0]) throw new Error("This activity already has a Trip Report");
    let userName = "Peaks member";
    try {
      const profile = await adminDb.collection("users").doc(user.uid).get();
      const name = profile.data()?.name;
      if (typeof name === "string" && name.trim()) userName = name.trim();
    } catch {
      // A missing profile must not block publishing.
    }
    const id = randomUUID();
    const activity = session.rows[0];
    await client.query(
      `INSERT INTO trip_reports
         (id, source_session_id, user_id, author_name, title, body,
          activity_name, activity_type, activity_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        data.sessionId,
        user.uid,
        userName,
        reportTitle,
        body,
        activity.name,
        activity.activity_type,
        activity.start_time,
      ]
    );
    await client.query(
      `INSERT INTO trip_report_destinations (report_id, destination_id)
       SELECT $1, destination_id FROM session_destinations
       WHERE session_id = $2 AND relation = 'reached'`,
      [id, data.sessionId]
    );
    await client.query(
      `INSERT INTO trip_report_routes (report_id, route_id)
       SELECT $1, sr.route_id FROM session_routes sr
       JOIN routes r ON r.id = sr.route_id
       WHERE sr.session_id = $2 AND r.status = 'active'`,
      [id, data.sessionId]
    );
    await syncTripReportPhotos(client, id, data.blocks);
    await client.query("COMMIT");
    return { id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTripReport(
  token: string,
  reportId: string,
  data: {
    title?: string;
    date?: string;
    destinations?: string[];
    blocks?: TripReportBlock[];
  }
): Promise<void> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const updates: string[] = ["updated_at = now()"];
  const values: unknown[] = [reportId, user.uid];
  if (data.title !== undefined) {
    values.push(title(data.title));
    updates.push(`title = $${values.length}`);
  }
  if (data.blocks !== undefined) {
    values.push(bodyFromBlocks(data.blocks));
    updates.push(`body = $${values.length}`);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE trip_reports SET ${updates.join(", ")}
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      values
    );
    if (!result.rows[0]) throw new Error("You can only edit your own reports");

    if (data.blocks !== undefined) {
      await syncTripReportPhotos(client, reportId, data.blocks);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTripReport(token: string, reportId: string): Promise<void> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO trip_report_photo_deletions (storage_path)
       SELECT storage_path FROM trip_report_photos p
       JOIN trip_reports tr ON tr.id = p.report_id
       WHERE p.report_id = $1 AND tr.user_id = $2 AND p.storage_path IS NOT NULL
       ON CONFLICT DO NOTHING`,
      [reportId, user.uid]
    );
    const result = await client.query(
      "DELETE FROM trip_reports WHERE id = $1 AND user_id = $2 RETURNING id",
      [reportId, user.uid]
    );
    if (!result.rows[0]) throw new Error("You can only delete your own reports");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
