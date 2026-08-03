Use `$peaks-route-elevation-backfill` and follow it literally. Work only from
`/Users/josiahm/projects/peaks/.workers/firebase-route-elevation`. Run one
bounded job: stats, claim exactly one route, then process only that route and
lease token. Do not improvise or use raw npm commands, another checkout, or a
worker ID. Report the compact result, queue totals, lease state, and blocker if
any. Stop after that one route.
