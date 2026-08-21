import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_NAV_ITEMS, isAdminPathActive } from "./admin-navigation";

test("the admin nav only lists routes that exist", () => {
  assert.deepEqual(
    ADMIN_NAV_ITEMS.map((item) => item.href),
    ["/admin", "/admin/photos", "/admin/destinations", "/admin/routes", "/admin/sessions"]
  );
});

test("dashboard only matches the dashboard while sections match nested pages", () => {
  assert.equal(isAdminPathActive("/admin", "/admin"), true);
  assert.equal(isAdminPathActive("/admin/photos", "/admin"), false);
  assert.equal(isAdminPathActive("/admin/routes/new", "/admin/routes"), true);
  assert.equal(isAdminPathActive("/admin/destinations", "/admin/routes"), false);
});
