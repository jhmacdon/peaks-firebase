import express from "express";
import { OAuth2Client } from "google-auth-library";
import { requireAuth } from "./auth";
import destinations from "./routes/destinations";
import routes from "./routes/routes";
import areas from "./routes/areas";
import sessions from "./routes/sessions";
import lists from "./routes/lists";
import plans from "./routes/plans";
import search from "./routes/search";
import { processingPool } from "./db";
import { sweepStuckSessions } from "./processing";

export const app = express();
// 5mb covers the iOS chunked points uploader (3000 pts/chunk ≈ 150KB) with
// generous headroom. Default express.json() limit is 100kb, which silently
// 413s real sessions before they reach the handler.
app.use(express.json({ limit: "5mb" }));

// Health check (unauthenticated — used by Cloud Run)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Stuck-session sweep, invoked by Cloud Scheduler every 2 minutes with an
// OIDC token. This replaced the in-process setInterval sweep: the service now
// runs with CPU throttling (request-based billing), so background timers get
// no CPU between requests — the scheduler request itself is the CPU window
// the sweep runs in. Advisory-lock-guarded inside sweepStuckSessions, so
// overlapping calls across instances are safe.
const sweepAuth = new OAuth2Client();
const SWEEP_AUDIENCE =
  process.env.SWEEP_AUDIENCE || "https://peaks-api-qownl77soa-uc.a.run.app";
const SWEEP_INVOKER =
  process.env.SWEEP_INVOKER || "peaks-sweeper@donner-a8608.iam.gserviceaccount.com";
let isSweeping = false;
app.post("/internal/sweep", async (req, res) => {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!idToken) {
    res.status(401).json({ error: "missing token" });
    return;
  }
  try {
    const ticket = await sweepAuth.verifyIdToken({ idToken, audience: SWEEP_AUDIENCE });
    const payload = ticket.getPayload();
    if (payload?.email !== SWEEP_INVOKER || !payload?.email_verified) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
  } catch {
    res.status(401).json({ error: "invalid token" });
    return;
  }

  if (isSweeping) {
    res.json({ status: "already_running" });
    return;
  }
  isSweeping = true;
  try {
    await sweepStuckSessions(processingPool);
    res.json({ status: "ok" });
  } catch (err) {
    console.error("[sweep] failed:", err);
    res.status(500).json({ error: "sweep failed" });
  } finally {
    isSweeping = false;
  }
});

// All API routes require Firebase Auth
app.use("/api", requireAuth);

app.use("/api/destinations", destinations);
app.use("/api/routes", routes);
app.use("/api/areas", areas);
app.use("/api/sessions", sessions);
app.use("/api/lists", lists);
app.use("/api/plans", plans);
app.use("/api/search", search);

// Don't bind a port when imported by tests.
if (process.env.NODE_ENV !== "test") {
  const port = parseInt(process.env.PORT || "8080");
  app.listen(port, () => {
    console.log(`Peaks API listening on port ${port}`);
  });
}
