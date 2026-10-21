# Route terrain facts

Where a catalog route is plain trail, rough trail, a scramble, or a technical
climb, found one route at a time from public sources. OpenStreetMap
`sac_scale` is a hint, never a label: mappers grade a whole way by its hardest
move (Kaleetan's 1.9 km climbers' trail is T3 end to end) and grade glacier
routes by crevasse risk (Disappointment Cleaver is T6).

Packet, research, verify, review and compare never write to the database.
Apply plans changes by default; writes need an explicit `--apply`.

## Steps

Run from `cloud-sql/migrate`, one directory per route run, outside the
checkout (source pages are copyrighted and stay local):

```bash
RUN=/path/to/peaks/private/terrain-facts/<date>/<name>
DB_HOST=127.0.0.1 DB_PASS=... npm run terrain:packet -- --route <route id> --dir $RUN
npm run terrain:research -- --dir $RUN
npm run terrain:verify -- --dir $RUN
```

1. **Packet** (`packet.ts`). Reads the active Peaks route read-only: ordered
   stretches (`S1`...; consecutive segments sharing a display name), named
   places within 75 m (`W1`...), and an elevation profile every 100 m. It
   leaves out current segment kinds and OSM difficulty tags so they cannot
   anchor the research. `packet_sha256` excludes the build time.
2. **Research** (`researcher-prompt.md`, `schema.ts`). One Codex run with live
   web search and a read-only sandbox in an empty directory, `--ignore-user-config`
   so no local MCP or plugin is in reach. Model and effort default to
   `gpt-6.1-sol` / `ultra`; override with `TERRAIN_MODEL` / `TERRAIN_EFFORT`.
   The answer must match the schema. Every value that is not `unknown` cites
   claims, and every claim is a 6–60 word verbatim quote with its URL.
3. **Verify** (`verify.ts`, `fetch-pages.ts`). Fetches each cited page once,
   saves its text under `pages/`, and checks:
   - the quote is on the page (typographic quotes, dashes and spaces folded;
     a punctuation-free match is marked `verified_loose`); no `...` or `[ ]`;
   - each value cites a verified claim whose own words carry it (a class 3
     needs "class 3"/"third class"; hands need words about hands or
     scrambling; `not_needed` needs "no hands", "walk-up", "non-technical"...);
   - a scramble, a technical climb, class 3+, and `hands: required` rest on
     two publishers, and not only on trip reports or forums;
   - a scramble states a class of 3+ or says hands are used: climbers write
     "scramble" for any walk over rock (the Mountaineers' "scramble down into
     the crater" on Rainier);
   - a ceiling is not a rating: NPS's "3rd or 4th class at most" for the
     Cleaver bounds it, so it cannot set a class;
   - every stretch appears once; every waypoint and stretch id exists;
     elevation bands use numbers stated in the placing quotes (or the catalog
     summit elevation when a quote says "summit", "final", "last" or "top"),
     and fall on the route.
   It writes `verification.json` and `review.md`.
4. **Review** (`reviewer-prompt.md`). Two Codex reviewers read the same saved
   files on their own, without web search. Each checks whether a quote is
   about this route and supports its claim. They write `decision.a.json` and
   `decision.b.json`, with labels, claim ids, new quotes, rejections and open
   questions. The checker tests new quotes against saved page text.
5. **Compare.** Checks both decisions and plans them against the database
   read-only. It writes `compare.json` and sends doubtful cases to a person.

## Review and compare

After verify, run both reviewers, then compare:

```bash
npm run terrain:review -- --dir $RUN --as a
npm run terrain:review -- --dir $RUN --as b
DB_HOST=127.0.0.1 DB_PASS=... npm run terrain:compare -- --dir $RUN
```

Both decisions must pass the checks. They must name the same non-trail
kinds. For each kind, the shared metres must cover at least 80% of the
combined metres. Both must have holds or neither may have them. Summary
presence and hardest class must match. Pure trail coverage does not affect
agreement.

Any disagreement goes to a person. So does any failed check, plan failure,
plan flag, hold, climb or climbers route, even when the reviewers agree.
Only agreement with no such flag writes `decision.json`. Existing decisions
are never overwritten. Apply still needs a separate run.

## Round up

Never let a route look easier than it is. When credible sources disagree,
the harder rating stands. An easier claim can lower a label only when two
publishers say so in plain words and none says harder; trip reports can raise
a flag but never lower one. Rate the hardest conditions of the route's normal
season. Unreviewed OSM labels stay until a review replaces them: resetting to
trail without evidence would understate.

## Applying a decision

`decision.json` carries `apply`: intervals along the route, each with a kind
(`climbers_route`, `scramble`, `climb`, `trail`, ...). An endpoint is
`"start"`, `"end"`, metres along the route, a segment edge
(`{"segment": id, "edge": "start"}`), or an elevation crossing
(`{"elevation_ft": 6100, "crossing": "last"}`, measured on the segments' own
elevations).

```bash
npm run terrain:apply -- --dir $RUN                                   # plan + hash
npm run terrain:apply -- --dir $RUN --apply --expected-plan <hash>    # write it
```

Segments wholly inside an interval take its kind. A segment an interval ends
inside more than 15 m from its ends is split there, for every route that uses
it; the pieces keep the parent's names, provenance and state, and get their
own distance, gain and loss. A scramble or climb label the decision does not
back goes back to trail. Apply runs in one transaction with rematch deferred,
re-reads every segment and refuses on any drift, rebuilds the paths and
derived stats of every touched route, and queues those routes' sessions to
match again after a split. Each change is recorded in
`segment_terrain_labels` with the plan hash, reviewer and source URLs.

Kinds:
- `trail` for any hike, rough or not: boot paths, talus and steep rocky trail
  stay trail.
- `climbers_route` only for the non-glacier ground of a mountaineering route
  whose research says it needs climbing gear or glacier travel (the Cleaver,
  Cathedral Gap, Rainier's crater rim). Crampons needed in the route's season
  count, even early season only (Stuart's Cascadian Couloir).
- `scramble` needs hands (class 3+ or quotes about hands).
- `climb` is 5th class: a roped technical rock climb, with a stated class 5
  or 5.x rating. Class 4 is a scramble.

## Fetching rules

HTTPS goes through the route factory's pinned-address fetcher. A site that
refuses scripts but serves a normal browser gets one headless Chromium load
(`TERRAIN_BROWSER`, else the newest Playwright Chromium in the user cache).
A bot check, captcha, 401, 403 or 429 is a block: the claim is
`page_blocked` and needs a person to read the page. Never solve a challenge,
sign in, or switch tools to get past one. Requests to one host are at least
two seconds apart. The researcher may open at most two Peakbagger pages per
route; Peakbagger blocks scripts, so its quotes always need a person.

## Cost

No service or timer; $0/month fixed. Each research run uses
Codex quota (several web searches and pages at `ultra` effort). Each reviewer
uses Codex quota with web search disabled.
