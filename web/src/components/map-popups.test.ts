import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { destinationPopup, routePopup, textPopup } from "./map-popups";

const window = new Window();
globalThis.document = window.document as unknown as Document;

test("destination popup renders hostile name, features, and id as text", () => {
  const popup = destinationPopup({
    id: 'abc"><script>alert(1)</script>',
    name: '<img src=x onerror="alert(1)">Peak',
    elevation: 1000,
    features: ["summit", "<b>volcano</b>"],
  });

  assert.equal(popup.querySelector("img"), null);
  assert.equal(popup.querySelector("script"), null);
  assert.equal(popup.querySelector("b"), null);
  assert.ok(popup.textContent?.includes('<img src=x onerror="alert(1)">Peak'));
  assert.ok(popup.textContent?.includes("summit, <b>volcano</b>"));

  const link = popup.querySelector("a");
  assert.ok(link);
  assert.equal(
    link.getAttribute("href"),
    `/destinations/${encodeURIComponent('abc"><script>alert(1)</script>')}`
  );
});

test("destination popup shows elevation in feet and falls back to Unnamed", () => {
  const popup = destinationPopup({
    id: "abc",
    name: null,
    elevation: 1000,
    features: [],
  });

  assert.ok(popup.textContent?.includes("Unnamed"));
  assert.ok(popup.textContent?.includes("3,281 ft"));
});

test("destination popup omits elevation and features when absent", () => {
  const popup = destinationPopup({
    id: "abc",
    name: "Plain Peak",
    elevation: null,
    features: [],
  });

  assert.ok(!popup.textContent?.includes("ft"));
  assert.ok(popup.textContent?.includes("Plain Peak"));
});

test("text popup renders a hostile name as text", () => {
  const popup = textPopup('<img src=x onerror="alert(1)">Peak');

  assert.equal(popup.querySelector("img"), null);
  assert.equal(popup.textContent, '<img src=x onerror="alert(1)">Peak');
});

test("route popup renders hostile name as text and links by encoded id", () => {
  const popup = routePopup({
    id: "r/1",
    name: "<svg onload=alert(1)>Ridge",
  });

  assert.equal(popup.querySelector("svg"), null);
  assert.ok(popup.textContent?.includes("<svg onload=alert(1)>Ridge"));
  assert.equal(
    popup.querySelector("a")?.getAttribute("href"),
    `/routes/${encodeURIComponent("r/1")}`
  );
});
