import { Router, Request, Response } from "express";
import admin from "firebase-admin";
import type { PoolClient } from "pg";
import { asyncRoute } from "../lib/async-route";
import { getUid, requireAdmin, type AuthRequest } from "../auth";
import db from "../db";
import { routeCoverJoinSql, routeCoverSelectSql } from "../lib/route-cover";
import {
  CoverPhotoError,
  firebaseCoverStorage,
  storeAdminCover,
  validateUploadPath,
  type CoverKind,
  type CoverStorage,
} from "../lib/cover-photo";

/**
 * Admin-only cover photos for routes and destinations.
 *
 *   PUT    /api/admin/routes/:id/cover        set a route's own cover
 *   DELETE /api/admin/routes/:id/cover        clear an admin-set route cover
 *   PUT    /api/admin/destinations/:id/cover  set a destination's hero cover
 *   DELETE /api/admin/destinations/:id/cover  clear an admin-set hero cover
 *
 * Contract for clients: docs/trails/admin-cover-api.md (peaks checkout).
 */

let storageFactory: () => CoverStorage = firebaseCoverStorage;

/** Tests replace Firebase Storage with an in-memory fake. */
export function setCoverStorageFactoryForTests(factory: () => CoverStorage): void {
  storageFactory = factory;
}

const router = Router();
router.use(requireAdmin);

interface CoverBody {
  storagePath: string;
  attribution: string | null;
  attributionUrl: string | null;
  focalX: number;
  focalY: number;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new CoverPhotoError(400, `${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new CoverPhotoError(400, `${label} is longer than ${max} characters`);
  return trimmed.length > 0 ? trimmed : null;
}

function focal(value: unknown, label: string): number {
  if (value === undefined || value === null) return 50;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new CoverPhotoError(400, `${label} must be a number from 0 to 100`);
  }
  return Math.round(value);
}

export function parseCoverBody(kind: CoverKind, id: string, raw: unknown): CoverBody {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const storagePath = validateUploadPath(kind, id, body.storagePath);
  const attribution = optionalText(body.attribution, "attribution", 300);
  const attributionUrl = optionalText(body.attributionUrl, "attributionUrl", 2000);
  if (attributionUrl) {
    let url: URL;
    try {
      url = new URL(attributionUrl);
    } catch {
      throw new CoverPhotoError(400, "attributionUrl must be an https URL");
    }
    if (url.protocol !== "https:") throw new CoverPhotoError(400, "attributionUrl must be an https URL");
  }
  return {
    storagePath,
    attribution,
    attributionUrl,
    focalX: focal(body.focalX, "focalX"),
    focalY: focal(body.focalY, "focalY"),
  };
}

/**
 * Default credit: "<admin display name> · Peaks". The name comes from the ID
 * token's `name` claim, then the Firebase Auth profile; with neither, "Peaks".
 */
async function defaultAttribution(req: Request): Promise<string> {
  const token = (req as AuthRequest).authToken;
  let name = typeof token?.name === "string" ? token.name.trim() : "";
  if (!name && process.env.NODE_ENV !== "test") {
    try {
      name = (await admin.auth().getUser(getUid(req))).displayName?.trim() ?? "";
    } catch {
      // A profile lookup must not fail a valid cover.
    }
  }
  return name ? `${name} · Peaks` : "Peaks";
}

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof CoverPhotoError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

async function bestEffortRemove(storage: CoverStorage, objectName: string | null | undefined): Promise<void> {
  if (!objectName) return;
  try {
    await storage.remove(objectName);
  } catch (error) {
    console.warn("[admin-cover] could not remove", objectName, (error as Error).message);
  }
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The route detail endpoint's flat cover fields, for one route. */
export async function routeCoverResponse(id: string): Promise<Record<string, unknown> | null> {
  const result = await db.query(
    `SELECT r.id, ${routeCoverSelectSql()}
     FROM routes r
     ${routeCoverJoinSql()}
     WHERE r.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/** The destination detail endpoint's hero fields, with its credit guard. */
export async function destinationCoverResponse(id: string): Promise<Record<string, unknown> | null> {
  const result = await db.query(
    `SELECT id, hero_image, hero_image_attribution, hero_image_attribution_url,
            hero_image_focal_x, hero_image_focal_y
     FROM destinations WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const credited = text(row.hero_image_attribution) && text(row.hero_image_attribution_url);
  return {
    id: row.id,
    hero_image: credited ? text(row.hero_image) : null,
    hero_image_attribution: credited ? text(row.hero_image_attribution) : null,
    hero_image_attribution_url: credited ? text(row.hero_image_attribution_url) : null,
    hero_image_focal_x: credited ? Number(row.hero_image_focal_x ?? 50) : 50,
    hero_image_focal_y: credited ? Number(row.hero_image_focal_y ?? 50) : 50,
  };
}

const TABLES: Record<CoverKind, { table: string; label: string; source: string; path: string }> = {
  routes: { table: "routes", label: "Route", source: "cover_source", path: "cover_storage_path" },
  destinations: {
    table: "destinations",
    label: "Destination",
    source: "hero_image_source",
    path: "hero_image_storage_path",
  },
};

function putCover(kind: CoverKind) {
  return asyncRoute(async (req, res) => {
    const { id } = req.params;
    const { table, label, path } = TABLES[kind];
    let body: CoverBody;
    try {
      body = parseCoverBody(kind, id, req.body);
    } catch (error) {
      if (sendError(res, error)) return;
      throw error;
    }
    const exists = await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
    if (exists.rowCount === 0) {
      res.status(404).json({ error: `${label} not found` });
      return;
    }

    const storage = storageFactory();
    let stored: Awaited<ReturnType<typeof storeAdminCover>>;
    try {
      stored = await storeAdminCover(storage, kind, id, body.storagePath, {
        uploadedBy: getUid(req),
      });
    } catch (error) {
      if (sendError(res, error)) return;
      throw error;
    }

    const attribution = body.attribution ?? (await defaultAttribution(req));
    // No public user profile pages exist yet, so the default credit link is
    // the processed image itself: stable, https, and always resolvable.
    const attributionUrl = body.attributionUrl ?? stored.url;

    const previous: { path: string | null } = { path: null };
    try {
      const found = await inTransaction(async (client) => {
        const current = await client.query(
          `SELECT ${path} AS storage_path FROM ${table} WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (current.rowCount === 0) return false;
        previous.path = current.rows[0].storage_path;
        if (kind === "routes") {
          await client.query(
            `UPDATE routes
                SET cover_image = $2, cover_attribution = $3, cover_attribution_url = $4,
                    cover_focal_x = $5, cover_focal_y = $6, cover_source = 'admin',
                    cover_storage_path = $7, cover_updated_at = now()
              WHERE id = $1`,
            [id, stored.url, attribution, attributionUrl, body.focalX, body.focalY, stored.objectName]
          );
        } else {
          await client.query(
            `UPDATE destinations
                SET hero_image = $2, hero_image_attribution = $3, hero_image_attribution_url = $4,
                    hero_image_focal_x = $5, hero_image_focal_y = $6, hero_image_source = 'admin',
                    hero_image_storage_path = $7
              WHERE id = $1`,
            [id, stored.url, attribution, attributionUrl, body.focalX, body.focalY, stored.objectName]
          );
        }
        return true;
      });
      if (!found) {
        await bestEffortRemove(storage, stored.objectName);
        res.status(404).json({ error: `${label} not found` });
        return;
      }
    } catch (error) {
      await bestEffortRemove(storage, stored.objectName);
      throw error;
    }

