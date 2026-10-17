import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

export const DEFAULT_INPUT = '/Users/josiahm/projects/peaks/private/wa-trail-data';
export const DEFAULT_OUT = resolve(__dirname, '../../../../.cache/graph');
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
