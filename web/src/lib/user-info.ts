import {
  resolveAvatarUrl,
  resolveProfileName,
  type RawUserProfileDoc,
} from "./user-profile-shape";

export interface UserInfo {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  firstName: string | null;
  lastName: string | null;
}

/** The subset of a Firebase Auth UserRecord that user shaping reads. */
export interface AuthUserLike {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

/**
 * Merge one Firebase Auth record with its Firestore `users/{uid}` profile
 * doc (either writer shape — see `user-profile-shape.ts`) into the wire
 * `UserInfo`. Email is private: pass `includeEmail` only when the caller is
 * an admin or the user themself.
 */
export function shapeUserInfo(
  authUser: AuthUserLike,
  profile: RawUserProfileDoc | null,
  includeEmail: boolean
): UserInfo {
  const resolvedName = profile ? resolveProfileName(profile) : null;
  const profileAvatar = profile ? resolveAvatarUrl(profile) : null;

  return {
    uid: authUser.uid,
    email: includeEmail ? authUser.email || null : null,
    displayName:
      authUser.displayName ||
      resolvedName?.displayName ||
      [resolvedName?.firstName, resolvedName?.lastName].filter(Boolean).join(" ") ||
      null,
    photoURL: profileAvatar || authUser.photoURL || null,
    firstName: resolvedName?.firstName ?? null,
    lastName: resolvedName?.lastName ?? null,
  };
}

/** Restore the caller's requested order from an unordered batch lookup,
 * dropping uids that resolved to no user and duplicate uids. */
export function orderByUids<T extends { uid: string }>(users: T[], uids: string[]): T[] {
  const byUid = new Map(users.map((user) => [user.uid, user]));
  const ordered: T[] = [];
  for (const uid of uids) {
    const user = byUid.get(uid);
    if (user) {
      ordered.push(user);
      byUid.delete(uid);
    }
  }
  return ordered;
}

/** Split into batches of at most `size` (for APIs with a per-call cap,
 * e.g. adminAuth.getUsers()'s 100-identifier limit). */
export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
