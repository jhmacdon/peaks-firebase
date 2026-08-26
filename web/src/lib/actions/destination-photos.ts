"use server";

import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import db from "../db";
import { verifyAdminToken } from "../auth-actions";
import { normalizeSearchName } from "../search-utils";
import {
  DestinationPhotoSourceError,
  deleteStoredDestinationPhoto,
  storeDestinationPhoto,
  type StoredDestinationPhoto,
} from "../destination-photo-storage";
import { destinationPhotoActionErrorMessage } from "../destination-photo-action-error";
import { destinationPhotoDimensionError } from "../destination-photo-quality";
import {
  approvedDestinationPhotoFraming,
  destinationPhotoPageBounds,
  DESTINATION_PHOTO_PAGE_SIZE,
  type DestinationPhotoDecision,
  type DestinationPhotoFraming,
} from "../destination-photo-review";

export type DestinationPhotoStatus = "pending" | "approved" | "denied";
export type DestinationPhotoListFilter = DestinationPhotoStatus | "comments";
export type { DestinationPhotoDecision, DestinationPhotoFraming } from "../destination-photo-review";

export interface DestinationPhotoCandidate {
  id: string;
  destination_id: string;
  destination_name: string;
  image_url: string;
  source_page_url: string;
  source_kind: string;
  photographer: string;
  license_name: string;
  license_url: string;
  image_width: number | null;
  image_height: number | null;
  focal_x: number;
  focal_y: number;
  notes: string | null;
  status: DestinationPhotoStatus;
  final_image_url: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  reviewer_comment: string | null;
  reviewer_comment_by: string | null;
  reviewer_comment_updated_at: string | null;
  reviewer_comment_resolved_by: string | null;
  reviewer_comment_resolved_at: string | null;
  created_at: string;
  current_image_url: string | null;
  current_image_attribution: string | null;
  current_image_attribution_url: string | null;
  current_image_focal_x: number;
  current_image_focal_y: number;
}

export interface DestinationPhotoCandidatePage {
  candidates: DestinationPhotoCandidate[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface DestinationPhotoComment {
  comment: string | null;
  updatedAt: string | null;
  resolvedAt: string | null;
}

export interface NewDestinationPhotoCandidate {
  destinationId: string;
  imageUrl: string;
  sourcePageUrl: string;
  sourceKind: string;
  photographer: string;
  licenseName: string;
  licenseUrl: string;
  imageWidth: number;
  imageHeight: number;
  focalX?: number;
  focalY?: number;
  notes?: string | null;
}

export interface PhotoDestinationSearchResult {
  id: string;
  name: string;
  state_code: string | null;
  country_code: string | null;
}

export type DestinationPhotoCandidateAddResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type DestinationPhotoReviewResult =
  | {
      ok: true;
      status: DestinationPhotoStatus;
      finalImageUrl: string | null;
    }
  | { ok: false; error: string };

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function httpsUrl(value: unknown, label: string): string {
  const text = requiredText(value, label);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`);
  }
  return url.toString();
}

function positiveInt(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DestinationPhotoSourceError(`${label} must be a positive whole number`);
  }
  return parsed;
}

function framingPercent(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${label} must be a whole number from 0 to 100`);
  }
  return parsed;
}

function framing(input: DestinationPhotoFraming): DestinationPhotoFraming {
  return {
    focalX: framingPercent(input.focalX, "Horizontal framing"),
    focalY: framingPercent(input.focalY, "Vertical framing"),
  };
}

function commentText(value: unknown): string | null {
  if (typeof value !== "string") throw new Error("Comment must be text");
  const text = value.trim();
  if (text.length > 2_000) throw new Error("Comment must be 2,000 characters or fewer");
  return text || null;
}

