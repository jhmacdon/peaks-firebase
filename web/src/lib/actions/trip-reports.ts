"use server";

import { adminDb } from "../firebase-admin";
import { verifyToken } from "../auth-actions";

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
}

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
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
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

function normalizePhotoBlocks(value: unknown): TripReportBlock[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];

    const content =
      typeof item.image === "string"
        ? item.image
        : typeof item.url === "string"
          ? item.url
          : typeof item.content === "string"
            ? item.content
            : null;

    if (!content) return [];

    const caption =
      typeof item.caption === "string"
        ? item.caption
        : typeof item.text === "string"
          ? item.text
          : undefined;

    return [
      {
        type: "photo" as const,
        content,
        caption,
      },
    ];
  });
}

function normalizeBlocks(data: Record<string, unknown>): TripReportBlock[] {
  if (Array.isArray(data.blocks)) {
    const blocks = data.blocks.flatMap((block) => {
      if (!isRecord(block)) return [];

      const type: TripReportBlock["type"] =
        block.type === "photo" ? "photo" : "text";
      const content =
        typeof block.content === "string"
          ? block.content
          : typeof block.text === "string"
            ? block.text
            : null;

      if (!content) return [];

      const caption =
        typeof block.caption === "string" ? block.caption : undefined;

      return [{ type, content, caption }];
    });

    if (blocks.length > 0) return blocks;
  }

  const fallbackBlocks: TripReportBlock[] = [];

  if (typeof data.content === "string" && data.content.trim()) {
    fallbackBlocks.push({
      type: "text",
      content: data.content,
    });
  }

  fallbackBlocks.push(...normalizePhotoBlocks(data.headerPhotos));
  fallbackBlocks.push(...normalizePhotoBlocks(data.attachments));

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

/**
 * Get trip reports for a destination.
 * Queries tripReports collection where destinations array-contains destinationId.
 */
export async function getTripReportsForDestination(
  destinationId: string,
  limit: number = 10
): Promise<TripReport[]> {
  const snapshot = await adminDb
    .collection("tripReports")
    .where("destinations", "array-contains", destinationId)
    .orderBy("date", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) =>
    normalizeTripReport(doc.id, doc.data())
  );
}

export async function getRecentTripReports(
  limit: number = 6
): Promise<TripReport[]> {
  const snapshot = await adminDb
    .collection("tripReports")
    .orderBy("date", "desc")
    .limit(limit)
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
    .get();

  return snapshot.size;
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

  await adminDb.collection("tripReports").doc(id).set({
    userId: verified.uid,
    userName,
    title: data.title,
    date: data.date,
    destinations: data.destinations,
    blocks: data.blocks,
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

  if (data.title !== undefined) updates.title = data.title;
  if (data.date !== undefined) updates.date = data.date;
  if (data.destinations !== undefined) updates.destinations = data.destinations;
  if (data.blocks !== undefined) updates.blocks = data.blocks;

  await adminDb.collection("tripReports").doc(reportId).update(updates);
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
