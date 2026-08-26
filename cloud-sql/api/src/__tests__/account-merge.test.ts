import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Pool } from "pg";
import {
  replaceUserStoragePaths,
  replaceUid,
  signInProvider,
  transferSqlOwnership,
} from "../routes/account";

test("signInProvider reads the provider Firebase used for this session", () => {
  const token = {
    uid: "member",
    firebase: { sign_in_provider: "google.com", identities: {} },
  } as DecodedIdToken;
  assert.equal(signInProvider(token), "google.com");
});

test("replaceUid moves array ownership and removes self duplicates", () => {
  assert.deepEqual(
    replaceUid(["anonymous-user", "member-user"], "anonymous-user", "member-user"),
    ["member-user"]
  );
  assert.deepEqual(
    replaceUid(["anonymous-user", "friend"], "anonymous-user", "member-user"),
    ["member-user", "friend"]
  );
});

test("replaceUserStoragePaths updates literal and encoded user-scoped URLs only", () => {
  const timestampLike = new Date("2026-08-26T00:00:00Z");
  const result = replaceUserStoragePaths({
    avatar: "https://storage.test/o/profiles%2Fold-user%2Favatar?alt=media",
    report: "trip-reports/old-user/session/photo.jpg",
    biography: "old-user climbed this",
    createdAt: timestampLike,
  }, "old-user", "new-user") as Record<string, unknown>;

  assert.equal(
    result.avatar,
    "https://storage.test/o/profiles%2Fnew-user%2Favatar?alt=media"
  );
  assert.equal(result.report, "trip-reports/new-user/session/photo.jpg");
  assert.equal(result.biography, "old-user climbed this");
  assert.equal(result.createdAt, timestampLike);
});

test("transferSqlOwnership wraps every user-owned SQL table in one transaction", async () => {
  const statements: string[] = [];
  const values: unknown[][] = [];
  const client = {
    async query(text: string, params?: unknown[]) {
      statements.push(text.replace(/\s+/g, " ").trim());
      values.push(params ?? []);
      return { rowCount: text === "BEGIN" || text === "COMMIT" ? null : 1 };
    },
    release() {},
  };
  const pool = { async connect() { return client; } } as unknown as Pool;

  await transferSqlOwnership(pool, "anonymous-user", "member-user");

  assert.equal(statements[0], "BEGIN");
  assert.equal(statements.at(-1), "COMMIT");
  for (const table of [
    "plans", "plan_party", "session_groups", "session_attempt_groups",
    "tracking_sessions", "session_markers", "session_tombstones",
    "trip_reports", "trip_report_photos", "trip_report_flags",
    "trip_report_photo_deletions", "session_comparisons", "routes", "lists",
    "destinations", "areas",
  ]) {
    assert.ok(statements.some((statement) => statement.includes(table)), `missing ${table}`);
  }
  assert.ok(values.some((params) =>
    params[0] === "anonymous-user" && params[1] === "member-user"
  ));
});

test("transferSqlOwnership rolls back and releases the client on failure", async () => {
  const statements: string[] = [];
  let released = false;
  const client = {
    async query(text: string) {
      statements.push(text);
      if (text.includes("INSERT INTO plan_party")) throw new Error("database failed");
      return { rowCount: null };
    },
    release() { released = true; },
  };
  const pool = { async connect() { return client; } } as unknown as Pool;

  await assert.rejects(
    transferSqlOwnership(pool, "anonymous-user", "member-user"),
    /database failed/
  );
  assert.deepEqual(statements, ["BEGIN", statements[1], "ROLLBACK"]);
  assert.ok(statements[1].includes("INSERT INTO plan_party"));
  assert.equal(released, true);
});
