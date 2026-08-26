import { strict as assert } from "node:assert";
import { test } from "node:test";
import { accountLinkMessage, providerName } from "./auth-linking";

test("providerName names every Peaks sign-in provider", () => {
  assert.equal(providerName("google.com"), "Google");
  assert.equal(providerName("apple.com"), "Apple");
  assert.equal(providerName("password"), "email and password");
});

test("accountLinkMessage directs the member to the existing provider", () => {
  assert.equal(
    accountLinkMessage("hiker@example.com", "google.com", ["password"]),
    "An account already exists for hiker@example.com. Sign in with email and password, and Peaks will add Google to the same account."
  );
});

test("accountLinkMessage remains useful when email-enumeration protection hides methods", () => {
  assert.match(
    accountLinkMessage("hiker@example.com", "apple.com"),
    /Sign in with the method you used before/
  );
});
