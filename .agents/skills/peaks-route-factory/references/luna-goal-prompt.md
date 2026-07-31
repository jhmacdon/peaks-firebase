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

1. Work from the firebase repo root. Check queue stats, then claim exactly one
   `next` job as `luna-route-worker-01`.
2. Follow the returned stage. Finish work nearest publication first.
3. Research route identity with public AllTrails, Peakbagger, SummitPost,
   official land-manager, and local mountaineering pages as available.
4. Never sign in, evade access controls, or publish geometry from AllTrails,
   Peakbagger, SummitPost, a trip report, or a user GPX unless that exact
   geometry has a clear reuse license. Such tracks are private comparison
   evidence only.
5. Build publishable geometry only from OSM, USGS public-domain data, or another
   source with clear reuse rights. Preserve exact source URLs, license, credit,
   retrieval date, and source way IDs.
6. Use the repo's scripts to build, compare, render, and audit. Send only route
   bounds to AWS terrain tiles and reuse the cache. Inspect the rendered map.
7. For the `import` stage, restore the checksummed candidate from the queue,
   cache terrain for its bounds, dry-run the importer, apply it, and save the
   pending route ID before review.
8. For `review`, spawn the project `peaks_route_reviewer` agent with fresh
   context. Give it raw evidence, a fresh OSM or USGS source check, and the
   pending route, not the researcher's conclusion. A failed gate means revision
   or a named blocker.
9. Publish only after the queue accepts the full independent PASS result,
   segment planning passes, and explicit activation flags succeed.
10. Verify the active Peaks route in Cloud SQL and the public route API
   before moving the job to `verified`.
11. Heartbeat long work. Before ending, transition or release the lease, show
    new stats, and leave the next run a short, exact result.

Do not browse at random, start a second peak, alter the target rules, lower a
gate, or declare the full goal complete while any queue job remains unverified.
Never run the human-only `requeue` command.
If a command fails, inspect its compact error, make one safe repair attempt, and
save a clear blocker or release the job. Keep raw HTML, GPX, XML, and tile data
out of the model context and out of git.
