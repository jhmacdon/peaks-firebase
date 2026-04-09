/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import db from "../db";

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
  destination_count: number;
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
}

export interface ListProgress {
  total: number;
  completed: number;
}

/**
 * Paginated list browse with optional name search.
 * Includes a destination_count subquery for each list.
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
            (SELECT COUNT(*) FROM list_destinations ld WHERE ld.list_id = l.id) AS destination_count
     FROM lists l
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
      destination_count: Number(r.destination_count),
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
            (SELECT COUNT(*) FROM list_destinations ld WHERE ld.list_id = l.id) AS destination_count,
            l.created_at, l.updated_at
     FROM lists l
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
    destination_count: Number(r.destination_count),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

/**
 * Destinations belonging to a list, joined with destination data.
 * Ordered by the ordinal position within the list.
 */
export async function getListDestinations(
  listId: string
): Promise<ListDestination[]> {
  const result = await db.query(
    `SELECT d.id, d.name, d.elevation, d.prominence, d.features,
            ST_Y(d.location::geometry) AS lat,
            ST_X(d.location::geometry) AS lng,
            ld.ordinal
     FROM destinations d
     JOIN list_destinations ld ON ld.destination_id = d.id
     WHERE ld.list_id = $1
     ORDER BY ld.ordinal`,
    [listId]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    elevation: r.elevation ? Number(r.elevation) : null,
    prominence: r.prominence ? Number(r.prominence) : null,
    features: parseArray(r.features),
    lat: r.lat ? Number(r.lat) : null,
    lng: r.lng ? Number(r.lng) : null,
    ordinal: Number(r.ordinal),
  }));
}

/**
 * How many destinations in this list the given user has "reached"
 * (via session_destinations with relation = 'reached').
 */
export async function getListProgress(
  listId: string,
  userId: string
): Promise<ListProgress> {
  const totalResult = await db.query(
    `SELECT COUNT(*) FROM list_destinations WHERE list_id = $1`,
    [listId]
  );

  const completedResult = await db.query(
    `SELECT COUNT(DISTINCT ld.destination_id) AS completed
     FROM list_destinations ld
     JOIN session_destinations sd ON sd.destination_id = ld.destination_id
     JOIN tracking_sessions ts ON ts.id = sd.session_id
     WHERE ld.list_id = $1
       AND ts.user_id = $2
       AND sd.relation = 'reached'`,
    [listId, userId]
  );

  return {
    total: Number(totalResult.rows[0].count),
    completed: Number(completedResult.rows[0].completed),
  };
}
