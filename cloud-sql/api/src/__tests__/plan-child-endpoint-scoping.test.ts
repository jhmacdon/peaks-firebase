import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildPlanDestinationsQuery,
  buildPlanPartyQuery,
  buildPlanRoutesQuery,
} from "../routes/plans";

test("plan child-endpoint queries scope to plan owner or party member", () => {
  for (const build of [
    buildPlanDestinationsQuery,
    buildPlanPartyQuery,
    buildPlanRoutesQuery,
  ]) {
    const query = build("plan-1", "user-1");
    assert.match(
      query.text,
      /p\.user_id = \$2 OR pp\.user_id = \$2/,
      "must scope to the plan owner or a party member"
    );
    assert.deepEqual(query.values, ["plan-1", "user-1"]);
  }
});

test("plan route children omit legacy links owned by another user", () => {
  const query = buildPlanRoutesQuery("plan-1", "user-1");
  assert.match(query.text, /r\.owner = 'peaks' OR r\.owner = p\.user_id/);
  assert.match(query.text, /AS is_catalog/);
});
