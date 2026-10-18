#!/usr/bin/env node
import photoQueue from "../../../../../cloud-sql/migrate/src/trail-catalog-photo-queue";
const { runPhotoQueueImport } = photoQueue;
runPhotoQueueImport(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
