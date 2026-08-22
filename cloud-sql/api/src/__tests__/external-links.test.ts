import { strict as assert } from "node:assert";
import { test } from "node:test";
import { externalIdUrl, normalizeExternalLinks } from "../lib/external-links";

test("stable mountain IDs resolve to their direct public pages", () => {
  assert.equal(externalIdUrl("peakbagger", "2296"), "https://www.peakbagger.com/peak.aspx?pid=2296");
  assert.equal(externalIdUrl("summitpost", "150291"), "https://www.summitpost.org/page/150291");
  assert.equal(externalIdUrl("listsofjohn", "16668"), "https://listsofjohn.com/peak/16668");
  assert.equal(externalIdUrl("wikidata", "q194057"), "https://www.wikidata.org/wiki/Q194057");
  assert.equal(
    externalIdUrl("gnis", "1533612"),
    "https://edits.nationalmap.gov/apps/gaz-domestic/public/summary/1533612"
  );
});

test("unknown or ambiguous IDs do not become search links", () => {
  assert.equal(externalIdUrl("osm", "123"), null);
  assert.equal(externalIdUrl("summitpost", "mount-rainier"), null);
  assert.equal(externalIdUrl("alltrails", "Mount Rainier"), null);
  assert.equal(externalIdUrl("unknown", "123"), null);
});

test("stable route IDs resolve without a name search", () => {
  assert.equal(externalIdUrl("strava", "3123456789012345678"), "https://www.strava.com/routes/3123456789012345678");
  assert.equal(externalIdUrl("caltopo", "7BM0"), "https://caltopo.com/m/7BM0");
  assert.equal(externalIdUrl("wikiloc", "123456789"), "https://www.wikiloc.com/wikiloc/view.do?id=123456789");
});

test("stored direct links lead derived provider links and duplicate URLs collapse", () => {
  assert.deepEqual(
    normalizeExternalLinks(
      [
        { type: "alltrails", id: "https://www.alltrails.com/trail/us/washington/mount-si-trail" },
        { provider: "wta", url: "https://www.wta.org/go-hiking/hikes/mount-si" },
        { type: "bad", id: "javascript:alert(1)" },
      ],
      {
        peakbagger: "1747",
        summit_post: "150729",
        alltrails: "https://www.alltrails.com/trail/us/washington/mount-si-trail",
      }
    ),
    [
      { type: "alltrails", id: "https://www.alltrails.com/trail/us/washington/mount-si-trail" },
      { type: "wta", id: "https://www.wta.org/go-hiking/hikes/mount-si" },
      { type: "peakbagger", id: "https://www.peakbagger.com/peak.aspx?pid=1747" },
      { type: "summitpost", id: "https://www.summitpost.org/page/150729" },
    ]
  );
});
