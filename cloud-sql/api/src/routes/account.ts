import { randomUUID } from "node:crypto";
import { Router, Response } from "express";
import admin from "firebase-admin";
import { FieldValue, type DocumentData, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Pool, PoolClient } from "pg";
import { AuthRequest } from "../auth";
import db from "../db";
import { asyncRoute } from "../lib/async-route";

const router = Router();

const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "donner-a8608.appspot.com";
const STORAGE_ROOTS = ["trip-reports", "profiles"] as const;
const MAX_ID_TOKEN_LENGTH = 16_384;

const SQL_OWNERS = [
  ["plans", "user_id", "plans"],
  ["session_groups", "user_id", "sessionGroups"],
  ["session_attempt_groups", "user_id", "sessionAttemptGroups"],
  ["tracking_sessions", "user_id", "trackingSessions"],
  ["trip_reports", "user_id", "tripReports"],
  ["session_comparisons", "user_id", "sessionComparisons"],
  ["session_markers", "created_by", "sessionMarkers"],
  ["routes", "owner", "routes"],
  ["lists", "owner", "lists"],
  ["destinations", "owner", "destinations"],
  ["areas", "owner", "areas"],
] as const;

const FIRESTORE_OWNERS = [
  ["sessions", "userId"],
  ["plans", "userId"],
  ["routes", "owner"],
  ["lists", "owner"],
  ["destinations", "owner"],
  ["invites", "userId"],
  ["tripReports", "userId"],
  ["feedback", "userId"],
] as const;

type MergeCounts = Record<string, number>;

class AccountMergeConflict extends Error {}

export function signInProvider(token: DecodedIdToken): string | undefined {
  return token.firebase?.sign_in_provider;
}

export function replaceUserStoragePaths(value: unknown, oldUid: string, newUid: string): unknown {
  if (typeof value === "string") {
    let replaced = value;
    for (const root of STORAGE_ROOTS) {
      replaced = replaced
        .split(`${root}/${oldUid}/`).join(`${root}/${newUid}/`)
        .split(`${root}%2F${oldUid}%2F`).join(`${root}%2F${newUid}%2F`)
        .split(`${root}%2f${oldUid}%2f`).join(`${root}%2f${newUid}%2f`);
    }
    return replaced;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceUserStoragePaths(item, oldUid, newUid));
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceUserStoragePaths(item, oldUid, newUid),
      ])
    );
  }
  return value;
}

async function claimMerge(
  firestore: Firestore,
  oldUid: string,
  newUid: string
): Promise<"claimed" | "complete"> {
  const ref = firestore.collection("_accountMerges").doc(oldUid);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existingTarget = snapshot.data()?.targetUid;
    if (typeof existingTarget === "string" && existingTarget !== newUid) {
      throw new AccountMergeConflict("That anonymous account was already merged elsewhere");
    }
    if (snapshot.data()?.status === "complete") return "complete";
    transaction.set(ref, {
      sourceUid: oldUid,
      targetUid: newUid,
      status: "processing",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return "claimed";
  });
}

async function copyStorageObjects(oldUid: string, newUid: string): Promise<number> {
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  let copied = 0;
  for (const root of STORAGE_ROOTS) {
    const oldPrefix = `${root}/${oldUid}/`;
    const [files] = await bucket.getFiles({ prefix: oldPrefix });
    for (const source of files) {
      const targetName = `${root}/${newUid}/${source.name.slice(oldPrefix.length)}`;
      const target = bucket.file(targetName);
      const [exists] = await target.exists();
      if (!exists) {
        await source.copy(target);
        copied += 1;
      }
    }
  }
  return copied;
}

async function deleteSourceStorageObjects(oldUid: string): Promise<number> {
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  let deleted = 0;
  for (const root of STORAGE_ROOTS) {
    const [files] = await bucket.getFiles({ prefix: `${root}/${oldUid}/` });
    for (const file of files) {
      await file.delete({ ignoreNotFound: true });
      deleted += 1;
    }
  }
  return deleted;
}

