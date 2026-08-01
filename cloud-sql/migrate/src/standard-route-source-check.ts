import path from "node:path";

export function sourceCheckerArgs(
  scriptPath: string,
  routeId: string,
  replacementRouteId: string | null
): string[] {
  const args = [
    scriptPath,
    "--route-id",
    routeId,
    "--format",
    "json",
  ];
  if (replacementRouteId) {
    args.push("--replace-active-route", replacementRouteId);
  }
  return args;
}

export function sourceCheckerRuntimePaths(
  moduleDirectory: string,
  scriptPathFromRepoRoot: string
): { executable: string; script: string } {
  const migrateRoot = path.resolve(moduleDirectory, "..");
  const repoRoot = path.resolve(migrateRoot, "../..");
  return {
    executable: path.resolve(migrateRoot, "node_modules/.bin/tsx"),
    script: path.resolve(repoRoot, scriptPathFromRepoRoot),
  };
}
