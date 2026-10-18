import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import admin from "firebase-admin";
import { app } from "../index";
import db from "../db";
import { deleteSqlOwnership } from "../routes/account";
import { AccountFirestore, AccountStorage } from "./helpers/account-services";
import { appRequest } from "./helpers/app-request";

const uid = "account-owner";
const other = "other-user";
afterEach(() => mock.restoreAll());

function services() {
  const firestore = new AccountFirestore();
  const storage = new AccountStorage();
  const users = new Set([uid, other, "guest"]);
  const sql: string[] = [];
  mock.getter(admin, "firestore", () => () => firestore.asFirestore());
  mock.getter(admin, "storage", () => () => storage);
  const deleteUser = mock.method(admin.auth(), "deleteUser", async (id: string) => {
    if (!users.delete(id)) throw Object.assign(new Error("missing"), { code: "auth/user-not-found" });
  });
  mock.method(db, "connect", async () => ({
    query: async (text: string) => { sql.push(text); return { rows: [], rowCount: 1 }; }, release() {},
  }));
  const deauthorize = mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));
  mock.method(console, "error", () => undefined);
  mock.method(console, "warn", () => undefined);
  return { firestore, storage, users, sql, deleteUser, deauthorize };
}

function seed(firestore: AccountFirestore, storage: AccountStorage) {
  for (const [name, field] of [
    ["sessions", "userId"], ["plans", "userId"], ["routes", "owner"], ["lists", "owner"],
    ["destinations", "owner"], ["invites", "userId"], ["tripReports", "userId"], ["feedback", "userId"],
    ["codes", "userId"],
  ]) {
    firestore.documents.set(`${name}/owned`, { [field]: uid });
    firestore.documents.set(`${name}/owned/children/nested`, { private: true });
    firestore.documents.set(`${name}/other`, { [field]: other });
  }
  firestore.documents.set("plans/other", { userId: other, party: [uid, other], name: "Keep this plan" });
  firestore.documents.set("codes/owned", { userId: uid, reason: "strava" });
  firestore.documents.set("friends/shared", { users: [other, uid] });
  firestore.documents.set("friendRequests/shared", { users: [uid, other], requestedBy: uid, status: "pending" });
  firestore.documents.set("friendRequests/incoming", { users: [other, uid], requestedBy: other, status: "pending" });
  firestore.documents.set("friends/other", { users: [other, "third-user"] });
  firestore.documents.set("friendRequests/other", { users: [other, "third-user"], requestedBy: other });
  firestore.documents.set(`users/${uid}`, { strava: { access_token: "test-strava-token" } });
  firestore.documents.set(`users/${uid}/savedDestinations/peak`, { name: "saved" });
  firestore.documents.set(`users/${uid}/savedPlaces/place/children/nested`, { name: "orphan child" });
  firestore.documents.set(`users/${other}`, { name: "Keep this user" });
  for (const root of ["trip-reports", "profiles"]) {
    storage.files.add(`${root}/${uid}/photo.jpg`);
    storage.files.add(`${root}/${uid}-suffix/photo.jpg`);
    storage.files.add(`${root}/${other}/photo.jpg`);
  }
}

function assertDeleted(firestore: AccountFirestore, storage: AccountStorage) {
  assert.equal([...firestore.documents.keys()].some((path) => path.includes("/owned") || path.startsWith(`users/${uid}`)), false);
  assert.deepEqual(firestore.documents.get("plans/other"), { userId: other, party: [other], name: "Keep this plan" });
  assert.equal(firestore.documents.has("friends/shared"), false);
  assert.equal(firestore.documents.has("friendRequests/shared"), false);
  assert.equal(firestore.documents.has("friendRequests/incoming"), false);
  assert.deepEqual(firestore.documents.get("friends/other"), { users: [other, "third-user"] });
  assert.deepEqual(firestore.documents.get("friendRequests/other"), { users: [other, "third-user"], requestedBy: other });
  assert.equal(firestore.documents.has("codes/owned"), false);
  assert.deepEqual(firestore.documents.get("codes/other"), { userId: other });
  assert.ok(firestore.documents.has(`users/${other}`));
  assert.equal(storage.files.size, 4);
  assert.equal([...storage.files].some((path) => path.includes(`/${uid}/`)), false);
}