async function runCounted(
  client: PoolClient,
  counts: MergeCounts,
  key: string,
  text: string,
  values: unknown[]
): Promise<void> {
  const result = await client.query(text, values);
  counts[key] = (counts[key] ?? 0) + (result.rowCount ?? 0);
}

export async function transferSqlOwnership(
  pool: Pool,
  oldUid: string,
  newUid: string
): Promise<MergeCounts> {
  const client = await pool.connect();
  const counts: MergeCounts = {};
  try {
    await client.query("BEGIN");

    await runCounted(client, counts, "planParty", `
      INSERT INTO plan_party (plan_id, user_id, joined_at)
      SELECT plan_id, $2, joined_at FROM plan_party WHERE user_id = $1
      ON CONFLICT (plan_id, user_id) DO NOTHING`, [oldUid, newUid]);
    await runCounted(client, counts, "planPartyRemoved",
      "DELETE FROM plan_party WHERE user_id = $1", [oldUid]);

    await runCounted(client, counts, "tripReportFlags", `
      INSERT INTO trip_report_flags (report_id, user_id, reason, created_at)
      SELECT report_id, $2, reason, created_at FROM trip_report_flags WHERE user_id = $1
      ON CONFLICT (report_id, user_id) DO NOTHING`, [oldUid, newUid]);
    await runCounted(client, counts, "tripReportFlagsRemoved",
      "DELETE FROM trip_report_flags WHERE user_id = $1", [oldUid]);

    await runCounted(client, counts, "sessionTombstones", `
      INSERT INTO session_tombstones (session_id, user_id, deleted_at, server_updated_at)
      SELECT session_id, $2, deleted_at, server_updated_at
      FROM session_tombstones WHERE user_id = $1
      ON CONFLICT (session_id, user_id) DO UPDATE SET
        deleted_at = GREATEST(session_tombstones.deleted_at, EXCLUDED.deleted_at),
        server_updated_at = GREATEST(session_tombstones.server_updated_at, EXCLUDED.server_updated_at)`,
    [oldUid, newUid]);
    await runCounted(client, counts, "sessionTombstonesRemoved",
      "DELETE FROM session_tombstones WHERE user_id = $1", [oldUid]);

    const oldTripPrefix = `trip-reports/${oldUid}/`;
    const newTripPrefix = `trip-reports/${newUid}/`;
    const oldEncodedPrefix = `trip-reports%2F${oldUid}%2F`;
    const newEncodedPrefix = `trip-reports%2F${newUid}%2F`;

    await runCounted(client, counts, "tripReportPhotoDeletions", `
      INSERT INTO trip_report_photo_deletions
        (storage_path, queued_at, attempts, last_error)
      SELECT replace(storage_path, $1, $2), queued_at, attempts, last_error
      FROM trip_report_photo_deletions WHERE storage_path LIKE $1 || '%'
      ON CONFLICT (storage_path) DO UPDATE SET
        queued_at = LEAST(trip_report_photo_deletions.queued_at, EXCLUDED.queued_at),
        attempts = GREATEST(trip_report_photo_deletions.attempts, EXCLUDED.attempts)`,
    [oldTripPrefix, newTripPrefix]);
    await runCounted(client, counts, "tripReportPhotoDeletionsRemoved",
      "DELETE FROM trip_report_photo_deletions WHERE storage_path LIKE $1 || '%'",
      [oldTripPrefix]);

    await runCounted(client, counts, "tripReportPhotos", `
      UPDATE trip_report_photos photos SET
        storage_path = replace(photos.storage_path, $1, $2),
        download_url = replace(replace(photos.download_url, $1, $2), $3, $4)
      FROM trip_reports reports
      WHERE photos.report_id = reports.id AND reports.user_id = $5`,
    [oldTripPrefix, newTripPrefix, oldEncodedPrefix, newEncodedPrefix, oldUid]);

    for (const [table, column, key] of SQL_OWNERS) {
      await runCounted(client, counts, key,
        `UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1`, [oldUid, newUid]);
    }

    await client.query("COMMIT");
    return counts;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function replaceUid(values: unknown, oldUid: string, newUid: string): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  return [...new Set(values.map((value) => value === oldUid ? newUid : value)
    .filter((value): value is string => typeof value === "string"))];
}

async function copySubcollection(
  firestore: Firestore,
  oldUid: string,
  newUid: string,
  name: string
): Promise<number> {
  const source = await firestore.collection("users").doc(oldUid).collection(name).get();
  let copied = 0;
  for (const document of source.docs) {
    const target = firestore.collection("users").doc(newUid).collection(name).doc(document.id);
    const existing = await target.get();
    if (!existing.exists) {
      await target.set(
        replaceUserStoragePaths(document.data(), oldUid, newUid) as DocumentData
      );
      copied += 1;
    }
    await document.ref.delete();
  }
  return copied;
}

export async function transferFirestoreOwnership(
  firestore: Firestore,
  oldUid: string,
  newUid: string
): Promise<MergeCounts> {
  const counts: MergeCounts = {};
  const writer = firestore.bulkWriter();

  for (const [collection, field] of FIRESTORE_OWNERS) {
    const snapshot = await firestore.collection(collection).where(field, "==", oldUid).get();
    counts[collection] = snapshot.size;
    for (const document of snapshot.docs) {
      writer.set(document.ref, { [field]: newUid }, { merge: true });
    }
  }

  const partyPlans = await firestore.collection("plans").where("party", "array-contains", oldUid).get();
  counts.planParty = partyPlans.size;
  for (const plan of partyPlans.docs) {
    const party = replaceUid(plan.data().party, oldUid, newUid);
    if (party) writer.set(plan.ref, { party }, { merge: true });
  }

  const [friendships, targetFriendships] = await Promise.all([
    firestore.collection("friends").where("users", "array-contains", oldUid).get(),
    firestore.collection("friends").where("users", "array-contains", newUid).get(),
  ]);
  const existingFriendPairs = new Set(targetFriendships.docs.map((friendship) =>
    (replaceUid(friendship.data().users, oldUid, newUid) ?? []).sort().join("\u0000")
  ));
  counts.friends = friendships.size;
  for (const friendship of friendships.docs) {
    const users = replaceUid(friendship.data().users, oldUid, newUid) ?? [];
    const pair = [...users].sort().join("\u0000");
    if (users.length < 2 || existingFriendPairs.has(pair)) {
      writer.delete(friendship.ref);
    } else {
      existingFriendPairs.add(pair);
      writer.set(friendship.ref, { users }, { merge: true });
    }
  }

  const [friendRequests, targetFriendRequests] = await Promise.all([
    firestore.collection("friendRequests").where("users", "array-contains", oldUid).get(),
    firestore.collection("friendRequests").where("users", "array-contains", newUid).get(),
  ]);
  const friendRequestKey = (data: DocumentData, users: string[]) =>
    `${[...users].sort().join("\u0000")}\u0000${String(data.status ?? "")}`;
  const existingRequestKeys = new Set(targetFriendRequests.docs.map((request) => {
    const users = replaceUid(request.data().users, oldUid, newUid) ?? [];
    return friendRequestKey(request.data(), users);
  }));
  counts.friendRequests = friendRequests.size;
  for (const request of friendRequests.docs) {
    const data = request.data();
    const users = replaceUid(data.users, oldUid, newUid) ?? [];
    const key = friendRequestKey(data, users);
    if (users.length < 2 || existingRequestKeys.has(key)) {
      writer.delete(request.ref);
    } else {
      existingRequestKeys.add(key);
      writer.set(request.ref, {
        users,
        ...(data.requestedBy === oldUid ? { requestedBy: newUid } : {}),
      }, { merge: true });
    }
  }
  await writer.close();

  counts.savedDestinations = await copySubcollection(
    firestore, oldUid, newUid, "savedDestinations"
  );
  counts.savedPlaces = await copySubcollection(firestore, oldUid, newUid, "savedPlaces");

  const oldProfileRef = firestore.collection("users").doc(oldUid);
  const newProfileRef = firestore.collection("users").doc(newUid);
  const [oldProfile, newProfile] = await Promise.all([oldProfileRef.get(), newProfileRef.get()]);
  if (oldProfile.exists) {
    const sourceData = replaceUserStoragePaths(oldProfile.data() ?? {}, oldUid, newUid) as object;
    await newProfileRef.set({ ...sourceData, ...(newProfile.data() ?? {}) }, { merge: true });
    await oldProfileRef.delete();
    counts.userProfile = 1;
  }
  return counts;
}

async function mergeAnonymousAccount(oldToken: DecodedIdToken, newToken: DecodedIdToken) {
  const firestore = admin.firestore();
  const claim = await claimMerge(firestore, oldToken.uid, newToken.uid);
  if (claim === "complete") {
    await deleteAuthUser(oldToken.uid);
    return { alreadyMerged: true };
  }

  const storageCopied = await copyStorageObjects(oldToken.uid, newToken.uid);
  const sql = await transferSqlOwnership(db, oldToken.uid, newToken.uid);
  const firestoreCounts = await transferFirestoreOwnership(firestore, oldToken.uid, newToken.uid);
  const storageDeleted = await deleteSourceStorageObjects(oldToken.uid);

  await firestore.collection("_accountMerges").doc(oldToken.uid).set({
    status: "complete",
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await deleteAuthUser(oldToken.uid);

  return {
    alreadyMerged: false,
    storageCopied,
    storageDeleted,
    sql,
    firestore: firestoreCounts,
  };
}

async function deleteAuthUser(uid: string): Promise<void> {
  try {
    await admin.auth().deleteUser(uid);
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
  }
}

export async function deleteSqlOwnership(pool: Pool, uid: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Segments have no owner column. Remove geometry used only by this user's
    // routes, while retaining any segment another route still uses.
    await client.query(`DELETE FROM segments s
      WHERE EXISTS (
        SELECT 1 FROM route_segments rs JOIN routes r ON r.id = rs.route_id
        WHERE rs.segment_id = s.id AND r.owner = $1
      ) AND NOT EXISTS (
        SELECT 1 FROM route_segments rs JOIN routes r ON r.id = rs.route_id
        WHERE rs.segment_id = s.id AND r.owner <> $1
      )`, [uid]);
    for (const [table, column] of SQL_OWNERS) {
      // Foreign-key cascades remove points, photos, conditions and child joins.
      await client.query(`DELETE FROM ${table} WHERE ${column} = $1`, [uid]);
    }
    for (const table of ["plan_party", "trip_report_flags", "session_tombstones"]) {
      await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [uid]);
    }
    // Compare a literal prefix: Firebase UIDs may contain SQL LIKE wildcards.
    await client.query(`DELETE FROM trip_report_photo_deletions
      WHERE left(storage_path, length($1)) = $1`, [`trip-reports/${uid}/`]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteFirestoreDocument(firestore: Firestore, ref: DocumentReference): Promise<void> {
  // Keep the owner field until every child is gone. recursiveDelete(ref) may
  // remove the parent before failing on a child, which would hide that child
  // from the next ownership query and leave it behind on retry.
  for (const collection of await ref.listCollections()) {
    await firestore.recursiveDelete(collection);
  }
  await ref.delete();
}

export async function deleteFirestoreOwnership(firestore: Firestore, uid: string): Promise<void> {
  for (const [collection, field] of FIRESTORE_OWNERS) {
    // Bounded reads, with the parent deleted only after its subcollections.
    for (;;) {
      const snapshot = await firestore.collection(collection).where(field, "==", uid).limit(100).get();
      if (snapshot.empty) break;
      for (const document of snapshot.docs) await deleteFirestoreDocument(firestore, document.ref);
    }
  }
  for (const [collection, field] of [
    ["plans", "party"], ["friends", "users"], ["friendRequests", "users"],
  ]) {
    const snapshot = await firestore.collection(collection).where(field, "array-contains", uid).get();
    for (const document of snapshot.docs) {
      await document.ref.update({
        [field]: FieldValue.arrayRemove(uid),
        ...(collection === "friendRequests" && document.data().requestedBy === uid
          ? { requestedBy: FieldValue.delete() } : {}),
      });
    }
  }
  // Includes savedDestinations, savedPlaces, and any nested profile data.
  await deleteFirestoreDocument(firestore, firestore.collection("users").doc(uid));
}

async function deauthorizeStrava(firestore: Firestore, uid: string): Promise<void> {
  // functions/src/strava.ts stores tokens on users/{uid}.strava.
  const profile = await firestore.collection("users").doc(uid).get();
  const token = profile.data()?.strava?.access_token;
  if (typeof token !== "string" || !token) return;
  try {
    const response = await fetch("https://www.strava.com/oauth/deauthorize", {
      method: "POST",
      body: new URLSearchParams({ access_token: token }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) console.warn("[account] Strava deauthorization failed:", response.status);
    // The response may contain the revoked token; never log it.
    await response.body?.cancel();
  } catch {
    console.warn("[account] Strava deauthorization failed");
  }
}

const DELETION_LEASE_MS = 15 * 60_000;

router.delete("/", asyncRoute(async (request, res: Response) => {
  const { uid } = request as AuthRequest;
  const firestore = admin.firestore();
  const ref = firestore.collection("_accountDeletions").doc(uid);
  const attemptId = randomUUID();
  const claim = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (data?.status === "complete") return "complete";
    if (data?.status === "processing" && data.leaseUntil > Date.now()) return "busy";
    transaction.set(ref, {
      status: "processing", attemptId, leaseUntil: Date.now() + DELETION_LEASE_MS,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return "claimed";
  });
  if (claim === "busy") {
    res.set("Retry-After", "5").status(409).json({ error: "Account deletion is already running" });
    return;
  }
  if (claim === "complete") {
    res.json({ status: "deleted" });
    return;
  }

  try {
    await deauthorizeStrava(firestore, uid);
    await deleteSqlOwnership(db, uid);
    await deleteSourceStorageObjects(uid);
    await deleteFirestoreOwnership(firestore, uid);
    await deleteAuthUser(uid);
    await ref.set({
      status: "complete", leaseUntil: 0,
      completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    res.json({ status: "deleted" });
  } catch (error) {
    // Release this attempt for an immediate retry. A crashed request's lease
    // expires without a worker, scheduler or resident service.
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.data()?.attemptId === attemptId && snapshot.data()?.status !== "complete") {
        transaction.set(ref, {
          status: "failed", leaseUntil: 0, updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });
    throw error;
  }
}));

router.post("/merge-anonymous", asyncRoute(async (request, res: Response) => {
  const req = request as AuthRequest;
  const anonymousIdToken = req.body?.anonymousIdToken;
  if (typeof anonymousIdToken !== "string" || anonymousIdToken.length === 0 ||
      anonymousIdToken.length > MAX_ID_TOKEN_LENGTH) {
    res.status(400).json({ error: "A valid anonymous ID token is required" });
    return;
  }
  if (signInProvider(req.authToken) === "anonymous") {
    res.status(409).json({ error: "Sign in to the permanent account before merging" });
    return;
  }

  let oldToken: DecodedIdToken;
  try {
    // Verify signature and expiry even on retries. A completed claim permits
    // a retry after deleteUser; unfinished merges still check revocation.
    oldToken = await admin.auth().verifyIdToken(anonymousIdToken);
  } catch {
    res.status(401).json({ error: "The anonymous session has expired; sign in again and retry" });
    return;
  }
  if (signInProvider(oldToken) !== "anonymous") {
    res.status(403).json({ error: "The source account must be anonymous" });
    return;
  }
  if (oldToken.uid === req.uid) {
    res.status(409).json({ error: "The source and target accounts must differ" });
    return;
  }

  try {
    const claim = await admin.firestore().collection("_accountMerges").doc(oldToken.uid).get();
    if (claim.data()?.status !== "complete") {
      try {
        oldToken = await admin.auth().verifyIdToken(anonymousIdToken, true);
      } catch {
        res.status(401).json({ error: "The anonymous session has expired; sign in again and retry" });
        return;
      }
    }
    const result = await mergeAnonymousAccount(oldToken, req.authToken);
    res.json(result);
  } catch (error) {
    if (error instanceof AccountMergeConflict) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
}));

export default router;
