import { randomUUID } from "node:crypto";
import { NextFunction, Router, Request, Response } from "express";
import admin from "firebase-admin";
import { Pool, PoolClient } from "pg";
import { getUid } from "../auth";
import db from "../db";

export const TRIP_REPORT_CONDITION_CODES = [
  "snow",
  "ice",
  "washout",
  "downed_trees",
  "water",
  "bugs",
  "smoke",
  "closure",
  "route_finding",
] as const;
export const TRIP_REPORT_SEVERITIES = ["info", "notable", "serious"] as const;

type ConditionCode = typeof TRIP_REPORT_CONDITION_CODES[number];
type Severity = typeof TRIP_REPORT_SEVERITIES[number];

interface ConditionInput {
  code: ConditionCode;
  severity: Severity;
  context?: string;
}

interface PhotoInput {
  id: string;
  storage_path: string;
  download_url: string;
  caption?: string;
  taken_at?: string;
}

interface ReportInput {
  session_id?: unknown;
  title?: unknown;
  body?: unknown;
  conditions?: unknown;
  photos?: unknown;
}

interface PageCursor {
  date: string;
  id: string;
}

const REPORT_SELECT = `
  SELECT tr.id, tr.source_session_id AS session_id, tr.user_id,
         tr.author_name, tr.title, tr.body, tr.activity_name,
         tr.activity_type, tr.activity_date, tr.legacy_record,
         tr.created_at, tr.updated_at,
         (tr.user_id = $1) AS is_owner,
         (s.id IS NOT NULL) AS session_available,
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
         ), '[]'::json) AS photos,
         COALESCE((
           SELECT json_agg(rd.destination_id ORDER BY rd.destination_id)
           FROM trip_report_destinations rd WHERE rd.report_id = tr.id
         ), '[]'::json) AS destination_ids,
         COALESCE((
           SELECT json_agg(rr.route_id ORDER BY rr.route_id)
           FROM trip_report_routes rr WHERE rr.report_id = tr.id
         ), '[]'::json) AS route_ids
  FROM trip_reports tr
  LEFT JOIN tracking_sessions s ON s.id = tr.source_session_id
`;

function cleanText(value: unknown, label: string, max: number, required: boolean): string {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw new Error(`${label} must be text`);
  }
  const result = value.trim();
  if (required && !result) throw new Error(`${label} is required`);
  if (result.length > max) throw new Error(`${label} is too long`);
  return result;
}

export function parseTripReportConditions(value: unknown): ConditionInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > TRIP_REPORT_CONDITION_CODES.length) {
    throw new Error("Conditions are invalid");
  }
  const codes = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("A condition is invalid");
    const item = raw as Record<string, unknown>;
    if (
      typeof item.code !== "string" ||
      !TRIP_REPORT_CONDITION_CODES.includes(item.code as ConditionCode) ||
      codes.has(item.code)
    ) {
      throw new Error("A condition code is invalid or repeated");
    }
    if (
      typeof item.severity !== "string" ||
      !TRIP_REPORT_SEVERITIES.includes(item.severity as Severity)
    ) {
      throw new Error("A condition severity is invalid");
    }
    codes.add(item.code);
    const context = item.context === undefined
      ? undefined
      : cleanText(item.context, "Condition context", 240, false);
    return {
      code: item.code as ConditionCode,
      severity: item.severity as Severity,
      context: context || undefined,
    };
  });
}

