import admin from "firebase-admin";
import path from "path";

// Initialize with service account from the functions directory
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.resolve(__dirname, "../../../functions/peaks-cred.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});

export const firestore = admin.firestore();
