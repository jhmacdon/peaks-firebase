"use server";

import { adminAuth } from "../firebase-admin";
import { adminDb } from "../firebase-admin";
import { chunk, orderByUids, shapeUserInfo, type UserInfo } from "../user-info";
import type { RawUserProfileDoc } from "../user-profile-shape";

export type { UserInfo };

export async function getUser(token: string, uid: string): Promise<UserInfo | null> {
  let caller;
  try {
    caller = await adminAuth.verifyIdToken(token);
  } catch {
    throw new Error("Unauthorized");
  }
  // Email is private: only an admin or the user themself may see it.
  const includeEmail = caller.admin === true || caller.uid === uid;

  try {
    const authUser = await adminAuth.getUser(uid);

    // The Firestore profile may have more detail than Auth. Its doc has two
    // possible shapes — iOS writes `avatar` + `name.first`/`name.last`, web
    // writes `avatarUrl` + a string `name` — shapeUserInfo reads both.
    let profile: RawUserProfileDoc | null = null;
    try {
      const userDoc = await adminDb.collection("users").doc(uid).get();
      if (userDoc.exists) profile = userDoc.data() ?? {};
    } catch {
      // Firestore profile may not exist
    }

    return shapeUserInfo(authUser, profile, includeEmail);
  } catch {
    return null;
  }
}

/**
 * Batched getUser: one server-action round trip for a whole uid list (e.g.
 * a plan's party) instead of one per member. Returns users in the requested
 * order; uids that resolve to no account are dropped. Each user's email
 * stays under the same privacy rule as getUser.
 */
export async function getUsers(token: string, uids: string[]): Promise<UserInfo[]> {
  let caller;
  try {
    caller = await adminAuth.verifyIdToken(token);
  } catch {
    throw new Error("Unauthorized");
  }

  const uniqueUids = [...new Set(uids)];
  if (uniqueUids.length === 0) return [];

  try {
    // adminAuth.getUsers() caps at 100 identifiers per call.
    const authBatches = await Promise.all(
      chunk(uniqueUids, 100).map((batch) =>
        adminAuth.getUsers(batch.map((uid) => ({ uid })))
      )
    );
    const authUsers = authBatches.flatMap((result) => result.users);
    if (authUsers.length === 0) return [];

    // One Firestore getAll for every profile doc. Profiles are enrichment —
    // on failure the Auth records still render (same as getUser's inner
    // swallow).
    const profileByUid = new Map<string, RawUserProfileDoc>();
    try {
      const docs = await adminDb.getAll(
        ...authUsers.map((user) => adminDb.collection("users").doc(user.uid))
      );
      for (const doc of docs) {
        if (doc.exists) profileByUid.set(doc.id, doc.data() ?? {});
      }
    } catch {
      // Firestore profiles may not exist
    }

    return orderByUids(
      authUsers.map((authUser) =>
        shapeUserInfo(
          authUser,
          profileByUid.get(authUser.uid) ?? null,
          caller.admin === true || caller.uid === authUser.uid
        )
      ),
      uniqueUids
    );
  } catch {
    return [];
  }
}
