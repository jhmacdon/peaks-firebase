# Luna scheduled-task prompt

Use `$peaks-route-factory` and follow it exactly.

Your lasting goal is to publish and verify one safe standard route for every
target peak in the Peaks route queue. The target includes every ultra-prominent
peak, Colorado 14er, Smoot's 100 peak, Washington Home Court 100 peak,
Peaks-owned Ultras-list peak, and any other summit with at least 25 recorded
sessions. Skip none. A blocked peak stays visible in the queue with a precise
blocker; it does not count as done.

This is one bounded worker run. Work from the durable Cloud SQL queue, not chat
memory:

1. Work only from the dedicated clean checkout at
   `/Users/josiahm/projects/peaks/.workers/firebase-route-factory`. If its
   preflight reports `setup_required`, stop. Never find another worktree, edit
   tracked files, apply migrations, seed the queue, pull, fetch, switch branches,
   or install packages.
2. Use `route_jobs.sh` to check stats, then claim exactly one `next` job as
   `luna-route-worker-01`.
3. Follow the returned stage. Finish work nearest publication first.
   A claim authorizes only that one stage. Its successful terminal transition
   clears the lease; run final stats and stop. Never start the next stage with
   the cleared token, a local artifact, or a saved route ID. A later heartbeat
   must claim the next stage with a new lease.
4. Research route identity with public AllTrails, Peakbagger, SummitPost,
   official land-manager, and local mountaineering pages as available.
5. Never sign in, evade access controls, or publish geometry from AllTrails,
   Peakbagger, SummitPost, a trip report, or a user GPX unless that exact
   geometry has a clear reuse license. Such tracks are private comparison
   evidence only.
6. Build publishable geometry only from OSM, USGS public-domain data, or another
   source with clear reuse rights. Preserve exact source URLs, license, credit,
   retrieval date, and source way IDs.
7. Use the repo's scripts to build, compare, render, and audit. Send only route
   bounds to AWS terrain tiles and reuse the cache. Inspect the rendered map.
8. For the `import` stage, restore the checksummed candidate from the queue,
   cache terrain for its bounds, dry-run the importer, apply it, and save the
   pending route ID before review. Call `import_route_candidate.sh` directly;
   never put environment assignments, `env`, or a shell before it.
9. For `review`, spawn the project `peaks_route_reviewer` agent with fresh
   context. Give it raw evidence, a fresh OSM or USGS source check, and the
   pending route, not the researcher's conclusion. A failed gate means revision
   or a named blocker.
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
