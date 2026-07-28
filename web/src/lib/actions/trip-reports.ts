"use server";

import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../firebase-admin";
import { verifyToken } from "../auth-actions";
import db from "../db";
import { normalizeReportPhotoUrl } from "../report-photo-url";

export interface TripReport {
  id: string;
  userId: string;
  userName: string;
  date: string;
  title: string;
  destinations: string[]; // destination IDs
  blocks: TripReportBlock[];
  createdAt: string;
  updatedAt: string;
}

export interface TripReportBlock {
  type: "text" | "photo";
  content: string; // text content or image URL
  caption?: string; // photo caption
  placement?: "header" | "content";
  sourceId?: string;
  createdAt?: string;
}

const MAX_DESTINATION_TRIP_REPORTS = 10;
const MAX_RECENT_TRIP_REPORTS = 6;

type FirestoreTimestampLike = {
  toDate?: () => Date;
  _seconds?: number;
  _nanoseconds?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestampLike(value: unknown): value is FirestoreTimestampLike {
  if (!isRecord(value)) return false;
  return (
    typeof value.toDate === "function" ||
    typeof value._seconds === "number"
  );
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00.000Z`)
      : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isTimestampLike(value)) {
    if (typeof value.toDate === "function") {
      return value.toDate().toISOString();
    }

    const millis =
      value._seconds! * 1000 +
      Math.floor((value._nanoseconds ?? 0) / 1_000_000);
    return new Date(millis).toISOString();
  }

  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeBlockArray(
  value: unknown,
  placement: "header" | "content"
): TripReportBlock[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];

    const type: TripReportBlock["type"] =
      item.type === "photo" ? "photo" : "text";
    const rawContent = type === "photo"
      ? typeof item.image === "string"
        ? item.image
        : typeof item.url === "string"
          ? item.url
          : typeof item.content === "string"
            ? item.content
            : null
      : typeof item.text === "string"
        ? item.text
        : typeof item.content === "string"
          ? item.content
          : null;
    const content =
      type === "photo"
        ? normalizeReportPhotoUrl(rawContent)
        : rawContent;

    if (!content) return [];

    const caption =
      type === "photo" && typeof item.caption === "string"
        ? item.caption
        : type === "photo" && typeof item.text === "string"
          ? item.text
          : undefined;

    return [
      {
        type,
        content,
        caption,
        placement: item.placement === "header" ? "header" : placement,
        sourceId:
          typeof item.sourceId === "string"
            ? item.sourceId
            : typeof item.id === "string"
              ? item.id
              : undefined,
        createdAt:
          typeof item.createdAt === "string"
            ? item.createdAt
            : toIsoString(item.created) ?? undefined,
      },
    ];
  });
}

function normalizeBlocks(data: Record<string, unknown>): TripReportBlock[] {
  const iosHeaderPhotos = normalizeBlockArray(data.headerPhotos, "header")
    .filter((block) => block.type === "photo");
  const iosContent = normalizeBlockArray(data.content, "content");
  if (iosHeaderPhotos.length > 0 || iosContent.length > 0) {
    return [...iosHeaderPhotos, ...iosContent];
  }

  const webBlocks = normalizeBlockArray(data.blocks, "content");
  if (webBlocks.length > 0) {
    return webBlocks;
  }

  const fallbackBlocks: TripReportBlock[] = [];

  if (typeof data.content === "string" && data.content.trim()) {
    fallbackBlocks.push({
      type: "text",
      content: data.content,
      placement: "content",
    });
  }

  return fallbackBlocks;
}

function normalizeTripReport(
  id: string,
  raw: Record<string, unknown> | undefined
): TripReport {
  const data = raw ?? {};
  const blocks = normalizeBlocks(data);

  return {
    id,
    userId: typeof data.userId === "string" ? data.userId : "",
    userName:
      typeof data.userName === "string"
        ? data.userName
        : typeof data.authorName === "string"
          ? data.authorName
          : "Unknown User",
    date:
      toIsoString(data.date) ??
      toIsoString(data.createdAt) ??
      new Date(0).toISOString(),
    title:
      typeof data.title === "string"
        ? data.title
        : typeof data.name === "string"
          ? data.name
          : "Trip Report",
    destinations: toStringArray(data.destinations),
    blocks,
    createdAt:
      toIsoString(data.createdAt) ??
      toIsoString(data.date) ??
      new Date(0).toISOString(),
    updatedAt:
      toIsoString(data.updatedAt) ??
      toIsoString(data.createdAt) ??
      toIsoString(data.date) ??
      new Date(0).toISOString(),
  };
}

function reportDateTimestamp(value: string): Timestamp {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00.000Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Date must be valid");
  }
  return Timestamp.fromDate(date);
}

function validatedTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error("Title is required");
  if (title.length > 180) {
    throw new Error("Title must be 180 characters or fewer");
  }
  return title;
}

function validatedDestinations(values: string[]): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Select at least one destination");
  }
  if (values.some((value) => typeof value !== "string")) {
    throw new Error("Destination selection is invalid");
  }
  const destinations = [...new Set(values.map((value) => value.trim()))];
  if (
    destinations.length > 100 ||
    destinations.some((value) => !value || value.length > 1_500)
  ) {
    throw new Error("Destination selection is invalid");
  }
  return destinations;
}

async function validatedExistingDestinations(
  values: string[]
): Promise<string[]> {
  const destinations = validatedDestinations(values);
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM destinations
     WHERE id = ANY($1::text[])`,
    [destinations]
  );
  const existingIds = new Set(result.rows.map((row) => String(row.id)));
  if (destinations.some((id) => !existingIds.has(id))) {
    throw new Error("One or more selected destinations no longer exists");
  }
  return destinations;
}

