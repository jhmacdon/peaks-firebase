# Half Dome cover

Half Dome (`OummFegY7fGoN2X7RdCz`) had no `hero_image`. Its only pending
photo showed the Pika Fire. Josiah requested a cover on September 5, 2026.

Selected David Iliff's view from Glacier Point, under CC BY-SA 3.0:
[source and license](https://commons.wikimedia.org/wiki/File:Half_Dome_from_Glacier_Point,_Yosemite_NP_-_Diliff.jpg).
The source names Half Dome. Visual review confirmed the subject and summit framing.
The manifest is `cloud-sql/migrate/data/half-dome-photo-candidate.json`.

Applied to Cloud SQL on September 6 UTC. The existing `storeDestinationPhoto`
function stored a 2400 × 1509 JPEG (632,048 bytes) in Peaks Firebase Storage.
One transaction assigned the cover only while `hero_image` was null and added
approved candidate `hPhREqBrfYxoz5BQzEkZ`. The review records `codex` as reviewer
and Josiah's request in the review note. The prior pending photo remains intact.

The cover carries David Iliff's credit, the full CC BY-SA 3.0 license URL,
a resize/crop notice, and a link to the source. Focal point: 55% horizontal,
40% vertical. Storage metadata retains source, photographer, license, and framing.

Checks: manifest parser accepted the record; live destination name and empty
cover matched before the write; the transaction updated exactly one destination.
The stored 2400 × 1509 image loaded publicly and passed visual review.
The public page initially continued to serve its older Next.js cached response
(`x-nextjs-cache: HIT`, `s-maxage=3600`). Allow that hourly cache to refresh.

No runtime code or infrastructure changed. Added storage is about 0.63 MB;
the storage cost change is below $0.01/month, excluding traffic.
