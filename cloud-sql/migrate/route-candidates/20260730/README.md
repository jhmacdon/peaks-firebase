# Standard-route backfill snapshot

Snapshot date: 2026-07-31.

The live goal audit found:

- 1,319 target summits;
- 293 with a Peaks-owned active standard route;
- 1,026 still missing one;
- 1,078 ultra-prominent targets;
- 340 targets from the named lists;
- 67 targets from the popularity rule; and
- 5 missing targets with a pending Peaks route.

This folder holds 119 saved route artifacts:

- 82 top-level OSM candidates that pass the file, provenance, license, catalog
  link, and
  geometry-shape audit; and
- 37 earlier, incomplete, duplicate, or rejected files under `research/`.

A file audit PASS is not route approval. Each top-level candidate still needs
route-identity, access, map, geometry-agreement, import dry-run, and independent
review gates before activation.

Live routes completed during this backfill:

- Gerlachovský štít — active with segments;
- Gunung Mulu — active with segments; and
- Jebel M'Goun — active with segments.

Known holds:

- Gunung Raung remains pending because its current access class blocks
  activation.
- Hikurangi remains pending after review found a parallel shortcut in the
  candidate; the rejected artifact now lives under `research/`.
- Gunung Butak needs a new final approach; the rejected artifact diverged from
  private comparison tracks.
- Haute Cime has a saved candidate but has not been imported.

The 91 matching trailhead migrations are in `cloud-sql/migrations`. The durable
queue migration and `$peaks-route-factory` skill replace this point-in-time
snapshot as the source of ongoing work.
