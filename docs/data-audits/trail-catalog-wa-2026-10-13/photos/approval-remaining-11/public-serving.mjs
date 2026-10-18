#!/usr/bin/env node
// Fetch only the eleven saved public Storage URLs. No Firebase or database imports.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';

const here = new URL('./', import.meta.url), root = new URL('../../../../../', here);
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--readback' || !/^production-readback-[1-9][0-9]*\.json$/.test(args[1]) || args[2] !== '--report' || !/^public-serving-[1-9][0-9]*\.json$/.test(args[3])) throw new Error('Use --readback production-readback-N.json --report public-serving-N.json');
const output = new URL(args[3], here);
const require = createRequire(new URL('cloud-sql/migrate/package.json', root));
const sharp = require('sharp');
const sha = data => createHash('sha256').update(data).digest('hex');
const manifestBytes = readFileSync(new URL('manifest.json', here));
const readbackBytes = readFileSync(new URL(args[1], here));
const manifest = JSON.parse(manifestBytes), readback = JSON.parse(readbackBytes);
const photos = readback.state?.photos;
if (!Number.isSafeInteger(readback.auditId) || readback.auditId < 1 || readback.checks !== 'passed' || readback.approvedPhotos !== 11 || readback.placeRowsChanged !== 11 || readback.queueRowsChanged !== 11
  || !readback.routesUnchanged || !readback.candidateJobsUnchanged || !Array.isArray(photos) || photos.length !== 11 || manifest.covers.length !== 11) throw new Error('Final eleven-photo readback is incomplete');
const MAX_BYTES = 10 * 1024 * 1024, TIMEOUT_MS = 30_000, MAX_EDGE = 2400;
function exactUrl(photo, binding) {
  if (photo.destinationId !== binding.destinationId || photo.status !== 'approved'
    || !photo.approvedBinding || !photo.storageBinding || !photo.heroBinding || !photo.authenticatedReviewerRecorded
    || !photo.creditedCover
    || photo.storageUrl !== photo.heroImage) throw new Error('Approved public binding differs');
  const url = new URL(photo.storageUrl), token = url.searchParams.get('token');
  if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password || url.hash
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(token ?? '')
    || url.search !== `?alt=media&token=${token}`
    || url.pathname !== `/v0/b/donner-a8608.appspot.com/o/${encodeURIComponent(`destination-covers/${binding.destinationId}/${binding.candidateId}-${token}.jpg`)}`) throw new Error('Storage origin, bucket, object path, or token differs');
  return url;
}
const expectedIds = new Set(['xxoCzbZ6wudjscAe788b','sLF3JFQL61nB2nK78F2f','vNACg3f2NioMeR2qdBjX','goxoEUevbtTLEgWOBQ2T','jXUNh6O7X9w3ubnS2FuC','tPvVhGEVwnGL3z5R-DEm','RuNcafBQAXNpAfNZMuCb','3QHwUgURE8ts4_kWO639','Dhv7RDXMojUW0T_jZYI4','WBxrYhLbTZWuLM7DqyAa','ITkoNEc-0dHINLIDz6gG']);
if (new Set(manifest.covers.map(c => c.candidateId)).size !== 11 || manifest.covers.some(c => !expectedIds.has(c.candidateId))) throw new Error('Only the exact eleven covers are allowed');
const selected = manifest.covers.map(binding => {
  const matches = photos.filter(photo => photo.candidateId === binding.candidateId);
  if (matches.length !== 1) throw new Error('Exact candidate ID is missing or repeated');
  return { photo: matches[0], binding, url: exactUrl(matches[0], binding) };
});
const reportFd = openSync(output, 'wx', 0o600);
const report = { mode: 'public-serving-check', checkedAt: new Date().toISOString(), readbackSha256: sha(readbackBytes), manifestSha256: sha(manifestBytes),
  helperSha256: sha(readFileSync(new URL(import.meta.url))), sharpVersion: sharp.versions.sharp,
  bounds: { photos: 11, maxBytesPerPhoto: MAX_BYTES, timeoutMs: TIMEOUT_MS, redirects: 0, maxDecodedPixels: MAX_EDGE * MAX_EDGE },
  databaseAccess: false, credentialAccess: false, imageFilesWritten: 0, passed: false, photos: [] };
report.photos = await Promise.all(selected.map(async ({ binding, url }) => {
  const row = { candidateId: binding.candidateId, destinationId: binding.destinationId, name: binding.name, publicUrl: url.href, passed: false };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { 'User-Agent': 'Peaks public cover serving check/1.0' } });
    row.httpStatus = response.status; row.contentType = response.headers.get('content-type');
    if (response.status !== 200 || row.contentType?.split(';')[0].trim().toLowerCase() !== 'image/jpeg') {
      await response.body?.cancel(); throw new Error('Expected a public HTTP200 JPEG');
    }
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) { await response.body?.cancel(); throw new Error('Image exceeds 10 MiB'); }
    if (!response.body) throw new Error('Image body is missing');
    const reader = response.body.getReader(), chunks = []; let count = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > MAX_BYTES) { await reader.cancel(); throw new Error('Image exceeds 10 MiB'); }
      chunks.push(Buffer.from(value));
    }
    if (!count) throw new Error('Image body is empty');
    const bytes = Buffer.concat(chunks);
    row.bytes = count; row.sha256 = sha(bytes);
    const metadata = await sharp(bytes, { limitInputPixels: MAX_EDGE * MAX_EDGE, failOn: 'error' }).metadata();
    if (metadata.format !== 'jpeg' || !Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)
      || metadata.width < 1600 || metadata.height < 900 || Math.max(metadata.width, metadata.height) > MAX_EDGE) throw new Error('Stored image violates existing cover dimensions');
    const decoded = await sharp(bytes, { limitInputPixels: MAX_EDGE * MAX_EDGE, failOn: 'error' }).raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== metadata.width || decoded.info.height !== metadata.height) throw new Error('Decoded image dimensions differ');
    row.width = metadata.width; row.height = metadata.height; row.passed = true;
  } catch (error) { row.error = error instanceof Error ? error.message : String(error); }
  finally { clearTimeout(timer); }
  return row;
}));
report.passed = report.photos.every(photo => photo.passed);
report.finishedAt = new Date().toISOString();
try { writeFileSync(reportFd, JSON.stringify(report, null, 2) + '\n'); } finally { closeSync(reportFd); }
console.log(JSON.stringify({ report: args[3], passed: report.passed, photos: report.photos.map(({ name, passed, httpStatus, width, height, error }) => ({ name, passed, httpStatus, width, height, error })) }));
if (!report.passed) process.exitCode = 1;
