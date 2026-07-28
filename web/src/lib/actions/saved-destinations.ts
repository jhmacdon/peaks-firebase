"use server";

import { Timestamp } from "firebase-admin/firestore";
import { verifyToken } from "../auth-actions";
import db from "../db";
import { adminDb } from "../firebase-admin";

export interface SavedDestination {
  id: string;
  name: string | null;
  elevation: number | null;
  features: string[];
  savedAt: string;
}

export interface SavedDestinationsResult {
  destinations: SavedDestination[];
  missingDestinationIds: string[];
}

interface LiveSavedDocument {
  id: string;
  savedAt: Timestamp;
}

// Tombstones must remain readable so an unsave reaches devices that have not
// synced yet. Bound the whole sync set, live records plus tombstones, rather
// than dropping old tombstones and risking a saved destination reappearing.
const MAX_SAVED_DESTINATION_DOCUMENTS = 1_000;

function savedDocument(uid: string, destinationId: string) {
  return adminDb
    .collection("users")
    .doc(uid)
    .collection("savedDestinations")
    .doc(destinationId);
}

function assertDestinationId(destinationId: string): void {
  if (
    destinationId.trim().length === 0 ||
    destinationId.includes("/") ||
    destinationId.length > 1_500
  ) {
    throw new Error("Invalid destination");
  }
}

async function requireUser(token: string): Promise<{ uid: string }> {
  const auth = await verifyToken(token);
  if (!auth) throw new Error("Unauthorized");
  return auth;
}

function asTimestamp(value: unknown): Timestamp | null {
  return value instanceof Timestamp ? value : null;
}

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.startsWith("{")) {
    return value.slice(1, -1).split(",").filter(Boolean);
  }
  return [];
}

export async function getSavedDestinationState(
  token: string,
  destinationId: string
): Promise<{ saved: boolean; savedAt: string | null }> {
  const auth = await requireUser(token);
  assertDestinationId(destinationId);

  const snapshot = await savedDocument(auth.uid, destinationId).get();
  const data = snapshot.data();
  const savedAt = asTimestamp(data?.savedAt);

  if (!snapshot.exists || !savedAt || data?.deleted === true) {
    return { saved: false, savedAt: null };
  }

  return { saved: true, savedAt: savedAt.toDate().toISOString() };
}

export async function saveDestination(
  token: string,
  destinationId: string,
  _name: string | null
): Promise<{ savedAt: string }> {
  const auth = await requireUser(token);
  assertDestinationId(destinationId);
  void _name;

  const ref = savedDocument(auth.uid, destinationId);
  const [destinationResult, existingSnapshot, countSnapshot] = await Promise.all([
    db.query<{ name: string | null }>(
      `SELECT name
       FROM destinations
       WHERE id = $1`,
      [destinationId]
    ),
    ref.get(),
    ref.parent.count().get(),
  ]);
  if (destinationResult.rows.length === 0) {
    throw new Error("Destination not found");
  }
  if (
    !existingSnapshot.exists &&
    countSnapshot.data().count >= MAX_SAVED_DESTINATION_DOCUMENTS
  ) {
    throw new Error(
      `You can sync up to ${MAX_SAVED_DESTINATION_DOCUMENTS.toLocaleString()} saved destination records`
    );
  }

  const savedAt = Timestamp.now();
  const data: {
    savedAt: Timestamp;
    deleted: false;
    name?: string;
  } = {
    savedAt,
    deleted: false,
  };

  const canonicalName = destinationResult.rows[0].name;
  if (canonicalName) {
    data.name = canonicalName;
  }

  await ref.set(data);
  return { savedAt: savedAt.toDate().toISOString() };
}

export async function unsaveDestination(
  token: string,
  destinationId: string
): Promise<void> {
  const auth = await requireUser(token);
  assertDestinationId(destinationId);

  const ref = savedDocument(auth.uid, destinationId);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.deleted === true) return;

    const priorSavedAt = asTimestamp(snapshot.data()?.savedAt);

    transaction.set(ref, {
      savedAt: priorSavedAt ?? Timestamp.now(),
      deleted: true,
    });
  });
}

export async function getSavedDestinations(
  token: string
): Promise<SavedDestinationsResult> {
  const auth = await requireUser(token);
  const snapshot = await adminDb
    .collection("users")
    .doc(auth.uid)
    .collection("savedDestinations")
    .limit(MAX_SAVED_DESTINATION_DOCUMENTS + 1)
    .get();
  if (snapshot.size > MAX_SAVED_DESTINATION_DOCUMENTS) {
    throw new Error(
      `Saved destination sync exceeds the ${MAX_SAVED_DESTINATION_DOCUMENTS.toLocaleString()} record limit`
    );
  }

  const savedDocuments: LiveSavedDocument[] = snapshot.docs.flatMap((document) => {
    const data = document.data();
    const savedAt = asTimestamp(data.savedAt);

    // The iOS decoder requires savedAt and treats missing/non-boolean `deleted`
    // as false for documents created before tombstones were added.
    if (!savedAt || data.deleted === true) return [];
    return [{ id: document.id, savedAt }];
  });

  savedDocuments.sort((left, right) => {
    const dateOrder = right.savedAt.toMillis() - left.savedAt.toMillis();
    return dateOrder !== 0 ? dateOrder : left.id.localeCompare(right.id);
  });

  const ids = savedDocuments.map((document) => document.id);
  if (ids.length === 0) {
    return { destinations: [], missingDestinationIds: [] };
  }

  const result = await db.query(
    `SELECT id, name, elevation, features
     FROM destinations
     WHERE id = ANY($1::text[])`,
    [ids]
  );

  const destinationsById = new Map<
    string,
    { id: string; name: string | null; elevation: number | null; features: string[] }
  >(
    result.rows.map((row) => [
      String(row.id),
      {
        id: String(row.id),
        name: row.name ?? null,
        elevation: row.elevation == null ? null : Number(row.elevation),
        features: parseArray(row.features),
      },
    ])
  );

  const missingDestinationIds: string[] = [];
  const destinations: SavedDestination[] = [];

  for (const saved of savedDocuments) {
    const destination = destinationsById.get(saved.id);
    if (!destination) {
      missingDestinationIds.push(saved.id);
      continue;
    }

    destinations.push({
      ...destination,
      savedAt: saved.savedAt.toDate().toISOString(),
    });
  }

  return { destinations, missingDestinationIds };
}
