import { Pool, types } from "pg";

// Cloud SQL connection via Unix socket (Cloud SQL Auth Proxy)
// or TCP for local development.
//
// In Cloud Run, set:
//   INSTANCE_CONNECTION_NAME = project:region:instance
//   DB_NAME, DB_USER, DB_PASS
//
// The Cloud SQL Auth Proxy provides the Unix socket at:
//   /cloudsql/INSTANCE_CONNECTION_NAME

// Return `BIGINT` (OID 20, `INT8`) as a JS `Number` instead of the pg-types
// default of `String`. The only BIGINT column in use today is
// `tracking_points.time` — a unix-seconds timestamp comfortably below 2^53,
// so precision is safe. Keeping the default string behavior caused iOS to
// parse `d["time"] as? Int` as nil, zero every tracking point's timestamp,
// and completely invalidate the session timeline + flyover day/night cycle.
// If a future BIGINT column needs >2^53 precision, give it its own typed
// parser or return it via `::text` in the query.
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

const pool = new Pool({
  host: process.env.DB_HOST || `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
  database: process.env.DB_NAME || "peaks",
  user: process.env.DB_USER || "peaks-api",
  password: process.env.DB_PASS,
  port: process.env.DB_HOST ? parseInt(process.env.DB_PORT || "5432") : undefined,
  max: 10,
});

export default pool;
