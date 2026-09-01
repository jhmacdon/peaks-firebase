/** Builds the pinned DoBIH v18.5 source fixture for four RHSoc registers. */

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
  type KeeperSourceList,
  validateKeeperFixture,
} from "./keeper-list-import/core";
import {
  DOBIH_GREAT_BRITAIN_MARILYNS_SELECTION,
  DOBIH_HIGH_HILLS_OF_BRITAIN_SELECTION,
  DOBIH_RHSOC_FOUR_KEEPER_LISTS,
  DOBIH_RHSOC_FOUR_NAMED_COMPLETION_EXCEPTIONS,
  DOBIH_RHSOC_FOUR_ROUTE_PUBLICATION_BLOCKS,
  DOBIH_RHSOC_FOUR_ROUTE_SAFETY_AUDIT_COMPLETE,
  DOBIH_RHSOC_FOUR_ROUTE_SAFETY_WARNING,
  DOBIH_SIMMS_SELECTION,
  DOBIH_SUBSIMMS_SELECTION,
} from "./keeper-list-import/bundles/dobih-rhsoc-four";
import { DOBIH_WELSH_3000S_NUMBERS } from
  "./keeper-list-import/bundles/dobih-smaller-majority-four";

interface RhsocFourSelection {
  sourceKey: string;
  selection: string;
  includes(row: ParsedDobihRow): boolean;
}

const GREAT_BRITAIN_COUNTRIES = new Set(["E", "ES", "S", "W"]);
const WELSH_3000S_NUMBER_SET = new Set<number>(DOBIH_WELSH_3000S_NUMBERS);

const RHSOC_FOUR_SELECTIONS: RhsocFourSelection[] = [
  {
    sourceKey: "dobih-great-britain-marilyns",
    selection: DOBIH_GREAT_BRITAIN_MARILYNS_SELECTION,
    includes: (row) => row.flags.Ma && GREAT_BRITAIN_COUNTRIES.has(row.country),
  },
  {
    sourceKey: "dobih-high-hills-of-britain",
    selection: DOBIH_HIGH_HILLS_OF_BRITAIN_SELECTION,
    includes: (row) => row.flags.HHB,
  },
  {
    sourceKey: "dobih-simms",
    selection: DOBIH_SIMMS_SELECTION,
    includes: (row) => row.flags.Sim,
  },
  {
    sourceKey: "dobih-subsimms",
    selection: DOBIH_SUBSIMMS_SELECTION,
    includes: (row) => row.flags.sSim,
  },
];

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
  if (encoded == null) throw new Error("DoBIH RHSoc fixture contains a non-JSON value");
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
    row.flags.DDew || row.flags.sMa || row.flags.B || row.flags.Sy ||
    WELSH_3000S_NUMBER_SET.has(row.number);
}

function pairOverlap(
  fixture: KeeperImportFixture,
  leftSourceKey: string,
  rightSourceKey: string
): number {
  const leftIds = new Set(fixture.lists[leftSourceKey].rows.map(
    (member) => member.sourceMemberId
  ));
  return fixture.lists[rightSourceKey].rows.filter(
    (member) => leftIds.has(member.sourceMemberId)
  ).length;
}

function sourceCountrySplit(rows: ParsedDobihRow[]): Record<string, number> {
  const split: Record<string, number> = {};
  for (const row of rows) split[row.country] = (split[row.country] ?? 0) + 1;
  return Object.fromEntries(Object.entries(split).sort(([left], [right]) =>
    left.localeCompare(right)));
}

