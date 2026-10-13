# Snow Lake and Ingalls Lake shared-segment inspection

This export inspects only segments `L4JeIhjFWrqIGzkkZ1fk` and
`vTRZQyeAZpTecyFjAGIr`, their references, and affected Peaks-owned routes.
It prepares evidence for a later repair decision; it makes no repair or approval.
It requires the deployed Phase 1 and 2 trail migrations. It has no dependency on
the Phase 3 review tables or functions.

The operator supplies an already approved read-only database connection. This
script contains no credentials, credential loader, role change or write. Run
from the repository root with connection details kept outside the command text:

```bash
psql -X -q -A -t -v ON_ERROR_STOP=1 \
  -f docs/data-audits/trail-catalog-wa-2026-10-13/shared-conflicts/inspect.sql \
  > /private/tmp/peaks-shared-conflicts-snapshot.json
```

Use a fresh output path. Require exit zero and one complete JSON object. A timeout,
schema error, empty output, exceeded cap, missing segment, private reference, or
withheld target blocks repair. Keep the error beside the output. Do not treat a
partial file or empty arrays as proof of no conflicts.

The first operator attempt stopped at `digest(bytea, unknown)` function resolution
under the locked `pg_catalog, public` search path. It produced no valid snapshot
and made no writes. The script now uses PostgreSQL's built-in `sha256(bytea)`,
including `convert_to(..., 'UTF8')` for private ID hashes; it needs no pgcrypto
function or added search-path entry.

The transaction uses one repeatable read snapshot, read-only mode, a 20-second
statement timeout and a 2-second lock timeout. LIMIT+1 checks cap references at
1,000, catalog routes at 25, segment and destination links at 500, and candidate
jobs at 50. Geometry budgets cap route and segment vertices at 100,000 each,
destination boundary vertices at 20,000, and provenance/profile data at 10 MB.
If the complete inventory exceeds a cap, the export withholds all geometry and
bindings and marks `repairBlocked`. Observed counts from an exceeded row cap are
lower bounds, not complete totals. Do not raise limits during an ordinary retry.

The export includes exact public XYZ coordinates, source provenance, elevation
profiles/stats, ordered segment links, catalog contacts and candidate/review
pending binding checks. A false binding for an old route without a candidate receipt is
visible evidence, not an automatic repair instruction. The two target segments
must have a Peaks-owned route reference before their geometry can be exported.

Private routes yield counts and domain-separated SHA-256 route ID hashes only;
the export omits their names, owners, coordinates, provenance, ordinal/direction,
plans and sessions. Private linked destinations likewise yield only counts and
hashed IDs. Any such reference blocks repair. No session or plan tables are read.
No segment geometry beyond the two target IDs appears. Affected catalog routes
include their full materialized XYZ path and ordered segment IDs, without
exporting those other segments separately.

After the operator returns the snapshot, compare its public geometry to the
saved OSM relation bundles `4793517` and `5626186` and their checked DEM files.
Use the existing exact matcher for analysis, retaining source boundary cuts.
Identify Snow Lake's exact split vertices and Ingalls Lake's XY, sampling, Z or
interval mismatch before proposing a source-proofed repair. Never add a guessed
connector, duplicate the common trail, delete a parent or rename a route to clear
these blockers. Fixed infrastructure cost: $0/month.