export function parseTripReportPhotos(value: unknown, uid: string, sessionId: string): PhotoInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error("Photos are invalid");
  const ids = new Set<string>();
  const paths = new Set<string>();
  const prefix = `trip-reports/${uid}/${sessionId}/`;
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("A photo is invalid");
    const item = raw as Record<string, unknown>;
    const id = cleanText(item.id, "Photo ID", 100, true);
    const storagePath = cleanText(item.storage_path, "Photo storage path", 500, true);
    const downloadURL = cleanText(item.download_url, "Photo URL", 3_000, true);
    if (
      !/^[A-Za-z0-9_-]+$/.test(id) ||
      ids.has(id) ||
      paths.has(storagePath) ||
      storagePath !== `${prefix}${id}.jpg`
    ) {
      throw new Error("A photo ID or storage path is invalid");
    }
    let parsedURL: URL;
    try {
      parsedURL = new URL(downloadURL);
    } catch {
      throw new Error("A photo URL is invalid");
    }
    const decodedObjectPath = decodeURIComponent(parsedURL.pathname);
    if (
      parsedURL.protocol !== "https:" ||
      parsedURL.hostname !== "firebasestorage.googleapis.com" ||
      !decodedObjectPath.endsWith(`/o/${storagePath}`)
    ) {
      throw new Error("Photos must use Peaks Storage");
    }
    let takenAt: string | undefined;
    if (typeof item.taken_at === "string") {
      const date = new Date(item.taken_at);
      if (Number.isNaN(date.getTime())) throw new Error("A photo date is invalid");
      takenAt = date.toISOString();
    }
    ids.add(id);
    paths.add(storagePath);
    const caption = item.caption === undefined
      ? undefined
      : cleanText(item.caption, "Photo caption", 500, false);
    return {
      id,
      storage_path: storagePath,
      download_url: downloadURL,
      caption: caption || undefined,
      taken_at: takenAt,
    };
  });
}

export function encodeTripReportCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeTripReportCursor(value: unknown): PageCursor | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const raw = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !raw ||
      typeof raw.date !== "string" ||
      Number.isNaN(new Date(raw.date).getTime()) ||
      typeof raw.id !== "string" ||
      !raw.id
    ) {
      return null;
    }
    return { date: new Date(raw.date).toISOString(), id: raw.id };
  } catch {
    return null;
  }
}

function pageLimit(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 25) : 10;
}

function pathParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? "" : value;
}

async function replaceConditions(
  client: PoolClient,
  reportId: string,
  conditions: ConditionInput[]
): Promise<void> {
  await client.query("DELETE FROM trip_report_conditions WHERE report_id = $1", [reportId]);
  for (const [ordinal, condition] of conditions.entries()) {
    await client.query(
      `INSERT INTO trip_report_conditions
         (report_id, code, severity, context, ordinal)
       VALUES ($1, $2, $3, $4, $5)`,
      [reportId, condition.code, condition.severity, condition.context ?? null, ordinal]
    );
  }
}

