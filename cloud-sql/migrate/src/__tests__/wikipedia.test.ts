import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  WIKIPEDIA_TEXT_LICENSE,
  buildImageAttribution,
  buildPlaceCopy,
  isFreeLicense,
  namesMatch,
  parseImageInfoResponse,
  parseSummaryResponse,
  shortenSummary,
} from "../lib/wikipedia";

test("shortenSummary keeps whole sentences under the cap", () => {
  const extract =
    "Mount Rainier is a large active stratovolcano in the Cascade Range. " +
    "It is the highest mountain in Washington. " +
    "The mountain carries more glacial ice than any other peak in the contiguous United States. " +
    "It is a Decade Volcano.";

  const short = shortenSummary(extract, 160);

  assert.equal(
    short,
    "Mount Rainier is a large active stratovolcano in the Cascade Range. It is the highest mountain in Washington."
  );
  assert.ok(short.length <= 160);
});

test("shortenSummary returns a short extract unchanged", () => {
  const extract = "Crystal Peak is a summit in Mount Rainier National Park.";
  assert.equal(shortenSummary(extract, 420), extract);
});

test("shortenSummary hard-truncates a single monster sentence at a word boundary", () => {
  const extract = "A ".repeat(400) + "end.";
  const short = shortenSummary(extract, 100);
  assert.ok(short.length <= 100);
  assert.ok(short.endsWith("…"), "a hard truncation must be visibly elided");
});

test("shortenSummary collapses whitespace and trims", () => {
  assert.equal(shortenSummary("  Aa.\n\n  Bb.  ", 420), "Aa. Bb.");
});

test("shortenSummary does not break a sentence at an abbreviation", () => {
  const extract =
    "The climb starts at Paradise and follows the Muir Snowfield toward Mt. Rainier itself. " +
    "Most parties bivouac at Camp Muir before the summit push. " +
    "The final section crosses the Disappointment Cleaver.";

  // A cap that lands inside the first sentence must not stop at "Mt.": the
  // abbreviation carries the sentence on, so the cut falls to the hard
  // truncation with the place name intact.
  const tight = shortenSummary(extract, 80);

  assert.equal(
    tight,
    "The climb starts at Paradise and follows the Muir Snowfield toward Mt. Rainier…"
  );
  assert.ok(tight.includes("Mt. Rainier"), "the abbreviation must survive intact");
  assert.equal(tight.endsWith("Mt."), false, "a dangling abbreviation is not a sentence end");
  assert.ok(tight.length <= 80);

  // With room for whole sentences, the cut lands on a real boundary.
  const roomy = shortenSummary(extract, 150);

  assert.ok(roomy.includes("Mt. Rainier"), "the abbreviation must survive intact");
  assert.ok(roomy.endsWith("push."), "the cut must land on a real sentence boundary");
  assert.ok(roomy.length <= 150);
});

test("shortenSummary keeps a dotted abbreviation inside its sentence", () => {
  const extract =
    "Permits are required for overnight trips. " +
    "The U.S. Forest Service manages the wilderness. " +
    "Rangers patrol the main trailheads.";

  // A cap that lands inside the U.S. sentence falls back to the previous whole
  // sentence rather than stopping at the abbreviation's full stop.
  const tight = shortenSummary(extract, 60);
  assert.equal(tight, "Permits are required for overnight trips.");

  // With room for it, the sentence survives whole.
  const roomy = shortenSummary(extract, 100);
  assert.equal(
    roomy,
    "Permits are required for overnight trips. The U.S. Forest Service manages the wilderness."
  );
  assert.ok(roomy.length <= 100);
});

test("shortenSummary ends a sentence that finishes on a number", () => {
  const extract =
    "The peak was first climbed in 1870. Today thousands of climbers attempt it every year.";

  const short = shortenSummary(extract, 70);

  assert.equal(short, "The peak was first climbed in 1870.");
  assert.ok(short.length <= 70);
});

test("shortenSummary ends a sentence that finishes on a unit", () => {
  const extract =
    "Mount Rainier rises to 14,411 ft. " +
    "It carries more glacial ice than any other peak in the contiguous United States.";

  const short = shortenSummary(extract, 100);

  assert.equal(short, "Mount Rainier rises to 14,411 ft.");
  assert.ok(short.length <= 100);
});

test("shortenSummary does not break inside a decimal number", () => {
  const extract =
    "Mount Rainier rises to 4,392.1 m above sea level in the Cascade Range. " +
    "Its glaciers feed six major rivers. " +
    "Climbers approach from Paradise on the south side.";

  const short = shortenSummary(extract, 120);

  assert.ok(short.includes("4,392.1 m"), "the decimal must survive intact");
  assert.ok(short.endsWith("rivers."), "the cut must land on a real sentence boundary");
  assert.ok(short.length <= 120);
});

test("namesMatch tolerates Mount/Mt and punctuation but rejects different peaks", () => {
  assert.ok(namesMatch("Mount Rainier", "Mount Rainier"));
  assert.ok(namesMatch("Mt. Rainier", "Mount Rainier"));
  assert.ok(namesMatch("Mount Rainier", "Mount Rainier (Washington)"));
  assert.equal(namesMatch("Crystal Peak", "Crystal Mountain"), false);
  assert.equal(namesMatch("Mount Adams", "Mount Rainier"), false);
});

