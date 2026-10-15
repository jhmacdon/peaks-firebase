import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

const MIGRATE_ROOT = join(__dirname, "../..");
const CLOUD_SQL_ROOT = join(MIGRATE_ROOT, "..");
const MIGRATION = readFileSync(
  join(CLOUD_SQL_ROOT, "migrations/20261015_route_covers.sql"),
  "utf8"
);
const REVIEW_SOURCE = readFileSync(
  join(CLOUD_SQL_ROOT, "migrations/20261014_trail_catalog_review_activation.sql"),
  "utf8"
);
const SCHEMA = readFileSync(join(CLOUD_SQL_ROOT, "schema.sql"), "utf8");
const TEST_DATABASE_URL = process.env.ROUTE_JOB_TEST_DATABASE_URL;

function functionBody(sql: string, name: string): string {
  const match = sql.match(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name}\\([\\s\\S]*?\\nEND \\$\\$;`)
  );
  assert.ok(match, `expected ${name}`);
  return match[0].replace(/^CREATE (?:OR REPLACE )?FUNCTION /, "");
}

test("photos are optional: the cover activation gate is dropped and gone from the baseline", () => {
  assert.match(MIGRATION, /DROP TRIGGER IF EXISTS trg_enforce_peaks_route_cover_activation ON routes;/);
  assert.match(MIGRATION, /DROP FUNCTION IF EXISTS enforce_peaks_route_cover_activation\(\);/);
  assert.doesNotMatch(SCHEMA, /CREATE CONSTRAINT TRIGGER trg_enforce_peaks_route_cover_activation/);
  assert.doesNotMatch(MIGRATION, /UPDATE\s+(?:public\.)?routes\s+SET/i);
});

test("catalog functions are reproduced exactly except for the cover gate", () => {
  const before = functionBody(REVIEW_SOURCE, "trail_catalog_review_machine_checks");
  const after = functionBody(MIGRATION, "trail_catalog_review_machine_checks");
  assert.equal(
    after,
    before
      .replace("\n    'credited_cover',cover,'elevation',", "\n    'elevation',")
      .replace(
        "'summit_max_gap_m',summit_gap,'summit_count',summit_count);",
        "'summit_max_gap_m',summit_gap,'summit_count',summit_count,'credited_cover',cover);"
      )
  );
  const sourceBefore = functionBody(REVIEW_SOURCE, "trail_catalog_source_review_passes");
  const sourceAfter = functionBody(MIGRATION, "trail_catalog_source_review_passes");
  assert.equal(sourceAfter, sourceBefore.replace("'segment_reuse','credited_cover','elevation'", "'segment_reuse','elevation'"));
  const exempt = "'status','updated_at'";
  const coverExempt =
    "'status','updated_at','cover_image','cover_attribution','cover_attribution_url','cover_storage_path','cover_focal_x','cover_focal_y','cover_source','cover_updated_at'";
  const guardBefore = functionBody(REVIEW_SOURCE, "guard_trail_catalog_pending_only");
  const guardAfter = functionBody(MIGRATION, "guard_trail_catalog_pending_only");
  assert.equal(guardAfter, guardBefore.split(`ARRAY[${exempt}]`).join(`ARRAY[${coverExempt}]`));
});

test("a shown route cover must carry its full credit", () => {
  assert.match(MIGRATION, /routes_cover_credit_check/);
  assert.match(MIGRATION, /NULLIF\(btrim\(cover_attribution\), ''\) IS NOT NULL/);
  assert.match(MIGRATION, /NULLIF\(btrim\(cover_attribution_url\), ''\) IS NOT NULL/);
  assert.match(MIGRATION, /cover_source IN \('commons', 'nps', 'usfs', 'admin', 'other'\)/);
  assert.match(MIGRATION, /GRANT SELECT ON route_cover_photos TO "peaks-api";/);
});

function requireDisposableDatabase(value: string): URL {
  const url = new URL(value);
  assert.match(url.pathname, /_test$/, "route-cover tests require a *_test database");
  return url;
}

test(
  "an uncovered Peaks route activates, and a route's own cover wins over its places",
  {
    skip: TEST_DATABASE_URL ? false : "ROUTE_JOB_TEST_DATABASE_URL is required",
  },
  async () => {
    requireDisposableDatabase(TEST_DATABASE_URL!);
    const suffix = `${process.pid}-${Date.now()}`;
    const destination = `cover-optional-destination-${suffix}`;
    const route = `cover-optional-route-${suffix}`;
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO destinations (id, name, search_name, features)
         VALUES ($1, 'Uncovered summit', 'uncovered summit',
                 ARRAY['summit']::destination_feature[])`,
        [destination]
      );
      await client.query(
        `INSERT INTO routes (id, name, owner, status)
         VALUES ($1, 'Uncovered route', 'peaks', 'pending')`,
        [route]
      );
      await client.query(
        `INSERT INTO route_destinations (route_id, destination_id, ordinal)
         VALUES ($1, $2, 0)`,
        [route, destination]
      );
      await client.query(`UPDATE routes SET status = 'active' WHERE id = $1`, [route]);
      await client.query("COMMIT");
      const saved = await client.query<{ status: string }>(
        `SELECT status FROM routes WHERE id = $1`,
        [route]
      );
      assert.equal(saved.rows[0]?.status, "active");
      const none = await client.query(`SELECT * FROM route_cover_photos WHERE route_id = $1`, [route]);
      assert.equal(none.rowCount, 0);

      await assert.rejects(
        client.query(
          `UPDATE routes SET cover_image = 'https://example.org/a.jpg', cover_source = 'admin' WHERE id = $1`,
          [route]
        ),
        /routes_cover_credit_check/
      );

      await client.query(
        `UPDATE destinations
            SET hero_image = 'https://example.org/place.jpg',
                hero_image_attribution = 'Place Photographer',
                hero_image_attribution_url = 'https://example.org/place'
          WHERE id = $1`,
        [destination]
      );
      const fromPlace = await client.query(`SELECT * FROM route_cover_photos WHERE route_id = $1`, [route]);
      assert.equal(fromPlace.rows[0].origin, "destination");
      assert.equal(fromPlace.rows[0].destination_id, destination);

      await client.query(
        `UPDATE routes
            SET cover_image = 'https://example.org/route.jpg',
                cover_attribution = 'Route Photographer',
                cover_attribution_url = 'https://example.org/route',
                cover_focal_x = 30, cover_focal_y = 70, cover_source = 'admin'
          WHERE id = $1`,
        [route]
      );
      const own = await client.query(`SELECT * FROM route_cover_photos WHERE route_id = $1`, [route]);
      assert.deepEqual(own.rows[0], {
        route_id: route,
        destination_id: null,
        destination_name: null,
        image_url: "https://example.org/route.jpg",
        attribution: "Route Photographer",
        attribution_url: "https://example.org/route",
        focal_x: 30,
        focal_y: 70,
        origin: "route",
      });
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query(`DELETE FROM routes WHERE id = $1`, [route]);
      await client.query(`DELETE FROM destinations WHERE id = $1`, [destination]);
      client.release();
      await pool.end();
    }
  }
);

