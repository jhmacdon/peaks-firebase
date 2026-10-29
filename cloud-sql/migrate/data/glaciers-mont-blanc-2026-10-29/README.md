# Mont Blanc source packet

The builder reads local, hashed inputs only. `builder-inputs.sha256.json` is
itself pinned in the builder. `SHA256SUMS` covers all saved files. Raw bytes
remain unchanged, including failed HTTP replies. Successful `.fetch.json`
records hold URL, plain tool User-Agent, response headers, timestamp and hash.
Overpass requests have their saved query and header files instead.

`derived/derivation.json` records the GDAL extraction/reprojection commands.
`inventory-crosswalk.json` preserves source properties and whole geometries;
its member links are the reviewed crosswalk. No inventory is clipped to OSM.
`ring-repair-audit.json` records the nine source ring self-contacts.
`place-inputs.json` records the relevance cut, source parts, aliases and
excluded named glaciers. `final-heads.json` uses the selected whole outlines.

To reproduce heads, build the manifest, then run (GDAL Python + numpy):

```bash
node --import tsx src/import-mont-blanc-glaciers.ts --write-manifest=.cache/mont-blanc-manifest.json >/dev/null
python3 scripts/glacier-dem-heads.py --manifest .cache/mont-blanc-manifest.json \
  --context data/glaciers-mont-blanc-2026-10-29/context-overpass.json \
  --dem-dir data/glaciers-mont-blanc-2026-10-29/copdem --output .cache/mont-blanc-heads.json
```

The output must match `derived/final-heads.json`. Peaks public searches verify
parent names and positions; IDs stay open. The audit packet in
`docs/data-audits/mont-blanc-glaciers-2026-10-29.md` lists terms, sources,
combined figures, exclusions, overlap holds and apply prerequisites.

The helper `scripts/mont-blanc-source-review/fetch.py URL DESTINATION` caches
one response and its hash, with no personal headers. It refuses replacement.
Space requests to each host; never run a concurrent Overpass batch.
