/**
 * Read one pinned Korea Forest Service trail archive and report validation
 * geometry and start/end point candidates. This command has no write mode.
 */

import { readFile } from "node:fs/promises";

import {
  assertCheckedBindingsSha256,
  auditKfsTrailArchiveFile,
  KfsTrailBindings,
  parseKfsTrailBindings,
} from "./kfs-trail-archive";

export type KfsTrailFinderArgs = {
  archivePath: string;
  packageIds: readonly string[];
  bindingsPath: string | null;
  expectedBindingsSha256: string | null;
};

function optionValue(argument: string, name: string): string | null {
  const prefix = `${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : null;
}

export function parseKfsTrailFinderArgs(argv: readonly string[]): KfsTrailFinderArgs {
  if (argv.some((argument) => argument === "--apply" || argument.startsWith("--apply="))) {
    throw new Error("The KFS trail finder is read-only and never accepts --apply");
  }
  let archivePath: string | null = null;
  let bindingsPath: string | null = null;
  let expectedBindingsSha256: string | null = null;
  const packageIds: string[] = [];
  for (const argument of argv) {
    const archive = optionValue(argument, "--archive");
    if (archive !== null) {
      if (archivePath !== null) throw new Error("--archive may appear only once");
      archivePath = archive;
      continue;
    }
    const packageId = optionValue(argument, "--package-id");
    if (packageId !== null) {
      packageIds.push(packageId);
      continue;
    }
    const bindings = optionValue(argument, "--bindings");
    if (bindings !== null) {
      if (bindingsPath !== null) throw new Error("--bindings may appear only once");
      bindingsPath = bindings;
      continue;
    }
    const expectedHash = optionValue(argument, "--expected-bindings-sha256");
    if (expectedHash !== null) {
      if (expectedBindingsSha256 !== null) {
        throw new Error("--expected-bindings-sha256 may appear only once");
      }
      expectedBindingsSha256 = expectedHash;
      continue;
    }
    throw new Error(`unknown option: ${argument}`);
  }
  if (!archivePath) throw new Error("--archive=/absolute/path/to/mountain.zip is required");
  if (bindingsPath && packageIds.length > 0) {
    throw new Error("choose --bindings or --package-id, not both");
  }
  if (!bindingsPath && packageIds.length === 0) {
    throw new Error("--bindings or at least one --package-id is required");
  }
  if (bindingsPath && !expectedBindingsSha256) {
    throw new Error("--expected-bindings-sha256 is required with --bindings");
  }
  if (!bindingsPath && expectedBindingsSha256) {
    throw new Error("--expected-bindings-sha256 requires --bindings");
  }
  return Object.freeze({
    archivePath,
    packageIds: Object.freeze(packageIds),
    bindingsPath,
    expectedBindingsSha256,
  });
}

async function loadCheckedBindings(
  path: string,
  expectedSha256: string
): Promise<KfsTrailBindings> {
  const bytes = await readFile(path);
  assertCheckedBindingsSha256(bytes, expectedSha256);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`KFS trail bindings are not valid UTF-8 JSON: ${message}`);
  }
  return parseKfsTrailBindings(value);
}

export async function runKfsTrailFinder(
  argv = process.argv.slice(2)
): Promise<void> {
  const options = parseKfsTrailFinderArgs(argv);
  const bindings =
    options.bindingsPath && options.expectedBindingsSha256
      ? await loadCheckedBindings(
          options.bindingsPath,
          options.expectedBindingsSha256
        )
      : null;
  const packageIds = bindings
    ? bindings.bindings.map(({ packageId }) => packageId)
    : options.packageIds;
  const report = await auditKfsTrailArchiveFile(options.archivePath, packageIds);
  const destinationIdsByPackage = new Map(
    bindings?.bindings.map(({ destinationId, packageId }) => [
      packageId,
      destinationId,
    ]) ?? []
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        ...report,
        packages: report.packages.map((item) => ({
          ...item,
          destinationId: destinationIdsByPackage.get(item.packageId) ?? null,
        })),
      },
      null,
      2
    )}\n`
  );
}

if (/(?:^|[/\\])find-kfs-trail-geometry\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runKfsTrailFinder().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export default {
  parseKfsTrailFinderArgs,
  runKfsTrailFinder,
};
