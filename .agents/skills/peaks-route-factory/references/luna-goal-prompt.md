# Luna scheduled-task prompt

Use `$peaks-route-factory` and follow it exactly.

Your lasting goal is to publish and verify one safe standard route for every
target peak in the Peaks route queue. The target includes every summit on any
Peaks-owned list, every ultra-prominent peak, and any other summit with at
least 25 recorded sessions. It also includes queued integrity repairs. Skip
none. A blocked peak stays visible in the queue with a precise blocker; it does
not count as done.

This is one bounded worker run. Work from the durable Cloud SQL queue, not chat
memory:

1. Work only from the exact dedicated checkout named by the scheduled task.
   Approved general worker checkouts end in `firebase-route-factory`,
   `firebase-route-factory-02`, `firebase-route-factory-03`, or
   `firebase-route-factory-04`. Never choose, search for, or switch to another
   checkout. If preflight reports `setup_required`, stop. Never edit tracked
   files, apply migrations, seed the queue, pull, fetch, switch branches, or
   install packages.
2. Use `route_jobs.sh` to check stats, then claim exactly one `factory` job. Never
   pass `--worker-id`; the wrapper derives the unique worker ID from the
   checkout.
3. Follow the returned stage. Finish work nearest publication first.
   A claim authorizes only that one stage. Its successful terminal transition
   clears the lease; run final stats and stop. Never start the next stage with
   the cleared token, a local artifact, or a saved route ID. A later heartbeat
   must claim the next stage with a new lease.
   Keep every mutable candidate, result, packet, and review in this checkout's
   ignored `cloud-sql/migrate/route-candidates/luna/worker-artifacts`
   directory, with the current lease token in its filename. Never use a shared
   `/private/tmp` handoff file. Restore prior-stage inputs from the durable
   queue with the exact materialize command in `stage-commands.md`.
4. Check public AllTrails and Peakbagger pages first for route identity, then
   confirm it with SummitPost, official land-manager, and local mountaineering
   pages as available. Store both checks in `discovery_checks`. A direct match
   must also appear in `identity_sources`; otherwise record a real `no_match`
   or `unavailable` note, the exact public service search for the claimed
   destination name, and a fresh `checked_at`. Never invent a source URL, search
   for another place, or use a service home page as proof.
5. Never sign in, evade access controls, or publish geometry from AllTrails,
   Peakbagger, SummitPost, a trip report, or a user GPX unless that exact
   geometry has a clear reuse license. Such tracks are private comparison
   evidence only.
6. Filter the reviewed official trail registry for the claimed country. Use
   relevant `validation_only` or `manual_gap` agency pages to check identity,
   access, or alignment, but never copy their geometry. Map the chosen route on
   a `ready_publishable` source first. If it has no complete line, use the
   existing USGS adapter next. Use OSM only after both official and USGS checks
   have durable negative outcomes. In `official_source_attempts`, record exactly
   one fresh, registry-compatible outcome for every source that covers the
   claim's stored country code, and repeat that code in
   `official_source_country_code`. The selected outcome must match the
   candidate's exact geometry source and URL. Preserve exact source URLs, license, credit,
   retrieval date, and stable source IDs.
7. Use the repo's scripts to build, compare, render, and audit. Send only route
   bounds to AWS terrain tiles and reuse the cache. Inspect the rendered map.
8. For the `import` stage, restore the checksummed candidate from the queue,
   cache terrain for its bounds, dry-run the importer, apply it, and save the
   pending route ID before review. Call `import_route_candidate.sh` directly;
   never put environment assignments, `env`, or a shell before it. Quote the
   full route name as one value and require the dry-run `Name:` and
   `route_name` output to match it before apply.
9. The `factory` stage excludes `pending_review`. Never claim `review`, build a
   review packet, invoke `peaks_route_reviewer`, or submit a review result. The
   separate worker in `firebase-route-review` owns that stage and its lease.
10. Publish only after the queue accepts the full independent PASS result,
   segment planning passes, and explicit activation flags succeed.
11. For `verify`, run the one queue `verify` command and accept its returned
    action. Never choose or write a verify transition yourself. A legacy route
    missing provenance or segments must go to rebuild, not `needs_human`.
12. Heartbeat long work. Before ending, transition or release the lease, show
    new stats, and leave the next run a short, exact result.

Do not browse at random, start a second peak, alter the target rules, lower a
gate, or declare the full goal complete while any queue job remains unverified.
Never run the human-only `requeue` command.
If the same tool fault or blocker occurs on three consecutive destinations,
release any lease, mark the lasting goal blocked, and stop. Do not keep draining
that stage.
If a command fails, inspect its compact error, make one safe repair attempt, and
save a clear blocker or release the job. Keep raw HTML, GPX, XML, and tile data
out of the model context and out of git.
