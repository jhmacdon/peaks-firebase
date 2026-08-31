/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import db from "../db";
import { verifyToken } from "../auth-actions";

/** pg may return custom enum arrays as "{a,b}" strings instead of JS arrays */
function parseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.startsWith("{")) {
    return val.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

export interface ListRow {
  id: string;
  name: string;
  description: string | null;
  owner: string;
  year_established: number | null;
  organization: string | null;
  source_name: string | null;
  source_url: string | null;
  region: string | null;
  /** Current roster size, regardless of the keeper's completion rule. */
  destination_count: number;
  /** Effective bounded target. Equals destination_count when the stored value is NULL or invalid. */
  completion_target: number;
  thumbnails: ListThumbnail[];
}

export interface ListThumbnail {
  url: string;
  focalX: number;
  focalY: number;
}

export interface ListDetail extends ListRow {
  created_at: string;
  updated_at: string;
}

export interface ListDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  prominence: number | null;
  features: string[];
  lat: number | null;
  lng: number | null;
  ordinal: number;
  hero_image: string | null;
  hero_image_focal_x: number;
  hero_image_focal_y: number;
  state_code: string | null;
  country_code: string | null;
}

export interface ListProgress {
  /** Compatibility alias for completion_target. */
  total: number;
  member_count: number;
  completion_target: number;
  completed: number;
  is_complete: boolean;
}

export interface ListCompletionEntry {
  reached_at: string | null;
  visit_count: number;
}

function parseThumbnails(value: unknown): ListThumbnail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.url !== "string" || !row.url) return [];
    return [{
      url: row.url,
      focalX: Number(row.focalX ?? 50),
      focalY: Number(row.focalY ?? 50),
    }];
  });
}

/**
 * Paginated list browse with optional name search.
 * Includes the current member count and bounded completion target for each list.
 */
export async function getLists(
  search?: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ lists: ListRow[]; total: number }> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (search && search.trim()) {
    conditions.push(`l.name ILIKE $${paramIndex}`);
    params.push(`%${search.trim()}%`);
    paramIndex++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await db.query(
    `SELECT COUNT(*) FROM lists l ${where}`,
    params
  );

  const result = await db.query(
    `SELECT l.id, l.name, l.description, l.owner,
            l.year_established, l.organization, l.source_name, l.source_url, l.region,
            list_counts.destination_count,
            effective_list_completion_target(
              l.completion_target, list_counts.destination_count
            ) AS completion_target,
            COALESCE((
              SELECT json_agg(json_build_object(
                'url', photo.hero_image,
                'focalX', photo.hero_image_focal_x,
                'focalY', photo.hero_image_focal_y
              ) ORDER BY photo.elevation DESC NULLS LAST)
              FROM (
                SELECT d.hero_image, d.hero_image_focal_x, d.hero_image_focal_y, d.elevation
                FROM list_destinations ld2
                JOIN destinations d ON d.id = ld2.destination_id
                WHERE ld2.list_id = l.id AND d.hero_image IS NOT NULL
                ORDER BY d.elevation DESC NULLS LAST LIMIT 3
              ) photo
            ), '[]'::json) AS thumbnails
     FROM lists l
     CROSS JOIN LATERAL (
       SELECT COUNT(*)::int AS destination_count
       FROM list_destinations ld
       WHERE ld.list_id = l.id
     ) list_counts
     ${where}
     ORDER BY l.name ASC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return {
    lists: result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      owner: r.owner,
      year_established: r.year_established,
      organization: r.organization,
      source_name: r.source_name,
      source_url: r.source_url,
      region: r.region,
      destination_count: Number(r.destination_count),
      completion_target: Number(r.completion_target),
      thumbnails: parseThumbnails(r.thumbnails),
    })),
    total: Number(countResult.rows[0].count),
  };
}

/**
 * Fetch a single list by ID with full detail including timestamps.
 */
export async function getList(id: string): Promise<ListDetail | null> {
  const result = await db.query(
    `SELECT l.id, l.name, l.description, l.owner,
            l.year_established, l.organization, l.source_name, l.source_url, l.region,
            list_counts.destination_count,
            effective_list_completion_target(
              l.completion_target, list_counts.destination_count
            ) AS completion_target,
            COALESCE((
              SELECT json_agg(json_build_object(
                'url', photo.hero_image,
                'focalX', photo.hero_image_focal_x,
                'focalY', photo.hero_image_focal_y
              ) ORDER BY photo.elevation DESC NULLS LAST)
              FROM (
                SELECT d.hero_image, d.hero_image_focal_x, d.hero_image_focal_y, d.elevation
                FROM list_destinations ld2
                JOIN destinations d ON d.id = ld2.destination_id
                WHERE ld2.list_id = l.id AND d.hero_image IS NOT NULL
                ORDER BY d.elevation DESC NULLS LAST LIMIT 3
              ) photo
            ), '[]'::json) AS thumbnails,
            l.created_at, l.updated_at
     FROM lists l
     CROSS JOIN LATERAL (
       SELECT COUNT(*)::int AS destination_count
       FROM list_destinations ld
       WHERE ld.list_id = l.id
     ) list_counts
     WHERE l.id = $1`,
    [id]
  );

  if (result.rows.length === 0) return null;

  const r = result.rows[0];
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    owner: r.owner,
    year_established: r.year_established,
    organization: r.organization,
    source_name: r.source_name,
    source_url: r.source_url,
    region: r.region,
    destination_count: Number(r.destination_count),
    completion_target: Number(r.completion_target),
    thumbnails: parseThumbnails(r.thumbnails),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

/**
 * Destinations belonging to a list, joined with destination data.
 * Default sort is elevation descending — the highest, most notable entries
 * first. Import ordinal isn't a meaningful order (it reflects source-list
 * position, which looks almost-but-not-quite sorted for many lists), so it's
 * kept as data but no longer drives the sort. Ties break on name then id so
 * the order is stable across requests.
 */
export async function getListDestinations(
  listId: string
): Promise<ListDestination[]> {
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.prominence, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            ld.ordinal,
            d.hero_image, d.hero_image_focal_x, d.hero_image_focal_y,
            d.state_code, d.country_code
     FROM destinations d
     JOIN list_destinations ld ON ld.destination_id = d.id
     WHERE ld.list_id = $1
     ORDER BY d.elevation DESC NULLS LAST, d.name ASC NULLS LAST, d.id ASC`,
    [listId]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    elevation: r.elevation != null ? Number(r.elevation) : null,
    prominence: r.prominence != null ? Number(r.prominence) : null,
    features: parseArray(r.features),
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    ordinal: Number(r.ordinal),
    hero_image: r.hero_image,
    hero_image_focal_x: Number(r.hero_image_focal_x ?? 50),
    hero_image_focal_y: Number(r.hero_image_focal_y ?? 50),
    state_code: r.state_code,
    country_code: r.country_code,
  }));
}

