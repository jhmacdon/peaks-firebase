#!/usr/bin/env node
// Public downloads and pure image rendering only. Never import Firebase modules.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';

const here = new URL('./', import.meta.url), root = new URL('../../../../../', here);
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--report' || !/^media-preflight-[1-9][0-9]*\.json$/.test(args[1]))) throw new Error('Use only --report media-preflight-N.json');
const reportName = args[1] ?? 'media-preflight-1.json';
const require = createRequire(new URL('cloud-sql/migrate/package.json', root));
const sharp = require('sharp');
const sha = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const MAX_SOURCE_BYTES = 40 * 1024 * 1024, MAX_INPUT_PIXELS = 80_000_000, MAX_OUTPUT_EDGE = 2_400;
const manifestBytes = readFileSync(new URL('manifest.json', here));
const manifest = JSON.parse(manifestBytes);
const expectedIds = new Set(['xxoCzbZ6wudjscAe788b','sLF3JFQL61nB2nK78F2f','vNACg3f2NioMeR2qdBjX','goxoEUevbtTLEgWOBQ2T','jXUNh6O7X9w3ubnS2FuC','tPvVhGEVwnGL3z5R-DEm','RuNcafBQAXNpAfNZMuCb','3QHwUgURE8ts4_kWO639','Dhv7RDXMojUW0T_jZYI4','WBxrYhLbTZWuLM7DqyAa','ITkoNEc-0dHINLIDz6gG']);
if (manifest.inputs.candidates.path !== 'cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/photos/candidates.json' || manifest.inputs.review.path !== 'cloud-sql/migrate/data/trail-catalog/wa-cascades-20261013/photos/review.json') throw new Error('Only the saved photo input paths are allowed');
const source = readFileSync(new URL(manifest.inputs.candidates.path, root));
if (sha(source) !== manifest.inputs.candidates.sha256 || manifest.covers.length !== 11 || new Set(manifest.covers.map(c => c.candidateId)).size !== 11 || manifest.covers.some(c => !expectedIds.has(c.candidateId))) throw new Error('Pinned eleven-cover manifest changed');
const candidates = JSON.parse(source).candidates;
const reviewBytes = readFileSync(new URL(manifest.inputs.review.path, root));
if (sha(reviewBytes) !== manifest.inputs.review.sha256) throw new Error('Pinned photo review changed');
const review = JSON.parse(reviewBytes);
const queuePath = 'docs/data-audits/trail-catalog-wa-2026-10-13/photos/operations/production-apply-1.jsonl';
if (manifest.inputs.queueReceipt.path !== queuePath) throw new Error('Only the saved queue receipt is allowed');
const queueBytes = readFileSync(new URL(queuePath, root));
if (sha(queueBytes) !== manifest.inputs.queueReceipt.sha256) throw new Error('Pinned queue receipt changed');
const queued = queueBytes.toString('utf8').trim().split('\n').map(JSON.parse).filter(row => row.type === 'candidate');
const helper = readFileSync(new URL('web/src/lib/destination-photo-storage.ts', root), 'utf8');
const quality = readFileSync(new URL('web/src/lib/destination-photo-quality.ts', root), 'utf8');
const renderBody = helper.slice(helper.indexOf('export async function renderDestinationPhoto('), helper.indexOf('export async function storeDestinationPhoto('));
for (const token of ['limitInputPixels: MAX_INPUT_PIXELS', 'metadata.orientation >= 5', '.rotate()', 'width: MAX_OUTPUT_EDGE', 'height: MAX_OUTPUT_EDGE', 'fit: "inside"', 'withoutEnlargement: true', '.jpeg({ quality: 86, progressive: true, mozjpeg: true })']) {
  if (!renderBody.includes(token)) throw new Error('Existing renderer changed; review the pure equivalent before running');
}
if (!helper.includes('MAX_INPUT_PIXELS = 80_000_000') || !helper.includes('MAX_OUTPUT_EDGE = 2_400')
  || !quality.includes('DESTINATION_PHOTO_MIN_WIDTH = 1_600') || !quality.includes('DESTINATION_PHOTO_MIN_HEIGHT = 900')) throw new Error('Existing render limits changed');
