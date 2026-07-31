#!/usr/bin/env node

import process from "node:process";
import dbImport from "../../../../cloud-sql/migrate/src/db";
import { verifyStandardRoute } from "../../../../cloud-sql/migrate/src/standard-route-verification";

const db =
  typeof (dbImport as { query?: unknown }).query === "function"
    ? dbImport
    : (dbImport as unknown as { default: typeof dbImport }).default;

function valueAfter(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  return index < 0 ? "" : argv[index + 1] ?? "";
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    "Usage: verify_standard_route.mts --route-id ID --destination-id ID " +
      "--trailhead-id ID [--public-base-url URL]"
  );
  process.exit(0);
}
const routeId = valueAfter(argv, "--route-id");
const destinationId = valueAfter(argv, "--destination-id");
const trailheadId = valueAfter(argv, "--trailhead-id");
for (const [flag, value] of [
  ["--route-id", routeId],
  ["--destination-id", destinationId],
  ["--trailhead-id", trailheadId],
]) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${flag} is required`);
  }
}

try {
  const verification = await verifyStandardRoute(db, {
    routeId,
    destinationId,
    trailheadId,
    publicBaseUrl: valueAfter(argv, "--public-base-url") || undefined,
  });
  console.log(JSON.stringify(verification));
  if (verification.verdict !== "PASS") process.exitCode = 2;
} finally {
  await db.end();
}
