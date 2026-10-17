export type LoaderMode = 'catalog' | 'bulk' | 'rebase' | 'prune' | 'retire-pilot';
const switches = ['apply','activate','elevation','only-ok','include-review','prune-pending','rebase','retire-pilot','bulk'];
/** Loader entry points must parse before reading files or opening a client.
 * A quoted string containing two flags is one invalid argument, never a mode. */
export function loaderArgs(argv = process.argv.slice(2), cli: 'catalog' | 'segments' = 'catalog'): Map<string, string[]> {
  const flags = new Set(cli === 'catalog' ? switches : ['apply']), values = new Set(cli === 'catalog' ? ['out','input','batch-size','dir','state'] : ['out']);
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
  if (mode === 'bulk') {
    for (const key of ['out','input','include-review','only-ok']) if (result.has(key)) throw new Error(`--${key} is not valid in bulk mode`);
    if (!result.get('dir')?.[0]) throw new Error('--bulk requires --dir');
    if (!['OR','CA','ID'].includes(result.get('state')?.[0] ?? '')) throw new Error('--bulk requires --state OR|CA|ID');
    const batch = Number(result.get('batch-size')?.[0] ?? '200');
    if (!Number.isInteger(batch) || batch < 1 || batch > 200) throw new Error('Bulk batch size must be 1–200');
    return result;
  }
  for (const key of ['dir','state']) if (result.has(key)) throw new Error(`--${key} requires --bulk`);
  if (mode !== 'catalog') for (const key of ['activate','only-ok','include-review','batch-size', ...(mode !== 'rebase' ? ['elevation'] : [])]) if (result.has(key)) throw new Error(`--${key} is not valid in ${mode} mode`);
  if (result.has('only-ok') && result.has('include-review')) throw new Error('Choose --only-ok or --include-review');
  const batch = Number(result.get('batch-size')?.[0] ?? '50'); if (!Number.isInteger(batch) || batch < 1 || batch > 50) throw new Error('Activation batch size must be 1–50');
  if (result.has('activate') && !result.has('elevation')) throw new Error('--activate requires --elevation');
  return result;
}
export function loaderMode(flags: Map<string, string[]>): LoaderMode {
  if (flags.has('bulk')) {
    if (['rebase','prune-pending','retire-pilot'].some(f => flags.has(f))) throw new Error('--bulk, --retire-pilot, --prune-pending and --rebase are exclusive modes');
    return 'bulk';
  }
  if (['rebase','prune-pending','retire-pilot'].filter(f => flags.has(f)).length > 1) throw new Error('--retire-pilot, --prune-pending and --rebase are exclusive modes');
  return flags.has('retire-pilot') ? 'retire-pilot' : flags.has('prune-pending') ? 'prune' : flags.has('rebase') ? 'rebase' : 'catalog';
}
