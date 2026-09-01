/** Builds the pinned DoBIH v18.5 source fixture for Birketts and Synges. */

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
  DOBIH_BIRKETTS_SELECTION,
  DOBIH_BIRKETTS_SYNGES_KEEPER_LISTS,
  DOBIH_BIRKETTS_SYNGES_ROUTE_PUBLICATION_BLOCKS,
  DOBIH_SYNGES_SELECTION,
} from "./keeper-list-import/bundles/dobih-birketts-synges";
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
  if (encoded == null) {
    throw new Error("DoBIH Birketts/Synges fixture contains a non-JSON value");
  }
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
    row.flags.VL || row.flags.Hew || row.flags.G || row.flags.Dew ||
    row.flags.DDew || row.flags.sMa || WELSH_3000S_NUMBER_SET.has(row.number);
}

function selectedRows(sourceRows: ParsedDobihRow[], flag: "B" | "Sy"): ParsedDobihRow[] {
  return sourceRows
    .filter((row) => row.flags[flag])
    .sort((left, right) => left.number - right.number);
}

function assertFixtureComposition(
  fixture: KeeperImportFixture,
  sourceRows: ParsedDobihRow[]
): void {
  const birkettsRows = selectedRows(sourceRows, "B");
  const syngesRows = selectedRows(sourceRows, "Sy");
  const birketts = fixture.lists["dobih-birketts"].rows;
  const synges = fixture.lists["dobih-synges"].rows;
  if (birkettsRows.length !== 541 || birketts.length !== 541 ||
      syngesRows.length !== 670 || synges.length !== 670) {
    throw new Error(
      "DoBIH Birketts/Synges source and fixture counts must be 541/541 and 670/670"
    );
  }

  const birkettsIds = new Set(birketts.map((member) => member.sourceMemberId));
  const syngesIds = new Set(synges.map((member) => member.sourceMemberId));
  const allIds = new Set([...birkettsIds, ...syngesIds]);
  const sharedIds = [...birkettsIds].filter((sourceMemberId) => syngesIds.has(sourceMemberId));
  if (birkettsIds.size !== 541 || syngesIds.size !== 670 ||
      allIds.size !== 723 || sharedIds.length !== 488) {
    throw new Error(
      `DoBIH Birketts/Synges identity counts are ${birkettsIds.size}/` +
      `${syngesIds.size}/${allIds.size}/${sharedIds.length}; expected 541/670/723/488`
    );
  }

  const reviewedIds = new Set(sourceRows
    .filter(isPreviouslyReviewedMember)
    .map((row) => `dobih:${row.number}`));
  const priorUnique = [...allIds].filter((sourceMemberId) => reviewedIds.has(sourceMemberId));
  const newUnique = [...allIds].filter((sourceMemberId) => !reviewedIds.has(sourceMemberId));
  const birkettsPrior = [...birkettsIds]
    .filter((sourceMemberId) => reviewedIds.has(sourceMemberId)).length;
  const syngesPrior = [...syngesIds]
    .filter((sourceMemberId) => reviewedIds.has(sourceMemberId)).length;
  if (priorUnique.length !== 323 || newUnique.length !== 400 ||
      birkettsPrior !== 302 || syngesPrior !== 322) {
    throw new Error(
      `DoBIH Birketts/Synges prior/new counts are ${priorUnique.length}/` +
      `${newUnique.length}, with ${birkettsPrior}/${syngesPrior} prior list rows; ` +
      "expected 323/400 and 302/322"
    );
  }

  if ([...birkettsRows, ...syngesRows].some((row) => row.country !== "E")) {
    throw new Error("DoBIH Birketts and Synges must contain only England source rows");
  }

  if (DOBIH_BIRKETTS_SYNGES_ROUTE_PUBLICATION_BLOCKS.length !== 1) {
    throw new Error("DoBIH Birketts/Synges must keep one shared route-publication block");
  }
  const [block] = DOBIH_BIRKETTS_SYNGES_ROUTE_PUBLICATION_BLOCKS;
  const blockedBirketts = birketts.find((member) =>
    member.sourceMemberId === block.sourceMemberId);
  const blockedSynges = synges.find((member) => member.sourceMemberId === block.sourceMemberId);
  if (block.sourceMemberId !== "dobih:2390" ||
      block.name !== "Pillar Rock" ||
      block.reason !== "technical_rock_summit" ||
      block.routePublicationAllowed !== false ||
      block.claimAcceptedWithoutSummit !== true ||
      canonicalJson(block.sourceKeys) !==
        canonicalJson(["dobih-birketts", "dobih-synges"]) ||
      block.accessUrl !== "https://ldwa.org.uk/hillwalkers/register2.php" ||
      blockedBirketts?.ordinal !== 61 || blockedBirketts.name !== block.name ||
      blockedSynges?.ordinal !== 65 || blockedSynges.name !== block.name) {
    throw new Error("DoBIH Birketts/Synges Pillar Rock rule changed");
  }
}

export function buildDobihBirkettsSyngesFixture(
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
  const birkettsRows = selectedRows(sourceRows, "B");
  const syngesRows = selectedRows(sourceRows, "Sy");
  const fixture: KeeperImportFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-01",
    sources,
    lists: {
      "dobih-birketts": {
        source: "dobih-v18.5",
        selection: DOBIH_BIRKETTS_SELECTION,
        rows: birkettsRows.map((row, index) => buildDobihSourceMember(row, index + 1)),
      },
      "dobih-synges": {
        source: "dobih-v18.5",
        selection: DOBIH_SYNGES_SELECTION,
        rows: syngesRows.map((row, index) => buildDobihSourceMember(row, index + 1)),
      },
    },
  };
  assertFixtureComposition(fixture, sourceRows);
  validateKeeperFixture(fixture, DOBIH_BIRKETTS_SYNGES_KEEPER_LISTS);
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
      "docs/data-audits/fixtures/" +
        "keeper-list-dobih-birketts-synges-candidates-2026-09-01.json"
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
  const fixture = buildDobihBirkettsSyngesFixture(csvBytes, sourceMetadata);
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
