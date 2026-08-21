import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  FlagUsageError,
  UPDATE_SQL,
  buildCandidateQuery,
  intFlagFrom,
  parseArgs,
  planRow,
  stringFlagFrom,
  writeRow,
  type ArticleSummary,
  type CandidateRow,
  type WikipediaClient,
} from "../backfill-destination-descriptions";
import { parseSummaryResponse, type WikipediaImageCredit } from "../lib/wikipedia";

/** A destination row as loadCandidates hands it over. */
function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: "dest-rainier",
    name: "Mount Rainier",
    lat: 46.8523,
    lng: -121.7603,
    wikidata_id: null,
    description: null,
    description_source_name: null,
    description_source_url: null,
    description_source_license: null,
    has_description: false,
    has_hero_image: false,
    ...overrides,
  };
}

/** A row a previous run filled with copy but no image — the recovery case. */
function rowAwaitingImage(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return row({
    description: "Mount Rainier is a large active stratovolcano.",
    description_source_name: "Wikipedia",
    description_source_url: "https://en.wikipedia.org/wiki/Mount_Rainier",
    description_source_license: "CC BY-SA 4.0",
    has_description: true,
    has_hero_image: false,
    ...overrides,
  });
}

function summary(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  return {
    title: "Mount Rainier",
    extract: "Mount Rainier is a large active stratovolcano in the Cascade Range of Washington.",
    pageUrl: "https://en.wikipedia.org/wiki/Mount_Rainier",
    leadImageTitle: "File:Mount_Rainier_from_the_Silver_Queen_Peak.jpg",
    coordinates: null,
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
  summary?: ArticleSummary | null;
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

test("a row with both a description and an image is skipped without any fetching", async () => {
  const stub = stubClient();
  const outcome = await planRow(
    rowAwaitingImage({ has_hero_image: true }),
    stub.client,
    { force: false }
  );

  assert.equal(outcome.kind, "skip");
  assert.deepEqual(stub.calls, [], "a re-run must not re-hit Wikipedia for finished rows");
});

test("--force re-fetches a row that already has a description", async () => {
  const stub = stubClient({ geosearchTitle: "Mount Rainier" });
  const outcome = await planRow(
    rowAwaitingImage({ has_hero_image: true }),
    stub.client,
    { force: true }
  );

  assert.equal(outcome.kind, "write");
  assert.ok(stub.calls.some((call) => call.startsWith("summary:")));
});

test("a description with a broken credit is left alone rather than half-rewritten", async () => {
  const stub = stubClient({ geosearchTitle: "Mount Rainier" });
  const outcome = await planRow(
    rowAwaitingImage({ description_source_url: null }),
    stub.client,
    { force: false }
  );

  assert.equal(outcome.kind, "skip");
  assert.deepEqual(stub.calls, []);
});

test("a row without a name or coordinates is skipped", async () => {
  const stub = stubClient();
  assert.equal((await planRow(row({ name: null }), stub.client, { force: false })).kind, "skip");
  assert.equal((await planRow(row({ lat: null }), stub.client, { force: false })).kind, "skip");
  assert.deepEqual(stub.calls, []);
});

test("the no-name skip reads differently from the already-filled skip", async () => {
  const stub = stubClient();
  const nameless = await planRow(row({ name: null }), stub.client, { force: false });
  const finished = await planRow(
    rowAwaitingImage({ has_hero_image: true }),
    stub.client,
    { force: false }
  );

  assert.equal(nameless.kind, "skip");
  assert.equal(finished.kind, "skip");
  if (nameless.kind !== "skip" || finished.kind !== "skip") assert.fail("both must skip");
  assert.notEqual(
    nameless.reason,
    finished.reason,
    "the run summary counts these apart, so they must not share a reason"
  );
});

// --- Candidate selection ---------------------------------------------------

test("a plain run only asks for rows still missing a description or an image", () => {
  const query = buildCandidateQuery({ ids: null, force: false, minProminence: 300, limit: 25 });

  assert.match(query.text, /d\.description IS NULL OR d\.hero_image IS NULL/);
  assert.deepEqual(query.values, [300, 25], "--limit must walk down the list, not restart it");
});

test("--force asks for filled rows too", () => {
  const query = buildCandidateQuery({ ids: null, force: true, minProminence: 300, limit: 25 });

  assert.ok(
    !/d\.description IS NULL/.test(query.text),
    "--force exists to rewrite rows that already carry copy"
  );
  assert.match(query.text, /'summit' = ANY\(d\.features\)/);
});

test("--ids takes the ids as given, filled or not", () => {
  const query = buildCandidateQuery({
    ids: ["dest-rainier", "dest-baker"],
    force: false,
    minProminence: 300,
    limit: 25,
  });

  assert.match(query.text, /d\.id = ANY\(\$1::text\[\]\)/);
  assert.ok(!/d\.description IS NULL/.test(query.text));
  assert.deepEqual(query.values, [["dest-rainier", "dest-baker"]]);
});

test("every branch selects the stored copy the recovery path writes back", () => {
  for (const query of [
    buildCandidateQuery({ ids: null, force: false, minProminence: 300, limit: 25 }),
    buildCandidateQuery({ ids: ["dest-rainier"], force: false, minProminence: 300, limit: 25 }),
    buildCandidateQuery({
      ids: null,
      force: false,
      minProminence: 300,
      limit: 25,
      listId: "list-bulger",
    }),
    buildCandidateQuery({ ids: null, force: false, minProminence: 300, limit: 25, allLists: true }),
  ]) {
    assert.match(query.text, /d\.description_source_name/);
    assert.match(query.text, /d\.description_source_url/);
    assert.match(query.text, /d\.description_source_license/);
  }
});

// --- --list-id / --all-lists -------------------------------------------

test("--list-id scopes candidates through list_destinations with no prominence floor or summit-feature filter", () => {
  const query = buildCandidateQuery({
    ids: null,
    force: false,
    minProminence: 300,
    limit: 150,
    listId: "DOlya3YYfIg60trgTm0n",
  });

  assert.match(query.text, /list_destinations/);
  assert.match(query.text, /ld\.list_id = \$1/);
  assert.match(query.text, /d\.hero_image IS NULL/);
  assert.ok(
    !/'summit' = ANY/.test(query.text),
    "list membership is the curation — the summit-feature filter would exclude most list members"
  );
  assert.ok(
    !/prominence/i.test(query.text),
    "list membership is the curation — the prominence floor would exclude most list members"
  );
  assert.match(query.text, /ORDER BY d\.elevation DESC/);
  assert.deepEqual(query.values, ["DOlya3YYfIg60trgTm0n", 150]);
});

test("--list-id with --force also reconsiders rows that already have a hero image", () => {
  const query = buildCandidateQuery({
    ids: null,
    force: true,
    minProminence: 300,
    limit: 150,
    listId: "DOlya3YYfIg60trgTm0n",
  });

  assert.ok(
    !/hero_image IS NULL/.test(query.text),
    "--force exists to rewrite rows that already carry an image"
  );
});

test("--all-lists selects across every list, deduplicated by destination, with the same relaxed filters", () => {
  const query = buildCandidateQuery({
    ids: null,
    force: false,
    minProminence: 300,
    limit: 500,
    allLists: true,
  });

  assert.match(query.text, /list_destinations/);
  assert.ok(!/ld\.list_id = \$/.test(query.text), "no single list to filter by");
  assert.match(query.text, /d\.hero_image IS NULL/);
  assert.ok(!/'summit' = ANY/.test(query.text));
  assert.ok(!/prominence/i.test(query.text));
  assert.match(query.text, /ORDER BY d\.elevation DESC/);
  assert.deepEqual(query.values, [500]);
});

test("--all-lists with --force also reconsiders rows that already have a hero image", () => {
  const query = buildCandidateQuery({
    ids: null,
    force: true,
    minProminence: 300,
    limit: 500,
    allLists: true,
  });

  assert.ok(!/hero_image IS NULL/.test(query.text));
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

// --- The wikidata coordinate anchor ----------------------------------------

test("a same-named wikidata article in another state is rejected", async () => {
  // "Crystal Peak" folds the same either side of the parenthetical, so the name
  // check passes and only the coordinates can tell the two summits apart.
  const stub = stubClient({
    wikidataTitle: "Crystal Peak (Colorado)",
    summary: summary({
      title: "Crystal Peak (Colorado)",
      coordinates: { lat: 39.4076, lon: -106.1236 },
    }),
  });
  const outcome = await planRow(
    row({ name: "Crystal Peak", wikidata_id: "Q-wrong" }),
    stub.client,
    { force: false }
  );

  assert.equal(outcome.kind, "miss", "a mis-keyed wikidata id must not write copy");
  if (outcome.kind !== "miss") assert.fail("expected a miss");
  assert.match(outcome.reason, /wikidata article too far/);
  assert.match(outcome.reason, /km/, "the log must say how far off the article sat");
});

test("a wikidata article on the mountain itself is accepted", async () => {
  const stub = stubClient({
    wikidataTitle: "Mount Rainier",
    summary: summary({ coordinates: { lat: 46.8529, lon: -121.7604 } }),
  });
  const outcome = await planRow(row({ wikidata_id: "Q194057" }), stub.client, { force: false });

  assert.equal(outcome.kind, "write");
});

test("a wikidata article with no coordinates is still accepted, but says so", async () => {
  const stub = stubClient({ wikidataTitle: "Mount Rainier", summary: summary() });
  const outcome = await planRow(row({ wikidata_id: "Q194057" }), stub.client, { force: false });

  assert.equal(outcome.kind, "write", "no coordinates is not evidence of a wrong article");
  if (outcome.kind !== "write") assert.fail("expected a write");
  assert.match(outcome.note ?? "", /coordinate check unavailable/);
});

test("the geosearch path is anchored already and carries no distance note", async () => {
  const stub = stubClient({
    geosearchTitle: "Mount Rainier",
    summary: summary({ coordinates: { lat: 46.8529, lon: -121.7604 } }),
  });
  const outcome = await planRow(row(), stub.client, { force: false });

  assert.equal(outcome.kind, "write");
  if (outcome.kind !== "write") assert.fail("expected a write");
  assert.equal(outcome.note, undefined);
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

/**
 * The whole image path, from the bytes Wikipedia actually returns to the write.
 * Every other test in this section hands planRow a leadImageTitle it never had
 * to derive, which is exactly how the production no-op hid: the REST summary
 * carries no `pageimage`, so the parser yielded null and the image half of the
 * backfill silently did nothing across 108 rows.
 */
test("a REST summary with no pageimage still produces an image write", async () => {
  const parsed = parseSummaryResponse({
    type: "standard",
    title: "Mount Rainier",
    titles: { canonical: "Mount_Rainier", normalized: "Mount Rainier" },
    extract: "Mount Rainier is a large active stratovolcano in the Cascade Range of Washington.",
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Mount_Rainier" } },
    thumbnail: {
      source:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Mount_Rainier_from_west.jpg/330px-Mount_Rainier_from_west.jpg",
    },
    originalimage: {
      source: "https://upload.wikimedia.org/wikipedia/commons/f/fa/Mount_Rainier_from_west.jpg",
    },
  });
  assert.ok(parsed, "the real REST shape must parse");

  const stub = stubClient({
    geosearchTitle: "Mount Rainier",
    summary: { ...parsed!, coordinates: { lat: 46.8529, lon: -121.7604 } },
  });
  const outcome = await planRow(row(), stub.client, { force: false });

  assert.ok(
    stub.calls.includes("image:File:Mount_Rainier_from_west.jpg"),
    "the credit lookup must be asked about the file the summary actually named"
  );
  assert.equal(outcome.kind, "write");
  if (outcome.kind !== "write") return;
  assert.equal(outcome.write.heroImage, "https://upload.wikimedia.org/rainier.jpg");
  assert.equal(outcome.write.heroAttribution, "A Photographer / CC BY-SA 4.0");
  assert.equal(
    outcome.write.heroAttributionUrl,
    "https://commons.wikimedia.org/wiki/File:Rainier.jpg"
  );
  assert.equal(outcome.imageSkipReason, undefined);
});

test("a non-free lead image is refused while the description still lands", async () => {
  for (const licence of ["CC BY-NC 2.0", "CC BY-ND 4.0", "Fair use", "All rights reserved"]) {
    const stub = stubClient({
      geosearchTitle: "Mount Rainier",
      imageCredit: credit({ licenseShortName: licence }),
    });
    const outcome = await planRow(row(), stub.client, { force: false });

    assert.equal(outcome.kind, "write");
    if (outcome.kind !== "write") assert.fail(`${licence}: expected a write`);
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

// --- Image-only recovery ---------------------------------------------------

test("a description that landed without its image gets the image on a later run", async () => {
  const stub = stubClient({ geosearchTitle: "Mount Rainier" });
  const candidate = rowAwaitingImage();
  const outcome = await planRow(candidate, stub.client, { force: false });

  assert.equal(outcome.kind, "write", "a failed image must not strand the row forever");
  if (outcome.kind !== "write") assert.fail("expected a write");
  assert.equal(outcome.write.heroImage, "https://upload.wikimedia.org/rainier.jpg");
  assert.equal(outcome.write.heroAttribution, "A Photographer / CC BY-SA 4.0");
  // The stored copy rides along verbatim, so the UPDATE is a no-op on those columns.
  assert.equal(outcome.write.description, candidate.description);
  assert.equal(outcome.write.sourceName, candidate.description_source_name);
  assert.equal(outcome.write.sourceUrl, candidate.description_source_url);
  assert.equal(outcome.write.sourceLicense, candidate.description_source_license);
});

test("recovery refuses a non-free image and leaves the row as it stands", async () => {
  const stub = stubClient({
    geosearchTitle: "Mount Rainier",
    imageCredit: credit({ licenseShortName: "CC BY-NC 2.0" }),
  });
  const outcome = await planRow(rowAwaitingImage(), stub.client, { force: false });

  assert.equal(outcome.kind, "miss", "there is nothing to write, so nothing is written");
  if (outcome.kind !== "miss") assert.fail("expected a miss");
  assert.match(outcome.imageSkipReason ?? "", /CC BY-NC 2\.0/);
});

test("recovery on an article with no lead image writes nothing", async () => {
  const stub = stubClient({
    geosearchTitle: "Mount Rainier",
    summary: summary({ leadImageTitle: null }),
  });
  const outcome = await planRow(rowAwaitingImage(), stub.client, { force: false });

  assert.equal(outcome.kind, "miss");
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

/**
 * A database that would happily accept the write. A fake that throws proves
 * nothing here: the rejection would read the same whether the guard stopped the
 * write or the query itself blew up. This one succeeds, so a missing guard
 * shows as a query that reached the table.
 */
function willingDb() {
  const queries: any[][] = [];
  return {
    queries,
    async query(_text: string, values?: any[]) {
      queries.push(values ?? []);
      return { rowCount: 1 };
    },
  };
}

test("writeRow refuses a description that lacks any part of the credit triple", async () => {
  const fakeDb = willingDb();

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
  assert.deepEqual(fakeDb.queries, [], "nothing uncredited may reach the table");
});

test("writeRow refuses a hero image without attribution", async () => {
  const fakeDb = willingDb();

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
  assert.deepEqual(fakeDb.queries, []);
});

test("writeRow refuses attribution with no image behind it", async () => {
  const fakeDb = willingDb();

  // The hero columns COALESCE one by one, so a stray credit would re-label
  // whatever picture an earlier run left in place.
  await assert.rejects(() =>
    writeRow(fakeDb, "dest-rainier", {
      matchedTitle: "Mount Rainier",
      description: "Mount Rainier is a large active stratovolcano.",
      sourceName: "Wikipedia",
      sourceUrl: "https://en.wikipedia.org/wiki/Mount_Rainier",
      sourceLicense: "CC BY-SA 4.0",
      heroImage: null,
      heroAttribution: "A Photographer / CC BY-SA 4.0",
      heroAttributionUrl: null,
    })
  );
  assert.deepEqual(fakeDb.queries, []);
});

test("stringFlagFrom returns the value that follows the flag, or null when absent", () => {
  const argv = ["node", "script", "--ids", "a,b,c", "--dry-run"];

  assert.equal(stringFlagFrom(argv, "ids"), "a,b,c");
  assert.equal(stringFlagFrom(argv, "min-prominence"), null);
});

test("stringFlagFrom refuses to swallow the next flag as a value", () => {
  // "--limit --force" used to hand back "--force" as the limit: it parsed to
  // NaN, silently fell back to 100, and ate --force on the way past.
  assert.throws(
    () => stringFlagFrom(["node", "script", "--limit", "--force"], "limit"),
    FlagUsageError
  );
  assert.throws(
    () => stringFlagFrom(["node", "script", "--limit"], "limit"),
    FlagUsageError,
    "a flag at the end of the arguments has no value either"
  );
});

test("intFlagFrom takes whole numbers, falls back only when the flag is absent", () => {
  assert.equal(intFlagFrom(["node", "script", "--limit", "250"], "limit", 100), 250);
  assert.equal(intFlagFrom(["node", "script", "--dry-run"], "limit", 100), 100);
  assert.equal(
    intFlagFrom(["node", "script", "--min-prominence", "-50"], "min-prominence", 300),
    -50
  );
});

test("intFlagFrom stops the run on a value it cannot read as a number", () => {
  for (const bad of ["abc", "", "12abc", "1e3", "3.5"]) {
    assert.throws(
      () => intFlagFrom(["node", "script", "--limit", bad], "limit", 100),
      FlagUsageError,
      `"${bad}" must stop the run rather than fall back to 100`
    );
  }
});

// --- parseArgs ---------------------------------------------------------

test("parseArgs reads --list-id and leaves --all-lists off", () => {
  const args = parseArgs(["node", "script", "--list-id", "DOlya3YYfIg60trgTm0n", "--dry-run"]);

  assert.equal(args.listId, "DOlya3YYfIg60trgTm0n");
  assert.equal(args.allLists, false);
  assert.equal(args.dryRun, true);
  assert.equal(args.commit, false);
});

test("parseArgs reads --all-lists and leaves --list-id null", () => {
  const args = parseArgs(["node", "script", "--all-lists", "--commit"]);

  assert.equal(args.allLists, true);
  assert.equal(args.listId, null);
  assert.equal(args.commit, true);
});

test("parseArgs rejects --list-id and --all-lists together", () => {
  assert.throws(
    () => parseArgs(["node", "script", "--list-id", "abc", "--all-lists"]),
    FlagUsageError
  );
});

test("parseArgs rejects --list-id combined with --ids", () => {
  assert.throws(
    () => parseArgs(["node", "script", "--list-id", "abc", "--ids", "a,b"]),
    FlagUsageError
  );
});

test("parseArgs rejects --all-lists combined with --ids", () => {
  assert.throws(
    () => parseArgs(["node", "script", "--all-lists", "--ids", "a,b"]),
    FlagUsageError
  );
});

test("parseArgs rejects --dry-run and --commit together", () => {
  assert.throws(() => parseArgs(["node", "script", "--dry-run", "--commit"]), FlagUsageError);
});

test("parseArgs rejects a blank --list-id value rather than falling back to the whole catalog", () => {
  // A quoted empty string or an unset shell variable passed quoted —
  // `--list-id "$UNSET"` — must not silently read as "no scope given" and
  // fall through to the default, prominence-ordered, catalog-wide branch.
  assert.throws(
    () => parseArgs(["node", "script", "--list-id", "", "--commit"]),
    FlagUsageError
  );
});

test("parseArgs rejects a whitespace-only --list-id value", () => {
  assert.throws(
    () => parseArgs(["node", "script", "--list-id", "   "]),
    FlagUsageError
  );
});

test("parseArgs rejects an unrecognized flag", () => {
  // A typo like --all-list (missing the final s) used to be silently
  // ignored, which is exactly as dangerous as a blank --list-id: the run
  // falls through to the default branch without saying so.
  assert.throws(
    () => parseArgs(["node", "script", "--all-list", "--commit"]),
    FlagUsageError
  );
});

test("parseArgs defaults: no list scope, not a dry run without the flag, commit off by default", () => {
  const args = parseArgs(["node", "script"]);

  assert.equal(args.listId, null);
  assert.equal(args.allLists, false);
  assert.equal(args.dryRun, false);
  assert.equal(args.commit, false);
  assert.equal(args.force, false);
  assert.equal(args.limit, 100);
  assert.equal(args.minProminence, 300);
  assert.equal(args.ids, null);
});
