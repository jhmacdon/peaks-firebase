"use server";

import { adminAuth } from "../firebase-admin";
import { adminDb } from "../firebase-admin";
import { resolveAvatarUrl, resolveProfileName } from "../user-profile-shape";

export interface UserInfo {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  firstName: string | null;
  lastName: string | null;
}

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
    // Get Firebase Auth record
    const authUser = await adminAuth.getUser(uid);

    // Get Firestore profile for name/avatar (may have more detail than
    // Auth). The profile doc has two possible shapes — iOS writes `avatar`
    // + `name.first`/`name.last`, web writes `avatarUrl` + a string `name`
    // — resolveAvatarUrl/resolveProfileName read both.
    let firstName: string | null = null;
    let lastName: string | null = null;
    let profileDisplayName: string | null = null;
    let photoURL = authUser.photoURL || null;

    try {
      const userDoc = await adminDb.collection("users").doc(uid).get();
      if (userDoc.exists) {
        const data = userDoc.data() ?? {};
        const resolvedName = resolveProfileName(data);
        firstName = resolvedName.firstName;
        lastName = resolvedName.lastName;
        profileDisplayName = resolvedName.displayName;
        const resolvedAvatar = resolveAvatarUrl(data);
        if (resolvedAvatar) photoURL = resolvedAvatar;
      }
    } catch {
      // Firestore profile may not exist
    }

    return {
      uid: authUser.uid,
      email: includeEmail ? authUser.email || null : null,
      displayName:
        authUser.displayName ||
        profileDisplayName ||
        [firstName, lastName].filter(Boolean).join(" ") ||
        null,
      photoURL,
      firstName,
      lastName,
    };
  } catch {
    return null;
  }
}
