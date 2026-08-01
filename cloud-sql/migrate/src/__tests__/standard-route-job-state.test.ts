import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransition,
  canonicalJson,
  humanRequeueTargetState,
  stageForState,
  statesForStage,
  verificationAction,
} from "../standard-route-job-state";

test("the normal route job can reach verified in strict steps", () => {
  const path = [
    "queued",
    "researching",
    "candidate_ready",
    "pending_review",
    "approved",
    "published",
    "verified",
  ] as const;

  for (let index = 0; index < path.length - 1; index += 1) {
    assert.equal(canTransition(path[index], path[index + 1]), true);
  }
});

test("a candidate cannot skip independent review", () => {
  assert.equal(canTransition("candidate_ready", "approved"), false);
  assert.equal(canTransition("researching", "approved"), false);
  assert.equal(canTransition("approved", "verified"), false);
});

test("claim stages favor finishing work already near publication", () => {
  assert.equal(stageForState("published"), "verify");
  assert.equal(stageForState("approved"), "publish");
  assert.equal(stageForState("pending_review"), "review");
  assert.equal(stageForState("candidate_ready"), "import");
  assert.equal(stageForState("queued"), "research");
  assert.equal(stageForState("waiting_rights"), null);
  assert.deepEqual(statesForStage("verify"), ["published"]);
});

test("blocked jobs are never part of the automatic next claim", () => {
  const nextStates = new Set(statesForStage("next"));
  assert.equal(nextStates.has("waiting_rights"), false);
  assert.equal(nextStates.has("waiting_access"), false);
  assert.equal(nextStates.has("needs_human"), false);
});

test("a human can retry an unchanged pending route after a tool fix", () => {
  assert.equal(
    humanRequeueTargetState("needs_revision"),
    "pending_review"
  );
  assert.equal(humanRequeueTargetState("needs_human"), "queued");
  assert.equal(humanRequeueTargetState("verified"), null);
});

test("candidate checksums survive JSONB key reordering", () => {
  const original = {
    type: "FeatureCollection",
    metadata: { z: 1, a: [{ y: true, b: false }] },
  };
  const reordered = {
    metadata: { a: [{ b: false, y: true }], z: 1 },
    type: "FeatureCollection",
  };
  assert.equal(canonicalJson(original), canonicalJson(reordered));
});

test("verification failures take a deterministic recovery path", () => {
  const gates = {
    owner: true,
    active: true,
    destination_order: true,
    segments: true,
    provenance: true,
    public_http: true,
  };
  assert.equal(verificationAction({ verdict: "PASS", gates }), "verified");
  assert.equal(
    verificationAction({
      verdict: "FAIL",
      gates: { ...gates, segments: false, provenance: false, public_http: false },
    }),
    "rebuild"
  );
  assert.equal(
    verificationAction({
      verdict: "FAIL",
      gates: { ...gates, public_http: false },
    }),
    "retry"
  );
  assert.equal(
    verificationAction({
      verdict: "FAIL",
      gates: { ...gates, destination_order: false },
    }),
    "needs_human"
  );
});