function serializeCandidate(row: Record<string, unknown>): DestinationPhotoCandidate {
  const reviewedAt = row.reviewed_at;
  const commentUpdatedAt = row.reviewer_comment_updated_at;
  const commentResolvedAt = row.reviewer_comment_resolved_at;
  const createdAt = row.created_at;
  return {
    ...(row as unknown as DestinationPhotoCandidate),
    image_width: row.image_width == null ? null : Number(row.image_width),
    image_height: row.image_height == null ? null : Number(row.image_height),
    focal_x: Number(row.focal_x),
    focal_y: Number(row.focal_y),
    current_image_focal_x: Number(row.current_image_focal_x ?? 50),
    current_image_focal_y: Number(row.current_image_focal_y ?? 50),
    reviewed_at:
      reviewedAt instanceof Date ? reviewedAt.toISOString() : (reviewedAt as string | null),
    reviewer_comment_updated_at:
      commentUpdatedAt instanceof Date
        ? commentUpdatedAt.toISOString()
        : (commentUpdatedAt as string | null),
    reviewer_comment_resolved_at:
      commentResolvedAt instanceof Date
        ? commentResolvedAt.toISOString()
        : (commentResolvedAt as string | null),
    created_at: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
  };
}

function reviewAttribution(photographer: string, licenseName: string): string {
  return `${photographer} / ${licenseName}`;
}

async function requireAdmin(token: string): Promise<{ uid: string }> {
  const admin = await verifyAdminToken(token);
  if (!admin) throw new Error("Unauthorized");
  return admin;
}

