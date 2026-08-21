import test from "node:test";
import assert from "node:assert/strict";
import { chunk, orderByUids, shapeUserInfo } from "./user-info";

const auth = (overrides: Partial<Parameters<typeof shapeUserInfo>[0]> = {}) => ({
  uid: "u1",
  ...overrides,
});

test("shapeUserInfo: profile avatar wins over the Auth photoURL", () => {
  const info = shapeUserInfo(
    auth({ photoURL: "https://auth.example/a.jpg" }),
    { avatarUrl: "https://profile.example/p.jpg" },
    false
  );
  assert.equal(info.photoURL, "https://profile.example/p.jpg");
});

test("shapeUserInfo: falls back to the Auth photoURL, then null", () => {
  assert.equal(
    shapeUserInfo(auth({ photoURL: "https://auth.example/a.jpg" }), {}, false).photoURL,
    "https://auth.example/a.jpg"
  );
  assert.equal(shapeUserInfo(auth(), null, false).photoURL, null);
});

test("shapeUserInfo: Auth displayName wins over the profile name", () => {
  const info = shapeUserInfo(auth({ displayName: "Auth Name" }), { name: "Profile Name" }, false);
  assert.equal(info.displayName, "Auth Name");
});

test("shapeUserInfo: web-shape profile name fills displayName and name parts", () => {
  const info = shapeUserInfo(auth(), { name: "Jo Hiker" }, false);
  assert.equal(info.displayName, "Jo Hiker");
  assert.equal(info.firstName, "Jo");
  assert.equal(info.lastName, "Hiker");
});

test("shapeUserInfo: iOS-shape profile (name.first/last + avatar) resolves", () => {
  const info = shapeUserInfo(
    auth(),
    { name: { first: "Jo", last: "Hiker" }, avatar: "https://profile.example/ios.jpg" },
    false
  );
  assert.equal(info.displayName, "Jo Hiker");
  assert.equal(info.firstName, "Jo");
  assert.equal(info.lastName, "Hiker");
  assert.equal(info.photoURL, "https://profile.example/ios.jpg");
});

test("shapeUserInfo: email only crosses when includeEmail is true", () => {
  const record = auth({ email: "jo@example.com" });
  assert.equal(shapeUserInfo(record, null, true).email, "jo@example.com");
  assert.equal(shapeUserInfo(record, null, false).email, null);
});

test("shapeUserInfo: no profile and bare Auth record yields nulls, never undefined", () => {
  const info = shapeUserInfo(auth(), null, true);
  assert.deepEqual(info, {
    uid: "u1",
    email: null,
    displayName: null,
    photoURL: null,
    firstName: null,
    lastName: null,
  });
});

test("orderByUids restores the requested order from an unordered batch result", () => {
  const users = [{ uid: "b" }, { uid: "c" }, { uid: "a" }];
  assert.deepEqual(
    orderByUids(users, ["a", "b", "c"]).map((u) => u.uid),
    ["a", "b", "c"]
  );
});

test("orderByUids drops uids that resolved to no user (deleted account)", () => {
  const users = [{ uid: "a" }];
  assert.deepEqual(
    orderByUids(users, ["a", "missing"]).map((u) => u.uid),
    ["a"]
  );
});

test("orderByUids drops duplicate uids rather than repeating a user", () => {
  const users = [{ uid: "a" }];
  assert.deepEqual(
    orderByUids(users, ["a", "a"]).map((u) => u.uid),
    ["a"]
  );
});

test("chunk splits into full batches plus a remainder", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("chunk of an exact multiple has no empty tail batch", () => {
  assert.deepEqual(chunk([1, 2], 2), [[1, 2]]);
});

test("chunk of an empty list is an empty list of batches", () => {
  assert.deepEqual(chunk([], 100), []);
});
