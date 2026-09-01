/** Builds the pinned DoBIH v18.5 source fixture for four smaller registers. */

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
  DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS,
  DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS,
  DOBIH_WELSH_3000S_NUMBERS,
  DOBIH_WELSH_3000S_SELECTION,
} from "./keeper-list-import/bundles/dobih-smaller-majority-four";

interface SmallerMajorityFourSelection {
  sourceKey: string;
  selection: string;
  includes(row: ParsedDobihRow): boolean;
}

const WELSH_3000S_NUMBER_SET = new Set<number>(DOBIH_WELSH_3000S_NUMBERS);

const SMALLER_MAJORITY_FOUR_SELECTIONS: SmallerMajorityFourSelection[] = [
  {
    sourceKey: "dobih-welsh-3000s",
    selection: DOBIH_WELSH_3000S_SELECTION,
    includes: (row) => WELSH_3000S_NUMBER_SET.has(row.number),
  },
  {
    sourceKey: "dobih-great-britain-submarilyns",
    selection: "sMa=1 AND Country IN (E,ES,S,W)",
    includes: (row) => row.flags.sMa && ["E", "ES", "S", "W"].includes(row.country),
  },
  {
    sourceKey: "dobih-donald-deweys",
    selection: "DDew=1",
    includes: (row) => row.flags.DDew,
  },
  {
    sourceKey: "dobih-england-wales-2000-foot-register",
    selection: "Hew=1 AND Country IN (E,ES,W)",
    includes: (row) => row.flags.Hew && ["E", "ES", "W"].includes(row.country),
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
  const allMembers = DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS.flatMap(
    (definition) => fixture.lists[definition.sourceKey].rows
  );
  if (allMembers.length !== 678) {
    throw new Error(
      `DoBIH smaller majority-four fixture has ${allMembers.length} memberships; expected 678`
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
  if (identityBySourceId.size !== 648) {
    throw new Error(
      `DoBIH smaller majority-four fixture has ${identityBySourceId.size} distinct members; ` +
      "expected 648"
    );
  }

  const priorIds = new Set(sourceRows
    .filter(isPriorReviewedMember)
    .map((row) => `dobih:${row.number}`));
  const newIds = new Set(identityBySourceId.keys());
  const priorOverlap = [...newIds].filter((sourceId) => priorIds.has(sourceId)).length;
  if (priorOverlap !== 121 || newIds.size - priorOverlap !== 527) {
    throw new Error(
      `DoBIH smaller majority-four/prior composition is ` +
      `${priorOverlap}/${newIds.size - priorOverlap}; expected 121/527`
    );
  }

  const expectedReuseAndNew = [
    [15, 0],
    [9, 91],
    [7, 240],
    [120, 196],
  ];
  const seen = new Set(priorIds);
  for (const [index, definition] of DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS.entries()) {
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

  const welshSourceIds = fixture.lists["dobih-welsh-3000s"].rows.map(
    (member) => member.sourceMemberId
  );
  const expectedWelshSourceIds = DOBIH_WELSH_3000S_NUMBERS.map(
    (number) => `dobih:${number}`
  );
  if (canonicalJson(welshSourceIds) !== canonicalJson(expectedWelshSourceIds)) {
    throw new Error("Welsh 3000s roster does not match the 15 explicit DoBIH Numbers");
  }

  const hewittMembers = new Map(
    fixture.lists["dobih-england-wales-2000-foot-register"].rows.map(
      (member) => [member.sourceMemberId, member.name]
    )
  );
  for (const block of DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS) {
    if (hewittMembers.get(block.sourceMemberId) !== block.name) {
      throw new Error(
        `Route publication block ${block.sourceMemberId} does not match the Hewitt roster`
      );
    }
  }
}

export function buildDobihSmallerMajorityFourFixture(
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
  const selectionBySourceKey = new Map(
    SMALLER_MAJORITY_FOUR_SELECTIONS.map((selection) => [selection.sourceKey, selection])
  );
  if (selectionBySourceKey.size !== DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS.length) {
    throw new Error(
      "DoBIH smaller majority-four selections and definitions have different sizes"
    );
  }

  const lists: Record<string, KeeperSourceList> = {};
  for (const definition of DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS) {
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
  validateKeeperFixture(fixture, DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS);
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
        "keeper-list-dobih-smaller-majority-four-candidates-2026-08-31.json"
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
  const fixture = buildDobihSmallerMajorityFourFixture(csvBytes, sourceMetadata);
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
