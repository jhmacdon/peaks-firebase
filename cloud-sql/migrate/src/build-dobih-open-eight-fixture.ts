/** Builds the pinned DoBIH v18.5 source fixture for the open-eight bundle. */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type KeeperImportFixture,
  type KeeperSourceList,
  type KeeperSourceMember,
  validateKeeperFixture,
} from "./keeper-list-import/core";
import {
  DOBIH_OPEN_EIGHT_KEEPER_LISTS,
} from "./keeper-list-import/bundles/dobih-open-eight";

const DOBIH_CSV_SHA256 =
  "d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea";
const DOBIH_ARCHIVE_SHA256 =
  "0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021";
const DOBIH_SOURCES_SHA256 =
  "54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402";
const CORRECTED_20085_RAW_NAME = "Meenteog [Moing an tSamhaidh]]";

type SelectionFlag =
  | "C"
  | "W"
  | "MT"
  | "F"
  | "D"
  | "DT"
  | "WO"
  | "Fel"
  | "VL"
  | "Hew"
  | "G";

interface ParsedDobihRow {
  number: number;
  rawName: string;
  metres: string;
  latitude: string;
  longitude: string;
  country: string;
  flags: Record<SelectionFlag, boolean>;
}

interface OpenEightSelection {
  sourceKey: string;
  selection: string;
  includes(row: ParsedDobihRow): boolean;
}

const FLAG_COLUMNS: SelectionFlag[] = [
  "C",
  "W",
  "MT",
  "F",
  "D",
  "DT",
  "WO",
  "Fel",
  "VL",
  "Hew",
  "G",
];

const REQUIRED_COLUMNS = [
  "Number",
  "Name",
  "Metres",
  "Latitude",
  "Longitude",
  "Country",
  ...FLAG_COLUMNS,
] as const;

const OPEN_EIGHT_SELECTIONS: OpenEightSelection[] = [
  {
    sourceKey: "dobih-munro-tops",
    selection: "MT=1",
    includes: (row) => row.flags.MT,
  },
  {
    sourceKey: "dobih-furths",
    selection: "F=1",
    includes: (row) => row.flags.F,
  },
  {
    sourceKey: "dobih-donalds",
    selection: "D=1 OR DT=1",
    includes: (row) => row.flags.D || row.flags.DT,
  },
  {
    sourceKey: "dobih-wainwright-outlying-fells",
    selection: "WO=1",
    includes: (row) => row.flags.WO,
  },
  {
    sourceKey: "dobih-fellrangers",
    selection: "Fel=1",
    includes: (row) => row.flags.Fel,
  },
  {
    sourceKey: "dobih-vandeleur-lynams",
    selection: "VL=1",
    includes: (row) => row.flags.VL,
  },
  {
    sourceKey: "dobih-irish-2000-foot-register",
    selection: "Hew=1 AND Country=I",
    includes: (row) => row.flags.Hew && row.country === "I",
  },
  {
    sourceKey: "dobih-grahams",
    selection: "G=1",
    includes: (row) => row.flags.G,
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

/**
 * Parses RFC-4180-style comma-separated rows while rejecting loose quotes,
 * partial quoted fields, and malformed row endings.
 */
export function parseStrictCsv(csvText: string): string[][] {
  const source = csvText.startsWith("\uFEFF") ? csvText.slice(1) : csvText;
  if (source.length === 0) throw new Error("DoBIH CSV is empty");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldStarted = false;
  let inQuotes = false;
  let afterQuote = false;

  const finishField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
    afterQuote = false;
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") {
        finishField();
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        finishRow();
      } else {
        throw new Error(`DoBIH CSV has text after a closing quote at character ${index}`);
      }
      continue;
    }

    if (character === '"') {
      if (fieldStarted) {
        throw new Error(`DoBIH CSV has a quote inside an unquoted field at character ${index}`);
      }
      fieldStarted = true;
      inQuotes = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      fieldStarted = true;
      field += character;
    }
  }

  if (inQuotes) throw new Error("DoBIH CSV ends inside a quoted field");
  if (fieldStarted || afterQuote || field.length > 0 || row.length > 0) finishRow();
  return rows;
}

function parsePositiveInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive integer; got ${JSON.stringify(value)}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is outside the safe integer range`);
  return parsed;
}

function parseFiniteNumber(value: string, label: string): number {
  if (value.length === 0) throw new Error(`${label} is missing`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number; got ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseDobihRows(csvText: string): ParsedDobihRow[] {
  const matrix = parseStrictCsv(csvText);
  if (matrix.length < 2) throw new Error("DoBIH CSV has no data rows");
  const headers = matrix[0].map((header) => header.trim());
  const headerIndexes = new Map<string, number>();
  for (const [index, header] of headers.entries()) {
    if (header.length === 0) throw new Error(`DoBIH CSV header ${index + 1} is empty`);
    if (headerIndexes.has(header)) throw new Error(`DoBIH CSV repeats header ${header}`);
    headerIndexes.set(header, index);
  }
  for (const required of REQUIRED_COLUMNS) {
    if (!headerIndexes.has(required)) throw new Error(`DoBIH CSV is missing column ${required}`);
  }

  const valueAt = (row: string[], column: string): string =>
    row[headerIndexes.get(column)!];
  const seenNumbers = new Set<number>();
  return matrix.slice(1).map((row, rowIndex) => {
    const sourceRow = rowIndex + 2;
    if (row.length !== headers.length) {
      throw new Error(
        `DoBIH CSV row ${sourceRow} has ${row.length} fields; expected ${headers.length}`
      );
    }
    const rawNumber = valueAt(row, "Number");
    if (rawNumber !== rawNumber.trim()) {
      throw new Error(`DoBIH CSV row ${sourceRow} has padded Number text`);
    }
    const number = parsePositiveInteger(rawNumber, `DoBIH CSV row ${sourceRow} Number`);
    if (seenNumbers.has(number)) throw new Error(`DoBIH CSV repeats Number ${number}`);
    seenNumbers.add(number);

    const rawName = valueAt(row, "Name");
    if (rawName.trim().length === 0) throw new Error(`DoBIH Number ${number} has no Name`);
    const country = valueAt(row, "Country").trim();
    if (country.length === 0) throw new Error(`DoBIH Number ${number} has no Country`);

    const flags = {} as Record<SelectionFlag, boolean>;
    for (const column of FLAG_COLUMNS) {
      const value = valueAt(row, column).trim();
      if (value !== "0" && value !== "1") {
        throw new Error(`DoBIH Number ${number} has invalid ${column} flag ${value}`);
      }
      flags[column] = value === "1";
    }
    return {
      number,
      rawName,
      metres: valueAt(row, "Metres").trim(),
      latitude: valueAt(row, "Latitude").trim(),
      longitude: valueAt(row, "Longitude").trim(),
      country,
      flags,
    };
  });
}

export function normalizeDobihName(
  number: number,
  rawName: string
): { name: string; aliases: string[] } {
  if (number === 20_085) {
    if (rawName !== CORRECTED_20085_RAW_NAME) {
      throw new Error(
        `DoBIH Number 20085 Name changed from ${JSON.stringify(CORRECTED_20085_RAW_NAME)}`
      );
    }
    return { name: "Meenteog", aliases: ["Moing an tSamhaidh"] };
  }

  const trimmedName = rawName.trim();
  const match = /^([^\[\]]+?)((?: \[[^\[\]]+\])*)$/.exec(trimmedName);
  if (match == null) {
    throw new Error(`DoBIH Number ${number} has unbalanced Name brackets: ${rawName}`);
  }
  const name = match[1];
  const aliases = Array.from(
    match[2].matchAll(/ \[([^\[\]]+)\]/g),
    (aliasMatch) => aliasMatch[1]
  );
  if (name.length === 0 || name !== name.trim() ||
      aliases.some((alias) => alias.length === 0 || alias !== alias.trim())) {
    throw new Error(`DoBIH Number ${number} has an empty or padded Name part`);
  }
  return { name, aliases };
}

function buildSourceMember(row: ParsedDobihRow, ordinal: number): KeeperSourceMember {
  const { name, aliases } = normalizeDobihName(row.number, row.rawName);
  const elevationM = parseFiniteNumber(row.metres, `DoBIH Number ${row.number} Metres`);
  const lat = parseFiniteNumber(row.latitude, `DoBIH Number ${row.number} Latitude`);
  const lng = parseFiniteNumber(row.longitude, `DoBIH Number ${row.number} Longitude`);
  if (elevationM <= 0) throw new Error(`DoBIH Number ${row.number} has invalid elevation`);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error(`DoBIH Number ${row.number} has coordinates outside world bounds`);
  }
  const member: KeeperSourceMember = {
    sourceMemberId: `dobih:${row.number}`,
    ordinal,
    name,
    elevationM,
    lat,
    lng,
    dobihNumber: row.number,
  };
  if (aliases.length > 0) member.aliases = aliases;
  return member;
}

function assertFixtureComposition(
  fixture: KeeperImportFixture,
  sourceRows: ParsedDobihRow[]
): void {
  const allMembers = DOBIH_OPEN_EIGHT_KEEPER_LISTS.flatMap(
    (definition) => fixture.lists[definition.sourceKey].rows
  );
  if (allMembers.length !== 1_460) {
    throw new Error(`DoBIH open-eight fixture has ${allMembers.length} memberships; expected 1460`);
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
  if (identityBySourceId.size !== 1_201) {
    throw new Error(
      `DoBIH open-eight fixture has ${identityBySourceId.size} distinct members; expected 1201`
    );
  }

  const baseIds = new Set(sourceRows
    .filter((row) => row.flags.C || row.flags.W)
    .map((row) => `dobih:${row.number}`));
  const openIds = new Set(identityBySourceId.keys());
  const baseOverlap = [...openIds].filter((sourceId) => baseIds.has(sourceId)).length;
  if (baseOverlap !== 212 || openIds.size - baseOverlap !== 989) {
    throw new Error(
      `DoBIH open-eight/base composition is ${baseOverlap}/${openIds.size - baseOverlap}; ` +
      "expected 212/989"
    );
  }

  const expectedReuseAndNew = [
    [0, 226],
    [4, 30],
    [7, 134],
    [0, 116],
    [217, 13],
    [13, 262],
    [207, 0],
    [23, 208],
  ];
  const seen = new Set(baseIds);
  for (const [index, definition] of DOBIH_OPEN_EIGHT_KEEPER_LISTS.entries()) {
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

  const correctedOrdinals = DOBIH_OPEN_EIGHT_KEEPER_LISTS.flatMap((definition) =>
    fixture.lists[definition.sourceKey].rows
      .filter((member) => member.sourceMemberId === "dobih:20085")
      .map((member) => [definition.sourceKey, member.ordinal] as const)
  );
  if (canonicalJson(correctedOrdinals) !== canonicalJson([
    ["dobih-vandeleur-lynams", 84],
    ["dobih-irish-2000-foot-register", 80],
  ])) {
    throw new Error("DoBIH Number 20085 has unexpected open-eight membership or ordinals");
  }
}

export function buildDobihOpenEightFixture(
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
    OPEN_EIGHT_SELECTIONS.map((selection) => [selection.sourceKey, selection])
  );
  if (selectionBySourceKey.size !== DOBIH_OPEN_EIGHT_KEEPER_LISTS.length) {
    throw new Error("DoBIH open-eight selections and definitions have different sizes");
  }

  const lists: Record<string, KeeperSourceList> = {};
  for (const definition of DOBIH_OPEN_EIGHT_KEEPER_LISTS) {
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
      rows: selectedRows.map((row, index) => buildSourceMember(row, index + 1)),
    };
  }

  const fixture: KeeperImportFixture = {
    schemaVersion: 1,
    generatedAt: "2026-08-30",
    sources,
    lists,
  };
  assertFixtureComposition(fixture, sourceRows);
  validateKeeperFixture(fixture, DOBIH_OPEN_EIGHT_KEEPER_LISTS);
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
      "docs/data-audits/fixtures/keeper-list-dobih-open-eight-candidates-2026-08-30.json"
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
  const fixture = buildDobihOpenEightFixture(csvBytes, sourceMetadata);
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