async function replacePhotos(
  client: PoolClient,
  reportId: string,
  photos: PhotoInput[]
): Promise<void> {
  const previous = await client.query<{ storage_path: string | null }>(
    "SELECT storage_path FROM trip_report_photos WHERE report_id = $1",
    [reportId]
  );
  const kept = new Set(photos.map((photo) => photo.storage_path));
  if (kept.size > 0) {
    await client.query(
      "DELETE FROM trip_report_photo_deletions WHERE storage_path = ANY($1::text[])",
      [[...kept]]
    );
  }
  for (const row of previous.rows) {
    if (row.storage_path && !kept.has(row.storage_path)) {
      await client.query(
        `INSERT INTO trip_report_photo_deletions (storage_path)
         VALUES ($1) ON CONFLICT (storage_path) DO NOTHING`,
        [row.storage_path]
      );
    }
  }
  await client.query("DELETE FROM trip_report_photos WHERE report_id = $1", [reportId]);
  for (const [ordinal, photo] of photos.entries()) {
    await client.query(
      `INSERT INTO trip_report_photos
         (id, report_id, storage_path, download_url, caption, taken_at, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        photo.id,
        reportId,
        photo.storage_path,
        photo.download_url,
        photo.caption ?? null,
        photo.taken_at ?? null,
        ordinal,
      ]
    );
  }
}

async function deriveLinks(client: PoolClient, reportId: string, sessionId: string): Promise<void> {
  await client.query("DELETE FROM trip_report_destinations WHERE report_id = $1", [reportId]);
  await client.query(
    `INSERT INTO trip_report_destinations (report_id, destination_id)
     SELECT $1, sd.destination_id
     FROM session_destinations sd
     WHERE sd.session_id = $2 AND sd.relation = 'reached'
     ON CONFLICT DO NOTHING`,
    [reportId, sessionId]
  );
  await client.query("DELETE FROM trip_report_routes WHERE report_id = $1", [reportId]);
  await client.query(
    `INSERT INTO trip_report_routes (report_id, route_id)
     SELECT $1, sr.route_id
     FROM session_routes sr
     JOIN routes r ON r.id = sr.route_id
     WHERE sr.session_id = $2 AND r.status = 'active'
     ON CONFLICT DO NOTHING`,
    [reportId, sessionId]
  );
}

async function reportById(pool: Pool, uid: string, id: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `${REPORT_SELECT}
     WHERE tr.id = $2 AND tr.moderation_state = 'published'`,
    [uid, id]
  );
  return result.rows[0] ?? null;
}

export async function drainTripReportPhotoDeletions(
  pool: Pool = db,
  maximum = 20
): Promise<number> {
  const result = await pool.query<{ storage_path: string }>(
    `SELECT storage_path
     FROM trip_report_photo_deletions
     ORDER BY queued_at
     LIMIT $1`,
    [maximum]
  );
  if (result.rows.length === 0) return 0;

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucketName) return 0;
  const bucket = admin.storage().bucket(bucketName);
  let deleted = 0;
  for (const row of result.rows) {
    try {
      await bucket.file(row.storage_path).delete({ ignoreNotFound: true });
      await pool.query(
        "DELETE FROM trip_report_photo_deletions WHERE storage_path = $1",
        [row.storage_path]
      );
      deleted++;
    } catch (error) {
      await pool.query(
        `UPDATE trip_report_photo_deletions
         SET attempts = attempts + 1, last_error = $2
         WHERE storage_path = $1`,
        [row.storage_path, String(error).slice(0, 1_000)]
      );
    }
  }
  return deleted;
}

export async function handleCreateTripReport(
  req: Request,
  res: Response,
  pool: Pool = db
): Promise<void> {
  const uid = getUid(req);
  const input = req.body as ReportInput;
  let sessionId: string;
  let title: string;
  let body: string;
  let conditions: ConditionInput[];
  let photos: PhotoInput[];
  try {
    sessionId = cleanText(input.session_id, "Session", 200, true);
    title = cleanText(input.title, "Title", 180, true);
    body = cleanText(input.body, "Report", 20_000, false);
    conditions = parseTripReportConditions(input.conditions);
    photos = parseTripReportPhotos(input.photos, uid, sessionId);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Trip Report is invalid" });
    return;
  }
  if (!body && conditions.length === 0 && photos.length === 0) {
    res.status(400).json({ error: "Add a note, condition, or photo" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sessionResult = await client.query(
      `SELECT id, name, activity_type, start_time
       FROM tracking_sessions
       WHERE id = $1 AND user_id = $2 AND ended = true
         AND processing_state = 'completed' AND processed_at IS NOT NULL
       FOR UPDATE`,
      [sessionId, uid]
    );
    if (sessionResult.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Activity is not ready for a Trip Report" });
      return;
    }
    const duplicate = await client.query(
      "SELECT id FROM trip_reports WHERE source_session_id = $1",
      [sessionId]
    );
    if (duplicate.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "This activity already has a Trip Report", id: duplicate.rows[0].id });
      return;
    }

    let authorName = "Peaks member";
    if (process.env.NODE_ENV !== "test") try {
      const user = await admin.firestore().collection("users").doc(uid).get();
      const name = user.data()?.name;
      if (typeof name === "string" && name.trim()) authorName = name.trim();
      if (name && typeof name === "object") {
        const parts = [name.first, name.last].filter((part) => typeof part === "string" && part.trim());
        if (parts.length > 0) authorName = parts.join(" ");
      }
    } catch {
      // A profile lookup must not make a valid report fail.
    }

    const reportId = randomUUID();
    const session = sessionResult.rows[0];
    await client.query(
      `INSERT INTO trip_reports
         (id, source_session_id, user_id, author_name, title, body,
          activity_name, activity_type, activity_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        reportId,
        sessionId,
        uid,
        authorName,
        title,
        body,
        session.name,
        session.activity_type,
        session.start_time,
      ]
    );
    await replaceConditions(client, reportId, conditions);
    await replacePhotos(client, reportId, photos);
    await deriveLinks(client, reportId, sessionId);
    await client.query("COMMIT");
    const report = await reportById(pool, uid, reportId);
    res.status(201).json(report);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[trip-reports] create failed", error);
    res.status(500).json({ error: "Could not publish Trip Report" });
  } finally {
    client.release();
  }
}

