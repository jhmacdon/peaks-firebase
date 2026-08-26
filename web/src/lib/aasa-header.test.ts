import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../../next.config";

test("Next serves the AASA file as JSON", async () => {
  const rules = await nextConfig.headers?.();
  const associationRule = rules?.find(
    (rule) => rule.source === "/.well-known/apple-app-site-association"
  );
  assert.deepEqual(associationRule?.headers, [
    { key: "Content-Type", value: "application/json" },
  ]);
});
