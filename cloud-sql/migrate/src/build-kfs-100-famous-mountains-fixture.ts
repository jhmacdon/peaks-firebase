/** Builds the pinned KFS 100 Famous Mountains source fixture. */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  normalizeKeeperPeakName,
  type KeeperImportFixture,
  type KeeperSourceMember,
  validateKeeperFixture,
} from "./keeper-list-import/core";
import {
  KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS,
} from "./keeper-list-import/bundles/kfs-100-famous-mountains";

const SOURCE_SHA256 =
  "b113780ebec8206cae3ca24022af7a9d77c2b718a258b000666a940f6ebd4735";
const RIGHTS_EVIDENCE_SHA256 =
  "8cb839b56ad7804a4b49c47f5ade3b7f2c65428b4e4915cfda5089c549c7d79a";
const NORMALIZED_ORDERED_ROSTER_SHA256 =
  "b26e7aca4881529e65b41ad29626eba4d0b370426b6db9dc6edce0bbbfd903a2";
const SOURCE_KEY = "kfs-100-famous-mountains";
const FIXTURE_SOURCE = "kfs-100-famous-mountains-2022-01-01";
const OFFICIAL_LIST_URL =
  "https://www.forest.go.kr/kfsweb/kfi/kfs/foreston/main/contents/" +
  "FmmntSrch/selectFmmntSrchList.do?mn=AR02_02_05_01&orgId=fon&" +
  "mntIndex=1&mntUnit=100";
const OFFICIAL_DOWNLOAD_URL =
  "https://www.forest.go.kr/images/data/fonDown/100_mountain.zip";
const RIGHTS_URL =
  "https://www.data.go.kr/data/15058662/openapi.do";

interface KfsSourceRow {
  ordinal: number;
  sourceMemberId: string;
  mntnId: string;
  name: string;
  liveName: string;
  hanjaName: string | null;
  elevationM: number;
  location: string;
  managingBody: string;
}

interface KfsSourceCrosswalk {
  schemaVersion: number;
  effectiveDate: string;
  keeper: string;
  list: string;
  registryId: string;
  sourceKeyRule: string;
  joinRule: string;
  rows: KfsSourceRow[];
}

interface KfsRightsEvidence {
  schemaVersion: number;
  sourceUrl: string;
  retrievedAt: string;
  rawPageSha256: string;
  datasetId: string;
  title: string;
  provider: string;
  modifiedAt: string;
  coverageEvidence: string;
  licenseScope: string;
  licenseScopeEnglish: string;
}

type KfsRosterIdentity = Pick<
  KfsSourceRow,
  "ordinal" | "mntnId" | "name" | "elevationM"
>;

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function kfsNormalizedOrderedRosterSha256(
  rows: readonly KfsRosterIdentity[]
): string {
  return sha256(JSON.stringify(rows.map((row) => ({
    ordinal: row.ordinal,
    mntnId: row.mntnId,
    name: normalizeKeeperPeakName(row.name),
    elevationM: row.elevationM,
  }))));
}