function assertFixtureComposition(
  fixture: KeeperImportFixture,
  sourceRows: ParsedDobihRow[]
): void {
  const expectedCounts: Record<string, number> = {
    "dobih-great-britain-marilyns": 1_550,
    "dobih-high-hills-of-britain": 1_035,
    "dobih-simms": 2_755,
    "dobih-subsimms": 739,
  };
  const selectedSourceRows = new Map<string, ParsedDobihRow[]>();
  for (const selection of RHSOC_FOUR_SELECTIONS) {
    const selected = sourceRows
      .filter(selection.includes)
      .sort((left, right) => left.number - right.number);
    selectedSourceRows.set(selection.sourceKey, selected);
    const fixtureCount = fixture.lists[selection.sourceKey].rows.length;
    const expected = expectedCounts[selection.sourceKey];
    if (selected.length !== expected || fixtureCount !== expected) {
      throw new Error(
        `DoBIH RHSoc list ${selection.sourceKey} has ${selected.length}/${fixtureCount} ` +
        `source/fixture rows; expected ${expected}/${expected}`
      );
    }
  }

  const allMembers = DOBIH_RHSOC_FOUR_KEEPER_LISTS.flatMap(
    (definition) => fixture.lists[definition.sourceKey].rows
  );
  if (allMembers.length !== 6_079) {
    throw new Error(`DoBIH RHSoc fixture has ${allMembers.length} memberships; expected 6079`);
  }

  const identityBySourceId = new Map<string, string>();
  const membershipCountBySourceId = new Map<string, number>();
  for (const member of allMembers) {
    const { ordinal: _ordinal, ...identity } = member;
    const encoded = canonicalJson(identity);
    const previous = identityBySourceId.get(member.sourceMemberId);
    if (previous != null && previous !== encoded) {
      throw new Error(`DoBIH source member ${member.sourceMemberId} changes between lists`);
    }
    identityBySourceId.set(member.sourceMemberId, encoded);
    membershipCountBySourceId.set(
      member.sourceMemberId,
      (membershipCountBySourceId.get(member.sourceMemberId) ?? 0) + 1
    );
  }
  if (identityBySourceId.size !== 4_306) {
    throw new Error(
      `DoBIH RHSoc fixture has ${identityBySourceId.size} distinct members; expected 4306`
    );
  }
  const membershipFrequencies = [1, 2, 3, 4].map((count) =>
    [...membershipCountBySourceId.values()].filter((value) => value === count).length);
  if (canonicalJson(membershipFrequencies) !== canonicalJson([2_875, 1_089, 342, 0])) {
    throw new Error(
      `DoBIH RHSoc membership frequencies are ${membershipFrequencies.join("/")}; ` +
      "expected 2875/1089/342/0"
    );
  }

  const expectedPairOverlaps: Array<[string, string, number]> = [
    ["dobih-great-britain-marilyns", "dobih-high-hills-of-britain", 342],
    ["dobih-great-britain-marilyns", "dobih-simms", 767],
    ["dobih-great-britain-marilyns", "dobih-subsimms", 0],
    ["dobih-high-hills-of-britain", "dobih-simms", 828],
    ["dobih-high-hills-of-britain", "dobih-subsimms", 178],
    ["dobih-simms", "dobih-subsimms", 0],
  ];
  for (const [left, right, expected] of expectedPairOverlaps) {
    const actual = pairOverlap(fixture, left, right);
    if (actual !== expected) {
      throw new Error(`DoBIH RHSoc overlap ${left}/${right} is ${actual}; expected ${expected}`);
    }
  }

  const priorIds = new Set(sourceRows
    .filter(isPreviouslyReviewedMember)
    .map((row) => `dobih:${row.number}`));
  const allIds = [...identityBySourceId.keys()];
  const priorUnique = allIds.filter((sourceMemberId) => priorIds.has(sourceMemberId)).length;
  const newUnique = allIds.length - priorUnique;
  const expectedPriorByList = [667, 401, 1_313, 131];
  const actualPriorByList = DOBIH_RHSOC_FOUR_KEEPER_LISTS.map((definition) =>
    fixture.lists[definition.sourceKey].rows.filter(
      (member) => priorIds.has(member.sourceMemberId)
    ).length);
  if (priorUnique !== 1_552 || newUnique !== 2_754 ||
      canonicalJson(actualPriorByList) !== canonicalJson(expectedPriorByList)) {
    throw new Error(
      `DoBIH RHSoc prior/new counts are ${priorUnique}/${newUnique}, with ` +
      `${actualPriorByList.join("/")} prior list rows; expected 1552/2754 and ` +
      "667/401/1313/131"
    );
  }

  const expectedCountrySplits: Record<string, Record<string, number>> = {
    "dobih-great-britain-marilyns": { E: 173, S: 1_218, W: 159 },
    "dobih-high-hills-of-britain": { E: 31, S: 977, W: 27 },
    "dobih-simms": { E: 190, ES: 2, I: 223, M: 1, S: 2_189, W: 150 },
    "dobih-subsimms": { E: 36, I: 39, S: 629, W: 35 },
  };
  for (const [sourceKey, expected] of Object.entries(expectedCountrySplits)) {
    const actual = sourceCountrySplit(selectedSourceRows.get(sourceKey)!);
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      throw new Error(
        `DoBIH RHSoc country split for ${sourceKey} is ${canonicalJson(actual)}; ` +
        `expected ${canonicalJson(expected)}`
      );
    }
  }

  if (DOBIH_RHSOC_FOUR_ROUTE_SAFETY_AUDIT_COMPLETE !== false ||
      !DOBIH_RHSOC_FOUR_ROUTE_SAFETY_WARNING.includes("non-exhaustive") ||
      DOBIH_RHSOC_FOUR_NAMED_COMPLETION_EXCEPTIONS.length !== 0) {
    throw new Error("DoBIH RHSoc route-safety boundary is not fail-closed");
  }
  for (const block of DOBIH_RHSOC_FOUR_ROUTE_PUBLICATION_BLOCKS) {
    for (const occurrence of block.sourceOccurrences) {
      const member = fixture.lists[occurrence.sourceKey].rows.find(
        (candidate) => candidate.sourceMemberId === block.sourceMemberId
      );
      if (member == null || member.name !== block.name || member.ordinal !== occurrence.ordinal) {
        throw new Error(
          `Route publication block ${block.sourceMemberId} does not match ` +
          `${occurrence.sourceKey} ordinal ${occurrence.ordinal}`
        );
      }
    }
  }
  const sourceIds = new Set(identityBySourceId.keys());
  if (sourceIds.has("dobih:2390") || sourceIds.has("dobih:2630")) {
    throw new Error("DoBIH RHSoc fixture unexpectedly includes Pillar Rock or High Knott");
  }
}

