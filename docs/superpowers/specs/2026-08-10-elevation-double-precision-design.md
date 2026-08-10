# Elevation Double Precision Design

## Goal

Keep every trusted elevation value in meters at the precision supplied by its source. Convert to whole feet or meters only while formatting text, or at a named external boundary that requires an integer.

## Audit findings

The live PostgreSQL schema already uses `DOUBLE PRECISION` for destination elevation and prominence, route and segment gain/loss, session gain/high point, and tracking-point elevation. PostGIS Z coordinates also use double precision. The live audit found 982,340 tracking points with fractional elevation, so the storage layer already carries decimals.

Precision is lost before or during serialization:

- Web destination creation, bulk waypoint import, elevation lookup, and automatic trailhead creation round to whole meters.
- The shared Terrarium decoder discards its native 1/256-meter fraction.
- Route elevation profile encoders in PostgreSQL, TypeScript, and Swift write whole-meter text. All 253 live Peaks profiles use integers even though their PostGIS paths contain fractional Z values. Across 77,816 samples, 71,580 differ from the path by up to 0.5 m (1.64 ft).
- Some route/session statistics are rounded to tenths before storage.
- iOS narrows elevation for route profiles, viewfinder requests, plan weather state, and GPX export.
- Several readers use truthiness, which turns a valid zero-meter value into null.

## Precision contract

Canonical elevation values use PostgreSQL `DOUBLE PRECISION`, TypeScript `number`, and Swift `Double`. Writers must reject non-finite values and must not call integer or decimal-place rounding before storage.

Duplicated elevation representations must agree:

- `destinations.elevation` equals `ST_Z(destinations.location)` when elevation is present.
- `tracking_points.elevation` equals `ST_Z(tracking_points.location)` when elevation is present.
- A Peaks-owned route profile decodes to the same finite values and vertex count as its `LineStringZ` path.

Display formatters may round. Derived render caches may use a narrower representation only when their error remains below the source resolution and they never feed canonical data back into storage.

## Route profile wire format

Keep the existing base64-wrapped, pipe-separated ASCII format so released clients remain compatible. Decimal tokens replace integer-only tokens. Existing clients already parse tokens as `Double`.

The canonical database encoder writes each finite PostGIS Z value as its round-trippable decimal text without whole-meter rounding. TypeScript and Swift encoders do the same for user-created profiles. Decoders accept both legacy integer tokens and finite decimal tokens, reject malformed/non-finite data, and enforce the expected vertex count when one is supplied.

## Writers and readers

Remove storage-time rounding from destination, route, session, import, GPX, viewfinder, and weather paths. Use null checks rather than truthiness. Add shared finite-number checks at API boundaries where client input can reach elevation, prominence, gain, loss, high point, or geometry Z.

The MET Norway request may format a decimal altitude because its query is a text boundary, but the plan and cache key retain `Double`. UI labels keep their current whole-unit presentation.

## Repair

Repair only from trusted values; never infer missing decimals.

1. Rebuild every valid Peaks-owned `elevation_string` from its PostGIS `LineStringZ` path in the database migration.
2. Repair duplicated plain-column/PostGIS-Z mismatches when one trusted canonical value exists, and add checks that prevent new mismatches.
3. Preserve existing user profiles that have no precise source. New iOS/web writers stop creating lossy profiles.
4. Emit a read-only audit report for whole-meter destination values whose original precision cannot be recovered locally. External IDs make a row reviewable, not automatically correct; no network value overwrites a destination without an identity and source check.
5. Do not add a Firestore fallback. Old rows stay visible in the report until a trusted source supplies a replacement.

## Migration safety

The migration is transactional and idempotent. It records before/after counts, leaves route geometry unchanged, rebuilds only profiles backed by valid finite `LineStringZ` data, and proves profile vertex counts and values match the path before commit. Existing whole-meter profile decoders remain compatible during rollout.

The change adds no service, timer, instance, or recurring job. Backend run-rate change: about $0/month.

## Tests and verification

Use `1234.567890123` as the cross-system sentinel. Tests cover database encoding, TypeScript and Swift profile round trips, destination column/Z equality, zero versus null, Terrarium decoding, API JSON, route/session statistics, viewfinder query values, plan weather cache keys, and GPX export/import.

Run the Firebase API and migration suites against the guarded `_test` database, then build/lint the API and web app. Run focused iOS unit tests with outbound-network auditing and build the `PeaksApp` simulator target with `ENABLE_USER_SCRIPT_SANDBOXING=NO`.