function validatedBlocks(values: TripReportBlock[]): TripReportBlock[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw new Error("Add between 1 and 100 content blocks");
  }

  let totalCharacters = 0;
  return values.map((block) => {
    if (block.type !== "text" && block.type !== "photo") {
      throw new Error("Unsupported report block");
    }

    const content =
      block.type === "photo"
        ? normalizeReportPhotoUrl(block.content)
        : block.content;
    if (content === null) {
      throw new Error(
        "Photo blocks need a Peaks Firebase Storage download URL"
      );
    }
    if (!content.trim()) throw new Error("Report blocks cannot be empty");
    if (
      (block.type === "text" && content.length > 100_000) ||
      (block.type === "photo" && content.length > 5_000)
    ) {
      throw new Error("A report block is too long");
    }
    if (block.caption && block.caption.length > 500) {
      throw new Error("Photo captions must be 500 characters or fewer");
    }
    if (block.sourceId && block.sourceId.length > 200) {
      throw new Error("Photo ID is invalid");
    }

    totalCharacters += content.length + (block.caption?.length ?? 0);
    if (totalCharacters > 500_000) {
      throw new Error("Trip report content is too large");
    }

    return {
      ...block,
      content,
      caption: block.caption?.trim() || undefined,
      placement:
        block.type === "photo" && block.placement === "header"
          ? "header"
          : "content",
    };
  });
}

function boundedPublicLimit(
  value: number,
  fallback: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), maximum);
}

function prepareTripReportBlocks(blocks: TripReportBlock[]): {
  webBlocks: Record<string, unknown>[];
  content: Record<string, unknown>[];
  headerPhotos: Record<string, unknown>[];
} {
  const webBlocks: Record<string, unknown>[] = [];
  const content: Record<string, unknown>[] = [];
  const headerPhotos: Record<string, unknown>[] = [];

  for (const block of blocks) {
    const placement = block.placement === "header" ? "header" : "content";
    const webBlock: Record<string, unknown> = {
      type: block.type,
      content: block.content,
      placement,
    };

    if (block.caption) webBlock.caption = block.caption;

    if (block.type === "text") {
      webBlocks.push(webBlock);
      content.push({
        type: "text",
        text: block.content,
      });
      continue;
    }

    const sourceId = block.sourceId || generateId();
    const requestedCreatedAt = block.createdAt
      ? new Date(block.createdAt)
      : null;
    const createdDate =
      requestedCreatedAt && !Number.isNaN(requestedCreatedAt.getTime())
        ? requestedCreatedAt
        : new Date();
    const createdAt = createdDate.toISOString();
    const created = Timestamp.fromDate(createdDate);
    webBlock.sourceId = sourceId;
    webBlock.createdAt = createdAt;
    webBlocks.push(webBlock);

    const iosPhoto: Record<string, unknown> = {
      type: "photo",
      id: sourceId,
      image: block.content,
      created,
    };
    if (block.caption) iosPhoto.caption = block.caption;

    if (placement === "header") {
      headerPhotos.push(iosPhoto);
    } else {
      content.push(iosPhoto);
    }
  }

  return { webBlocks, content, headerPhotos };
}

/**
 * Get trip reports for a destination.
 * Queries tripReports collection where destinations array-contains destinationId.
 */
export async function getTripReportsForDestination(
  destinationId: string,
  limit: number = 10
): Promise<TripReport[]> {
  const safeLimit = boundedPublicLimit(
    limit,
    MAX_DESTINATION_TRIP_REPORTS,
    MAX_DESTINATION_TRIP_REPORTS
  );
  const snapshot = await adminDb
    .collection("tripReports")
    .where("destinations", "array-contains", destinationId)
    .orderBy("date", "desc")
    .limit(safeLimit)
    .get();

  return snapshot.docs.map((doc) =>
    normalizeTripReport(doc.id, doc.data())
  );
}

export async function getRecentTripReports(
  limit: number = 6
): Promise<TripReport[]> {
  const safeLimit = boundedPublicLimit(
    limit,
    MAX_RECENT_TRIP_REPORTS,
    MAX_RECENT_TRIP_REPORTS
  );
  const snapshot = await adminDb
    .collection("tripReports")
    .orderBy("date", "desc")
    .limit(safeLimit)
    .get();

  return snapshot.docs.map((doc) =>
    normalizeTripReport(doc.id, doc.data())
  );
}

