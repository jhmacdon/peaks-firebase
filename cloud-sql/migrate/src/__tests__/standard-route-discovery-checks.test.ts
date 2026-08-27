import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRouteDiscoveryChecks as parseChecksForDestination,
} from "../standard-route-discovery-checks";

const NOW_MS = Date.parse("2026-08-27T12:00:00.000Z");
const CHECKED_AT = "2026-08-27T11:30:00.000Z";

const identitySources = [
  {
    type: "alltrails",
    url: "https://www.alltrails.com/trail/us/washington/example",
  },
  {
    type: "peakbagger",
    url: "https://www.peakbagger.com/peak.aspx?pid=1",
  },
  { type: "official", url: "https://www.nps.gov/example" },
];

function parseRouteDiscoveryChecks(
  value: unknown,
  sources: readonly unknown[],
  nowMs: number
) {
  return parseChecksForDestination(value, sources, { name: "Example" }, nowMs);
}

test("both route-discovery publishers are retained as exact matches", () => {
  assert.deepEqual(
    parseRouteDiscoveryChecks(
      {
        alltrails: {
          status: "matched",
          url: "https://www.alltrails.com/trail/us/washington/example",
          checked_at: CHECKED_AT,
        },
        peakbagger: {
          status: "matched",
          url: "https://www.peakbagger.com/peak.aspx?pid=1",
          checked_at: CHECKED_AT,
        },
      },
      identitySources,
      NOW_MS
    ),
    {
      alltrails: {
        status: "matched",
        url: "https://www.alltrails.com/trail/us/washington/example",
        checked_at: CHECKED_AT,
      },
      peakbagger: {
        status: "matched",
        url: "https://www.peakbagger.com/peak.aspx?pid=1",
        checked_at: CHECKED_AT,
      },
    }
  );
});

test("a real no-match or access failure is durable", () => {
  assert.deepEqual(
    parseRouteDiscoveryChecks(
      {
        alltrails: {
          status: "no_match",
          attempted_url: "https://www.alltrails.com/search?q=Example",
          checked_at: CHECKED_AT,
          note: "No direct page matched the summit and trailhead.",
        },
        peakbagger: {
          status: "unavailable",
          attempted_url:
            "https://www.peakbagger.com/search.aspx?tid=R&query=Example",
          checked_at: CHECKED_AT,
          note: "The public page could not be reached in this run.",
        },
      },
      [{ type: "official", url: "https://www.nps.gov/example" }],
      NOW_MS
    ),
    {
      alltrails: {
        status: "no_match",
        attempted_url: "https://www.alltrails.com/search?q=Example",
        checked_at: CHECKED_AT,
        note: "No direct page matched the summit and trailhead.",
      },
      peakbagger: {
        status: "unavailable",
        attempted_url:
          "https://www.peakbagger.com/search.aspx?tid=R&query=Example",
        checked_at: CHECKED_AT,
        note: "The public page could not be reached in this run.",
      },
    }
  );
});

test("matched checks cannot invent, swap, or hide publisher URLs", () => {
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          alltrails: {
            status: "no_match",
            attempted_url: "https://www.alltrails.com:8443/search?q=Example",
            checked_at: CHECKED_AT,
            note: "No direct match.",
          },
          peakbagger: {
            status: "matched",
            url: "https://www.peakbagger.com/peak.aspx?pid=1",
            checked_at: CHECKED_AT,
          },
        },
        identitySources,
        NOW_MS
      ),
    /public alltrails HTTPS host/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          alltrails: {
            status: "no_match",
            attempted_url: "https://search.alltrails.com/search?q=Example",
            checked_at: CHECKED_AT,
            note: "No direct match.",
          },
          peakbagger: {
            status: "matched",
            url: "https://www.peakbagger.com/peak.aspx?pid=1",
            checked_at: CHECKED_AT,
          },
        },
        identitySources,
        NOW_MS
      ),
    /public alltrails HTTPS host/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          alltrails: {
            status: "matched",
            url: "https://example.com/not-alltrails",
            checked_at: CHECKED_AT,
          },
          peakbagger: {
            status: "matched",
            url: "https://www.peakbagger.com/peak.aspx?pid=1",
            checked_at: CHECKED_AT,
          },
        },
        identitySources,
        NOW_MS
      ),
    /public alltrails HTTPS host/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          alltrails: {
            status: "matched",
            url: "https://www.alltrails.com/trail/us/washington/example",
            checked_at: CHECKED_AT,
          },
          peakbagger: {
            status: "matched",
            url: "https://www.peakbagger.com/peak.aspx?pid=2",
            checked_at: CHECKED_AT,
          },
        },
        identitySources,
        NOW_MS
      ),
    /matched peakbagger discovery check must appear in identity_sources/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          alltrails: {
            status: "no_match",
            attempted_url: "https://www.alltrails.com/search?q=Example",
            checked_at: CHECKED_AT,
            note: "No direct match.",
            url: "https://www.alltrails.com/trail/us/washington/example",
          },
          peakbagger: {
            status: "unavailable",
            attempted_url:
              "https://www.peakbagger.com/search.aspx?tid=R&query=Example",
            checked_at: CHECKED_AT,
            note: "Public page was unavailable.",
          },
        },
        identitySources,
        NOW_MS
      ),
    /must contain exactly attempted_url, checked_at, note, status/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          alltrails: {
            status: "matched",
            url: "https://www.alltrails.com/search?q=Example",
            checked_at: CHECKED_AT,
          },
          peakbagger: {
            status: "matched",
            url: "https://www.peakbagger.com/peak.aspx?pid=1",
            checked_at: CHECKED_AT,
          },
        },
        [
          ...identitySources,
          { type: "alltrails", url: "https://www.alltrails.com/search?q=Example" },
        ],
        NOW_MS
      ),
    /alltrails\.url must name a concrete public result page/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          alltrails: {
            status: "matched",
            url: "https://www.alltrails.com/trail/us/washington/example",
            checked_at: CHECKED_AT,
          },
          peakbagger: {
            status: "matched",
            url: "https://www.peakbagger.com/",
            checked_at: CHECKED_AT,
          },
        },
        [
          ...identitySources,
          { type: "peakbagger", url: "https://www.peakbagger.com/" },
        ],
        NOW_MS
      ),
    /peakbagger\.url must name a concrete public result page/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          alltrails: {
            status: "matched",
            url: "https://www.alltrails.com/trail/us/washington/example",
            checked_at: CHECKED_AT,
          },
          peakbagger: {
            status: "matched",
            url: "https://www.peakbagger.com/search.aspx?query=Example",
            checked_at: CHECKED_AT,
          },
        },
        [
          ...identitySources,
          {
            type: "peakbagger",
            url: "https://www.peakbagger.com/search.aspx?query=Example",
          },
        ],
        NOW_MS
      ),
    /peakbagger\.url must name a concrete public result page/
  );
});

