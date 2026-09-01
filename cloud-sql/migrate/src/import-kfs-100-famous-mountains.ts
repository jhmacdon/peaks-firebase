/**
 * Imports the reviewed Korea Forest Service 100 Famous Mountains roster.
 *
 * Dry-run is the default. Destination staging and list publication are
 * separate. Publication also requires complete summit and route covers.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { PoolClient } from "pg";
import db from "./db";
import {
  type KeeperImportFixture,
  type KeeperResolutionFixture,
  parseKeeperImportArgs,
  runKeeperImport as runKeeperImportCore,
} from "./keeper-list-import/core";
import {
  KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS,
  KFS_100_FAMOUS_MOUNTAINS_RESOLUTIONS_SHA256,
} from "./keeper-list-import/bundles/kfs-100-famous-mountains";

export { KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS };

export interface Kfs100CommandOverrides {
  readFile?: (filePath: string) => Promise<string>;
  connect?: () => Promise<PoolClient>;
  end?: () => Promise<void>;
  runKeeperImport?: typeof runKeeperImportCore;
  writeLine?: (line: string) => void;
  writeError?: (line: string) => void;
}

export async function runKfs100Command(
  argv = process.argv.slice(2),
  overrides: Kfs100CommandOverrides = {}
): Promise<number> {
  const args = parseKeeperImportArgs(argv);
  const readFile = overrides.readFile ??
    ((filePath: string) => fs.readFile(filePath, "utf8"));
  const connect = overrides.connect ?? (() => db.connect());
  const end = overrides.end ?? (() => db.end());
  const importList = overrides.runKeeperImport ?? runKeeperImportCore;
  const writeLine = overrides.writeLine ?? ((line: string) => console.log(line));
  const fixture = JSON.parse(await readFile(args.input)) as KeeperImportFixture;
  const resolutionText = await readFile(args.resolutions);
  const resolutionSha256 = crypto
    .createHash("sha256")
    .update(resolutionText)
    .digest("hex");
  if (resolutionSha256 !== KFS_100_FAMOUS_MOUNTAINS_RESOLUTIONS_SHA256) {
    throw new Error(
      `KFS resolution fixture checksum ${resolutionSha256} does not match ` +
        KFS_100_FAMOUS_MOUNTAINS_RESOLUTIONS_SHA256
    );
  }
  const resolutions = JSON.parse(resolutionText) as KeeperResolutionFixture;
  const client = await connect();
  try {
    const report = await importList(
      client,
      fixture,
      resolutions,
      args.mode,
      KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS
    );
    writeLine(JSON.stringify(report, null, 2));
    return report.complete &&
      (args.mode !== "check-publication" || report.publication?.ready === true)
      ? 0
      : 2;
  } finally {
    client.release();
    await end();
  }
}

export async function runKfs100Main(
  argv = process.argv.slice(2),
  overrides: Kfs100CommandOverrides = {}
): Promise<number> {
  try {
    return await runKfs100Command(argv, overrides);
  } catch (error) {
    const writeError = overrides.writeError ?? ((line: string) => console.error(line));
    writeError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (require.main === module) {
  runKfs100Main().then((exitCode) => {
    if (exitCode !== 0) process.exitCode = exitCode;
  });
}
