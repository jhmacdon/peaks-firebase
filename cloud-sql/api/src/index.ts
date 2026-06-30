import express from "express";
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

  // Background safety-net: finish any session left 'pending'/'failed'/stale by an
  // inline run that hit the web pool's 30s budget. Advisory-lock-guarded inside
  // sweepStuckSessions so only one instance sweeps at a time. Needs Cloud Run
  // --no-cpu-throttling so the timer runs between requests (Task 5).
  const sweepIntervalMs = Number(process.env.SWEEP_INTERVAL_MS) || 120_000;
  let isSweeping = false;
  setInterval(async () => {
    if (isSweeping) return; // never overlap on the same instance
    isSweeping = true;
    try {
      await sweepStuckSessions(processingPool);
    } catch (err) {
      console.error("[sweep] tick failed:", err);
    } finally {
      isSweeping = false;
    }
  }, sweepIntervalMs);
}