export async function getDestinationPhotoCandidates(
  token: string,
  filter: DestinationPhotoListFilter = "pending",
  page = 0,
  pageSize = DESTINATION_PHOTO_PAGE_SIZE
): Promise<DestinationPhotoCandidatePage> {
  await requireAdmin(token);
  if (!(["pending", "approved", "denied", "comments"] as string[]).includes(filter)) {
    throw new Error("Invalid photo filter");
  }

  const countResult = await db.query(
    `SELECT count(*)::int AS total
       FROM destination_photo_candidates
      WHERE ($1 = 'comments'
             AND reviewer_comment IS NOT NULL
             AND reviewer_comment_resolved_at IS NULL)
         OR ($1 <> 'comments' AND status = $1)`,
    [filter]
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const bounds = destinationPhotoPageBounds(total, page, pageSize);

  const result = await db.query(
    `SELECT c.id, c.destination_id, d.name AS destination_name,
            c.image_url, c.source_page_url, c.source_kind,
            c.photographer, c.license_name, c.license_url,
            c.image_width, c.image_height, c.focal_x, c.focal_y,
            c.notes, c.status,
            c.final_image_url, c.reviewed_by, c.reviewed_at,
            c.review_note,
            c.reviewer_comment, c.reviewer_comment_by,
            c.reviewer_comment_updated_at,
            c.reviewer_comment_resolved_by,
            c.reviewer_comment_resolved_at,
            c.created_at,
            d.hero_image AS current_image_url,
            d.hero_image_attribution AS current_image_attribution,
            d.hero_image_attribution_url AS current_image_attribution_url,
            d.hero_image_focal_x AS current_image_focal_x,
            d.hero_image_focal_y AS current_image_focal_y
       FROM destination_photo_candidates c
       JOIN destinations d ON d.id = c.destination_id
      WHERE ($1 = 'comments'
             AND c.reviewer_comment IS NOT NULL
             AND c.reviewer_comment_resolved_at IS NULL)
         OR ($1 <> 'comments' AND c.status = $1)
      ORDER BY CASE WHEN $1 = 'comments' THEN c.reviewer_comment_updated_at END DESC NULLS LAST,
               CASE WHEN $1 <> 'comments' THEN c.created_at END ASC,
               d.name ASC, c.id ASC
      LIMIT $2 OFFSET $3`,
    [filter, bounds.pageSize, bounds.offset]
  );
  return {
    candidates: result.rows.map(serializeCandidate),
    total,
    page: bounds.page,
    pageSize: bounds.pageSize,
    pageCount: bounds.pageCount,
  };
}

export async function searchDestinationsForPhotoCandidate(
  token: string,
  query: string
): Promise<PhotoDestinationSearchResult[]> {
  await requireAdmin(token);
  const search = normalizeSearchName(requiredText(query, "Search"));
  const result = await db.query(
    `SELECT id, name, state_code, country_code
       FROM destinations
      WHERE name IS NOT NULL
        AND (search_name = $1 OR search_name ILIKE $2)
      ORDER BY CASE WHEN search_name = $1 THEN 0 ELSE 1 END,
               similarity(search_name, $1) DESC,
               name ASC
      LIMIT 12`,
    [search, `%${search}%`]
  );
  return result.rows;
}

async function performAddDestinationPhotoCandidate(
  token: string,
  input: NewDestinationPhotoCandidate
): Promise<{ id: string }> {
  await requireAdmin(token);
  const destinationId = requiredText(input.destinationId, "Destination");
  const imageUrl = httpsUrl(input.imageUrl, "Image URL");
  const sourcePageUrl = httpsUrl(input.sourcePageUrl, "Source page URL");
  const sourceKind = requiredText(input.sourceKind, "Source");
  const photographer = requiredText(input.photographer, "Photographer");
  const licenseName = requiredText(input.licenseName, "License");
  const licenseUrl = httpsUrl(input.licenseUrl, "License URL");
  const imageWidth = positiveInt(input.imageWidth, "Image width");
  const imageHeight = positiveInt(input.imageHeight, "Image height");
  const dimensionError = destinationPhotoDimensionError(imageWidth, imageHeight);
  if (dimensionError) throw new DestinationPhotoSourceError(dimensionError);
  const photoFraming = framing({
    focalX: input.focalX ?? 50,
    focalY: input.focalY ?? 50,
  });
  const notes = input.notes?.trim() || null;
  const id = randomBytes(15).toString("base64url");

  try {
    await db.query(
      `INSERT INTO destination_photo_candidates (
         id, destination_id, image_url, source_page_url, source_kind,
         photographer, license_name, license_url,
         image_width, image_height, focal_x, focal_y, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        destinationId,
        imageUrl,
        sourcePageUrl,
        sourceKind,
        photographer,
        licenseName,
        licenseUrl,
        imageWidth,
        imageHeight,
        photoFraming.focalX,
        photoFraming.focalY,
        notes,
      ]
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23503") throw new Error("Destination was not found");
    if (code === "23505") throw new Error("That source photo is already linked to this destination");
    throw error;
  }
  return { id };
}

export async function addDestinationPhotoCandidate(
  token: string,
  input: NewDestinationPhotoCandidate
): Promise<DestinationPhotoCandidateAddResult> {
  try {
    const result = await performAddDestinationPhotoCandidate(token, input);
    return { ok: true, ...result };
  } catch (error) {
    console.error("Destination photo candidate add failed", { error });
    return {
      ok: false,
      error: destinationPhotoActionErrorMessage(
        error,
        "Could not add this photo. Try again."
      ),
    };
  }
}

export async function updateDestinationPhotoCandidateFraming(
  token: string,
  candidateId: string,
  input: DestinationPhotoFraming
): Promise<DestinationPhotoFraming> {
  await requireAdmin(token);
  const id = requiredText(candidateId, "Candidate");
  const photoFraming = framing(input);
  const result = await db.query(
    `UPDATE destination_photo_candidates
        SET focal_x = $1, focal_y = $2, updated_at = now()
      WHERE id = $3 AND status = 'pending'
      RETURNING focal_x, focal_y`,
    [photoFraming.focalX, photoFraming.focalY, id]
  );
  if (result.rowCount !== 1) {
    throw new Error("Only a pending photo can change framing");
  }
  return {
    focalX: Number(result.rows[0].focal_x),
    focalY: Number(result.rows[0].focal_y),
  };
}

export async function updateDestinationPhotoCandidateComment(
  token: string,
  candidateId: string,
  comment: string
): Promise<DestinationPhotoComment> {
  const admin = await requireAdmin(token);
  const id = requiredText(candidateId, "Candidate");
  const text = commentText(comment);
  const result = await db.query(
    text
      ? `UPDATE destination_photo_candidates
            SET reviewer_comment = $1,
                reviewer_comment_by = $2,
                reviewer_comment_updated_at = now(),
                reviewer_comment_resolved_by = NULL,
                reviewer_comment_resolved_at = NULL,
                updated_at = now()
          WHERE id = $3
          RETURNING reviewer_comment, reviewer_comment_updated_at,
                    reviewer_comment_resolved_at`
      : `UPDATE destination_photo_candidates
            SET reviewer_comment = NULL,
                reviewer_comment_by = NULL,
                reviewer_comment_updated_at = NULL,
                reviewer_comment_resolved_by = NULL,
                reviewer_comment_resolved_at = NULL,
                updated_at = now()
          WHERE id = $1
          RETURNING reviewer_comment, reviewer_comment_updated_at,
                    reviewer_comment_resolved_at`,
    text ? [text, admin.uid, id] : [id]
  );
  if (result.rowCount !== 1) throw new Error("Photo candidate was not found");
  const row = result.rows[0];
  const updatedAt = row.reviewer_comment_updated_at;
  return {
    comment: row.reviewer_comment as string | null,
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : (updatedAt as string | null),
    resolvedAt: null,
  };
}

export async function resolveDestinationPhotoCandidateComment(
  token: string,
  candidateId: string
): Promise<DestinationPhotoComment> {
  const admin = await requireAdmin(token);
  const id = requiredText(candidateId, "Candidate");
  const result = await db.query(
    `UPDATE destination_photo_candidates
        SET reviewer_comment_resolved_by = COALESCE(reviewer_comment_resolved_by, $1),
            reviewer_comment_resolved_at = COALESCE(reviewer_comment_resolved_at, now()),
            updated_at = now()
      WHERE id = $2 AND reviewer_comment IS NOT NULL
      RETURNING reviewer_comment, reviewer_comment_updated_at,
                reviewer_comment_resolved_at`,
    [admin.uid, id]
  );
  if (result.rowCount !== 1) throw new Error("Photo candidate has no comment to handle");
  const row = result.rows[0];
  const updatedAt = row.reviewer_comment_updated_at;
  const resolvedAt = row.reviewer_comment_resolved_at;
  return {
    comment: row.reviewer_comment as string,
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : (updatedAt as string | null),
    resolvedAt: resolvedAt instanceof Date ? resolvedAt.toISOString() : (resolvedAt as string | null),
  };
}

async function loadCandidateForReview(id: string): Promise<Record<string, unknown> | null> {
  const result = await db.query(
    `SELECT id, destination_id, image_url, source_page_url, source_kind,
            photographer, license_name, license_url, focal_x, focal_y,
            status, final_image_url
       FROM destination_photo_candidates
      WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function lockCandidate(client: PoolClient, id: string): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `SELECT id, destination_id, image_url, source_page_url, source_kind,
            photographer, license_name, license_url, focal_x, focal_y,
            status, final_image_url
       FROM destination_photo_candidates
      WHERE id = $1
      FOR UPDATE`,
    [id]
  );
  return result.rows[0] || null;
}

async function performDestinationPhotoReview(
  token: string,
  candidateId: string,
  decision: DestinationPhotoDecision,
  reviewNote?: string | null,
  requestedFraming?: DestinationPhotoFraming
): Promise<{ status: DestinationPhotoStatus; finalImageUrl: string | null }> {
  const admin = await requireAdmin(token);
  const id = requiredText(candidateId, "Candidate");
  if (decision !== "approve" && decision !== "deny") {
    throw new Error("Review must approve or deny the photo");
  }

  const initial = await loadCandidateForReview(id);
  if (!initial) throw new Error("Photo candidate was not found");
  if (initial.status !== "pending") {
    return {
      status: initial.status as DestinationPhotoStatus,
      finalImageUrl: (initial.final_image_url as string | null) || null,
    };
  }

  const requestedOrSavedFraming = approvedDestinationPhotoFraming(
    decision,
    requestedFraming,
    {
      focalX: Number(initial.focal_x),
      focalY: Number(initial.focal_y),
    }
  );
  const approvedFraming = requestedOrSavedFraming
    ? framing(requestedOrSavedFraming)
    : null;
  let storedPhoto: StoredDestinationPhoto | null = null;
  if (decision === "approve") {
    if (!approvedFraming) throw new Error("Approved photo framing is missing");
    storedPhoto = await storeDestinationPhoto({
      id: String(initial.id),
      destinationId: String(initial.destination_id),
      imageUrl: String(initial.image_url),
      sourcePageUrl: String(initial.source_page_url),
      photographer: String(initial.photographer),
      licenseName: String(initial.license_name),
      licenseUrl: String(initial.license_url),
      focalX: approvedFraming.focalX,
      focalY: approvedFraming.focalY,
    });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const candidate = await lockCandidate(client, id);
    if (!candidate) throw new Error("Photo candidate was not found");
    if (candidate.status !== "pending") {
      await client.query("ROLLBACK");
      if (storedPhoto) {
        try {
          await deleteStoredDestinationPhoto(storedPhoto);
        } catch (cleanupError) {
          console.error("Could not remove unused destination cover", cleanupError);
        }
      }
      return {
        status: candidate.status as DestinationPhotoStatus,
        finalImageUrl: (candidate.final_image_url as string | null) || null,
      };
    }

    if (decision === "approve") {
      if (!storedPhoto || !approvedFraming) throw new Error("Approved photo was not stored");
      await client.query(
        `UPDATE destinations
            SET hero_image = $1,
                hero_image_attribution = $2,
                hero_image_attribution_url = $3,
                hero_image_focal_x = $4,
                hero_image_focal_y = $5,
                updated_at = now()
          WHERE id = $6`,
        [
          storedPhoto.url,
          reviewAttribution(String(candidate.photographer), String(candidate.license_name)),
          candidate.source_page_url,
          approvedFraming.focalX,
          approvedFraming.focalY,
          candidate.destination_id,
        ]
      );
      await client.query(
        `UPDATE destination_photo_candidates
            SET status = 'approved', final_image_url = $1,
                focal_x = $2, focal_y = $3,
                reviewed_by = $4, reviewed_at = now(), review_note = $5,
                updated_at = now()
          WHERE id = $6`,
        [
          storedPhoto.url,
          approvedFraming.focalX,
          approvedFraming.focalY,
          admin.uid,
          reviewNote?.trim() || null,
          id,
        ]
      );
    } else {
      await client.query(
        `UPDATE destination_photo_candidates
            SET status = 'denied', reviewed_by = $1, reviewed_at = now(),
                review_note = $2, updated_at = now()
          WHERE id = $3`,
        [admin.uid, reviewNote?.trim() || null, id]
      );
    }
    await client.query("COMMIT");
    return {
      status: decision === "approve" ? "approved" : "denied",
      finalImageUrl: storedPhoto?.url || null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (storedPhoto) {
      try {
        await deleteStoredDestinationPhoto(storedPhoto);
      } catch (cleanupError) {
        console.error("Could not remove failed destination cover", cleanupError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewDestinationPhotoCandidate(
  token: string,
  candidateId: string,
  decision: DestinationPhotoDecision,
  reviewNote?: string | null,
  requestedFraming?: DestinationPhotoFraming
): Promise<DestinationPhotoReviewResult> {
  try {
    const result = await performDestinationPhotoReview(
      token,
      candidateId,
      decision,
      reviewNote,
      requestedFraming
    );
    return { ok: true, ...result };
  } catch (error) {
    console.error("Destination photo review failed", {
      candidateId,
      decision,
      error,
    });
    return {
      ok: false,
      error: destinationPhotoActionErrorMessage(
        error,
        "Could not review this photo. Try again."
      ),
    };
  }
}