test("parseSummaryResponse extracts text, page URL, and lead image title", () => {
  const json = {
    title: "Mount Rainier",
    extract: "Mount Rainier is a stratovolcano.",
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Mount_Rainier" } },
    originalimage: { source: "https://upload.wikimedia.org/…/Mount_Rainier.jpg" },
    titles: { canonical: "Mount_Rainier" },
    pageimage: "Mount_Rainier_from_the_Silver_Queen_Peak.jpg",
  };

  const summary = parseSummaryResponse(json);

  assert.ok(summary);
  assert.equal(summary!.title, "Mount Rainier");
  assert.equal(summary!.extract, "Mount Rainier is a stratovolcano.");
  assert.equal(summary!.pageUrl, "https://en.wikipedia.org/wiki/Mount_Rainier");
  assert.equal(summary!.leadImageTitle, "File:Mount_Rainier_from_the_Silver_Queen_Peak.jpg");
});

test("parseSummaryResponse rejects disambiguation pages and empty extracts", () => {
  assert.equal(parseSummaryResponse({ type: "disambiguation", title: "Rainier", extract: "x" }), null);
  assert.equal(parseSummaryResponse({ title: "Rainier", extract: "   " }), null);
  assert.equal(parseSummaryResponse({ title: "Rainier" }), null);
  assert.equal(parseSummaryResponse(null), null);
});

test("parseSummaryResponse yields a null lead image when the page has none", () => {
  const summary = parseSummaryResponse({
    title: "Nameless Bump",
    extract: "A bump.",
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Nameless_Bump" } },
  });
  assert.ok(summary);
  assert.equal(summary!.leadImageTitle, null);
});

test("parseImageInfoResponse pulls url, artist, licence, and file page", () => {
  const json = {
    query: {
      pages: {
        "-1": {
          title: "File:Mount_Rainier.jpg",
          imageinfo: [
            {
              url: "https://upload.wikimedia.org/…/Mount_Rainier.jpg",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg",
              extmetadata: {
                Artist: { value: '<a href="/wiki/User:Someone">Someone</a>' },
                LicenseShortName: { value: "CC BY-SA 4.0" },
              },
            },
          ],
        },
      },
    },
  };

  const credit = parseImageInfoResponse(json);

  assert.ok(credit);
  assert.equal(credit!.imageUrl, "https://upload.wikimedia.org/…/Mount_Rainier.jpg");
  assert.equal(credit!.artist, "Someone", "HTML in the Artist field must be stripped");
  assert.equal(credit!.licenseShortName, "CC BY-SA 4.0");
  assert.equal(credit!.descriptionUrl, "https://commons.wikimedia.org/wiki/File:Mount_Rainier.jpg");
});

test("parseImageInfoResponse returns null when the licence is unknown", () => {
  const json = {
    query: {
      pages: {
        "-1": {
          imageinfo: [
            {
              url: "https://upload.wikimedia.org/…/x.jpg",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:X.jpg",
              extmetadata: {},
            },
          ],
        },
      },
    },
  };
  assert.equal(parseImageInfoResponse(json), null);
});

test("isFreeLicense accepts CC/public-domain and rejects fair use", () => {
  assert.ok(isFreeLicense("CC BY-SA 4.0"));
  assert.ok(isFreeLicense("CC BY 2.0"));
  assert.ok(isFreeLicense("CC0"));
  assert.ok(isFreeLicense("Public domain"));
  assert.equal(isFreeLicense("Fair use"), false);
  assert.equal(isFreeLicense("All rights reserved"), false);
  assert.equal(isFreeLicense(""), false);
});

test("isFreeLicense rejects NonCommercial and NoDerivatives variants", () => {
  assert.equal(isFreeLicense("CC BY-NC 2.0"), false);
  assert.equal(isFreeLicense("CC BY-NC-SA 4.0"), false);
  assert.equal(isFreeLicense("CC BY-ND 4.0"), false);
  assert.ok(isFreeLicense("CC BY-SA 4.0"), "share-alike stays free");
});

test("isFreeLicense reads typographic hyphens as plain ones", () => {
  // U+2011 non-breaking hyphens, as Commons sometimes writes them.
  assert.ok(isFreeLicense("CC‑BY‑SA 4.0"));
  assert.equal(isFreeLicense("CC‑BY‑NC 4.0"), false);
});

test("buildImageAttribution names the artist and licence", () => {
  assert.equal(
    buildImageAttribution({
      imageUrl: "u",
      artist: "Someone",
      licenseShortName: "CC BY-SA 4.0",
      descriptionUrl: "d",
    }),
    "Someone / CC BY-SA 4.0"
  );
  assert.equal(
    buildImageAttribution({ imageUrl: "u", artist: null, licenseShortName: "CC0", descriptionUrl: "d" }),
    "Wikimedia Commons / CC0"
  );
});

test("buildPlaceCopy stamps Wikipedia credit onto a shortened extract", () => {
  const copy = buildPlaceCopy(
    {
      title: "Mount Rainier",
      extract: "Mount Rainier is a stratovolcano. It is the highest peak in Washington. It has 25 named glaciers.",
      pageUrl: "https://en.wikipedia.org/wiki/Mount_Rainier",
      leadImageTitle: null,
    },
    80
  );

  assert.ok(copy);
  // Two sentences fit under the 80-char cap (71); the third would overrun at 97.
  assert.equal(
    copy!.description,
    "Mount Rainier is a stratovolcano. It is the highest peak in Washington."
  );
  assert.ok(copy!.description.length <= 80);
  assert.equal(copy!.sourceName, "Wikipedia");
  assert.equal(copy!.sourceUrl, "https://en.wikipedia.org/wiki/Mount_Rainier");
  assert.equal(copy!.sourceLicense, WIKIPEDIA_TEXT_LICENSE);
});

test("buildPlaceCopy refuses copy it cannot credit", () => {
  assert.equal(
    buildPlaceCopy({ title: "X", extract: "Some text.", pageUrl: "", leadImageTitle: null }),
    null
  );
});
