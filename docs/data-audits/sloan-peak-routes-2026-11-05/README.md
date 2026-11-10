# Sloan Peak route research — 2026-11-05

Research handoff for [Sloan Peak](https://getpeaks.app/destinations/lE8Xh02BVk0o8ew7fuRs), destination `lE8Xh02BVk0o8ew7fuRs`.

**Status: research complete for the entries below; live catalog audit and imports blocked.**
This session has GitHub access, but no Cloud SQL credentials or connected Peaks admin browser.
The public destination page could not be read. Existing route counts, destination identity,
list memberships, trailhead IDs, and user-route leads remain unverified. No database rows
were written. This is not a confirmed missing-route audit or an import-ready manifest.

`research.json` retains source URLs, reported grades, route distinctions, unknown fields
and blockers. Its `publication_state` describes this handoff, not a database route status.
All distance, gain and time fields remain null until an exact itinerary and terrain profile
are checked. Wall height and technical pitch length must not become full-route metrics.

## Proposed route inventory

There are 12 proposed entries: two approaches to the normal Corkscrew line, six other
summer rock itineraries, and four winter itineraries. These are candidates to compare
with existing catalog rows, not 12 assumed missing routes.

| Proposed Peaks route | Reported difficulty | Evidence |
| --- | --- | --- |
| Sloan Peak via Corkscrew Route from Cougar Creek | Class 3 and glacier travel; brief Class 4 step reported | [The Mountaineers](https://www.mountaineers.org/activities/routes-places/sloan-peak-corkscrew-route) |
| Sloan Peak via Corkscrew Route from Bedal Creek | Class 3 and glacier travel; brief Class 4 step reported | [The Mountaineers](https://www.mountaineers.org/activities/routes-places/sloan-peak-corkscrew-route) |
| Sloan Peak via Southeast Shelf | 5.4 reported; condition-dependent fifth-class steps | [SummitPost](https://www.summitpost.org/sloan-peak-se-shelf/865646); [The Mountaineers](https://www.mountaineers.org/activities/routes-places/sloan-peak-southeast-face) |
| Sloan Peak via Southeast Face | II 5.7 | [The Mountaineers](https://www.mountaineers.org/activities/routes-places/sloan-peak-southeast-face) |
| Sloan Peak via West Face | 5.8; steep snow and routefinding | [SummitPost](https://www.summitpost.org/west-face/168478) |
| Sloan Peak via Fire on the Mountain | 5.10d on Mountain Project; 5.11- and III+ in the AAJ account | [Mountain Project](https://www.mountainproject.com/route/122891276/fire-on-the-mountain); [American Alpine Journal](https://publications.americanalpineclub.org/articles/12201009201) |
| Sloan Peak via Diamond in the Rough | III 5.11- on Mountain Project; III 5.10 in the 2012 AAJ summary | [Mountain Project](https://www.mountainproject.com/route/117637828/diamond-in-the-rough); [American Alpine Journal](https://publications.americanalpineclub.org/articles/12201209100) |
| Sloan Peak via Northwest Buttress | IV 5.9+ | [Mountain Project](https://www.mountainproject.com/route/119519445/northwest-buttress) |
| Sloan Peak via Full Moon Fever | IV 5.8 AI4 50°; R reported in later AAJ coverage | [American Alpine Journal](https://publications.americanalpineclub.org/articles/12201209502); [American Alpine Journal](https://publications.americanalpineclub.org/articles/13201216960) |
| Sloan Peak via Superalpine | IV WI3/4 | [Kyle McCrohen](https://climberkyle.com/2020/02/28/fa-sloan-peak-superalpine-wi3-4-1000/); [American Alpine Journal](https://publications.americanalpineclub.org/articles/13201216588); [American Alpine Journal](https://publications.americanalpineclub.org/articles/13201216960) |
| Sloan Peak via Merrill–Minton | IV WI4+; later conditions reported as WI5 R on shared pitches | [American Alpine Journal](https://publications.americanalpineclub.org/articles/13201216588); [American Alpine Journal](https://publications.americanalpineclub.org/articles/13201216960) |
| Sloan Peak via Borrowed Time | IV WI5 M7; R on Mountain Project | [American Alpine Journal](https://publications.americanalpineclub.org/articles/13201216960); [Mountain Project](https://www.mountainproject.com/route/200656568/borrowed-time) |

## Route identity decisions

- Keep the two Corkscrew starts separate and reuse their common upper segments after
  exact overlap review. The Bedal Creek variant still crosses Sloan Glacier.
- Southeast Shelf and Southeast Face are separate itineraries. The former joins the
  upper scramble; the latter climbs a technical face above the ledge.
- Keep the conventional West Face, Northwest Buttress, Fire on the Mountain, and
  Diamond in the Rough distinct. A shared basin approach is not proof of a shared line.
- Preserve the Fire on the Mountain and Diamond in the Rough grade disagreements
  in the handoff. Neither conflict has been resolved by choosing the lower grade.
- Superalpine needs its completed summit itinerary. The 2020 report describes a retreat;
  [the 2022 report](https://cascadeclimbers.com/forum/topic/104401-tr-north-cascades-sloan-peak-superalpine-wi3-4-1000-04172022/) and later AAJ coverage
  establish the summit completion.
- Hold Merrill–Minton as a summit-route candidate until the continuation is verified:
  [the first-ascent account](https://publications.americanalpineclub.org/articles/13201216588) stopped about
  70 m below the summit. Do not bridge that gap with an invented line.
- Borrowed Time has a direct upper finish. Its first-ascent sources also describe the
  descent differently; do not map a descent line until those accounts are reconciled.

Three additional historical leads are recorded separately in `research.json`: the 1967
East Face direct aid route, the 1948 Southwest Face ascent, and a 2008 SE Ridge/Corner
variation. Their current route identity or suitability needs further work.

## Finish the catalog addition

Start with Corkscrew via Cougar Creek and Bedal Creek, then Southeast Shelf and Southeast
Face. West Face and the other named rock and winter routes can follow as their exact
lines and source rights are established. This ordering is a proposed work order, not
an assertion that any candidate has passed review.

1. From an environment with existing authorized Peaks credentials, run the read-only
   preflight from the repository root:

   ```bash
   cloud-sql/scripts/peaks-psql -f docs/data-audits/sloan-peak-routes-2026-11-05/preflight.sql
   ```

   Save its output privately. Confirm the linked destination is Sloan Peak before
   proceeding, distinguish active/pending/user-owned rows, and bind actual trailhead IDs.
   Recheck before any write. Use `owner = 'peaks' AND status = 'active'` for the
   standard-route predicate. A distinct existing route is not automatically a replacement.
2. Apply the [standard-route-backfill workflow](../../../.claude/skills/peaks-standard-route-backfill/SKILL.md).
   Check the US entries in
   [the official geometry registry](../../../cloud-sql/migrate/data/official-trail-sources.json).
   The registered publishable USFS service is the first geometry lead. Official, USGS
   adapter and OSM discovery were **not run** in this session; there are no negative
   results establishing absent coverage.
3. Acquire an authorized full itinerary, including every off-trail, glacier and rock
   section. Never connect missing sections by straight lines or trace a copyrighted topo.
   The AllTrails search was unavailable; the matched Peakbagger page supports identity,
   not GPX redistribution rights. No third-party tracks or map images are included here.
4. Check current land-manager access, seasonal constraints and exact source rights.
   Historical descriptions do not verify current road access, river crossings,
   snow bridges, glacier passage, anchors or permits.
5. Build, render and inspect each candidate, check terrain-derived metrics and shared
   segment reuse, then dry-run the supported importer. Resolve any technical-route
   limitations in that importer rather than bypassing its checks.
6. Import only as pending, perform the required independent source and segment review,
   and activate only candidates that pass. Verify the final route records and their links
   through Cloud SQL and the public destination/API. Record actual route IDs and receipts.

The user asked to add these routes; the remaining dependency is environment access and
publishable, reviewed geometry, not another general permission request.

## Validation performed

- Direct source pages checked on 2026-11-05; grades and itinerary conflicts
  retained rather than normalized away.
- Research JSON parsed; unique keys, source references, route count, null geometry/metrics
  and explicit unpublished state checked locally.
- Preflight columns checked against the repository schema. The SQL has not run against
  a database; it forces a read-only transaction and contains no catalog writes.
- Documentation links and the scoped diff checked. No application code changed.
