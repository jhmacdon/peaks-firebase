import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Pool, type PoolClient } from "pg";

const TEST_DATABASE_URL = process.env.PHOTO_CANDIDATE_TEST_DATABASE_URL;
const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../migrations/20260830_destination_photo_candidate_identity.sql"
);

async function setSearchPath(client: PoolClient, schema: string): Promise<void> {
  await client.query(`SET search_path TO "${schema}"`);
}

test(
  "photo identity migration guards the automated writer in both insert orders",
  {
    skip: TEST_DATABASE_URL
      ? false
      : "PHOTO_CANDIDATE_TEST_DATABASE_URL not set",
  },
  async () => {
    const databaseUrl = new URL(TEST_DATABASE_URL!);
    assert.match(databaseUrl.pathname, /_test$/);

    const schema = `listed_photo_${process.pid}_${Date.now()}`;
    const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    const setup = await pool.connect();
    try {
      await setup.query(`CREATE SCHEMA "${schema}"`);
      await setSearchPath(setup, schema);
      await setup.query(`
        CREATE TABLE destinations (
          id TEXT PRIMARY KEY
        );
        CREATE TABLE destination_photo_candidates (
          id TEXT PRIMARY KEY,
          destination_id TEXT NOT NULL REFERENCES destinations(id),
          source_page_url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'approved', 'denied')),
          UNIQUE (destination_id, source_page_url)
        );
      `);
      await setup.query(await readFile(MIGRATION_PATH, "utf8"));

      await setup.query(
        "INSERT INTO destinations (id) VALUES ('manual-first'), ('automated-first'), ('sha')"
      );

      const firstWriter = await pool.connect();
      const secondWriter = await pool.connect();
      try {
        await setSearchPath(firstWriter, schema);
        await setSearchPath(secondWriter, schema);

        await firstWriter.query("BEGIN");
        await firstWriter.query(
          "SELECT 1 FROM destinations WHERE id = 'manual-first' FOR UPDATE"
        );
        const automatedAfterManual = secondWriter.query(`
          INSERT INTO destination_photo_candidates (
            id, destination_id, source_page_url, candidate_origin
          ) VALUES (
            'auto-after-manual', 'manual-first', 'https://example.com/auto-after-manual',
            'listed_photo_backfill'
          )
          RETURNING id
        `);
        await firstWriter.query(`
          INSERT INTO destination_photo_candidates (
            id, destination_id, source_page_url, candidate_origin
          ) VALUES (
            'manual-first-row', 'manual-first', 'https://example.com/manual-first', 'manual'
          )
        `);
        await firstWriter.query("COMMIT");
        assert.equal((await automatedAfterManual).rowCount, 0);

        await firstWriter.query("BEGIN");
        await firstWriter.query(
          "SELECT 1 FROM destinations WHERE id = 'automated-first' FOR UPDATE"
        );
        await firstWriter.query(`
          INSERT INTO destination_photo_candidates (
            id, destination_id, source_page_url, candidate_origin
          ) VALUES (
            'auto-first-row', 'automated-first', 'https://example.com/auto-first',
            'listed_photo_backfill'
          )
        `);
        const manualAfterAutomated = secondWriter.query(`
          INSERT INTO destination_photo_candidates (
            id, destination_id, source_page_url, candidate_origin
          ) VALUES (
            'manual-after-auto', 'automated-first', 'https://example.com/manual-after-auto',
            'manual'
          )
          RETURNING id
        `);
        await firstWriter.query("COMMIT");
        assert.equal((await manualAfterAutomated).rowCount, 1);

        const secondAutomated = await secondWriter.query(`
          INSERT INTO destination_photo_candidates (
            id, destination_id, source_page_url, candidate_origin
          ) VALUES (
            'second-auto', 'automated-first', 'https://example.com/second-auto',
            'listed_photo_backfill'
          )
          RETURNING id
        `);
        assert.equal(secondAutomated.rowCount, 0);
      } finally {
        await firstWriter.query("ROLLBACK").catch(() => undefined);
        await secondWriter.query("ROLLBACK").catch(() => undefined);
        firstWriter.release();
        secondWriter.release();
      }

      await setup.query(`
        INSERT INTO destination_photo_candidates (
          id, destination_id, source_page_url, candidate_origin, media_sha1, status
        ) VALUES (
          'sha-first', 'sha', 'https://example.com/sha-first', 'manual',
          '7a1f2627e0f702e514290f1c06aa76e838dd845f', 'denied'
        )
      `);
      await assert.rejects(
        setup.query(`
          INSERT INTO destination_photo_candidates (
            id, destination_id, source_page_url, candidate_origin, media_sha1, status
          ) VALUES (
            'sha-alias', 'sha', 'https://example.com/sha-alias', 'manual',
            '7a1f2627e0f702e514290f1c06aa76e838dd845f', 'denied'
          )
        `),
        /uq_destination_photo_candidates_media_sha1/
      );
      await assert.rejects(
        setup.query(`
          INSERT INTO destination_photo_candidates (
            id, destination_id, source_page_url, candidate_origin, media_sha1, status
          ) VALUES (
            'bad-sha', 'sha', 'https://example.com/bad-sha', 'manual',
            '0123456789abcdefghijklmnopqrstu', 'denied'
          )
        `),
        /destination_photo_candidates_media_sha1_format/
      );
    } finally {
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      setup.release();
      await pool.end();
    }
  }
);
