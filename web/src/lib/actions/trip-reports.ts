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

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as TripReport[];
}

/**
 * Get a single trip report by ID.
 */
export async function getTripReport(
  reportId: string
): Promise<TripReport | null> {
  const doc = await adminDb.collection("tripReports").doc(reportId).get();
  if (!doc.exists) return null;

  return {
    id: doc.id,
    ...doc.data(),
  } as TripReport;
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
