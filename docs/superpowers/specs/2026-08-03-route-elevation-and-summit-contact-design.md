# Route Elevation and Summit Contact

## Problem

The route catalog can publish complete-looking summary stats without the data
needed to draw an elevation profile. Production has 254 active Peaks-owned
routes with geometry and no `elevation_string`. Of those, 129 already carry
non-flat Z values in PostGIS and 125 carry only zero elevations.

The catalog also accepts routes that stop near a linked summit. Mount
Bierstadt's West Slopes route ends 30.6 m short, but the catalog audit fails
only gaps over 250 m. Of 252 active Peaks-owned routes linked to summits, 77
miss at least one summit by more than 5 m and 41 miss by more than 20 m.

This work covers Peaks-owned routes only. It must not replace elevations from
user recordings or imports.

## Invariants

An active Peaks-owned route is complete only when:

1. its path contains finite elevation at every vertex;
2. its encoded elevation profile decodes to the path vertex count;
3. its route and segment gain and loss agree with the stored profile;
4. its public API payload contains the encoded profile;
5. its path comes within 5 m of every linked summit; and
6. an out-and-back or point-to-point summit route ends within 5 m of its final
   linked summit. A loop or lollipop may reach a summit inside its path.

The system must not append a straight line to a summit merely to pass these
gates. A repair must use reviewed OSM, USGS, or other reusable geometry. A
short connector may end at the exact catalog summit only when route sources
show that the accepted route reaches that summit and the source-geometry
review approves the connector.

## Elevation Storage

PostGIS `LineStringZ` paths remain the source of truth. `elevation_string` is a
client cache: rounded metre elevations joined with `|`, then base64 encoded in
the format the iOS app already reads.

A database helper materializes this cache from a non-flat Z path whenever a
Peaks-owned route path changes. It clears the cache for a flat or invalid path.
User-owned routes keep their supplied values.

New route writers must store a full Z path before activation. Activation and
final verification fail when the profile is absent, flat for a climbing route,
the encoded count differs from the path count, or route and segment data
drift.

## Elevation Backfill Queue

Add a durable queue keyed by route ID with queued, working, retry, blocked,
complete, and out-of-scope states. Each row stores:

- a path fingerprint so changed routes return to the queue;
- priority, attempts, last error, and final evidence;
- a lease owner, token, and expiry; and
- whether the worker reused stored Z values or sampled AWS Terrarium tiles.

Seeding includes active and pending Peaks-owned routes with missing, invalid,
or flat elevation profiles. A Luna Max worker claims one route per run.

For a non-flat path, the worker encodes its Z values without a network call.
For a flat path, it fetches only the required zoom-14 Terrarium tiles from the
approved AWS Open Data source, caches them outside git, and samples every
vertex. It may anchor a linked trailhead or summit elevation only when the path
already lies within 5 m of that destination.

The worker updates segment source geometry first, then rebuilds affected route
caches and stats in one transaction. A legacy route with no segment may receive
a route profile while its separate catalog audit still requires a full route
factory rebuild. Failures keep the old active route live and return the job to
retry or blocked state.

Completion requires a fresh database read and a successful response from the
same public route payload used by iOS. The decoded profile count, Z values,
gain, loss, and public payload must all pass.

## Summit Contact Audits and Repairs

The catalog checker must measure the closest path distance to every linked
summit, not only the last endpoint. It reports a hard error above 5 m. It also
checks the final endpoint for out-and-back and point-to-point routes.

The same gate belongs in:

- route candidate review;
- pending-route activation;
- route factory final verification; and
- catalog audit results.

The audit queue stores a rule version as part of its fingerprint. Raising a
gate version requeues prior completed audits so an old pass cannot survive a
new rule.

Seeding adds high priority to summit-contact faults. Every current miss gets a
durable repair job. A single-summit route receives a reviewed replacement
while the old route stays active. For a route linked to several summits, the
factory builds and verifies each required standard route before retiring or
unlinking the shared bad route, so no destination loses coverage midway.

Mount Bierstadt is the first proof repair. Its replacement must reach the exact
catalog summit, carry valid segment provenance and elevation, pass the public
API check, and replace the current West Slopes route without a coverage gap.

## Skills and Workers

Update the four route-catalog-audit workers to:

- treat summit contact over 5 m as an error;
- include profile validity in stored-data gates;
- use the versioned audit fingerprint; and
- send every fault to the repair queue without editing route data.

Create a low-freedom `peaks-route-elevation-backfill` skill. Its scripts own
all queue, sampling, write, and verification steps. The Luna prompt tells the
worker to claim exactly one route, run only the scripts, clear its lease, and
stop. Raw coordinates and terrain tiles never enter model context.

Start one fifth Luna Max task in a dedicated clean checkout. A ten-minute
heartbeat keeps that task working in the same thread and reports only failures.
Resume the existing route-factory task after its stricter activation and
verification gates ship.

## Failure Handling

- A tile timeout or partial tile set retries without writing.
- A changed path invalidates a lease completion and requeues the route.
- Missing or mismatched segments block activation but do not remove a live
  route.
- A route or summit identity conflict goes to human review.
- A repair never copies private GPX geometry or an unlicensed track.
- Three repeated shared tool faults stop that worker and alert the supervisor.

## Tests and Proof

Automated tests cover:

- profile encoding and decoding, including long base64 strings;
- flat, missing, partial, and non-flat Z paths;
- gain and loss recomputation;
- route and segment atomic updates;
- lease claims, expiry, retries, fingerprints, and stale completion;
- internal summit contact for loops;
- final summit contact for out-and-back routes;
- multi-summit route faults;
- audit-version requeue behavior;
- activation and public verification failures for missing elevation or summit
  contact; and
- Peaks-owned scope, with user routes unchanged.

Production proof requires:

1. a complete Bierstadt repair and public API response;
2. one existing-Z elevation job;
3. one AWS-sampled flat elevation job;
4. zero expired worker leases;
5. all 254 current profile gaps present in the queue or complete; and
6. all 77 current summit-contact faults present in repair work or fixed.

## Cost

The design uses the existing Mac, Cloud SQL proxy, Codex heartbeat, and public
AWS terrain tiles. It adds small queue rows and no hosted worker, scheduler, or
always-on service. Expected backend run-rate change is near $0/month; Luna
tokens remain the only material added operating cost.
