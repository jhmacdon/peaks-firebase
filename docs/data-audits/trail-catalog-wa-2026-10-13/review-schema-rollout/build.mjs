#!/usr/bin/env node
// Offline bundle builder. It does not connect to a database.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const migration = 'cloud-sql/migrations/20261014_trail_catalog_review_activation.sql';
const source = readFileSync(new URL('../../../../' + migration, here), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
if ((source.match(/^BEGIN;$/gm) ?? []).length !== 1 || (source.match(/^COMMIT;$/gm) ?? []).length !== 1 || !source.trimEnd().endsWith('COMMIT;')) throw new Error('Migration transaction boundaries changed; review this builder');
const body = source.replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\s*$/m, '');
const preview = readFileSync(new URL('before.sql', here), 'utf8')
  + `\n-- PINNED MIGRATION: ${migration}\n-- SHA256: ${hash(source)}\n` + body
  + '\n' + readFileSync(new URL('after.sql', here), 'utf8') + '\nROLLBACK;\n';
writeFileSync(new URL('rollback-preview.sql', here), preview);
writeFileSync(new URL('manifest.json', here), JSON.stringify({ migration, migrationSha256: hash(source), previewSha256: hash(preview), fixedMonthlyCostDeltaUsd: 0 }, null, 2) + '\n');
console.log(JSON.stringify({ migration, migrationSha256: hash(source), previewSha256: hash(preview) }));
