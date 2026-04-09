import { Pool } from "pg";

// Server-side only — PostGIS direct connection via Cloud SQL Auth Proxy
const pool = new Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "peaks",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASS,
  max: 5,
});

export default pool;
