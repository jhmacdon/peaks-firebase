import express from "express";
import { requireAuth } from "./auth";
import destinations from "./routes/destinations";
import routes from "./routes/routes";
import sessions from "./routes/sessions";
import lists from "./routes/lists";
import search from "./routes/search";

const app = express();
app.use(express.json());

// Health check (unauthenticated — used by Cloud Run)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// All API routes require Firebase Auth
app.use("/api", requireAuth);

app.use("/api/destinations", destinations);
app.use("/api/routes", routes);
app.use("/api/sessions", sessions);
app.use("/api/lists", lists);
app.use("/api/search", search);

const port = parseInt(process.env.PORT || "8080");
app.listen(port, () => {
  console.log(`Peaks API listening on port ${port}`);
});
