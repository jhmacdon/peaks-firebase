import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildDestinationDetailQuery,
  mapDestinationDetailRow,
} from "../routes/destinations";

test("destination detail query includes linked areas without area boundaries", () => {
  const query = buildDestinationDetailQuery("dest-1");

  assert.match(query.text, /FROM destination_areas da/);
  assert.match(query.text, /JOIN areas a ON a\.id = da\.area_id/);
  assert.match(query.text, /json_agg/);
  assert.match(query.text, /'kind', a\.kind/);
  assert.doesNotMatch(query.text, /a\.boundary/);
  // duplicate PAD-US park fragments collapse so a park never shows twice
  assert.match(query.text, /DISTINCT ON \(a\.kind, a\.name\)/);
  assert.deepEqual(query.values, ["dest-1"]);
});

test("mapDestinationDetailRow merges averages and defaults areas to empty array", () => {
  const row: any = {
    id: "dest-1",
    name: "Mount Rainier",
    averages: {
      months: { jun: 1 },
      days: { sa: 1 },
      lastUpdated: "2026-06-01T00:00:00.000Z",
    },
    averages_offset: {
      months: { jun: 2 },
      days: { su: 1 },
      lastUpdated: "2026-06-02T00:00:00.000Z",
    },
    areas: null,
  };

  const mapped = mapDestinationDetailRow(row);

  assert.deepEqual(mapped.averages.months, { jun: 3 });
  assert.deepEqual(mapped.averages.days, { sa: 1, su: 1 });
  assert.equal(mapped.averages.lastUpdated, "2026-06-02T00:00:00.000Z");
  assert.deepEqual(mapped.areas, []);
  assert.equal(Object.prototype.hasOwnProperty.call(mapped, "averages_offset"), false);
});