test(
  "replacing a destination photo elsewhere clears its admin markers",
  {
    skip: TEST_DATABASE_URL ? false : "ROUTE_JOB_TEST_DATABASE_URL is required",
  },
  async () => {
    requireDisposableDatabase(TEST_DATABASE_URL!);
    const destination = `cover-marker-destination-${process.pid}-${Date.now()}`;
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query(
        `INSERT INTO destinations (id, name, search_name, hero_image, hero_image_attribution,
                                   hero_image_attribution_url, hero_image_source, hero_image_storage_path)
         VALUES ($1, 'Marker place', 'marker place', 'https://example.org/admin.jpg', 'Admin',
                 'https://example.org/admin', 'admin', 'destination-covers/x/admin.jpg')`,
        [destination]
      );
      await pool.query(
        `UPDATE destinations SET hero_image_focal_x = 40 WHERE id = $1`,
        [destination]
      );
      let row = (await pool.query(`SELECT hero_image_source FROM destinations WHERE id = $1`, [destination])).rows[0];
      assert.equal(row.hero_image_source, "admin", "an unrelated edit keeps the marker");
      await pool.query(
        `UPDATE destinations SET hero_image = 'https://example.org/reviewed.jpg' WHERE id = $1`,
        [destination]
      );
      row = (await pool.query(
        `SELECT hero_image_source, hero_image_storage_path FROM destinations WHERE id = $1`,
        [destination]
      )).rows[0];
      assert.equal(row.hero_image_source, null);
      assert.equal(row.hero_image_storage_path, null);
    } finally {
      await pool.query(`DELETE FROM destinations WHERE id = $1`, [destination]);
      await pool.end();
    }
  }
);
