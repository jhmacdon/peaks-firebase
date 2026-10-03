import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";
import admin from "firebase-admin";
import { app } from "../index";
import db from "../db";
import { AccountFirestore, AccountStorage } from "./helpers/account-services";
import { appRequest } from "./helpers/app-request";
import { dbSkipReason } from "./helpers/test-db";

const prefix = `delete-account-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const id = (suffix: string) => `${prefix}-${suffix}`;
const uid = id("user_");
const other = id("other");
const ownPhoto = `trip-reports/${uid}/session/photo.jpg`;
const otherPhoto = `trip-reports/${uid.replace(/_$/, "x")}/session/photo.jpg`;
const firestore = new AccountFirestore();
const storage = new AccountStorage();
const authUsers = new Set([uid,other]);
const referenceKinds = ["session", "plan", "report"] as const;

async function cleanup() {
  await db.query("DELETE FROM trip_report_photo_deletions WHERE storage_path = ANY($1::text[])", [[ownPhoto,otherPhoto]]);
  await db.query("UPDATE areas SET parent_area_id = NULL WHERE id = ANY($1::text[])", [[id("own-area"),id("other-area")]]);
  for (const [table,column] of [
    ["trip_reports","user_id"],["tracking_sessions","user_id"],["session_groups","user_id"],
    ["session_attempt_groups","user_id"],["session_tombstones","user_id"],["plans","user_id"],
    ["routes","owner"],["lists","owner"],["destinations","owner"],["areas","owner"],
  ]) await db.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::text[])`, [[uid,other]]);
  for (const table of ["routes", "destinations"]) {
    const kind = table === "routes" ? "route" : "destination";
    await db.query(`DELETE FROM ${table} WHERE id = ANY($1::text[])`, [referenceKinds.map((parent) => id(`${parent}-${kind}`))]);
  }
  await db.query("DELETE FROM segments WHERE id = ANY($1::text[])", [[id("segment"),id("shared-segment"),id("retained-segment")]]);
}

