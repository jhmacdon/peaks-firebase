import { Pool } from "pg";

// Cloud SQL connection via Unix socket (Cloud SQL Auth Proxy)
// or TCP for local development.
//
// In Cloud Run, set:
//   INSTANCE_CONNECTION_NAME = project:region:instance
//   DB_NAME, DB_USER, DB_PASS
//
// The Cloud SQL Auth Proxy provides the Unix socket at:
//   /cloudsql/INSTANCE_CONNECTION_NAME

const pool = new Pool({
  host: process.env.DB_HOST || `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
  database: process.env.DB_NAME || "peaks",
  user: process.env.DB_USER || "peaks-api",
  password: process.env.DB_PASS,
  port: process.env.DB_HOST ? parseInt(process.env.DB_PORT || "5432") : undefined,
  max: 10,
});

export default pool;
