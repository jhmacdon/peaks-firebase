"use server";

import { adminDb } from "../firebase-admin";
import { verifyToken } from "../auth-actions";

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Friend {
  id: string;
  friendUserId: string;
  friendName: string;
  friendEmail: string;
  friendAvatarUrl: string | null;
  since: string;
}

export async function getProfile(
  token: string
): Promise<UserProfile | null> {
  const auth = await verifyToken(token);
  if (!auth) return null;

  const doc = await adminDb.collection("users").doc(auth.uid).get();
  if (!doc.exists) return null;

  const data = doc.data()!;
  return {
    name: data.name || "",
    email: data.email || "",
    avatarUrl: data.avatarUrl || null,
    createdAt: data.createdAt || "",
  };
}

export async function updateProfile(
  token: string,
  data: { name?: string; avatarUrl?: string }
): Promise<{ success: boolean }> {
  const auth = await verifyToken(token);
  if (!auth) return { success: false };

  const updates: Record<string, string> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.avatarUrl !== undefined) updates.avatarUrl = data.avatarUrl;

  if (Object.keys(updates).length > 0) {
    await adminDb.collection("users").doc(auth.uid).update(updates);
  }

  return { success: true };
}

export async function getFriends(token: string): Promise<Friend[]> {
  const auth = await verifyToken(token);
  if (!auth) return [];

  const snapshot = await adminDb
    .collection("friends")
    .where("users", "array-contains", auth.uid)
    .get();

  const friends: Friend[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const users: string[] = data.users || [];
    const otherUid = users.find((uid) => uid !== auth.uid);
    if (!otherUid) continue;

    const userDoc = await adminDb.collection("users").doc(otherUid).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    friends.push({
      id: doc.id,
      friendUserId: otherUid,
      friendName: userData?.name || "",
      friendEmail: userData?.email || "",
      friendAvatarUrl: userData?.avatarUrl || null,
      since: data.createdAt
        ? typeof data.createdAt === "string"
          ? data.createdAt
          : data.createdAt.toDate().toISOString()
        : "",
    });
  }

  return friends;
}

export async function createFriendInvite(
  token: string
): Promise<{ inviteCode: string } | null> {
  const auth = await verifyToken(token);
  if (!auth) return null;

  const docRef = await adminDb.collection("invites").add({
    userId: auth.uid,
    type: "friend",
    createdAt: new Date().toISOString(),
  });

  return { inviteCode: docRef.id };
}

export async function acceptFriendInvite(
  token: string,
  inviteCode: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyToken(token);
  if (!auth) return { success: false, error: "Not authenticated" };

  const normalizedInviteCode = extractInviteCode(inviteCode);
  if (!normalizedInviteCode) {
    return { success: false, error: "Invalid invite code" };
  }

  const inviteRef = adminDb.collection("invites").doc(normalizedInviteCode);
  const inviteDoc = await inviteRef.get();

  if (!inviteDoc.exists) {
    return { success: false, error: "Invalid invite code" };
  }

  const inviteData = inviteDoc.data()!;

  if (inviteData.userId === auth.uid) {
    return { success: false, error: "You cannot accept your own invite" };
  }

  // Check if friendship already exists
  const existingFriends = await adminDb
    .collection("friends")
    .where("users", "array-contains", auth.uid)
    .get();

  const alreadyFriends = existingFriends.docs.some((doc) => {
    const users: string[] = doc.data().users || [];
    return users.includes(inviteData.userId);
  });

  if (alreadyFriends) {
    await inviteRef.delete();
    return { success: false, error: "You are already friends" };
  }

  // Create friendship
  await adminDb.collection("friends").add({
    users: [inviteData.userId, auth.uid],
    createdAt: new Date().toISOString(),
  });

  // Delete the invite
  await inviteRef.delete();

  return { success: true };
}

function extractInviteCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.searchParams.get("invite");
  } catch {
    return trimmed;
  }
}

export async function removeFriend(
  token: string,
  friendDocId: string
): Promise<{ success: boolean }> {
  const auth = await verifyToken(token);
  if (!auth) return { success: false };

  const friendRef = adminDb.collection("friends").doc(friendDocId);
  const friendDoc = await friendRef.get();

  if (!friendDoc.exists) return { success: false };

  const data = friendDoc.data()!;
  const users: string[] = data.users || [];

  if (!users.includes(auth.uid)) {
    return { success: false };
  }

  await friendRef.delete();
  return { success: true };
}