/**
 * Count trip reports for a destination.
 */
export async function getTripReportCountForDestination(
  destinationId: string
): Promise<number> {
  const snapshot = await adminDb
    .collection("tripReports")
    .where("destinations", "array-contains", destinationId)
    .count()
    .get();

  return snapshot.data().count;
}

/**
 * Get a single trip report by ID.
 */
export async function getTripReport(
  reportId: string
): Promise<TripReport | null> {
  const doc = await adminDb.collection("tripReports").doc(reportId).get();
  if (!doc.exists) return null;

  return normalizeTripReport(doc.id, doc.data());
}

/**
 * Check whether an authenticated user owns a trip report.
 */
export async function canEditTripReport(
  token: string,
  reportId: string
): Promise<boolean> {
  const verified = await verifyToken(token);
  if (!verified) return false;

  const doc = await adminDb.collection("tripReports").doc(reportId).get();
  return doc.exists && doc.data()?.userId === verified.uid;
}

/**
 * Get a report for editing. Requires the authenticated report owner.
 */
export async function getTripReportForEdit(
  token: string,
  reportId: string
): Promise<TripReport | null> {
  const verified = await verifyToken(token);
  if (!verified) throw new Error("Unauthorized");

  const doc = await adminDb.collection("tripReports").doc(reportId).get();
  if (!doc.exists) return null;

  if (doc.data()?.userId !== verified.uid) {
    throw new Error("You can only edit your own reports");
  }

  return normalizeTripReport(doc.id, doc.data());
}

/**
 * Create a new trip report. Requires authenticated user.
 */
export async function createTripReport(
  token: string,
  data: {
    title: string;
    date: string;
    destinations: string[];
    blocks: TripReportBlock[];
  }
): Promise<{ id: string }> {
  const verified = await verifyToken(token);
  if (!verified) throw new Error("Unauthorized");
  const title = validatedTitle(data.title);
  const date = reportDateTimestamp(data.date);
  const destinations = await validatedExistingDestinations(data.destinations);
  const blocks = validatedBlocks(data.blocks);

  // Look up user name from Firestore users collection
  let userName = "Unknown User";
  try {
    const userDoc = await adminDb.collection("users").doc(verified.uid).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      // Handle both { name: string } and { name: { first, last } } formats
      if (typeof userData?.name === "string") {
        userName = userData.name;
      } else if (userData?.name) {
        userName = [userData.name.first, userData.name.last]
          .filter(Boolean)
          .join(" ");
      }
    }
  } catch {
    // Fall back to "Unknown User"
  }

  const now = new Date().toISOString();
  const id = generateId();
  const preparedBlocks = prepareTripReportBlocks(blocks);

  await adminDb.collection("tripReports").doc(id).set({
    userId: verified.uid,
    userName,
    title,
    date,
    destinations,
    blocks: preparedBlocks.webBlocks,
    content: preparedBlocks.content,
    headerPhotos: preparedBlocks.headerPhotos,
    attachments: {
      route: false,
      timeline: false,
    },
    createdAt: now,
    updatedAt: now,
  });

  return { id };
}

/**
 * Update an existing trip report. Requires authenticated user who owns the report.
 */
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
  const verified = await verifyToken(token);
  if (!verified) throw new Error("Unauthorized");

  const doc = await adminDb.collection("tripReports").doc(reportId).get();
  if (!doc.exists) throw new Error("Report not found");

  const reportData = doc.data();
  if (reportData?.userId !== verified.uid) {
    throw new Error("You can only edit your own reports");
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (data.title !== undefined) updates.title = validatedTitle(data.title);
  if (data.date !== undefined) updates.date = reportDateTimestamp(data.date);
  if (data.destinations !== undefined) {
    updates.destinations = await validatedExistingDestinations(
      data.destinations
    );
  }
  if (data.blocks !== undefined) {
    const preparedBlocks = prepareTripReportBlocks(
      validatedBlocks(data.blocks)
    );
    updates.blocks = preparedBlocks.webBlocks;
    updates.content = preparedBlocks.content;
    updates.headerPhotos = preparedBlocks.headerPhotos;
  }

  await adminDb.collection("tripReports").doc(reportId).update(updates);
}

/**
 * Delete an existing trip report. Requires authenticated user who owns the report.
 */
export async function deleteTripReport(
  token: string,
  reportId: string
): Promise<void> {
  const verified = await verifyToken(token);
  if (!verified) throw new Error("Unauthorized");

  const doc = await adminDb.collection("tripReports").doc(reportId).get();
  if (!doc.exists) throw new Error("Report not found");

  if (doc.data()?.userId !== verified.uid) {
    throw new Error("You can only delete your own reports");
  }

  // Legacy iOS photos use a flat reports/<UUID>.jpg path with no owner
  // metadata. Deleting those objects here would let a report owner copy and
  // delete another report's photo. Automatic cleanup must wait for uploads
  // namespaced by user/report with ownership metadata.
  await doc.ref.delete();
}

function generateId(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 20; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
