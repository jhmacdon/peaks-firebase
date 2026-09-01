/** Builds the pinned DoBIH v18.5 source fixture for the Deweys. */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DOBIH_ARCHIVE_SHA256,
  DOBIH_CSV_SHA256,
  DOBIH_SOURCES_SHA256,
  buildDobihSourceMember,
  parseDobihRows,
  type ParsedDobihRow,
} from "./build-dobih-open-eight-fixture";
import {
  type KeeperImportFixture,
  validateKeeperFixture,
} from "./keeper-list-import/core";
import {
  DOBIH_DEWEYS_COUNTRY_COUNTS,
  DOBIH_DEWEYS_ISLE_OF_MAN_NUMBERS,
  DOBIH_DEWEYS_KEEPER_LISTS,
  DOBIH_DEWEYS_ROUTE_PUBLICATION_BLOCKS,
  DOBIH_DEWEYS_SELECTION,
} from "./keeper-list-import/bundles/dobih-deweys";
import { DOBIH_WELSH_3000S_NUMBERS } from
  "./keeper-list-import/bundles/dobih-smaller-majority-four";

const WELSH_3000S_NUMBER_SET = new Set<number>(DOBIH_WELSH_3000S_NUMBERS);

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded == null) throw new Error("DoBIH Deweys fixture contains a non-JSON value");
  return encoded;
}

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isPreviouslyReviewedMember(row: ParsedDobihRow): boolean {
  return row.flags.C || row.flags.W || row.flags.MT || row.flags.F ||
    row.flags.D || row.flags.DT || row.flags.WO || row.flags.Fel ||
    row.flags.VL || row.flags.Hew || row.flags.G || row.flags.DDew ||
    row.flags.sMa || WELSH_3000S_NUMBER_SET.has(row.number);
}

function assertFixtureComposition(
  fixture: KeeperImportFixture,
  sourceRows: ParsedDobihRow[]
): void {
  const selectedRows = sourceRows.filter((row) => row.flags.Dew);
  const members = fixture.lists["dobih-deweys"].rows;
  if (selectedRows.length !== 425 || members.length !== 425) {
    throw new Error(
      `DoBIH Deweys fixture has ${selectedRows.length}/${members.length} source/member rows; ` +
      "expected 425/425"
    );
  }

  const uniqueIds = new Set(members.map((member) => member.sourceMemberId));
  if (uniqueIds.size !== 425) {
    throw new Error(`DoBIH Deweys fixture has ${uniqueIds.size} distinct members; expected 425`);
  }

  const reviewedCount = selectedRows.filter(isPreviouslyReviewedMember).length;
  if (reviewedCount !== 52 || selectedRows.length - reviewedCount !== 373) {
    throw new Error(
      `DoBIH Deweys prior/new identity split is ` +
      `${reviewedCount}/${selectedRows.length - reviewedCount}; expected 52/373`
    );
  }

  const countryCounts = Object.fromEntries(
    Object.keys(DOBIH_DEWEYS_COUNTRY_COUNTS).map((country) => [
      country,
      selectedRows.filter((row) => row.country === country).length,
    ])
  );
  if (canonicalJson(countryCounts) !== canonicalJson(DOBIH_DEWEYS_COUNTRY_COUNTS) ||
      selectedRows.some((row) =>
        !Object.prototype.hasOwnProperty.call(DOBIH_DEWEYS_COUNTRY_COUNTS, row.country))) {
    throw new Error(
      `DoBIH Deweys country split ${canonicalJson(countryCounts)} does not match ` +
      canonicalJson(DOBIH_DEWEYS_COUNTRY_COUNTS)
    );
  }

  const isleOfManNumbers = selectedRows
    .filter((row) => row.country === "M")
    .map((row) => row.number);
  if (canonicalJson(isleOfManNumbers) !== canonicalJson(DOBIH_DEWEYS_ISLE_OF_MAN_NUMBERS)) {
    throw new Error("DoBIH Deweys Isle of Man members changed");
  }

  if (DOBIH_DEWEYS_ROUTE_PUBLICATION_BLOCKS.length !== 1) {
    throw new Error("DoBIH Deweys must keep one reviewed route-publication block");
  }
  const [block] = DOBIH_DEWEYS_ROUTE_PUBLICATION_BLOCKS;
  const blockedMember = members.find((member) => member.sourceMemberId === block.sourceMemberId);
  if (block.sourceMemberId !== "dobih:3649" ||
      block.name !== "Great Links Tor" ||
      block.reason !== "technical_rock_summit" ||
      block.routePublicationAllowed !== false ||
      block.accessUrl !== "https://ldwa.org.uk/hillwalkers/register5.php" ||
      blockedMember?.ordinal !== 408 ||
      blockedMember.name !== block.name) {
    throw new Error("DoBIH Deweys Great Links Tor publication block changed");
  }
}

