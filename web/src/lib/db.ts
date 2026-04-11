import { Pool } from "pg";

// Server-side only — PostGIS connection.
// In Cloud Run / App Hosting: connects via Unix socket at /cloudsql/INSTANCE.
// Locally: connects via TCP at DB_HOST (Cloud SQL Auth Proxy).
const pool = new Pool({
  host: process.env.DB_HOST || `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
  database: process.env.DB_NAME || "peaks",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASS,
  port: process.env.DB_HOST ? parseInt(process.env.DB_PORT || "5432") : undefined,
  max: 5,
});

export default pool;
