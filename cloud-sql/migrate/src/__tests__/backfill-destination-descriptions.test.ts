import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  UPDATE_SQL,
  planRow,
  writeRow,
  type CandidateRow,
  type WikipediaClient,
} from "../backfill-destination-descriptions";
import type { WikipediaImageCredit, WikipediaSummary } from "../lib/wikipedia";

/** A destination row as loadCandidates hands it over. */
function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: "dest-rainier",
    name: "Mount Rainier",
    lat: 46.8523,
    lng: -121.7603,
    wikidata_id: null,
    has_description: false,
    has_hero_image: false,
    ...overrides,
  };
}

function summary(overrides: Partial<WikipediaSummary> = {}): WikipediaSummary {
  return {
    title: "Mount Rainier",
    extract: "Mount Rainier is a large active stratovolcano in the Cascade Range of Washington.",
    pageUrl: "https://en.wikipedia.org/wiki/Mount_Rainier",
    leadImageTitle: "File:Mount_Rainier_from_the_Silver_Queen_Peak.jpg",
    ...overrides,
  };
}

function credit(overrides: Partial<WikipediaImageCredit> = {}): WikipediaImageCredit {
  return {
    imageUrl: "https://upload.wikimedia.org/rainier.jpg",
    artist: "A Photographer",
    licenseShortName: "CC BY-SA 4.0",
    descriptionUrl: "https://commons.wikimedia.org/wiki/File:Rainier.jpg",
    ...overrides,
  };
}

type StubOptions = {
  wikidataTitle?: string | null;
  geosearchTitle?: string | null;
  summary?: WikipediaSummary | null;
  imageCredit?: WikipediaImageCredit | null;
};

type Stub = { client: WikipediaClient; calls: string[] };

function stubClient(options: StubOptions = {}): Stub {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async titleFromWikidata(id) {
        calls.push(`wikidata:${id}`);
        return options.wikidataTitle ?? null;
      },
      async titleFromGeosearch(name, lat, lng) {
        calls.push(`geosearch:${name}@${lat},${lng}`);
        return options.geosearchTitle ?? null;
      },
      async fetchSummary(title) {
        calls.push(`summary:${title}`);
        return options.summary === undefined ? summary() : options.summary;
      },
      async fetchImageCredit(fileTitle) {
        calls.push(`image:${fileTitle}`);
        return options.imageCredit === undefined ? credit() : options.imageCredit;
      },
    },
  };
}

// --- Idempotence -----------------------------------------------------------

test("a row that already has a description is skipped without any fetching", async () => {
  const stub = stubClient();
  const outcome = await planRow(row({ has_description: true }), stub.client, { force: false });

  assert.equal(outcome.kind, "skip");
  assert.deepEqual(stub.calls, [], "a re-run must not re-hit Wikipedia for filled rows");
});

test("--force re-fetches a row that already has a description", async () => {
  const stub = stubClient({ geosearchTitle: "Mount Rainier" });
  const outcome = await planRow(row({ has_description: true }), stub.client, { force: true });

  assert.equal(outcome.kind, "write");
  assert.ok(stub.calls.some((call) => call.startsWith("summary:")));
});

test("a row without a name or coordinates is skipped", async () => {
  const stub = stubClient();
  assert.equal((await planRow(row({ name: null }), stub.client, { force: false })).kind, "skip");
  assert.equal((await planRow(row({ lat: null }), stub.client, { force: false })).kind, "skip");
  assert.deepEqual(stub.calls, []);
});

// --- Match resolution order ------------------------------------------------

test("a wikidata sitelink wins and geosearch is never called", async () => {
  const stub = stubClient({ wikidataTitle: "Mount Rainier", geosearchTitle: "Crystal Peak" });
  const outcome = await planRow(row({ wikidata_id: "Q194057" }), stub.client, { force: false });

  assert.equal(outcome.kind, "write");
  assert.deepEqual(stub.calls, [
    "wikidata:Q194057",
    "summary:Mount Rainier",
    "image:File:Mount_Rainier_from_the_Silver_Queen_Peak.jpg",
  ]);
});

test("geosearch fills in when the wikidata sitelink is missing", async () => {
  const stub = stubClient({ wikidataTitle: null, geosearchTitle: "Mount Rainier" });
  const outcome = await planRow(row({ wikidata_id: "Q194057" }), stub.client, { force: false });

  assert.equal(outcome.kind, "write");
  assert.ok(stub.calls.includes("geosearch:Mount Rainier@46.8523,-121.7603"));
});

test("no confident title match is a miss, not a write", async () => {
  const stub = stubClient({ geosearchTitle: null });
  const outcome = await planRow(row(), stub.client, { force: false });

  assert.equal(outcome.kind, "miss");
  assert.ok(!stub.calls.some((call) => call.startsWith("summary:")));
});

test("a summary whose title names a different place is rejected", async () => {
  const stub = stubClient({
    geosearchTitle: "Mount Rainier",
    summary: summary({ title: "Crystal Peak (Washington)" }),
  });
  const outcome = await planRow(row(), stub.client, { force: false });

  assert.equal(outcome.kind, "miss", "a wrong article is worse than no article");
});

// --- Description credit ----------------------------------------------------

test("a write carries the full name + url + licence triple", async () => {
  const stub = stubClient({ geosearchTitle: "Mount Rainier" });
  const outcome = await planRow(row(), stub.client, { force: false });

  assert.equal(outcome.kind, "write");
  if (outcome.kind !== "write") return;
  assert.ok(outcome.write.description.length > 0);
  assert.equal(outcome.write.sourceName, "Wikipedia");
  assert.equal(outcome.write.sourceUrl, "https://en.wikipedia.org/wiki/Mount_Rainier");
  assert.equal(outcome.write.sourceLicense, "CC BY-SA 4.0");
});

