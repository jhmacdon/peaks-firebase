/**
 * Imports reviewed peak lists from saved keeper-source fixtures.
 *
 * Dry-run is the default. Apply refuses to write unless every list resolves
 * to its full, unique membership.
 */

import fs from "node:fs/promises";
import db from "./db";
import {
  type KeeperImportFixture,
  type KeeperResolutionFixture,
  parseKeeperImportArgs,
  runKeeperImport,
} from "./keeper-list-import/core";
import {
  BASE_THREE_KEEPER_LISTS,
} from "./keeper-list-import/bundles/base-three";

export * from "./keeper-list-import/core";
export * from "./keeper-list-import/sources";
export {
  BASE_THREE_KEEPER_LISTS,
  BASE_THREE_KEEPER_LISTS as KEEPER_LISTS,
} from "./keeper-list-import/bundles/base-three";

async function main(): Promise<void> {
  const args = parseKeeperImportArgs();
  const fixture = JSON.parse(await fs.readFile(args.input, "utf8")) as KeeperImportFixture;
  const resolutions = JSON.parse(
    await fs.readFile(args.resolutions, "utf8")
  ) as KeeperResolutionFixture;
  const client = await db.connect();
  try {
    const report = await runKeeperImport(
      client,
      fixture,
      resolutions,
      args.apply,
      BASE_THREE_KEEPER_LISTS
    );
    console.log(JSON.stringify(report, null, 2));
    if (!report.complete) process.exitCode = 2;
  } finally {
    client.release();
    await db.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
