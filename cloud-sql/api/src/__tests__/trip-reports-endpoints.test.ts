import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import request from "supertest";
import db from "../db";
import { app } from "../index";
import { dbSkipReason as skipReason } from "./helpers/test-db";

const prefix = `trip-report-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const owner = `${prefix}-owner`;
const other = `${prefix}-other`;
const session = `${prefix}-session`;
const failedSession = `${prefix}-failed`;
const destination = `${prefix}-destination`;
const unrelatedDestination = `${prefix}-unrelated-destination`;
const route = `${prefix}-route`;

async function cleanup(): Promise<void> {
  await db.query("DELETE FROM trip_report_photo_deletions WHERE storage_path LIKE $1", [`trip-reports/${owner}/%`]);
  await db.query("DELETE FROM trip_reports WHERE user_id = ANY($1)", [[owner, other]]);
  await db.query("DELETE FROM tracking_sessions WHERE id = ANY($1)", [[session, failedSession]]);
  await db.query("DELETE FROM routes WHERE id = $1", [route]);
  await db.query("DELETE FROM destinations WHERE id = ANY($1)", [[destination, unrelatedDestination]]);
}

describe("Trip Report endpoints", { skip: skipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    await db.query(
      `INSERT INTO destinations (id, name, search_name)
       VALUES ($1, 'Mount Rainier', 'mount rainier'), ($2, 'Unrelated Peak', 'unrelated peak')`,
      [destination, unrelatedDestination]
    );
    await db.query(
      `INSERT INTO routes (id, name, status) VALUES ($1, 'Disappointment Cleaver', 'active')`,
      [route]
    );
    await db.query(
      `INSERT INTO tracking_sessions
         (id, user_id, name, start_time, end_time, ended, processing_state, processed_at)
       VALUES
         ($1, $2, 'Rainier climb', '2026-07-20T12:00:00Z', '2026-07-21T02:00:00Z',
          true, 'completed', '2026-07-21T02:05:00Z'),
         ($3, $2, 'Failed climb', '2026-07-22T12:00:00Z', '2026-07-22T13:00:00Z',
          true, 'failed', NULL)`,
      [session, owner, failedSession]
    );
    await db.query(
      `INSERT INTO session_destinations (session_id, destination_id, relation, source)
       VALUES ($1, $2, 'reached', 'auto')`,
      [session, destination]
    );
    await db.query(
      `INSERT INTO session_routes (session_id, route_id, source, coverage)
       VALUES ($1, $2, 'auto', 0.92)`,
      [session, route]
    );
  });

  after(cleanup);

  test("failed or incomplete activities cannot publish", async () => {
    const response = await request(app)
      .post("/api/trip-reports")
      .set("X-Test-User", owner)
      .send({ session_id: failedSession, title: "Not ready", body: "No", conditions: [], photos: [] });
    assert.equal(response.status, 409);
    assert.match(response.body.error, /not ready/i);
  });

  test("create derives destination and route links, prevents duplicates, and scopes discovery", async () => {
    const storagePath = `trip-reports/${owner}/${session}/photo-1.jpg`;
    const created = await request(app)
      .post("/api/trip-reports")
      .set("X-Test-User", owner)
      .send({
        session_id: session,
        title: "Late July on Rainier",
        body: "Firm snow above the cleaver.",
        conditions: [
          { code: "snow", severity: "serious", context: "Firm after sunrise" },
          { code: "route_finding", severity: "notable" },
        ],
        photos: [{
          id: "photo-1",
          storage_path: storagePath,
          download_url: `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(storagePath)}?alt=media`,
        }],
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.session_id, session);
    assert.deepEqual(created.body.destination_ids, [destination]);
    assert.deepEqual(created.body.route_ids, [route]);
    assert.equal(created.body.conditions.length, 2);
    assert.equal(created.body.photos.length, 1);
    assert.equal(created.body.is_owner, true);

    const duplicate = await request(app)
      .post("/api/trip-reports")
      .set("X-Test-User", owner)
      .send({ session_id: session, title: "Again", body: "Duplicate", conditions: [], photos: [] });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.id, created.body.id);

    const destinationPage = await request(app)
      .get(`/api/trip-reports?destination_id=${encodeURIComponent(destination)}&limit=1`)
      .set("X-Test-User", other);
    assert.equal(destinationPage.status, 200);
    assert.equal(destinationPage.body.reports.length, 1);
    assert.equal(destinationPage.body.reports[0].id, created.body.id);
    assert.equal(destinationPage.body.reports[0].is_owner, false);

    const unrelatedPage = await request(app)
      .get(`/api/trip-reports?destination_id=${encodeURIComponent(unrelatedDestination)}`)
      .set("X-Test-User", other);
    assert.equal(unrelatedPage.status, 200);
    assert.deepEqual(unrelatedPage.body.reports, []);

    const routePage = await request(app)
      .get(`/api/trip-reports?route_id=${encodeURIComponent(route)}`)
      .set("X-Test-User", other);
    assert.equal(routePage.status, 200);
    assert.deepEqual(routePage.body.reports.map((report: { id: string }) => report.id), [created.body.id]);
  });

  test("only the owner can edit or delete; removed photos enter the retry queue", async () => {
    const existing = await db.query("SELECT id FROM trip_reports WHERE source_session_id = $1", [session]);
    const reportId = existing.rows[0].id as string;
    const storagePath = `trip-reports/${owner}/${session}/photo-1.jpg`;

    const attackerEdit = await request(app)
      .put(`/api/trip-reports/${reportId}`)
      .set("X-Test-User", other)
      .send({ title: "Taken", body: "No", conditions: [], photos: [] });
    assert.equal(attackerEdit.status, 404);

    const ownerEdit = await request(app)
      .put(`/api/trip-reports/${reportId}`)
      .set("X-Test-User", owner)
      .send({
        title: "Updated Rainier report",
        body: "The route changed after noon.",
        conditions: [{ code: "ice", severity: "notable" }],
        photos: [],
      });
    assert.equal(ownerEdit.status, 200);
    assert.equal(ownerEdit.body.title, "Updated Rainier report");
    assert.deepEqual(ownerEdit.body.conditions.map((condition: { code: string }) => condition.code), ["ice"]);
    const queued = await db.query(
      "SELECT storage_path FROM trip_report_photo_deletions WHERE storage_path LIKE $1",
      [`trip-reports/${owner}/${session}/%`]
    );
    assert.equal(queued.rows.length, 1);

    const readded = await request(app)
      .put(`/api/trip-reports/${reportId}`)
      .set("X-Test-User", owner)
      .send({
        title: "Updated Rainier report",
        body: "The route changed after noon.",
        conditions: [],
        photos: [{
          id: "photo-1",
          storage_path: storagePath,
          download_url: `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(
            storagePath
          )}?alt=media`,
        }],
      });
    assert.equal(readded.status, 200);
    const noLongerQueued = await db.query(
      "SELECT storage_path FROM trip_report_photo_deletions WHERE storage_path LIKE $1",
      [`trip-reports/${owner}/${session}/%`]
    );
    assert.equal(noLongerQueued.rows.length, 0);

    const attackerDelete = await request(app)
      .delete(`/api/trip-reports/${reportId}`)
      .set("X-Test-User", other);
    assert.equal(attackerDelete.status, 404);

    const ownerDelete = await request(app)
      .delete(`/api/trip-reports/${reportId}`)
      .set("X-Test-User", owner);
    assert.equal(ownerDelete.status, 204);
    const removed = await db.query("SELECT id FROM trip_reports WHERE id = $1", [reportId]);
    assert.equal(removed.rows.length, 0);
  });
});
