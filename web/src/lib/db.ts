import { Pool } from "pg";
import { buildWebPoolSafetyConfig } from "./db-config";

// Server-side only — PostGIS connection.
// Locally: connects via TCP at DB_HOST (Cloud SQL Auth Proxy).
// App Hosting / Cloud Run: uses @google-cloud/cloud-sql-connector for a
// secure tunnel without needing a Unix socket mount.

let pool: Pool;

if (process.env.DB_HOST) {
  // Local development — direct TCP via Cloud SQL Auth Proxy
  pool = new Pool({
    host: process.env.DB_HOST,
    database: process.env.DB_NAME || "peaks",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASS,
    port: parseInt(process.env.DB_PORT || "5432"),
    ...buildWebPoolSafetyConfig(),
  });
} else {
  // Production — Cloud SQL Connector (no Unix socket needed)
  const { Connector, IpAddressTypes } = await import("@google-cloud/cloud-sql-connector");
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: process.env.INSTANCE_CONNECTION_NAME!,
    ipType: IpAddressTypes.PUBLIC,
  });
  pool = new Pool({
    ...clientOpts,
    database: process.env.DB_NAME || "peaks",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASS,
    ...buildWebPoolSafetyConfig(),
  });
}

pool.on("error", (error) => {
  console.error("[db] idle pool client error", error);
});

export default pool;
