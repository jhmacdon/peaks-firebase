/** Builds the pinned DoBIH v18.5 source fixture for four hill registers. */

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
  DOBIH_MAJORITY_FOUR_KEEPER_LISTS,
} from "./keeper-list-import/bundles/dobih-majority-four";

interface MajorityFourSelection {
  sourceKey: string;
  selection: string;
  includes(row: ParsedDobihRow): boolean;
}

const MAJORITY_FOUR_SELECTIONS: MajorityFourSelection[] = [
  {
    sourceKey: "dobih-england-wales-2000-foot-register",
    selection: "Hew=1 AND Country IN (E,ES,W)",
    includes: (row) => row.flags.Hew && ["E", "ES", "W"].includes(row.country),
  },
  {
    sourceKey: "dobih-birketts",
    selection: "B=1 AND Country=E",
    includes: (row) => row.flags.B && row.country === "E",
  },
  {
    sourceKey: "dobih-synges",
    selection: "Sy=1 AND Country=E",
    includes: (row) => row.flags.Sy && row.country === "E",
  },
  {
    sourceKey: "dobih-great-britain-submarilyns",
    selection: "sMa=1 AND Country IN (E,ES,S,W)",
    includes: (row) => row.flags.sMa && ["E", "ES", "S", "W"].includes(row.country),
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
  if (encoded == null) throw new Error("DoBIH fixture contains a non-JSON value");
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

function isPriorReviewedMember(row: ParsedDobihRow): boolean {
  return row.flags.C || row.flags.W || row.flags.MT || row.flags.F ||
    row.flags.D || row.flags.DT || row.flags.WO || row.flags.Fel ||
    row.flags.VL || row.flags.G || (row.flags.Hew && row.country === "I");
}

function assertFixtureComposition(
  fixture: KeeperImportFixture,
  sourceRows: ParsedDobihRow[]
): void {
  const allMembers = DOBIH_MAJORITY_FOUR_KEEPER_LISTS.flatMap(
    (definition) => fixture.lists[definition.sourceKey].rows
  );
  if (allMembers.length !== 1_627) {
    throw new Error(
      `DoBIH majority-four fixture has ${allMembers.length} memberships; expected 1627`
    );
  }

  const identityBySourceId = new Map<string, string>();
  for (const member of allMembers) {
    const { ordinal: _ordinal, ...identity } = member;
    const encoded = canonicalJson(identity);
    const previous = identityBySourceId.get(member.sourceMemberId);
    if (previous != null && previous !== encoded) {
      throw new Error(`DoBIH source member ${member.sourceMemberId} changes between lists`);
    }
    identityBySourceId.set(member.sourceMemberId, encoded);
  }
  if (identityBySourceId.size !== 1_015) {
    throw new Error(
      `DoBIH majority-four fixture has ${identityBySourceId.size} distinct members; expected 1015`
    );
  }

  const priorIds = new Set(sourceRows
    .filter(isPriorReviewedMember)
    .map((row) => `dobih:${row.number}`));
  const newIds = new Set(identityBySourceId.keys());
  const priorOverlap = [...newIds].filter((sourceId) => priorIds.has(sourceId)).length;
  if (priorOverlap !== 317 || newIds.size - priorOverlap !== 698) {
    throw new Error(
      `DoBIH majority-four/prior composition is ${priorOverlap}/${newIds.size - priorOverlap}; ` +
      "expected 317/698"
    );
  }

  const expectedReuseAndNew = [
    [116, 200],
    [292, 249],
    [508, 162],
    [13, 87],
  ];
  const seen = new Set(priorIds);
  for (const [index, definition] of DOBIH_MAJORITY_FOUR_KEEPER_LISTS.entries()) {
    const sourceIds = fixture.lists[definition.sourceKey].rows.map(
      (member) => member.sourceMemberId
    );
    const reused = sourceIds.filter((sourceId) => seen.has(sourceId)).length;
    const added = sourceIds.length - reused;
    const [expectedReused, expectedAdded] = expectedReuseAndNew[index];
    if (reused !== expectedReused || added !== expectedAdded) {
      throw new Error(
        `DoBIH list ${definition.sourceKey} reuses/adds ${reused}/${added}; ` +
        `expected ${expectedReused}/${expectedAdded}`
      );
    }
    sourceIds.forEach((sourceId) => seen.add(sourceId));
  }
}

export function buildDobihMajorityFourFixture(
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
      sourceMetadata.csvSha256 !== DOBIH_CSV_SHA256) {
    throw new Error("DoBIH source metadata does not pin the reviewed archive and CSV");
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
  const selectionBySourceKey = new Map(
    MAJORITY_FOUR_SELECTIONS.map((selection) => [selection.sourceKey, selection])
  );
  if (selectionBySourceKey.size !== DOBIH_MAJORITY_FOUR_KEEPER_LISTS.length) {
    throw new Error("DoBIH majority-four selections and definitions have different sizes");
  }

  const lists: Record<string, KeeperSourceList> = {};
  for (const definition of DOBIH_MAJORITY_FOUR_KEEPER_LISTS) {
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
    generatedAt: "2026-08-31",
    sources,
    lists,
  };
  assertFixtureComposition(fixture, sourceRows);
  validateKeeperFixture(fixture, DOBIH_MAJORITY_FOUR_KEEPER_LISTS);
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
      "docs/data-audits/fixtures/keeper-list-dobih-majority-four-candidates-2026-08-31.json"
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
  const fixture = buildDobihMajorityFourFixture(csvBytes, sourceMetadata);
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