test("negative checks name a concrete service search for the destination", () => {
  const checks = {
    alltrails: {
      status: "no_match",
      attempted_url: "https://www.alltrails.com/",
      checked_at: CHECKED_AT,
      note: "No direct match.",
    },
    peakbagger: {
      status: "unavailable",
      attempted_url: "https://www.peakbagger.com/search.aspx",
      checked_at: CHECKED_AT,
      note: "The search page was unavailable.",
    },
  };
  assert.throws(
    () => parseRouteDiscoveryChecks(checks, identitySources, NOW_MS),
    /alltrails\.attempted_url must be a public search for destination/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          ...checks,
          alltrails: {
            ...checks.alltrails,
            attempted_url: "https://www.alltrails.com/search?q=Example",
          },
        },
        identitySources,
        NOW_MS
      ),
    /peakbagger\.attempted_url must be a public search for destination/
  );
  assert.doesNotThrow(() =>
    parseRouteDiscoveryChecks(
      {
        alltrails: {
          ...checks.alltrails,
          attempted_url: "https://www.alltrails.com/search?q=Example",
        },
        peakbagger: {
          ...checks.peakbagger,
          attempted_url:
            "https://www.peakbagger.com/search.aspx?query=Example",
        },
      },
      identitySources,
      NOW_MS
    )
  );
});

test("negative checks reject a search for another summit", () => {
  const checks = {
    alltrails: {
      status: "no_match",
      attempted_url: "https://www.alltrails.com/search?q=Mount+Wrong",
      checked_at: CHECKED_AT,
      note: "No direct match.",
    },
    peakbagger: {
      status: "unavailable",
      attempted_url:
        "https://www.peakbagger.com/search.aspx?query=Example",
      checked_at: CHECKED_AT,
      note: "The search page was unavailable.",
    },
  };
  assert.throws(
    () => parseRouteDiscoveryChecks(checks, identitySources, NOW_MS),
    /alltrails\.attempted_url must be a public search for destination "Example"/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          ...checks,
          alltrails: {
            ...checks.alltrails,
            attempted_url: "https://www.alltrails.com/search?q=Example",
          },
          peakbagger: {
            ...checks.peakbagger,
            attempted_url:
              "https://www.peakbagger.com/search.aspx?query=Mount+Wrong",
          },
        },
        identitySources,
        NOW_MS
      ),
    /peakbagger\.attempted_url must be a public search for destination "Example"/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          ...checks,
          alltrails: {
            ...checks.alltrails,
            attempted_url:
              "https://www.alltrails.com/search?q=Mount+Wrong+Example",
          },
        },
        identitySources,
        NOW_MS
      ),
    /alltrails\.attempted_url must be a public search for destination "Example"/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          ...checks,
          alltrails: {
            ...checks.alltrails,
            attempted_url:
              "https://www.alltrails.com/search?q=Example&q=Mount+Wrong",
          },
        },
        identitySources,
        NOW_MS
      ),
    /alltrails\.attempted_url must be a public search for destination "Example"/
  );
});

test("route-discovery checks must be fresh and cannot be future-dated", () => {
  const checks = {
    alltrails: {
      status: "matched",
      url: "https://www.alltrails.com/trail/us/washington/example",
      checked_at: "2026-08-26T11:59:59.999Z",
    },
    peakbagger: {
      status: "matched",
      url: "https://www.peakbagger.com/peak.aspx?pid=1",
      checked_at: CHECKED_AT,
    },
  };
  assert.throws(
    () => parseRouteDiscoveryChecks(checks, identitySources, NOW_MS),
    /older than 24 hours/
  );
  assert.throws(
    () =>
      parseRouteDiscoveryChecks(
        {
          ...checks,
          alltrails: {
            ...checks.alltrails,
            checked_at: "2026-08-27T12:05:00.001Z",
          },
        },
        identitySources,
        NOW_MS
      ),
    /in the future/
  );
});
