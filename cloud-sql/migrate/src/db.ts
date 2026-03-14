import { Pool } from "pg";

// For migration, connect via Cloud SQL Auth Proxy (local) or direct TCP.
// Set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS in environment.

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "peaks",
  user: process.env.DB_USER || "peaks-api",
  password: process.env.DB_PASS,
  max: 5,
});

export default pool;
