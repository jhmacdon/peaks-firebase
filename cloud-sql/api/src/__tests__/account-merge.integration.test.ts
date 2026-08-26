import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import db from "../db";
import { transferSqlOwnership } from "../routes/account";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const prefix = `account-merge-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const oldUid = `${prefix}-anonymous`;
const newUid = `${prefix}-member`;
const planId = `${prefix}-plan`;
const sessionId = `${prefix}-session`;
const sessionGroupId = `${prefix}-group`;
const attemptGroupId = `${prefix}-attempt-group`;
const reportId = `${prefix}-report`;
const destinationId = `${prefix}-destination`;
const routeId = `${prefix}-route`;
const listId = `${prefix}-list`;
const oldPhotoPath = `trip-reports/${oldUid}/${sessionId}/photo.jpg`;
const newPhotoPath = `trip-reports/${newUid}/${sessionId}/photo.jpg`;

async function cleanup(): Promise<void> {
  await db.query(
    "DELETE FROM trip_report_photo_deletions WHERE storage_path = ANY($1::text[])",
    [[oldPhotoPath, newPhotoPath]]
  );
  await db.query("DELETE FROM trip_reports WHERE id = $1", [reportId]);
  await db.query("DELETE FROM session_tombstones WHERE session_id = $1", [sessionId]);
  await db.query("DELETE FROM tracking_sessions WHERE id = $1", [sessionId]);
  await db.query("DELETE FROM session_groups WHERE id = $1", [sessionGroupId]);
  await db.query("DELETE FROM session_attempt_groups WHERE id = $1", [attemptGroupId]);
  await db.query("DELETE FROM plans WHERE id = $1", [planId]);
  await db.query("DELETE FROM routes WHERE id = $1", [routeId]);
  await db.query("DELETE FROM lists WHERE id = $1", [listId]);
  await db.query("DELETE FROM destinations WHERE id = $1", [destinationId]);
}

describe("account merge SQL", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    await db.query("INSERT INTO destinations (id, name, owner) VALUES ($1, 'Merge Peak', $2)", [
      destinationId, oldUid,
    ]);
    await db.query("INSERT INTO routes (id, name, owner) VALUES ($1, 'Merge Route', $2)", [
      routeId, oldUid,
    ]);
    await db.query("INSERT INTO lists (id, name, owner) VALUES ($1, 'Merge List', $2)", [
      listId, oldUid,
    ]);
    await db.query("INSERT INTO plans (id, user_id, name) VALUES ($1, $2, 'Merge Plan')", [
      planId, oldUid,
    ]);
    await db.query(
      "INSERT INTO plan_party (plan_id, user_id) VALUES ($1, $2), ($1, $3)",
      [planId, oldUid, newUid]
    );
    await db.query("INSERT INTO session_groups (id, user_id) VALUES ($1, $2)", [
      sessionGroupId, oldUid,
    ]);
    await db.query("INSERT INTO session_attempt_groups (id, user_id) VALUES ($1, $2)", [
      attemptGroupId, oldUid,
    ]);
    await db.query(
      `INSERT INTO tracking_sessions
        (id, user_id, start_time, group_id, attempt_group_id)
       VALUES ($1, $2, now(), $3, $4)`,
      [sessionId, oldUid, sessionGroupId, attemptGroupId]
    );
    await db.query(
      "INSERT INTO session_markers (session_id, name, created_by) VALUES ($1, 'Camp', $2)",
      [sessionId, oldUid]
    );
    await db.query(
      `INSERT INTO session_tombstones (session_id, user_id, deleted_at, server_updated_at)
       VALUES ($1, $2, now() - interval '1 day', now() - interval '1 day'),
              ($1, $3, now(), now())`,
      [sessionId, oldUid, newUid]
    );
    await db.query(
      `INSERT INTO trip_reports
        (id, source_session_id, user_id, title, activity_date)
       VALUES ($1, $2, $3, 'Merge Report', now())`,
      [reportId, sessionId, oldUid]
    );
    await db.query(
      `INSERT INTO trip_report_photos (id, report_id, storage_path, download_url)
       VALUES ('photo', $1, $2, $3)`,
      [
        reportId,
        oldPhotoPath,
        `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(oldPhotoPath)}?alt=media`,
      ]
    );
    await db.query(
      "INSERT INTO trip_report_flags (report_id, user_id, reason) VALUES ($1, $2, 'old'), ($1, $3, 'new')",
      [reportId, oldUid, newUid]
    );
    await db.query(
      "INSERT INTO trip_report_photo_deletions (storage_path) VALUES ($1)",
      [oldPhotoPath]
    );
  });

  after(cleanup);

  test("moves owned rows, resolves join conflicts, and rewrites photo paths", async () => {
    await transferSqlOwnership(db, oldUid, newUid);

    for (const [table, column, idColumn, id] of [
      ["plans", "user_id", "id", planId],
      ["session_groups", "user_id", "id", sessionGroupId],
      ["session_attempt_groups", "user_id", "id", attemptGroupId],
      ["tracking_sessions", "user_id", "id", sessionId],
      ["trip_reports", "user_id", "id", reportId],
      ["routes", "owner", "id", routeId],
      ["lists", "owner", "id", listId],
      ["destinations", "owner", "id", destinationId],
    ]) {
      const result = await db.query(
        `SELECT ${column} AS owner FROM ${table} WHERE ${idColumn} = $1`,
        [id]
      );
      assert.equal(result.rows[0].owner, newUid, `${table} owner`);
    }

    const party = await db.query("SELECT user_id FROM plan_party WHERE plan_id = $1", [planId]);
    assert.deepEqual(party.rows.map((row) => row.user_id), [newUid]);

    const flags = await db.query("SELECT user_id FROM trip_report_flags WHERE report_id = $1", [reportId]);
    assert.deepEqual(flags.rows.map((row) => row.user_id), [newUid]);

    const tombstones = await db.query(
      "SELECT user_id FROM session_tombstones WHERE session_id = $1",
      [sessionId]
    );
    assert.deepEqual(tombstones.rows.map((row) => row.user_id), [newUid]);

    const marker = await db.query("SELECT created_by FROM session_markers WHERE session_id = $1", [sessionId]);
    assert.equal(marker.rows[0].created_by, newUid);

    const photo = await db.query(
      "SELECT storage_path, download_url FROM trip_report_photos WHERE report_id = $1",
      [reportId]
    );
    assert.equal(photo.rows[0].storage_path, newPhotoPath);
    assert.match(photo.rows[0].download_url, new RegExp(encodeURIComponent(newPhotoPath)));

    const deletion = await db.query(
      "SELECT storage_path FROM trip_report_photo_deletions WHERE storage_path = $1",
      [newPhotoPath]
    );
    assert.equal(deletion.rowCount, 1);
  });
});
