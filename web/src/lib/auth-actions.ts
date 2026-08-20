"use server";

import { adminAuth } from "./firebase-admin";

export async function verifyToken(
  token: string
): Promise<{ uid: string } | null> {
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

export async function verifyAdminToken(
  token: string
): Promise<{ uid: string } | null> {
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.admin === true ? { uid: decoded.uid } : null;
  } catch {
    return null;
  }
}