/**
 * How many destinations in this list the given user has "reached"
 * (via session_destinations with relation = 'reached').
 */
export async function getListProgress(
  token: string,
  listId: string
): Promise<ListProgress> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const result = await db.query(
    `SELECT COUNT(DISTINCT ld.destination_id)::int AS member_count,
            effective_list_completion_target(
              l.completion_target,
              COUNT(DISTINCT ld.destination_id)::int
            ) AS completion_target,
            COUNT(DISTINCT CASE
              WHEN ts.id IS NOT NULL THEN ld.destination_id
            END)::int AS completed
     FROM lists l
     LEFT JOIN list_destinations ld ON ld.list_id = l.id
     LEFT JOIN session_destinations sd
       ON sd.destination_id = ld.destination_id AND sd.relation = 'reached'
     LEFT JOIN tracking_sessions ts
       ON ts.id = sd.session_id AND ts.user_id = $2
     WHERE l.id = $1
     GROUP BY l.id, l.completion_target`,
    [listId, user.uid]
  );

  if (result.rows.length === 0) {
    return {
      total: 0,
      member_count: 0,
      completion_target: 0,
      completed: 0,
      is_complete: false,
    };
  }

  const memberCount = Number(result.rows[0].member_count);
  const completionTarget = Number(result.rows[0].completion_target);
  const completed = Number(result.rows[0].completed);

  return {
    total: completionTarget,
    member_count: memberCount,
    completion_target: completionTarget,
    completed,
    is_complete: completionTarget > 0 && completed >= completionTarget,
  };
}

/**
 * Per-destination completion detail for this list, keyed by destination id:
 * how many sessions reached it and when it was last reached. `reached_at` is
 * the session start date — session_destinations stores no summit time, same
 * convention as getUserDestinationActivity's latest_visit.
 */
export async function getListCompletion(
  token: string,
  listId: string
): Promise<Record<string, ListCompletionEntry>> {
  const user = await verifyToken(token);
  if (!user) throw new Error("Unauthorized");

  const result = await db.query(
    `SELECT ld.destination_id,
            COUNT(DISTINCT sd.session_id) AS visit_count,
            MAX(ts.start_time)            AS reached_at
     FROM list_destinations ld
     JOIN session_destinations sd
       ON sd.destination_id = ld.destination_id AND sd.relation = 'reached'
     JOIN tracking_sessions ts
       ON ts.id = sd.session_id AND ts.user_id = $2
     WHERE ld.list_id = $1
     GROUP BY ld.destination_id`,
    [listId, user.uid]
  );

  const completion: Record<string, ListCompletionEntry> = {};
  for (const r of result.rows) {
    completion[r.destination_id] = {
      visit_count: Number(r.visit_count),
      reached_at: r.reached_at instanceof Date ? r.reached_at.toISOString() : r.reached_at ?? null,
    };
  }
  return completion;
}