const selected = manifest.covers.map(binding => {
  const matches = candidates.filter(c => c.destinationId === binding.destinationId && c.sourcePageUrl === binding.sourcePageUrl);
  const proof = review.proposals.filter(p => p.destinationId === binding.destinationId && p.sourcePageUrl === binding.sourcePageUrl);
  const queue = queued.filter(q => q.candidateId === binding.candidateId && q.destinationId === binding.destinationId && q.sourcePageUrl === binding.sourcePageUrl);
  if (proof.length !== 1 || queue.length !== 1 || proof[0].imageSha1 !== binding.imageSha1 || proof[0].metadataSha256 !== binding.metadataSha256) throw new Error('Saved review or queue identity differs');
  if (matches.length !== 1 || matches[0].destinationName !== binding.name || !/^[a-f0-9]{40}$/.test(binding.imageSha1)) throw new Error('Exact public source binding missing');
  return { binding, candidate: matches[0] };
});
function publicImage(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org' || url.port || url.username || url.password || url.search || url.hash) throw new Error('Only the exact public Commons image host is allowed');
  return url;
}
async function download(raw) {
  let url = publicImage(raw), response;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await fetch(url, { signal: controller.signal, redirect: 'manual', headers: { 'User-Agent': 'Peaks licensed cover preflight/1.0 (https://peaks.app)' } });
      if (response.status < 300 || response.status >= 400) break;
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects === 5) throw new Error('Missing or excessive image redirects');
      url = publicImage(new URL(location, url).href);
    }
    if (!response?.ok) { await response?.body?.cancel(); throw new Error(`Image HTTP ${response?.status ?? 0}`); }
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.toLowerCase().startsWith('image/')) { await response.body?.cancel(); throw new Error('Source is not an image'); }
    if (Number(response.headers.get('content-length') || 0) > MAX_SOURCE_BYTES) { await response.body?.cancel(); throw new Error('Source exceeds 40 MiB'); }
    if (!response.body) throw new Error('Empty image response');
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error('Source exceeds 40 MiB'); }
      chunks.push(Buffer.from(value));
    }
    if (!bytes) throw new Error('Empty source image');
    return { data: Buffer.concat(chunks), status: response.status, finalUrl: url.href, contentType };
  } finally { clearTimeout(timeout); }
}
// Same pure Sharp operations and limits as renderDestinationPhoto(). Importing
// that module would initialize Firebase Admin and select cert/ADC credentials.
async function render(data) {
  const image = sharp(data, { limitInputPixels: MAX_INPUT_PIXELS }), metadata = await image.metadata();
  const swapsAxes = metadata.orientation != null && metadata.orientation >= 5;
  const width = swapsAxes ? metadata.height || 0 : metadata.width || 0;
  const height = swapsAxes ? metadata.width || 0 : metadata.height || 0;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1600 || height < 900) throw new Error('Source is below the existing 1600×900 cover floor');
  const output = await image.rotate().resize({ width: MAX_OUTPUT_EDGE, height: MAX_OUTPUT_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86, progressive: true, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { metadata, oriented: { width, height }, output };
}
const reportFd = openSync(new URL(reportName, here), 'wx', 0o600);
const cache = mkdtempSync('/private/tmp/peaks-eleven-cover-media-');
const report = { mode: 'public-media-preflight-only', startedAt: new Date().toISOString(),
  manifestSha256: sha(manifestBytes), candidatesSha256: sha(source), reviewSha256: sha(reviewBytes), queueReceiptSha256: sha(queueBytes), helperSha256: sha(readFileSync(new URL(import.meta.url))), rendererBodySha256: sha(renderBody), qualityHelperSha256: sha(quality), sharpVersion: sharp.versions.sharp,
  limitation: 'Pure Sharp equivalent: importing destination-photo-storage.ts initializes Firebase Admin and selects cert/ADC credentials. No Firebase module was imported; authentication, Storage upload, admin action and public serving were not tested.',
  bounds: { candidates: 11, sourceBytes: MAX_SOURCE_BYTES, downloadTimeoutMs: 30_000, maxRedirects: 5, maxInputPixels: MAX_INPUT_PIXELS, maxOutputEdge: MAX_OUTPUT_EDGE },
  databaseAccess: false, credentialAccess: false, uploads: 0, approvals: 0, fixedMonthlyCostDeltaUsd: 0, candidates: [] };
try {
  for (const { binding, candidate } of selected) {
    const row = { candidateId: binding.candidateId, destinationId: binding.destinationId, name: binding.name,
      imageUrl: candidate.imageUrl, sourcePageUrl: binding.sourcePageUrl, expectedSha1: binding.imageSha1, checkedAt: new Date().toISOString(), passed: false };
    try {
      const sourceImage = await download(candidate.imageUrl), data = sourceImage.data;
      Object.assign(row, { httpStatus: sourceImage.status, finalUrl: sourceImage.finalUrl, contentType: sourceImage.contentType,
        sourceBytes: data.length, sourceSha1: sha(data, 'sha1'), sourceSha256: sha(data) });
      if (row.sourceSha1 !== binding.imageSha1) throw new Error('Original Commons SHA-1 changed');
      writeFileSync(`${cache}/${binding.candidateId}-source.jpg`, data, { flag: 'wx', mode: 0o600 });
      const result = await render(data);
      if (result.metadata.width !== candidate.imageWidth || result.metadata.height !== candidate.imageHeight) throw new Error('Decoded dimensions differ from saved Commons manifest');
      writeFileSync(`${cache}/${binding.candidateId}-rendered.jpg`, result.output.data, { flag: 'wx', mode: 0o600 });
      Object.assign(row, { sourceDimensions: { width: result.metadata.width, height: result.metadata.height, orientation: result.metadata.orientation ?? null },
        orientedDimensions: result.oriented, renderedDimensions: { width: result.output.info.width, height: result.output.info.height },
        renderedBytes: result.output.info.size, renderedSha256: sha(result.output.data), passed: true });
    } catch (error) { row.error = error instanceof Error ? error.message : String(error); if (error?.cause?.code) row.networkErrorCode = error.cause.code; }
    report.candidates.push(row);
    console.log(JSON.stringify({ name: row.name, passed: row.passed, sourceBytes: row.sourceBytes ?? null, error: row.error ?? null }));
  }
} finally { rmSync(cache, { recursive: true, force: true }); }
report.finishedAt = new Date().toISOString(); report.cacheRetained = false;
report.complete = report.candidates.length === 11 && report.candidates.every(c => c.passed);
try { writeFileSync(reportFd, JSON.stringify(report, null, 2)+'\n'); } finally { closeSync(reportFd); }
if (!report.complete) process.exitCode = 2;
