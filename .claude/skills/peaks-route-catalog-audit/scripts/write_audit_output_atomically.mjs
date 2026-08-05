#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const AUDIT_OUTPUT_NAME =
  /^peaks-route-audit-[A-Za-z0-9][A-Za-z0-9._-]*\.(catalog|identity)\.json$/;

async function fixedTempPath(filePath) {
  const absolutePath = path.resolve(filePath);
  const lexicalParent = path.dirname(absolutePath);
  if (lexicalParent !== "/tmp" && lexicalParent !== "/private/tmp") {
    throw new Error("setup_required: audit output must be a direct system temp file");
  }
  const fileName = path.basename(absolutePath);
  if (!AUDIT_OUTPUT_NAME.test(fileName)) {
    throw new Error("setup_required: audit output name is not approved");
  }
  const physicalParent = await fs.realpath(lexicalParent);
  if (physicalParent !== "/tmp" && physicalParent !== "/private/tmp") {
    throw new Error("setup_required: system temp root resolved unexpectedly");
  }
  return {
    outputPath: path.join(physicalParent, fileName),
    physicalParent,
    fileName,
  };
}

async function run(argv = process.argv.slice(2)) {
  const separator = argv.indexOf("--");
  if (separator !== 1 || argv.length < 3) {
    throw new Error("usage: write_audit_output_atomically.mjs OUTPUT -- COMMAND [ARGS...]");
  }
  const destination = await fixedTempPath(argv[0]);
  const command = argv[2];
  const commandArgs = argv.slice(3);
  const temporaryPath = path.join(
    destination.physicalParent,
    `.${destination.fileName}.tmp.${randomUUID()}`
  );
  let handle;
  try {
    handle = await fs.open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    );
    const child = spawn(command, commandArgs, {
      stdio: ["inherit", handle.fd, "inherit"],
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) reject(new Error(`${command} exited on ${signal}`));
        else resolve(code ?? 1);
      });
    });
    if (exitCode !== 0) {
      throw new Error(`${command} exited with status ${exitCode}`);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporaryPath, destination.outputPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
