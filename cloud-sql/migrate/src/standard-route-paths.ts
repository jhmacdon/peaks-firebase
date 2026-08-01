import path from "node:path";

const REPO_MIGRATE_PREFIX = "cloud-sql/migrate/";

export function resolveRouteArtifactPath(
  moduleDirectory: string,
  artifactInput: string
): string {
  if (path.isAbsolute(artifactInput)) {
    return path.normalize(artifactInput);
  }
  const migrateRoot = path.resolve(moduleDirectory, "..");
  const migrateRelative = artifactInput.startsWith(REPO_MIGRATE_PREFIX)
    ? artifactInput.slice(REPO_MIGRATE_PREFIX.length)
    : artifactInput;
  return path.resolve(migrateRoot, migrateRelative);
}