export function buildDobihRhsocFourFixture(
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
  if (sourceRows.length !== 21_576) {
    throw new Error(`DoBIH v18.5 has ${sourceRows.length} source rows; expected 21576`);
  }
  const selectionBySourceKey = new Map(
    RHSOC_FOUR_SELECTIONS.map((selection) => [selection.sourceKey, selection])
  );
  if (selectionBySourceKey.size !== DOBIH_RHSOC_FOUR_KEEPER_LISTS.length) {
    throw new Error("DoBIH RHSoc selections and definitions have different sizes");
  }

  const lists: Record<string, KeeperSourceList> = {};
  for (const definition of DOBIH_RHSOC_FOUR_KEEPER_LISTS) {
    const selection = selectionBySourceKey.get(definition.sourceKey);
    if (selection == null ||
        definition.productionManifest?.selection !== selection.selection) {
      throw new Error(`DoBIH list ${definition.sourceKey} has no matching selector`);
    }
    const selectedRows = sourceRows
      .filter(selection.includes)
      .sort((left, right) => left.number - right.number);
    lists[definition.sourceKey] = {
      source: "dobih-v18.5",
      selection: selection.selection,
      rows: selectedRows.map((row, index) => buildDobihSourceMember(row, index + 1)),
    };
  }

  const fixture: KeeperImportFixture = {
    schemaVersion: 1,
    generatedAt: "2026-09-01",
    sources,
    lists,
  };
  assertFixtureComposition(fixture, sourceRows);
  validateKeeperFixture(fixture, DOBIH_RHSOC_FOUR_KEEPER_LISTS);
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
        "keeper-list-dobih-rhsoc-four-candidates-2026-09-01.json"
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
  const fixture = buildDobihRhsocFourFixture(csvBytes, sourceMetadata);
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
