import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";
import db from "../db";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const migration = readFileSync(
  resolve(__dirname, "../../../migrations/20260825_session_route_covered_intervals.sql"),
  "utf8"
);

test("the migration adds covered_intervals without rewriting session_routes", () => {
  assert.match(migration, /ALTER TABLE session_routes/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS covered_intervals JSONB/);
  // A NOT NULL or a DEFAULT would rewrite every row on a db-f1-micro.
  assert.doesNotMatch(migration, /covered_intervals JSONB[^;]*NOT NULL/);
  assert.doesNotMatch(migration, /covered_intervals JSONB[^;]*DEFAULT/);
  // Nothing here drops or rewrites the existing coverage column.
  assert.doesNotMatch(migration, /DROP COLUMN/);
  assert.doesNotMatch(migration, /UPDATE session_routes/);
});

test("schema.sql carries the same column so provisioning matches production", () => {
  const schema = readFileSync(resolve(__dirname, "../../../schema.sql"), "utf8");
  const table = schema.slice(
    schema.indexOf("CREATE TABLE session_routes"),
    schema.indexOf("CREATE TABLE trip_reports")
  );
  assert.match(table, /covered_intervals\s+JSONB/);
});

describe("session_routes.covered_intervals", { skip: skipReason ?? undefined }, () => {
  test("exists as a nullable jsonb column", async () => {
    const result = await db.query(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'session_routes' AND column_name = 'covered_intervals'`
    );
    assert.equal(result.rows.length, 1, "covered_intervals column is missing");
    assert.equal(result.rows[0].data_type, "jsonb");
    assert.equal(result.rows[0].is_nullable, "YES");
  });
});