async function handleList(req: Request, res: Response): Promise<void> {
  const uid = getUid(req);
  const destinationId = typeof req.query.destination_id === "string" ? req.query.destination_id : null;
  const routeId = typeof req.query.route_id === "string" ? req.query.route_id : null;
  if (destinationId && routeId) {
    res.status(400).json({ error: "Choose one report scope" });
    return;
  }
  const limit = pageLimit(req.query.limit);
  const cursor = req.query.cursor ? decodeTripReportCursor(req.query.cursor) : null;
  if (req.query.cursor && !cursor) {
    res.status(400).json({ error: "Cursor is invalid" });
    return;
  }
  const values: unknown[] = [uid];
  const joins: string[] = [];
  const where = ["tr.moderation_state = 'published'"];
  if (destinationId) {
    values.push(destinationId);
    joins.push("JOIN trip_report_destinations scope_d ON scope_d.report_id = tr.id");
    where.push(`scope_d.destination_id = $${values.length}`);
  }
  if (routeId) {
    values.push(routeId);
    joins.push("JOIN trip_report_routes scope_r ON scope_r.report_id = tr.id");
    where.push(`scope_r.route_id = $${values.length}`);
  }
  if (cursor) {
    values.push(cursor.date, cursor.id);
    where.push(`(tr.activity_date, tr.id) < ($${values.length - 1}, $${values.length})`);
  }
  values.push(limit + 1);
  const result = await db.query(
    `${REPORT_SELECT}
     ${joins.join("\n")}
     WHERE ${where.join(" AND ")}
     ORDER BY tr.activity_date DESC, tr.id DESC
     LIMIT $${values.length}`,
    values
  );
  const hasMore = result.rows.length > limit;
  const reports = result.rows.slice(0, limit);
  const last = reports.at(-1);
  res.json({
    reports,
    next_cursor: hasMore && last
      ? encodeTripReportCursor({ date: new Date(last.activity_date).toISOString(), id: last.id })
      : null,
  });
}

async function handleGetBySession(req: Request, res: Response): Promise<void> {
  const uid = getUid(req);
  const result = await db.query(
    `${REPORT_SELECT}
     WHERE tr.source_session_id = $2 AND tr.moderation_state = 'published'`,
    [uid, req.params.sessionId]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Trip Report not found" });
    return;
  }
  res.json(result.rows[0]);
}

async function handleGet(req: Request, res: Response): Promise<void> {
  const report = await reportById(db, getUid(req), pathParam(req.params.id));
  if (!report) {
    res.status(404).json({ error: "Trip Report not found" });
    return;
  }
  res.json(report);
}

