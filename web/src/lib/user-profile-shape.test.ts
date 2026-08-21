import assert from "node:assert/strict";
import test from "node:test";

import { resolveAvatarUrl, resolveProfileName } from "./user-profile-shape";

test("resolveAvatarUrl reads the web shape (avatarUrl)", () => {
  assert.equal(resolveAvatarUrl({ avatarUrl: "https://example.com/a.jpg" }), "https://example.com/a.jpg");
});

test("resolveAvatarUrl reads the iOS shape (avatar) when avatarUrl is absent", () => {
  assert.equal(resolveAvatarUrl({ avatar: "https://example.com/a.jpg" }), "https://example.com/a.jpg");
});

test("resolveAvatarUrl prefers avatarUrl when both are present", () => {
  assert.equal(
    resolveAvatarUrl({ avatarUrl: "https://web.example/a.jpg", avatar: "https://ios.example/a.jpg" }),
    "https://web.example/a.jpg"
  );
});

test("resolveAvatarUrl returns null for a missing or blank field on either shape", () => {
  assert.equal(resolveAvatarUrl({}), null);
  assert.equal(resolveAvatarUrl({ avatarUrl: "", avatar: "" }), null);
  assert.equal(resolveAvatarUrl({ avatarUrl: "   " }), null);
});

test("resolveAvatarUrl ignores non-string values", () => {
  assert.equal(resolveAvatarUrl({ avatarUrl: 12345, avatar: null }), null);
});

test("resolveProfileName reads the web shape (string name)", () => {
  assert.deepEqual(resolveProfileName({ name: "Josiah McDonald" }), {
    displayName: "Josiah McDonald",
    firstName: "Josiah",
    lastName: "McDonald",
  });
});

test("resolveProfileName reads the iOS shape (name.first/name.last)", () => {
  assert.deepEqual(resolveProfileName({ name: { first: "Josiah", last: "McDonald" } }), {
    displayName: "Josiah McDonald",
    firstName: "Josiah",
    lastName: "McDonald",
  });
});

test("resolveProfileName handles a single-word string name", () => {
  assert.deepEqual(resolveProfileName({ name: "Josiah" }), {
    displayName: "Josiah",
    firstName: "Josiah",
    lastName: null,
  });
});

test("resolveProfileName handles an iOS shape with only a first name", () => {
  assert.deepEqual(resolveProfileName({ name: { first: "Josiah" } }), {
    displayName: "Josiah",
    firstName: "Josiah",
    lastName: null,
  });
});

test("resolveProfileName returns all-null for a missing or blank name", () => {
  assert.deepEqual(resolveProfileName({}), {
    displayName: null,
    firstName: null,
    lastName: null,
  });
  assert.deepEqual(resolveProfileName({ name: "   " }), {
    displayName: null,
    firstName: null,
    lastName: null,
  });
  assert.deepEqual(resolveProfileName({ name: {} }), {
    displayName: null,
    firstName: null,
    lastName: null,
  });
});

test("resolveProfileName trims a multi-space string name", () => {
  assert.deepEqual(resolveProfileName({ name: "  Josiah   McDonald  " }), {
    displayName: "Josiah   McDonald",
    firstName: "Josiah",
    lastName: "McDonald",
  });
});
