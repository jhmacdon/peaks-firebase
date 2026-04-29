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
 *
 * In test mode (NODE_ENV === "test"), reads uid from an X-Test-User header
 * instead — lets the API integration test suite inject identities without
 * minting Firebase tokens.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === "test") {
    // Defense-in-depth: refuse to bypass auth if we're running inside Cloud
    // Run, even if NODE_ENV is somehow set to "test". K_SERVICE / K_REVISION
    // are injected by the Cloud Run runtime and never set in local dev.
    if (process.env.K_SERVICE || process.env.K_REVISION) {
      res.status(500).json({ error: "Auth shim refuses to run in Cloud Run" });
      return;
    }
    const testUid = req.headers["x-test-user"];
    if (typeof testUid === "string" && testUid.length > 0) {
      (req as AuthRequest).uid = testUid;
      next();
      return;
    }
    res.status(401).json({ error: "Test mode requires X-Test-User header" });
    return;
  }

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
