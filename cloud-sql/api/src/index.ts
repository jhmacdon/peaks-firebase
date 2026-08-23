import express, { NextFunction, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import admin from "firebase-admin";
import { asyncRoute } from "./lib/async-route";
import { requireAuth } from "./auth";
import destinations from "./routes/destinations";
import routes from "./routes/routes";
import areas from "./routes/areas";
import sessions from "./routes/sessions";
import lists from "./routes/lists";
import plans from "./routes/plans";
import search from "./routes/search";
import tripReports, { drainTripReportPhotoDeletions } from "./routes/trip-reports";
import publicAirQuality from "./routes/public-air-quality";
import pool, { processingPool } from "./db";
import { sweepStuckSessions } from "./processing";
import { refreshDestinationWeather } from "./weather-refresh";

export const app = express();
// 5mb covers the iOS chunked points uploader (3000 pts/chunk ≈ 150KB) with
// generous headroom. Default express.json() limit is 100kb, which silently
// 413s real sessions before they reach the handler.
app.use(express.json({ limit: "5mb" }));

// Health check (unauthenticated — used by Cloud Run)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Public because the main map works before sign-in and the response contains
// no user data. The provider is disabled until AirNow's owner-notice step is
// complete; keeping this before /api auth makes that state visible to clients.
app.use("/public/air-quality", publicAirQuality);

// Shared by every /internal/* endpoint below: Cloud Scheduler calls them with
// an OIDC token whose audience is this service and whose subject is the
// scheduler's invoker SA. Verifies that token, writing the 401/403 response
// itself on failure; callers just check the return value. `label` picks the
// log prefix ("sweep", "weather") so each endpoint's rejections stay
// distinguishable in logs — behavior and status codes are identical either
// way. Not Firebase auth: this is a service-to-service call, not a user one.
const schedulerAuth = new OAuth2Client();
const SWEEP_AUDIENCE =
  process.env.SWEEP_AUDIENCE || "https://peaks-api-qownl77soa-uc.a.run.app";
const SWEEP_INVOKER =
  process.env.SWEEP_INVOKER || "peaks-sweeper@donner-a8608.iam.gserviceaccount.com";
async function verifySchedulerToken(req: Request, res: Response, label: string): Promise<boolean> {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!idToken) {
    console.warn(`[${label}] rejected: no bearer token (auth header present:`, header.length > 0, ")");
    res.status(401).json({ error: "missing token" });
    return false;
  }
  try {
    const ticket = await schedulerAuth.verifyIdToken({ idToken, audience: SWEEP_AUDIENCE });
    const payload = ticket.getPayload();
    if (payload?.email !== SWEEP_INVOKER || !payload?.email_verified) {
      console.warn(`[${label}] rejected: wrong invoker`, payload?.email);
      res.status(403).json({ error: "forbidden" });
      return false;
    }
  } catch (err) {
    console.warn(`[${label}] rejected: token verification failed:`, (err as Error).message);
    res.status(401).json({ error: "invalid token" });
    return false;
  }
  return true;
}

// Stuck-session sweep, invoked by Cloud Scheduler every 2 minutes. This
// replaced the in-process setInterval sweep: the service now runs with CPU
// throttling (request-based billing), so background timers get no CPU
// between requests — the scheduler request itself is the CPU window the
// sweep runs in. Advisory-lock-guarded inside sweepStuckSessions, so
// overlapping calls across instances are safe.
let isSweeping = false;
app.post("/internal/sweep", asyncRoute(async (req, res) => {
  if (!(await verifySchedulerToken(req, res, "sweep"))) return;

  if (isSweeping) {
    res.json({ status: "already_running" });
    return;
  }
  isSweeping = true;
  try {
    await sweepStuckSessions(processingPool);
    await drainTripReportPhotoDeletions(processingPool);
    res.json({ status: "ok" });
  } catch (err) {
    console.error("[sweep] failed:", err);
    res.status(500).json({ error: "sweep failed" });
  } finally {
    isSweeping = false;
  }
}));

// Destination weather refresh, invoked by Cloud Scheduler 3x daily (job
// `peaks-api-weather`, same OIDC invoker SA as sweep). Same
// request-is-the-CPU-window reasoning as the sweep above; see
// weather-refresh.ts for the actual fetch/write work. selectWeatherTargets's
// read is a single bounded, indexed SELECT — not the long-running per-session
// work processingPool exists for — so this uses the default web pool instead
// of competing with the sweep for the small isolated processing pool.
let isRefreshingWeather = false;
app.post("/internal/weather-refresh", asyncRoute(async (req, res) => {
  if (!(await verifySchedulerToken(req, res, "weather"))) return;

  if (isRefreshingWeather) {
    res.json({ status: "already_running" });
    return;
  }
  isRefreshingWeather = true;
  try {
    const counts = await refreshDestinationWeather(pool, admin.firestore());
    res.json({ status: "ok", ...counts });
  } catch (err) {
    console.error("[weather] failed:", err);
    res.status(500).json({ error: "weather refresh failed" });
  } finally {
    isRefreshingWeather = false;
  }
}));

// All API routes require Firebase Auth
app.use("/api", requireAuth);

app.use("/api/destinations", destinations);
app.use("/api/routes", routes);
app.use("/api/areas", areas);
app.use("/api/sessions", sessions);
app.use("/api/lists", lists);
app.use("/api/plans", plans);
app.use("/api/search", search);
app.use("/api/trip-reports", tripReports);

// A rejected handler promise lands here via asyncRoute (lib/async-route.ts).
// Express 4 ignores the promise an async handler returns, so without that
// wrapper and this middleware a single rejected query would crash the
// instance (Node's default --unhandled-rejections=throw). A response that
// already sent headers (streaming endpoints) falls through to Express's
// default handler, which closes the connection.
app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    console.error("[api] request failed:", error);
    next(error);
    return;
  }
  // express.json() rejections carry their own status — 400 for malformed
  // JSON, 413 for a body over the 5mb limit. A 4xx must pass through: the
  // 413 in particular is load-bearing, because the iOS chunked uploader is
  // sized against the limit and treats a 500 as transient, so flattening it
  // invites endless retries.
  const err = error as { status?: unknown; statusCode?: unknown } | null;
  const status = err?.status ?? err?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    console.warn("[api] request rejected:", status, error instanceof Error ? error.message : error);
    res.status(status).json({ error: "Bad request" });
    return;
  }
  console.error("[api] request failed:", error);
  res.status(500).json({ error: "Request failed" });
});

// Don't bind a port when imported by tests.
if (process.env.NODE_ENV !== "test") {
  const port = parseInt(process.env.PORT || "8080");
  app.listen(port, () => {
    console.log(`Peaks API listening on port ${port}`);
  });
}