function assertSourceCrosswalk(value: unknown): asserts value is KfsSourceCrosswalk {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("KFS source crosswalk is not an object");
  }
  const source = value as Partial<KfsSourceCrosswalk>;
  if (source.schemaVersion !== 1 || source.effectiveDate !== "2022-01-01" ||
      source.keeper !== "Korea Forest Service" ||
      source.list !== "Korean Forest Service 100 Famous Mountains" ||
      source.registryId !== SOURCE_KEY || source.sourceKeyRule !== "kfs:<mntnId>" ||
      typeof source.joinRule !== "string" || source.joinRule.length === 0 ||
      !Array.isArray(source.rows) || source.rows.length !== 100) {
    throw new Error("KFS source crosswalk metadata is not the reviewed roster");
  }
  const sourceIds = new Set<string>();
  const mountainIds = new Set<string>();
  source.rows.forEach((row, index) => {
    const ordinal = index + 1;
    if (row == null || typeof row !== "object" || row.ordinal !== ordinal ||
        !/^\d{8}$/.test(row.mntnId) ||
        row.sourceMemberId !== `kfs:${row.mntnId}` ||
        typeof row.name !== "string" || row.name.trim().length === 0 ||
        typeof row.liveName !== "string" || row.liveName.trim().length === 0 ||
        (row.hanjaName != null &&
          (typeof row.hanjaName !== "string" || row.hanjaName.trim().length === 0)) ||
        typeof row.elevationM !== "number" || !Number.isFinite(row.elevationM) ||
        typeof row.location !== "string" || row.location.trim().length === 0 ||
        typeof row.managingBody !== "string" || row.managingBody.trim().length === 0) {
      throw new Error(`KFS source crosswalk row ${ordinal} is incomplete`);
    }
    if (sourceIds.has(row.sourceMemberId) || mountainIds.has(row.mntnId)) {
      throw new Error(`KFS source crosswalk repeats row identity ${row.sourceMemberId}`);
    }
    sourceIds.add(row.sourceMemberId);
    mountainIds.add(row.mntnId);
  });
}

function assertRightsEvidence(value: unknown): asserts value is KfsRightsEvidence {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("KFS data-rights evidence is not an object");
  }
  const evidence = value as Partial<KfsRightsEvidence>;
  if (evidence.schemaVersion !== 1 || evidence.sourceUrl !== RIGHTS_URL ||
      evidence.retrievedAt !== "2026-08-31" || evidence.datasetId !== "15058662" ||
      evidence.rawPageSha256 !==
        "a47c620cd929e92f4ea747f1f9cb2573c93fa0049b51a36b9b1284ff691fadb8" ||
      evidence.title !== "산림청_산정보 서비스(국내 소재 3,368개 설명)" ||
      evidence.provider !== "산림청" || evidence.modifiedAt !== "2025-09-11" ||
      evidence.coverageEvidence !== "100대 명산" ||
      evidence.licenseScope !== "이용허락범위 제한 없음" ||
      evidence.licenseScopeEnglish !== "No restriction on use") {
    throw new Error("KFS data-rights evidence does not match the reviewed official record");
  }
}

function aliasesFor(row: KfsSourceRow): string[] | undefined {
  const aliases = [row.liveName, row.hanjaName]
    .filter((value): value is string => value != null && value !== row.name)
    .filter((value, index, values) => values.indexOf(value) === index);
  return aliases.length === 0 ? undefined : aliases;
}

