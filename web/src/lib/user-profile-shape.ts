/**
 * Reads for the Firestore `users/{uid}` document have to tolerate two
 * shapes: the iOS app (and old web code) writes `avatar` + `name.first` /
 * `name.last`, while the web profile editor (see `actions/profile.ts`)
 * writes `avatarUrl` + a plain string `name`. Never change what a writer
 * writes — iOS compatibility — only widen what a reader accepts.
 */

export interface RawUserProfileDoc {
  avatarUrl?: unknown;
  avatar?: unknown;
  name?: unknown;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** `avatarUrl` (web shape) wins when both are present; either shape works
 * standalone. */
export function resolveAvatarUrl(doc: RawUserProfileDoc): string | null {
  const avatarUrl = trimmedString(doc.avatarUrl);
  if (avatarUrl) return avatarUrl;
  const avatar = trimmedString(doc.avatar);
  return avatar || null;
}

export interface ResolvedProfileName {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}

const EMPTY_NAME: ResolvedProfileName = {
  displayName: null,
  firstName: null,
  lastName: null,
};

/** Accepts a string `name` (web shape) or a `{ first, last }` object (iOS
 * shape) and normalizes both to the same `{ displayName, firstName,
 * lastName }` result. */
export function resolveProfileName(doc: RawUserProfileDoc): ResolvedProfileName {
  const name = doc.name;

  if (typeof name === "string") {
    const trimmed = name.trim();
    if (!trimmed) return EMPTY_NAME;
    const parts = trimmed.split(/\s+/);
    return {
      displayName: trimmed,
      firstName: parts[0] || null,
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
    };
  }

  if (name && typeof name === "object") {
    const nameObj = name as Record<string, unknown>;
    const first = trimmedString(nameObj.first);
    const last = trimmedString(nameObj.last);
    const displayName = [first, last].filter(Boolean).join(" ") || null;
    return {
      displayName,
      firstName: first || null,
      lastName: last || null,
    };
  }

  return EMPTY_NAME;
}