test("DELETE account removes docs, descendants, objects and shared references before Auth; retry is idempotent", async () => {
  const { firestore, storage, users, sql, deleteUser, deauthorize } = services();
  seed(firestore, storage);
  deleteUser.mock.mockImplementation(async (id: string) => {
    assertDeleted(firestore, storage);
    assert.ok(sql.includes("COMMIT"));
    users.delete(id);
  });
  const response = await appRequest(app, "DELETE", "/api/account", { "X-Test-User": uid });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "deleted" });
  assert.equal(users.has(uid), false);
  assert.equal(users.has(other), true);
  assertDeleted(firestore, storage);
  assert.equal(deauthorize.mock.callCount(), 1);
  const call = deauthorize.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(call[0], "https://www.strava.com/oauth/deauthorize");
  assert.equal(call[1].method, "POST");
  assert.equal(String(call[1].body), "access_token=test-strava-token");
  assert.ok(call[1].signal);
  assert.equal(firestore.documents.get(`_accountDeletions/${uid}`)?.status, "complete");
  const statements = sql.length;
  assert.deepEqual((await appRequest(app, "DELETE", "/api/account", { "X-Test-User": uid })).body, { status: "deleted" });
  assert.equal(sql.length, statements);
  assert.equal(deleteUser.mock.callCount(), 1);
});

for (const failure of ["storage", "firestore", "auth", "claim-after-auth"]) {
  test(`DELETE resumes after ${failure} fails, including an already-missing Auth user`, async () => {
    const { firestore, storage, users, deleteUser } = services();
    seed(firestore, storage);
    if (failure === "storage") storage.failDelete = true;
    if (failure === "firestore") firestore.failDelete = true;
    if (failure === "auth") deleteUser.mock.mockImplementationOnce(async () => { throw new Error("Auth unavailable"); });
    if (failure === "claim-after-auth") {
      // DeleteUser succeeded but the completion write was lost. The next
      // attempt must tolerate user-not-found and finish the claim.
      deleteUser.mock.mockImplementationOnce(async () => { users.delete(uid); throw new Error("lost response"); });
    }
    const first = await appRequest(app, "DELETE", "/api/account", { "X-Test-User": uid });
    assert.equal(first.status, 500);
    assert.equal(firestore.documents.get(`_accountDeletions/${uid}`)?.status, "failed");
    if (failure !== "claim-after-auth") assert.equal(users.has(uid), true);
    assert.deepEqual((await appRequest(app, "DELETE", "/api/account", { "X-Test-User": uid })).body, { status: "deleted" });
    assertDeleted(firestore, storage);
    assert.equal(users.has(uid), false);
  });
}

test("a failed recursive deletion leaves its owner discoverable until all descendants are removed", async () => {
  const { firestore, storage, users } = services();
  seed(firestore, storage);
  firestore.documents.set("sessions/owned/children/nested/deeper/record", { private: true });
  firestore.failAfterChildDelete = true;
  assert.equal((await appRequest(app, "DELETE", "/api/account", { "X-Test-User": uid })).status, 500);
  assert.equal(firestore.documents.get("sessions/owned")?.userId, uid);
  assert.ok(firestore.documents.has("sessions/owned/children/nested/deeper/record"));
  assert.equal(users.has(uid), true);
  assert.equal((await appRequest(app, "DELETE", "/api/account", { "X-Test-User": uid })).status, 200);
  assertDeleted(firestore, storage);
});

test("DELETE keeps going when Strava refuses deauthorization", async () => {
  const { firestore, storage, deauthorize } = services();
  seed(firestore, storage);
  deauthorize.mock.mockImplementation(async () => new Response(null, { status: 401 }));
  assert.equal((await appRequest(app, "DELETE", "/api/account", { "X-Test-User": uid })).status, 200);
  assertDeleted(firestore, storage);
});