export function buildDobihDeweysFixture(
  csvBytes: Buffer,
  sourceMetadata: unknown
): KeeperImportFixture {
  const actualCsvSha256 = sha256(csvBytes);
  if (actualCsvSha256 !== DOBIH_CSV_SHA256) {
    throw new Error(
      `DoBIH CSV checksum ${actualCsvSha256} does not match ${DOBIH_CSV_SHA256}`
    );
  }
  if (!isRecord(sourceMetadata)) throw new Error("DoBIH source metadata is missing");
  if (sourceMetadata.archiveSha256 !== DOBIH_ARCHIVE_SHA256 ||
      sourceMetadata.csvSha256 !== DOBIH_CSV_SHA256 ||
      sourceMetadata.license !== "CC BY 4.0" ||
      sourceMetadata.licenseUrl !== "https://creativecommons.org/licenses/by/4.0/") {
    throw new Error(
      "DoBIH source metadata does not pin the reviewed archive, CSV, and CC BY 4.0 license"
    );
  }
  const sources = { "dobih-v18.5": sourceMetadata };
  const actualSourcesSha256 = canonicalSha256(sources);
  if (actualSourcesSha256 !== DOBIH_SOURCES_SHA256) {
    throw new Error(
      `DoBIH source metadata checksum ${actualSourcesSha256} does not match ` +
      DOBIH_SOURCES_SHA256
    );
  }

  const csvText = new TextDecoder("utf-8", { fatal: true }).decode(csvBytes);
  const sourceRows = parseDobihRows(csvText);
  const selectedRows = sourceRows
    .filter((row) => row.flags.Dew)
    .sort((left, right) => left.number - right.number);
  const fixture: KeeperImportFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-01",
    sources,
    lists: {
      "dobih-deweys": {
        source: "dobih-v18.5",
        selection: DOBIH_DEWEYS_SELECTION,
        rows: selectedRows.map((row, index) => buildDobihSourceMember(row, index + 1)),
      },
    },
  };
  assertFixtureComposition(fixture, sourceRows);
  validateKeeperFixture(fixture, DOBIH_DEWEYS_KEEPER_LISTS);
  return fixture;
}

interface BuildFixtureArgs {
  input: string;
  baseFixture: string;
  output: string;
}

function parseBuildFixtureArgs(argv: string[]): BuildFixtureArgs {
  const repoRoot = path.resolve(__dirname, "../../..");
  const defaults: BuildFixtureArgs = {
    input: "/private/tmp/dobih-v18.5/DoBIH_v18_5.csv",
    baseFixture: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-candidates-2026-08-30.json"
    ),
    output: path.join(
      repoRoot,
      "docs/data-audits/fixtures/keeper-list-dobih-deweys-candidates-2026-09-01.json"
    ),
  };
  const options: Array<[string, keyof BuildFixtureArgs]> = [
    ["--input=", "input"],
    ["--base-fixture=", "baseFixture"],
    ["--output=", "output"],
  ];
  const parsed = { ...defaults };
  const seen = new Set<keyof BuildFixtureArgs>();
  for (const argument of argv) {
    const option = options.find(([prefix]) => argument.startsWith(prefix));
    if (option == null) throw new Error(`Unknown option: ${argument}`);
    const [prefix, key] = option;
    const value = argument.slice(prefix.length).trim();
    if (value.length === 0) throw new Error(`${prefix.slice(0, -1)} requires a path`);
    if (seen.has(key)) throw new Error(`${prefix.slice(0, -1)} was provided twice`);
    parsed[key] = path.resolve(value);
    seen.add(key);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = parseBuildFixtureArgs(process.argv.slice(2));
  const [csvBytes, baseFixtureText] = await Promise.all([
    fs.readFile(args.input),
    fs.readFile(args.baseFixture, "utf8"),
  ]);
  const baseFixture = JSON.parse(baseFixtureText) as KeeperImportFixture;
  const sourceMetadata = baseFixture.sources?.["dobih-v18.5"];
  const fixture = buildDobihDeweysFixture(csvBytes, sourceMetadata);
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(`Wrote ${args.output}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