export function buildKfs100Fixture(
  sourceBytes: Buffer,
  rightsEvidenceBytes: Buffer
): KeeperImportFixture {
  const actualSha = sha256(sourceBytes);
  if (actualSha !== SOURCE_SHA256) {
    throw new Error(`KFS source crosswalk checksum ${actualSha} does not match ${SOURCE_SHA256}`);
  }
  const source = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes));
  assertSourceCrosswalk(source);
  const rightsEvidenceSha256 = sha256(rightsEvidenceBytes);
  if (rightsEvidenceSha256 !== RIGHTS_EVIDENCE_SHA256) {
    throw new Error(
      `KFS data-rights evidence checksum ${rightsEvidenceSha256} does not match ` +
        RIGHTS_EVIDENCE_SHA256
    );
  }
  const rightsEvidence = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(rightsEvidenceBytes)
  );
  assertRightsEvidence(rightsEvidence);
  const normalizedRosterSha256 = kfsNormalizedOrderedRosterSha256(source.rows);
  if (normalizedRosterSha256 !== NORMALIZED_ORDERED_ROSTER_SHA256) {
    throw new Error(
      `KFS normalized ordered roster checksum ${normalizedRosterSha256} does not match ` +
        NORMALIZED_ORDERED_ROSTER_SHA256
    );
  }
  const rows: KeeperSourceMember[] = source.rows.map((row) => ({
    sourceMemberId: row.sourceMemberId,
    ordinal: row.ordinal,
    name: row.name,
    ...(aliasesFor(row) == null ? {} : { aliases: aliasesFor(row) }),
    elevationM: row.elevationM,
    kfsMntnId: row.mntnId,
  }));
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-30",
    sources: {
      [FIXTURE_SOURCE]: {
        keeper: "Korea Forest Service",
        list: "100 Famous Mountains",
        effectiveDate: "2022-01-01",
        sourceKeyRule: "kfs:<mntnId>",
        joinRule: source.joinRule,
        officialListUrl: OFFICIAL_LIST_URL,
        officialDownloadUrl: OFFICIAL_DOWNLOAD_URL,
        dataRightsUrl: RIGHTS_URL,
        dataRights: rightsEvidence.licenseScopeEnglish,
        dataRightsCheckedAt: rightsEvidence.retrievedAt,
        dataRightsPageSha256: rightsEvidence.rawPageSha256,
        dataRightsEvidenceSha256: rightsEvidenceSha256,
        archiveSha256:
          "0785a8fd37ae0bb671c774dd833c9e0849ee453c531211efdc51f92173f5d38a",
        workbookSha256:
          "6edeed758c174580b8152cf0c74b1b5b8b29735314f1d3e8139f7bf160339c60",
        livePageCheckedAt: "2026-08-30",
        livePageSha256:
          "e4fddd46b6e3330dc01d0f621ddca8d5703e626bd4fcf19337a2b30d89a5a1f4",
        sourceCrosswalkSha256: SOURCE_SHA256,
        normalizedOrderedRosterSha256: normalizedRosterSha256,
        photoRightsNote: "Do not use KFS roster-page images as cover photos.",
      },
    },
    lists: {
      [SOURCE_KEY]: {
        source: FIXTURE_SOURCE,
        selection: "KFS official 100 Famous Mountains roster, 2022-01-01",
        rows,
      },
    },
  };
}

interface BuildArgs {
  source: string;
  rightsEvidence: string;
  checkedSource: string;
  output: string;
}

function parseArgs(argv: string[]): BuildArgs {
  const repoRoot = path.resolve(__dirname, "../../..");
  const value = (name: string, fallback: string): string =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const known = new Set(["source", "rights-evidence", "checked-source", "output"]);
  const unknown = argv.find((arg) => !arg.startsWith("--") ||
    !known.has(arg.slice(2).split("=", 1)[0]));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
  return {
    source: value("source", "/private/tmp/kfs-100-crosswalk-2026-08-30.json"),
    rightsEvidence: value("rights-evidence", path.join(
      repoRoot,
      "docs/data-audits/fixtures/" +
        "keeper-list-kfs-100-famous-mountains-data-rights-2026-08-31.json"
    )),
    checkedSource: value("checked-source", path.join(
      repoRoot,
      "docs/data-audits/fixtures/" +
        "keeper-list-kfs-100-famous-mountains-source-crosswalk-2026-08-30.json"
    )),
    output: value("output", path.join(
      repoRoot,
      "docs/data-audits/fixtures/" +
        "keeper-list-kfs-100-famous-mountains-candidates-2026-08-30.json"
    )),
  };
}

export async function runKfs100FixtureBuilder(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const [sourceBytes, rightsEvidenceBytes] = await Promise.all([
    fs.readFile(args.source),
    fs.readFile(args.rightsEvidence),
  ]);
  const fixture = buildKfs100Fixture(sourceBytes, rightsEvidenceBytes);
  validateKeeperFixture(fixture, KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS);
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.checkedSource, sourceBytes);
  await fs.writeFile(args.output, `${JSON.stringify(fixture, null, 2)}\n`);
}

if (require.main === module) {
  runKfs100FixtureBuilder().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