describe("DELETE /api/account across SQL and mocked Firebase services", { skip: dbSkipReason ?? undefined }, () => {
  before(async () => {
    await cleanup();
    for (const [suffix,owner] of [["own",uid],["other",other]]) {
      await db.query("INSERT INTO plans (id,user_id,name) VALUES ($1,$2,$1)", [id(`${suffix}-plan`),owner]);
      await db.query("INSERT INTO session_groups (id,user_id) VALUES ($1,$2)", [id(`${suffix}-group`),owner]);
      await db.query("INSERT INTO session_attempt_groups (id,user_id) VALUES ($1,$2)", [id(`${suffix}-attempt`),owner]);
      await db.query(`INSERT INTO tracking_sessions (id,user_id,start_time,group_id,attempt_group_id)
        VALUES ($1,$2,now(),$3,$4)`, [id(`${suffix}-session`),owner,id(`${suffix}-group`),id(`${suffix}-attempt`)]);
      await db.query("INSERT INTO tracking_points (session_id,time) VALUES ($1,100)", [id(`${suffix}-session`)]);
      await db.query("INSERT INTO session_tombstones (session_id,user_id) VALUES ($1,$2)", [id(`${suffix}-deleted-session`),owner]);
      await db.query("INSERT INTO routes (id,name,owner) VALUES ($1,$1,$2)", [id(`${suffix}-route`),owner]);
      await db.query("INSERT INTO lists (id,name,owner) VALUES ($1,$1,$2)", [id(`${suffix}-list`),owner]);
      await db.query("INSERT INTO destinations (id,name,search_name,owner) VALUES ($1,$1,$1,$2)", [id(`${suffix}-destination`),owner]);
      await db.query(`INSERT INTO areas
        (id,name,search_name,kind,owner,source,source_id,source_version,boundary,centroid,
         bbox_min_lat,bbox_max_lat,bbox_min_lng,bbox_max_lng)
        VALUES ($1,$1,$1,'wilderness',$2,'test',$1,'test',
          ST_Multi(ST_MakeEnvelope(-122.1,46.9,-121.9,47.1,4326)),ST_SetSRID(ST_MakePoint(-122,47),4326),
          46.9,47.1,-122.1,-121.9)`, [id(`${suffix}-area`),owner]);
      await db.query("INSERT INTO list_destinations (list_id,destination_id) VALUES ($1,$2)", [id(`${suffix}-list`),id(`${suffix}-destination`)]);
      await db.query("INSERT INTO session_destinations (session_id,destination_id,relation) VALUES ($1,$2,'reached')", [id(`${suffix}-session`),id(`${suffix}-destination`)]);
      await db.query("INSERT INTO plan_destinations (plan_id,destination_id) VALUES ($1,$2)", [id(`${suffix}-plan`),id(`${suffix}-destination`)]);
      await db.query("INSERT INTO plan_routes (plan_id,route_id) VALUES ($1,$2)", [id(`${suffix}-plan`),id(`${suffix}-route`)]);
      await db.query(`INSERT INTO trip_reports (id,user_id,source_session_id,title,activity_date)
        VALUES ($1,$2,$3,$1,now())`, [id(`${suffix}-report`),owner,id(`${suffix}-session`)]);
      await db.query("INSERT INTO trip_report_conditions (report_id,code) VALUES ($1,'snow')", [id(`${suffix}-report`)]);
      await db.query(`INSERT INTO trip_report_photos (id,report_id,storage_path,download_url)
        VALUES ($1,$2,$3,'https://example.test/photo')`, [id(`${suffix}-photo`),id(`${suffix}-report`),suffix === "own" ? ownPhoto : otherPhoto]);
    }
    // Each row has only one kind of external reference, so omitting any of
    // the six preservation checks loses a link and fails this fixture.
    for (const kind of referenceKinds) {
      const destination = id(`${kind}-destination`);
      const route = id(`${kind}-route`);
      await db.query("INSERT INTO destinations (id,name,search_name,owner) VALUES ($1,$1,$1,$2)", [destination,uid]);
      await db.query("INSERT INTO routes (id,name,owner) VALUES ($1,$1,$2)", [route,uid]);
      if (kind === "session") {
        await db.query("INSERT INTO session_destinations (session_id,destination_id,relation) VALUES ($1,$2,'reached')", [id("other-session"),destination]);
        await db.query("INSERT INTO session_routes (session_id,route_id) VALUES ($1,$2)", [id("other-session"),route]);
      } else if (kind === "plan") {
        await db.query("INSERT INTO plan_destinations (plan_id,destination_id) VALUES ($1,$2)", [id("other-plan"),destination]);
        await db.query("INSERT INTO plan_routes (plan_id,route_id) VALUES ($1,$2)", [id("other-plan"),route]);
      } else {
        await db.query("INSERT INTO trip_report_destinations (report_id,destination_id) VALUES ($1,$2)", [id("other-report"),destination]);
        await db.query("INSERT INTO trip_report_routes (report_id,route_id) VALUES ($1,$2)", [id("other-report"),route]);
      }
    }
    await db.query("UPDATE areas SET parent_area_id = $1 WHERE id = $2", [id("own-area"),id("other-area")]);
    await db.query("INSERT INTO session_markers (id,session_id,created_by) VALUES ($1,$3,$4),($2,$3,$5)", [id("own-marker"),id("other-marker"),id("other-session"),uid,other]);
    await db.query("INSERT INTO plan_party (plan_id,user_id) VALUES ($1,$2),($1,$3)", [id("other-plan"),uid,other]);
    await db.query("INSERT INTO trip_report_flags (report_id,user_id,reason) VALUES ($1,$2,'flag'),($1,$3,'flag')", [id("other-report"),uid,other]);
    await db.query("INSERT INTO trip_report_photo_deletions (storage_path) VALUES ($1),($2)", [ownPhoto,otherPhoto]);
    await db.query("INSERT INTO segments (id) VALUES ($1),($2),($3)", [id("segment"),id("shared-segment"),id("retained-segment")]);
    await db.query("INSERT INTO route_segments (route_id,segment_id,ordinal) VALUES ($1,$3,0),($1,$4,1),($2,$4,0)", [id("own-route"),id("other-route"),id("segment"),id("shared-segment")]);
    await db.query("INSERT INTO route_segments (route_id,segment_id,ordinal) VALUES ($1,$3,0),($2,$3,2)", [id("session-route"),id("own-route"),id("retained-segment")]);
    await db.query(`INSERT INTO session_comparisons
      (user_id,session_a,session_b,scope,overlap_m,a_frac,b_frac,a_enter_ms,a_exit_ms,b_enter_ms,b_exit_ms,
       a_start_m,a_end_m,b_start_m,b_end_m,a_out_and_back,b_out_and_back,a_elapsed_s,b_elapsed_s,matcher_version,legs_version)
      VALUES ($1,$2,$3,'full',100,1,1,0,1000,0,1000,0,100,0,100,false,false,1,1,1,1)`, [uid,id("own-session"),id("other-session")]);

    firestore.documents.set(`users/${uid}`, { strava: { access_token: "fixture-token" } });
    firestore.documents.set(`users/${uid}/savedPlaces/one`, { name: "saved" });
    firestore.documents.set("sessions/own", { userId: uid });
    firestore.documents.set("sessions/own/points/one", { time: 100 });
    firestore.documents.set("plans/shared", { userId: other, party: [uid,other] });
    firestore.documents.set("friends/shared", { users: [uid,other] });
    firestore.documents.set("friendRequests/shared", { users: [uid,other], requestedBy: other });
    firestore.documents.set("friends/other", { users: [other,"third-user"] });
    firestore.documents.set("codes/own", { userId: uid, reason: "strava" });
    firestore.documents.set("codes/other", { userId: other, reason: "strava" });
    storage.files.add(ownPhoto);
    storage.files.add(`profiles/${uid}/avatar.jpg`);
    storage.files.add(otherPhoto);
    mock.getter(admin,"firestore",() => () => firestore.asFirestore());
    mock.getter(admin,"storage",() => () => storage);
    mock.method(globalThis,"fetch",async () => new Response(null,{ status: 200 }));
    mock.method(admin.auth(),"deleteUser",async (user: string) => {
      assert.equal(user, uid, "the retained SQL owner is never an Auth user");
      assert.equal([...firestore.documents.keys()].some((path) => path.startsWith(`users/${uid}`) || path.startsWith("sessions/own")),false);
      assert.equal(storage.files.has(ownPhoto),false);
      assert.equal((await db.query("SELECT id FROM tracking_sessions WHERE user_id=$1",[uid])).rowCount,0);
      if (!authUsers.delete(user)) throw Object.assign(new Error("missing"),{ code: "auth/user-not-found" });
    });
  });
  after(async () => { mock.restoreAll(); await cleanup(); });

  test("deletes every ownership table, retains shared data, and resumes after SQL committed", async () => {
    storage.failDelete = true;
    assert.equal((await appRequest(app,"DELETE","/api/account",{ "X-Test-User": uid })).status,500);
    assert.equal(authUsers.has(uid),true);
    assert.ok(firestore.documents.has(`users/${uid}`));
    const response = await appRequest(app,"DELETE","/api/account",{ "X-Test-User": uid });
    assert.equal(response.status,200);
    assert.deepEqual(response.body,{ status: "deleted" });
    for (const [table,column] of [
      ["plans","user_id"],["plan_party","user_id"],["session_groups","user_id"],
      ["session_attempt_groups","user_id"],["tracking_sessions","user_id"],["session_tombstones","user_id"],
      ["trip_reports","user_id"],["trip_report_flags","user_id"],["session_comparisons","user_id"],
      ["session_markers","created_by"],["routes","owner"],["lists","owner"],["destinations","owner"],["areas","owner"],
    ]) assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`,[uid])).rowCount,0,table);
    for (const [table,column,value] of [
      ["tracking_points","session_id",id("own-session")],["trip_report_photos","report_id",id("own-report")],
      ["trip_report_conditions","report_id",id("own-report")],["trip_report_photo_deletions","storage_path",ownPhoto],
      ["segments","id",id("segment")],
      ["routes","id",id("own-route")],["destinations","id",id("own-destination")],["areas","id",id("own-area")],
    ]) assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`,[value])).rowCount,0,table);
    for (const [table,column,value] of [
      ["plans","id",id("other-plan")],["tracking_sessions","id",id("other-session")],
      ["tracking_points","session_id",id("other-session")],["trip_reports","id",id("other-report")],
      ["trip_report_photos","report_id",id("other-report")],["trip_report_photo_deletions","storage_path",otherPhoto],
      ["session_markers","id",id("other-marker")],["segments","id",id("shared-segment")],
      ["segments","id",id("retained-segment")],
    ]) assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`,[value])).rowCount,1,table);
    assert.deepEqual((await db.query("SELECT user_id FROM plan_party WHERE plan_id=$1",[id("other-plan")])).rows,[{ user_id: other }]);
    assert.deepEqual((await db.query("SELECT user_id FROM trip_report_flags WHERE report_id=$1",[id("other-report")])).rows,[{ user_id: other }]);
    assert.deepEqual(firestore.documents.get("plans/shared"),{ userId: other, party: [other] });
    assert.equal(firestore.documents.has("friends/shared"),false);
    assert.equal(firestore.documents.has("friendRequests/shared"),false);
    assert.deepEqual(firestore.documents.get("friends/other"),{ users: [other,"third-user"] });
    assert.equal(firestore.documents.has("codes/own"),false);
    assert.deepEqual(firestore.documents.get("codes/other"),{ userId: other, reason: "strava" });
    assert.deepEqual((await db.query("SELECT parent_area_id FROM areas WHERE id=$1",[id("other-area")])).rows,[{ parent_area_id: null }]);
    for (const [joinTable, parentColumn, kind, entity] of [
      ["session_destinations","session_id","session","destination"],
      ["session_routes","session_id","session","route"],
      ["plan_destinations","plan_id","plan","destination"],
      ["plan_routes","plan_id","plan","route"],
      ["trip_report_destinations","report_id","report","destination"],
      ["trip_report_routes","report_id","report","route"],
    ]) {
      const retainedId = id(`${kind}-${entity}`);
      const result = await db.query(`SELECT retained.owner FROM ${joinTable} link
        JOIN ${entity}s retained ON retained.id = link.${entity}_id
        WHERE link.${parentColumn} = $1 AND retained.id = $2`, [id(`other-${kind}`),retainedId]);
      assert.deepEqual(result.rows,[{ owner: "deleted-user" }],joinTable);
      assert.equal((await appRequest(app,"GET",`/api/${entity}s/${retainedId}`)).status,404,"retained rows stay private");
    }
    assert.equal((await db.query("SELECT 1 FROM route_segments WHERE route_id=$1 AND segment_id=$2",[id("session-route"),id("retained-segment")])).rowCount,1);
    assert.deepEqual([...storage.files],[otherPhoto]);
    assert.equal(authUsers.has(uid),false);
    assert.equal(authUsers.has(other),true);
    assert.deepEqual((await appRequest(app,"DELETE","/api/account",{ "X-Test-User": uid })).body,{ status: "deleted" });
    for (const table of ["routes", "destinations"]) {
      const kind = table === "routes" ? "route" : "destination";
      assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE id = ANY($1::text[]) AND owner = 'deleted-user'`,
        [referenceKinds.map((parent) => id(`${parent}-${kind}`))])).rowCount,3);
    }
  });
});
