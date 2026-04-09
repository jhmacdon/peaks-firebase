"use server";

import { adminAuth } from "../firebase-admin";
import { adminDb } from "../firebase-admin";

export interface UserInfo {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  firstName: string | null;
  lastName: string | null;
}

export async function getUser(uid: string): Promise<UserInfo | null> {
  try {
    // Get Firebase Auth record
    const authUser = await adminAuth.getUser(uid);

    // Get Firestore profile for name/avatar (may have more detail than Auth)
    let firstName: string | null = null;
    let lastName: string | null = null;
    let photoURL = authUser.photoURL || null;

    try {
      const userDoc = await adminDb.collection("users").doc(uid).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        firstName = data?.name?.first || null;
        lastName = data?.name?.last || null;
        if (data?.avatar) photoURL = data.avatar;
      }
    } catch {
      // Firestore profile may not exist
    }

    return {
      uid: authUser.uid,
      email: authUser.email || null,
      displayName: authUser.displayName || [firstName, lastName].filter(Boolean).join(" ") || null,
      photoURL,
      firstName,
      lastName,
    };
  } catch {
    return null;
  }
}
