export type LoaderMode = 'catalog' | 'rebase' | 'prune';
const switches = ['apply','activate','elevation','only-ok','include-review','prune-pending','rebase'];
/** Loader entry points must parse before reading files or opening a client.
 * A quoted string containing two flags is one invalid argument, never a mode. */
export function loaderArgs(argv = process.argv.slice(2), cli: 'catalog' | 'segments' = 'catalog'): Map<string, string[]> {
  const flags = new Set(cli === 'catalog' ? switches : ['apply']), values = new Set(cli === 'catalog' ? ['out','input','batch-size'] : ['out']);
  const result = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]; if (!raw.startsWith('--') || /\s/.test(raw.split('=')[0])) throw new Error(`Unknown argument ${JSON.stringify(raw)}`);
    const [key, ...attached] = raw.slice(2).split('=');
    if (!flags.has(key) && !values.has(key)) throw new Error(`Unknown argument ${JSON.stringify(raw)}`);
    if (result.has(key)) throw new Error(`Duplicate argument --${key}`);
    if (flags.has(key)) { if (attached.length) throw new Error(`--${key} is a flag without a value`); result.set(key, ['true']); }
    else {
      const value = attached.length ? attached.join('=') : argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`); result.set(key, [value]);
    }
  }
  if (cli === 'segments') return result;
  const mode = loaderMode(result);
  if (mode !== 'catalog') for (const key of ['activate','only-ok','include-review','batch-size', ...(mode === 'prune' ? ['elevation'] : [])]) if (result.has(key)) throw new Error(`--${key} is not valid in ${mode} mode`);
  if (result.has('only-ok') && result.has('include-review')) throw new Error('Choose --only-ok or --include-review');
  const batch = Number(result.get('batch-size')?.[0] ?? '50'); if (!Number.isInteger(batch) || batch < 1 || batch > 50) throw new Error('Activation batch size must be 1–50');
  if (result.has('activate') && !result.has('elevation')) throw new Error('--activate requires --elevation');
  return result;
}
export function loaderMode(flags: Map<string, string[]>): LoaderMode {
  if (flags.has('rebase') && flags.has('prune-pending')) throw new Error('--prune-pending and --rebase are exclusive modes');
  return flags.has('prune-pending') ? 'prune' : flags.has('rebase') ? 'rebase' : 'catalog';
}
