import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { statePaths } from './state';

export const DEFAULT_INPUT = '/Users/josiahm/projects/peaks/private/wa-trail-data';
export const DEFAULT_OUT = statePaths('WA').graph;
export const stateDefaults = statePaths;
export async function* lines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  // Forward file errors to the readline iterator.
  stream.on('error', error => reader.close());
  try { for await (const line of reader) if (line.trim()) yield line; }
  finally { reader.close(); stream.destroy(); }
  if (stream.errored) throw stream.errored;
}
export async function* ndjson<T>(path: string): AsyncGenerator<T> {
  for await (const line of lines(path)) yield JSON.parse(line.replace(/^\x1e/, '')) as T;
}
/** Read one feature at a time from a FeatureCollection, including single-line
 * agency exports. Memory grows with one feature, not the full source file. */
export async function* geojsonFeatures<T>(path: string): AsyncGenerator<T> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  let header = '', found = false, depth = 0, quoted = false, escaped = false, record = '', ended = false;
  try {
    for await (const chunk of stream) {
      let text = String(chunk);
      if (!found) {
        header += text; const match = /"features"\s*:\s*\[/.exec(header);
        if (!match) { if (header.length > 1024 * 1024) throw new Error(`GeoJSON features header too large: ${path}`); continue; }
        text = header.slice(match.index + match[0].length); header = ''; found = true;
      }
      let start = depth ? 0 : -1;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (!depth) {
          if (c === ']') { ended = true; break; }
          if (c === '{') { depth = 1; start = i; }
          else if (!/[\s,]/.test(c)) throw new Error(`Invalid GeoJSON feature: ${path}`);
          continue;
        }
        if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
        else if (c === '"') quoted = true;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') {
          depth--;
          if (!depth) { record += text.slice(start, i + 1); yield JSON.parse(record) as T; record = ''; start = -1; }
        }
      }
      if (depth && start >= 0) record += text.slice(start);
      if (ended) break;
    }
    if (!found || !ended || depth || quoted) throw new Error(`Incomplete GeoJSON FeatureCollection: ${path}`);
  } finally { stream.destroy(); }
}
export async function writeNdjson(path: string, records: Iterable<unknown>): Promise<void> {
  const stream = createWriteStream(path);
  const done = finished(stream); done.catch(() => {});
  for (const record of records) if (!stream.write(JSON.stringify(record) + '\n')) await once(stream, 'drain');
  stream.end(); await done;
}
export function args(argv = process.argv.slice(2)): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Expected --option, got ${argv[i]}`);
    const key = argv[i].slice(2), value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    result.set(key, [...(result.get(key) ?? []), value]);
  } return result;
}
export const option = (options: Map<string, string[]>, key: string, fallback: string): string => options.get(key)?.[0] ?? fallback;
