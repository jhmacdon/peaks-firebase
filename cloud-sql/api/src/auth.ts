import { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";

// Initialize Firebase Admin — in Cloud Run this uses the default service account
if (!admin.apps.length) {
  admin.initializeApp();
}

export interface AuthRequest extends Request {
  uid: string;
}

/** Helper to extract uid from an auth-verified request */
export function getUid(req: Request): string {
  return (req as any).uid;
}

/**
 * Middleware: verifies Firebase Auth ID token from Authorization header.
 * Sets req.uid on success, returns 401 on failure.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  try {
    const token = header.slice(7);
    const decoded = await admin.auth().verifyIdToken(token);
    (req as AuthRequest).uid = decoded.uid;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
