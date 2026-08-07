// Postgres pool. Cloud Run: Unix socket at /cloudsql/<instance>.
// Local dev: TCP via Cloud SQL Auth Proxy (set DB_HOST=127.0.0.1).
import { Pool } from "pg";

const pool =
  process.env.INSTANCE_CONNECTION_NAME && !process.env.DB_HOST
    ? new Pool({
        host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
        database: process.env.DB_NAME || "peaks",
        user: process.env.DB_USER || "peaks-api",
        password: process.env.DB_PASS,
        max: 2,
      })
    : new Pool({
        host: process.env.DB_HOST || "127.0.0.1",
        port: parseInt(process.env.DB_PORT || "5432"),
        database: process.env.DB_NAME || "peaks",
        user: process.env.DB_USER || "peaks-api",
        password: process.env.DB_PASS,
        max: 2,
      });

export default pool;