test("a summary with no page url yields no description at all", async () => {
  const stub = stubClient({ geosearchTitle: "Mount Rainier", summary: summary({ pageUrl: "" }) });
  const outcome = await planRow(row(), stub.client, { force: false });

  assert.equal(outcome.kind, "miss", "an uncredited description must never be stored");
});

// --- Image licence gate ----------------------------------------------------

test("a freely licensed lead image is written with its attribution", async () => {
  const stub = stubClient({ geosearchTitle: "Mount Rainier" });
  const outcome = await planRow(row(), stub.client, { force: false });

  assert.equal(outcome.kind, "write");
  if (outcome.kind !== "write") return;
  assert.equal(outcome.write.heroImage, "https://upload.wikimedia.org/rainier.jpg");
  assert.equal(outcome.write.heroAttribution, "A Photographer / CC BY-SA 4.0");
  assert.equal(
    outcome.write.heroAttributionUrl,
    "https://commons.wikimedia.org/wiki/File:Rainier.jpg"
  );
});

test("a non-free lead image is refused while the description still lands", async () => {
  for (const licence of ["CC BY-NC 2.0", "CC BY-ND 4.0", "Fair use", "All rights reserved"]) {
    const stub = stubClient({
      geosearchTitle: "Mount Rainier",
      imageCredit: credit({ licenseShortName: licence }),
    });
    const outcome = await planRow(row(), stub.client, { force: false });

    assert.equal(outcome.kind, "write");
    if (outcome.kind !== "write") return;
    assert.equal(outcome.write.heroImage, null, `${licence} must not be stored`);
    assert.equal(outcome.write.heroAttribution, null);
    assert.equal(outcome.write.heroAttributionUrl, null);
    assert.ok(
      (outcome.imageSkipReason ?? "").includes(licence),
      "the refusal must name the licence so the run log explains itself"
    );
    assert.ok(outcome.write.description.length > 0);
  }
});

test("an unparseable image credit is refused", async () => {
  const stub = stubClient({ geosearchTitle: "Mount Rainier", imageCredit: null });
  const outcome = await planRow(row(), stub.client, { force: false });

  assert.equal(outcome.kind, "write");
  if (outcome.kind !== "write") return;
  assert.equal(outcome.write.heroImage, null);
  assert.ok((outcome.imageSkipReason ?? "").length > 0);
});

test("a row that already has a hero image is not re-fetched", async () => {
  const stub = stubClient({ geosearchTitle: "Mount Rainier" });
  const outcome = await planRow(row({ has_hero_image: true }), stub.client, { force: false });

  assert.equal(outcome.kind, "write");
  assert.ok(!stub.calls.some((call) => call.startsWith("image:")));
});

test("a summary with no lead image is not an image fetch", async () => {
  const stub = stubClient({
    geosearchTitle: "Mount Rainier",
    summary: summary({ leadImageTitle: null }),
  });
  await planRow(row(), stub.client, { force: false });

  assert.ok(!stub.calls.some((call) => call.startsWith("image:")));
});

// --- The UPDATE ------------------------------------------------------------

test("writeRow sends the credit triple and coalesces the hero columns", async () => {
  const seen: { text: string; values: any[] }[] = [];
  const fakeDb = {
    async query(text: string, values?: any[]) {
      seen.push({ text, values: values ?? [] });
      return { rowCount: 1 };
    },
  };

  await writeRow(fakeDb, "dest-rainier", {
    matchedTitle: "Mount Rainier",
    description: "Mount Rainier is a large active stratovolcano.",
    sourceName: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Mount_Rainier",
    sourceLicense: "CC BY-SA 4.0",
    heroImage: null,
    heroAttribution: null,
    heroAttributionUrl: null,
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, UPDATE_SQL);
  assert.deepEqual(seen[0].values, [
    "dest-rainier",
    "Mount Rainier is a large active stratovolcano.",
    "Wikipedia",
    "https://en.wikipedia.org/wiki/Mount_Rainier",
    "CC BY-SA 4.0",
    null,
    null,
    null,
  ]);
  assert.match(
    UPDATE_SQL,
    /hero_image\s*=\s*COALESCE/,
    "a null hero must never wipe an image an earlier run stored"
  );
});

test("writeRow refuses a description that lacks any part of the credit triple", async () => {
  const fakeDb = {
    async query() {
      throw new Error("must not reach the database");
    },
  };

  await assert.rejects(() =>
    writeRow(fakeDb, "dest-rainier", {
      matchedTitle: "Mount Rainier",
      description: "Mount Rainier is a large active stratovolcano.",
      sourceName: "Wikipedia",
      sourceUrl: "",
      sourceLicense: "CC BY-SA 4.0",
      heroImage: null,
      heroAttribution: null,
      heroAttributionUrl: null,
    })
  );
});

test("writeRow refuses a hero image without attribution", async () => {
  const fakeDb = {
    async query() {
      throw new Error("must not reach the database");
    },
  };

  await assert.rejects(() =>
    writeRow(fakeDb, "dest-rainier", {
      matchedTitle: "Mount Rainier",
      description: "Mount Rainier is a large active stratovolcano.",
      sourceName: "Wikipedia",
      sourceUrl: "https://en.wikipedia.org/wiki/Mount_Rainier",
      sourceLicense: "CC BY-SA 4.0",
      heroImage: "https://upload.wikimedia.org/rainier.jpg",
      heroAttribution: null,
      heroAttributionUrl: "https://commons.wikimedia.org/wiki/File:Rainier.jpg",
    })
  );
});
