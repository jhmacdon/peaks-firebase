import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const association = JSON.parse(
  readFileSync(
    new URL("../../public/.well-known/apple-app-site-association", import.meta.url),
    "utf8"
  )
) as {
  applinks: {
    details: Array<{ appIDs: string[]; components: Array<{ "/": string }> }>;
  };
  webcredentials: { apps: string[] };
};

test("AASA associates the Peaks app with each public share path", () => {
  const detail = association.applinks.details[0];
  assert.deepEqual(detail.appIDs, ["NBY6Q9BRN9.com.jhm.PeaksApp"]);
  assert.deepEqual(
    detail.components.map((component) => component["/"]),
    [
      "/destinations/*",
      "/routes/*",
      "/route/*",
      "/plan/*",
      "/log/*",
      "/reports/*",
      "/areas/*",
      "/lists/*",
    ]
  );
});

test("AASA associates Peaks website credentials with the app", () => {
  assert.deepEqual(association.webcredentials.apps, [
    "NBY6Q9BRN9.com.jhm.PeaksApp",
  ]);
});
