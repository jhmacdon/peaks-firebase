import assert from "node:assert/strict";
import test from "node:test";
import {
  externalIdUrl,
  parseDestinationExternalLinks,
  parseExternalRouteLinks,
  partitionDestinationExternalLinks,
} from "./external-links";

test("destination provider IDs become exact public pages in useful order", () => {
  const links = parseDestinationExternalLinks([], {
    wikidata: "Q194057",
    listsofjohn: "16668",
    summitpost: "150291",
    peakbagger: "2296",
  });

  assert.deepEqual(
    links.map(({ label, href }) => ({ label, href })),
    [
      { label: "Peakbagger", href: "https://www.peakbagger.com/peak.aspx?pid=2296" },
      { label: "SummitPost", href: "https://www.summitpost.org/page/150291" },
      { label: "ListsOfJohn", href: "https://listsofjohn.com/peak/16668" },
      { label: "Wikidata", href: "https://www.wikidata.org/wiki/Q194057" },
    ]
  );
});

test("RIDB facility IDs become one exact Recreation.gov action", () => {
  const links = parseDestinationExternalLinks([], {
    ridb_facility: "232459",
    peakbagger: "2296",
  });
  const partitioned = partitionDestinationExternalLinks(links);

  assert.deepEqual(
    partitioned.recreationGov && {
      label: partitioned.recreationGov.label,
      href: partitioned.recreationGov.href,
    },
    {
      label: "Recreation.gov",
      href: "https://www.recreation.gov/camping/campgrounds/232459",
    }
  );
  assert.deepEqual(partitioned.other.map((link) => link.label), ["Peakbagger"]);
  assert.equal(externalIdUrl("ridb_facility", "not-a-number"), null);
});

test("route links accept current type/id rows and legacy slugs", () => {
  const links = parseExternalRouteLinks([
    { type: "alltrails", id: "trail/us/washington/mount-si-trail" },
    { type: "wta", id: "mount-si" },
    { type: "strava", id: "3123456789012345678" },
    { type: "mountaineers", id: "https://www.mountaineers.org/activities/routes-places/mount-si-main-trail" },
  ]);

  assert.deepEqual(
    links.map(({ label, href }) => ({ label, href })),
    [
      { label: "AllTrails", href: "https://www.alltrails.com/trail/us/washington/mount-si-trail" },
      { label: "Washington Trails Association", href: "https://www.wta.org/go-hiking/hikes/mount-si" },
      { label: "Strava", href: "https://www.strava.com/routes/3123456789012345678" },
      { label: "The Mountaineers", href: "https://www.mountaineers.org/activities/routes-places/mount-si-main-trail" },
    ]
  );
});

test("unsafe, ambiguous, and unknown IDs stay hidden", () => {
  assert.equal(externalIdUrl("alltrails", "Mount Si"), null);
  assert.equal(externalIdUrl("osm", "123"), null);
  assert.equal(externalIdUrl("unknown", "123"), null);
  assert.deepEqual(
    parseExternalRouteLinks([{ type: "other", id: "javascript:alert(1)" }]),
    []
  );
});
