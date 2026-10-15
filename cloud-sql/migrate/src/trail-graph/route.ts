import { join } from 'node:path';
import { args, DEFAULT_OUT, ndjson, option } from './io';
import { TrailRouter } from './router';
import type { Kind, NamedFeature, Segment } from './types';

export async function loadRouter(dir: string): Promise<TrailRouter> {
  const segments: Segment[] = [], features: NamedFeature[] = [];
  for await (const s of ndjson<Segment>(join(dir, 'segments.ndjson'))) segments.push(s);
  for await (const f of ndjson<NamedFeature>(join(dir, 'features.ndjson'))) features.push(f);
  return new TrailRouter(segments, features);
}
async function main() {
  const options = args(), router = await loadRouter(option(options, 'out', DEFAULT_OUT));
  const from = option(options, 'from', ''), to = option(options, 'to', '');
  if (!from || !to) throw new Error('Usage: npm run trail-graph:route -- --from NAME_OR_LON,LAT --to NAME_OR_LON,LAT [--via NAME] [--prefer NAME] [--avoid KIND] [--out DIR]');
  const avoid = options.get('avoid') ?? [];
  if (avoid.some(k => !['trail', 'road', 'snowfield', 'glacier', 'scramble', 'climb', 'xc'].includes(k))) throw new Error('Unknown --avoid kind');
  console.log(JSON.stringify(router.route(from, to, { via: options.get('via'), preferNames: options.get('prefer'), avoidKinds: avoid as Kind[] }), null, 2));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
