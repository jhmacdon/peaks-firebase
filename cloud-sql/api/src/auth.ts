import { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";
import type { DecodedIdToken } from "firebase-admin/auth";

// Initialize Firebase Admin — in Cloud Run this uses the default service account
if (!admin.apps.length) {
  admin.initializeApp();
}

export interface AuthRequest extends Request {
  uid: string;
  authToken: DecodedIdToken;
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
      const testName = req.headers["x-test-name"];
      (req as AuthRequest).authToken = {
        uid: testUid,
        firebase: { sign_in_provider: "password", identities: {} },
        // Lets admin-route tests stand in for the Firebase `admin` custom claim.
        ...(req.headers["x-test-admin"] === "true" ? { admin: true } : {}),
        ...(typeof testName === "string" && testName ? { name: testName } : {}),
      } as DecodedIdToken;
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
    (req as AuthRequest).authToken = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Middleware for /api/admin/*: the verified ID token must carry the Firebase
 * custom claim `admin: true`, the same admin source of truth the web app uses
 * (web/src/lib/auth-actions.ts). Mount after requireAuth. Returns 403 for a
 * signed-in user without the claim.
 *
 * The claim lives in the ID token, so a newly granted admin must refresh the
 * token (sign out and in, or force a token refresh) before this passes.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = (req as Partial<AuthRequest>).authToken;
  if (!token || token.admin !== true) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