async function handleUpdate(req: Request, res: Response): Promise<void> {
  const uid = getUid(req);
  const reportId = pathParam(req.params.id);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query(
      `SELECT id, source_session_id
       FROM trip_reports
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [reportId, uid]
    );
    if (owned.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Trip Report not found" });
      return;
    }
    const sessionId = owned.rows[0].source_session_id as string | null;
    let title: string;
    let body: string;
    let conditions: ConditionInput[];
    let photos: PhotoInput[];
    try {
      title = cleanText(req.body.title, "Title", 180, true);
      body = cleanText(req.body.body, "Report", 20_000, false);
      conditions = parseTripReportConditions(req.body.conditions);
      photos = sessionId ? parseTripReportPhotos(req.body.photos, uid, sessionId) : [];
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: error instanceof Error ? error.message : "Trip Report is invalid" });
      return;
    }
    if (!body && conditions.length === 0 && photos.length === 0) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Add a note, condition, or photo" });
      return;
    }
    await client.query(
      `UPDATE trip_reports SET title = $3, body = $4, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [reportId, uid, title, body]
    );
    await replaceConditions(client, reportId, conditions);
    // Legacy reports have no safe, owner-scoped Storage path. Keep their
    // imported photos intact while still allowing the owner to edit the text
    // and conditions. New session-backed reports can manage photos normally.
    if (sessionId) await replacePhotos(client, reportId, photos);
    if (sessionId) await deriveLinks(client, reportId, sessionId);
    await client.query("COMMIT");
    void drainTripReportPhotoDeletions().catch((error) => {
      console.error("[trip-reports] photo cleanup failed", error);
    });
    res.json(await reportById(db, uid, reportId));
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[trip-reports] update failed", error);
    res.status(500).json({ error: "Could not update Trip Report" });
  } finally {
    client.release();
  }
}

async function handleDelete(req: Request, res: Response): Promise<void> {
  const uid = getUid(req);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query(
      "SELECT id FROM trip_reports WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [req.params.id, uid]
    );
    if (owned.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Trip Report not found" });
      return;
    }
    await client.query(
      `INSERT INTO trip_report_photo_deletions (storage_path)
       SELECT storage_path FROM trip_report_photos
       WHERE report_id = $1 AND storage_path IS NOT NULL
       ON CONFLICT (storage_path) DO NOTHING`,
      [req.params.id]
    );
    await client.query("DELETE FROM trip_reports WHERE id = $1", [req.params.id]);
    await client.query("COMMIT");
    void drainTripReportPhotoDeletions().catch((error) => {
      console.error("[trip-reports] photo cleanup failed", error);
    });
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[trip-reports] delete failed", error);
    res.status(500).json({ error: "Could not delete Trip Report" });
  } finally {
    client.release();
  }
}

async function handleFlag(req: Request, res: Response): Promise<void> {
  const uid = getUid(req);
  let reason: string;
  try {
    reason = cleanText(req.body.reason, "Reason", 500, true);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Reason is invalid" });
    return;
  }
  const result = await db.query(
    `INSERT INTO trip_report_flags (report_id, user_id, reason)
     SELECT id, $2, $3 FROM trip_reports
     WHERE id = $1 AND moderation_state = 'published' AND user_id <> $2
     ON CONFLICT (report_id, user_id)
     DO UPDATE SET reason = EXCLUDED.reason, created_at = now()
     RETURNING report_id`,
    [req.params.id, uid, reason]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Trip Report not found" });
    return;
  }
  res.status(204).end();
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res).catch(next);
  };
}

const router = Router();
router.get("/", asyncRoute(handleList));
router.get("/session/:sessionId", asyncRoute(handleGetBySession));
router.get("/:id", asyncRoute(handleGet));
router.post("/", asyncRoute(handleCreateTripReport));
router.put("/:id", asyncRoute(handleUpdate));
router.delete("/:id", asyncRoute(handleDelete));
router.post("/:id/flag", asyncRoute(handleFlag));
router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[trip-reports] request failed", error);
  if (!res.headersSent) res.status(500).json({ error: "Trip Report request failed" });
});

export default router;
