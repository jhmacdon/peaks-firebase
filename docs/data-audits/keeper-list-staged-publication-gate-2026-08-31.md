# Keeper list staged publication gate — 2026-08-31

## Result

The keeper importer now keeps destination work apart from list publication.
The old `--apply` switch is disabled. No command can add or repair a summit and
publish its list membership in the same transaction.

This change made no production writes.

## Required order

Run the same pinned input and reviewed resolution files through these steps:

1. Run with no mode flag for the identity dry run.
2. Run with `--stage-destinations` to add or repair reviewed summit rows only.
3. Add and review each summit cover, route, and route cover through their own
   guarded tools.
4. Run with `--check-publication`. Exit code 2 means work remains.
5. Run with `--publish-lists` only after the check reports `ready: true`.

`--stage-destinations` never writes `lists` or `list_destinations`.
`--check-publication` uses a repeatable-read, read-only transaction.
`--publish-lists` never adds or repairs a destination.
Staging and publishing both take their table lock before their shared advisory
lock, so concurrent runs fail rather than deadlock or read a stale snapshot.

## Publication rules

Every planned destination must:

- exist and retain its summit feature;
- have a nonblank cover URL, credit, and credit URL;
- have at least one active Peaks route that passes the route publication
  checks and has a route cover;
- have no linked active Peaks route without a route cover.

The gate also fails when any active Peaks route in the whole catalog lacks a
route cover. This keeps a new list import from passing while an older route has
lost its cover.

The checks fail closed if their database evidence is missing or malformed.
Publishing also fails before any membership write when a reviewed destination
still needs staging or an identity remains unresolved.

A publish transaction takes no-wait write-blocking locks on every table that
feeds destination covers, route integrity, route covers, and list membership.
It takes those locks before its first database snapshot and holds them through
the membership commit. If another catalog, route, photo, or list writer is
active, publication fails and the operator must rerun it. Reads stay available.

Those locks cover the publication transaction, not later edits. A later route,
photo, destination, or membership write can change the result. Run the PR #170
zero-gap audit after publication and after later catalog maintenance before
claiming the catalog is complete.

## Dependencies and rollout

The runtime check uses `peaks_route_passes_publish_integrity` from route-factory
PR #156 and `route_cover_photos` from route-cover PR #157. The full listed-data
audit in PR #170 remains the final independent check. Merge the code, then apply
the required #156 database changes and the manual
`20260830_route_cover_photos.sql` view migration from #157 with approval before
running the check or publish modes. A code deploy alone does not apply either
database dependency.

The change adds no service, scheduled job, instance, storage class, or paid API.
Estimated backend cost change: **$0/month**.

## Checks

- TypeScript build: passed.
- Focused keeper suites: 75 passed, 1 database-backed test skipped, 0 failed.
- Full migration suite: 829 passed, 9 database-backed tests skipped, 0 failed.
- Tests cover each destination rule, the global route-cover rule, malformed
  evidence, phase-specific writes, unstaged destinations, unresolved identities,
  and the disabled legacy apply path.