    // The processed copy is now the record. Drop the original upload and the
    // admin cover it replaced.
    await bestEffortRemove(storage, body.storagePath);
    if (previous.path && previous.path !== stored.objectName) await bestEffortRemove(storage, previous.path);

    const response = kind === "routes" ? await routeCoverResponse(id) : await destinationCoverResponse(id);
    res.json(response);
  });
}

function deleteCover(kind: CoverKind) {
  return asyncRoute(async (req, res) => {
    const { id } = req.params;
    const { table, label, source, path } = TABLES[kind];
    const outcome = await inTransaction(async (client) => {
      const current = await client.query(
        `SELECT ${source} AS source, ${path} AS storage_path FROM ${table} WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (current.rowCount === 0) return { status: 404 as const };
      if (current.rows[0].source !== "admin") return { status: 409 as const };
      if (kind === "routes") {
        await client.query(
          `UPDATE routes
              SET cover_image = NULL, cover_attribution = NULL, cover_attribution_url = NULL,
                  cover_focal_x = 50, cover_focal_y = 50, cover_source = NULL,
                  cover_storage_path = NULL, cover_updated_at = now()
            WHERE id = $1`,
          [id]
        );
      } else {
        await client.query(
          `UPDATE destinations
              SET hero_image = NULL, hero_image_attribution = NULL, hero_image_attribution_url = NULL,
                  hero_image_focal_x = 50, hero_image_focal_y = 50, hero_image_source = NULL,
                  hero_image_storage_path = NULL
            WHERE id = $1`,
          [id]
        );
      }
      return { status: 200 as const, storagePath: current.rows[0].storage_path as string | null };
    });
    if (outcome.status === 404) {
      res.status(404).json({ error: `${label} not found` });
      return;
    }
    if (outcome.status === 409) {
      res.status(409).json({ error: `${label} has no cover set by an admin` });
      return;
    }
    if (outcome.storagePath) {
      try {
        await bestEffortRemove(storageFactory(), outcome.storagePath);
      } catch (error) {
        console.warn("[admin-cover] storage unavailable for cleanup", (error as Error).message);
      }
    }
    const response = kind === "routes" ? await routeCoverResponse(id) : await destinationCoverResponse(id);
    res.json(response);
  });
}

router.put("/routes/:id/cover", putCover("routes"));
router.delete("/routes/:id/cover", deleteCover("routes"));
router.put("/destinations/:id/cover", putCover("destinations"));
router.delete("/destinations/:id/cover", deleteCover("destinations"));

export default router;
