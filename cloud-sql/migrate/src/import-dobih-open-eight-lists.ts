/**
 * Imports the eight reviewed DoBIH open-list rosters from saved fixtures.
 *
 * Dry-run is the default. Apply refuses to write unless every list resolves
 * to its full, unique membership.
 */

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
  DOBIH_OPEN_EIGHT_KEEPER_LISTS,
} from "./keeper-list-import/bundles/dobih-open-eight";

export { DOBIH_OPEN_EIGHT_KEEPER_LISTS };

export interface DobihOpenEightCommandOverrides {
  readFile?: (filePath: string) => Promise<string>;
  connect?: () => Promise<PoolClient>;
  end?: () => Promise<void>;
  runKeeperImport?: typeof runKeeperImportCore;
  writeLine?: (line: string) => void;
  writeError?: (line: string) => void;
}

export async function runDobihOpenEightCommand(
  argv = process.argv.slice(2),
  overrides: DobihOpenEightCommandOverrides = {}
): Promise<number> {
  const args = parseKeeperImportArgs(argv);
  const readFile = overrides.readFile ??
    ((filePath: string) => fs.readFile(filePath, "utf8"));
  const connect = overrides.connect ?? (() => db.connect());
  const end = overrides.end ?? (() => db.end());
  const importLists = overrides.runKeeperImport ?? runKeeperImportCore;
  const writeLine = overrides.writeLine ?? ((line: string) => console.log(line));
  const fixture = JSON.parse(await readFile(args.input)) as KeeperImportFixture;
  const resolutions = JSON.parse(
    await readFile(args.resolutions)
  ) as KeeperResolutionFixture;
  const client = await connect();
  try {
    const report = await importLists(
      client,
      fixture,
      resolutions,
      args.apply,
      DOBIH_OPEN_EIGHT_KEEPER_LISTS
    );
    writeLine(JSON.stringify(report, null, 2));
    return report.complete ? 0 : 2;
  } finally {
    client.release();
    await end();
  }
}

export async function runDobihOpenEightMain(
  argv = process.argv.slice(2),
  overrides: DobihOpenEightCommandOverrides = {}
): Promise<number> {
  try {
    return await runDobihOpenEightCommand(argv, overrides);
  } catch (error) {
    const writeError = overrides.writeError ?? ((line: string) => console.error(line));
    writeError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (require.main === module) {
  runDobihOpenEightMain().then((exitCode) => {
    if (exitCode !== 0) process.exitCode = exitCode;
  });
}