test("DELETE skips Strava without a token and respects active and expired deletion claims", async () => {
  const { firestore, deauthorize, sql } = services();
  firestore.documents.set(`_accountDeletions/${uid}`, { status: "processing", leaseUntil: Date.now() + 60_000 });
  const busy = await appRequest(app, "DELETE", "/api/account", { "X-Test-User": uid });
  assert.equal(busy.status, 409);
  assert.ok(busy.headers["retry-after"]);
  assert.equal(sql.length, 0);
  firestore.documents.get(`_accountDeletions/${uid}`)!.leaseUntil = 0;
  assert.equal((await appRequest(app, "DELETE", "/api/account", { "X-Test-User": uid })).status, 200);
  assert.equal(deauthorize.mock.callCount(), 0);
});

test("SQL deletion rolls back on failure and releases its connection", async () => {
  const statements: string[] = [];
  let released = false;
  const client = {
    query: async (text: string) => {
      statements.push(text);
      if (text.startsWith("DELETE")) throw new Error("query failed");
      return { rowCount: 0 };
    }, release: () => { released = true; },
  };
  await assert.rejects(deleteSqlOwnership({ connect: async () => client } as any, uid), /query failed/);
  assert.equal(statements[0], "BEGIN");
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(released, true);
});

test("merge deletes the anonymous Auth user and accepts a completed-claim retry after deletion", async () => {
  const { firestore, storage, users, sql, deleteUser } = services();
  firestore.documents.set("users/guest", { name: "Guest" });
  firestore.documents.set("sessions/guest-session", { userId: "guest" });
  storage.files.add("profiles/guest/avatar.jpg");
  const verify = mock.method(admin.auth(), "verifyIdToken", async (_token: string, checkRevoked?: boolean) => {
    if (checkRevoked && !users.has("guest")) throw Object.assign(new Error("missing"), { code: "auth/user-not-found" });
    return { uid: "guest", firebase: { sign_in_provider: "anonymous", identities: {} } };
  });
  const request = () => appRequest(app, "POST", "/api/account/merge-anonymous", { "X-Test-User": uid }, { anonymousIdToken: "signed-guest-token" });
  const first = await request();
  assert.equal(first.status, 200);
  assert.equal(first.body.alreadyMerged, false);
  assert.equal(users.has("guest"), false);
  assert.equal(users.has(uid), true);
  assert.equal(firestore.documents.get("sessions/guest-session")?.userId, uid);
  assert.equal(storage.files.has(`profiles/${uid}/avatar.jpg`), true);
  assert.equal(storage.files.has("profiles/guest/avatar.jpg"), false);
  assert.equal(deleteUser.mock.callCount(), 1);
  const statements = sql.length;
  const second = await request();
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyMerged, true);
  assert.equal(sql.length, statements);
  assert.equal(verify.mock.calls.filter((call) => call.arguments[1] === true).length, 1);
  assert.equal((await appRequest(app, "POST", "/api/account/merge-anonymous", { "X-Test-User": other }, { anonymousIdToken: "signed-guest-token" })).status, 409);
});

test("merge retains its complete claim if Auth deletion fails, then retries Auth deletion", async () => {
  const { firestore, deleteUser } = services();
  mock.method(admin.auth(), "verifyIdToken", async () => ({ uid: "guest", firebase: { sign_in_provider: "anonymous" } }));
  deleteUser.mock.mockImplementationOnce(async () => { throw new Error("Auth unavailable"); });
  const request = () => appRequest(app, "POST", "/api/account/merge-anonymous", { "X-Test-User": uid }, { anonymousIdToken: "signed-token" });
  assert.equal((await request()).status, 500);
  assert.equal(firestore.documents.get("_accountMerges/guest")?.status, "complete");
  assert.equal((await request()).status, 200);
  assert.equal(deleteUser.mock.callCount(), 2);
});

test("unfinished merges still reject revoked guest credentials", async () => {
  const { sql, deleteUser } = services();
  mock.method(admin.auth(), "verifyIdToken", async (_token: string, checkRevoked?: boolean) => {
    if (checkRevoked) throw new Error("revoked");
    return { uid: "guest", firebase: { sign_in_provider: "anonymous" } };
  });
  assert.equal((await appRequest(app, "POST", "/api/account/merge-anonymous", { "X-Test-User": uid }, { anonymousIdToken: "revoked" })).status, 401);
  assert.equal(sql.length, 0);
  assert.equal(deleteUser.mock.callCount(), 0);
});
