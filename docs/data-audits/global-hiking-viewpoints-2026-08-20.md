# Dolomites and Nepal viewpoint review — 2026-08-20

## Scope

This pass covers one fixed box in the Italian Dolomites and three mapped
trekking areas in Nepal. It uses named OSM `tourism=viewpoint` nodes, ways, and
relations.

- Dolomites: country `IT`, box `46.074,10.772,46.703,12.634`
- Sagarmatha National Park: country `NP`, OSM relation
  [3531450](https://www.openstreetmap.org/relation/3531450)
- Annapurna Conservation Area: country `NP`, OSM relation
  [4497739](https://www.openstreetmap.org/relation/4497739)
- Langtang National Park: country `NP`, OSM relation
  [1268964](https://www.openstreetmap.org/relation/1268964)

The guarded source queries now intersect every park relation or subdivision
with its chosen country. A second live query checks that every included source
or supplement OSM identity still falls inside the same scope. An international
apply stops if that check was skipped or changed after the dry-run.

## Reviewed result

| Scope | Source rows | Included | Excluded | Held | Inserts | Enrichments |
|---|---:|---:|---:|---:|---:|---:|
| Dolomites | 242 | 230 | 11 | 1 | 221 | 9 |
| Sagarmatha | 18 | 17 | 0 | 1 | 16 | 1 |
| Annapurna | 25 | 20 | 4 | 1 | 20 | 0 |
| Langtang | 4 | 3 | 0 | 1 | 3 | 0 |
| **Total** | **289** | **270** | **15** | **4** | **260** | **10** |

All four live dry-runs passed their scope checks. They found no unclear catalog
matches, elevation gaps, or new session links.

Independent review changed three generic Nepal labels from excluded to held:
`Lake view`, `Best valley view`, and `Viewtower`. It also found two passes whose
OSM `name` was not English. The importer now prefers `name:en`, so they plan as
`Nangpa La` and `Renjo La`; the reviewed source snapshot keeps the original
OSM tags.

The Dolomites review added Ponte, Pagoda, and Punto video. It holds one newer
`Drei Zinnen Blick` marker because it may repeat an older marker.

## Applied result — 2026-08-20

All four guarded transactions matched their pinned plans and passed the live
scope check:

| Scope | Inserted | Enriched | Session links |
|---|---:|---:|---:|
| Dolomites | 221 | 9 | 0 |
| Sagarmatha | 16 | 1 | 0 |
| Annapurna | 20 | 0 | 0 |
| Langtang | 3 | 0 | 0 |
| **Total** | **260** | **10** | **0** |

A fresh post-import dry-run resolved all 270 included candidates as unchanged.
It found no pending inserts, enrichments, unclear matches, elevation gaps, or
session links.

- Applied result receipt SHA-256: `e3576cd7a8bcd61e5bcd00cdf57d1996c8348667eebc5efea0c27955b9e59c05`
- Dolomites post-import report SHA-256: `8c4edfb8a236a6a738ddb11975cccdacf5c74f7fdab682677b73dc8e959b9d01`
- Sagarmatha post-import report SHA-256: `2bad02007d16425484911a59e8b0478c4562433bc0855f4ccbe215550ba3349b`
- Annapurna post-import report SHA-256: `eb530d21ba60c21a9497cd75caf07acac839e705dd0a87dbbc109a43e7daaf7b`
- Langtang post-import report SHA-256: `8c09ee5d41e67cf66acb1d43cb4a2caf2eff253e37f5dab6895f6169e709d52c`

The iOS app is unchanged and will still treat the route end or turnaround as
the top.

## Review record

| Scope | OSM time | Query SHA-256 | Source SHA-256 | Review fingerprint | Scope identity SHA-256 | Report SHA-256 |
|---|---|---|---|---|---|---|
| Dolomites | `2026-08-20T04:03:53Z` | `e1ff7063bfbd7b980a12ce6e564c350f1b35de52ace7bc5f5ccb7b775ef2f3c4` | `056d38149deb366b611a3dc460caafaf7d09d41968c604ea82639cbcb1a3c9bf` | `48e1a35a072eae62ba2a56b9e20485557e0807b3d404d2d931abb513d132176f` | `7314cfab5eeaad042bea25c4c8ad6d2796f843a458397989781057c94cc09293` | `2cd8d61b811d1b7f6e69da853372d2b6c12c33b76114ae36e3617e10605ad944` |
| Sagarmatha | `2026-08-20T03:57:56Z` | `29edaa3a21fe40d3a4682b1405ffa479a6e3e5960a7821b661d8d6e0d2f28abf` | `f7e060095dbd45f418367beee03a9864fe156586cc6ceb414737da568b29b132` | `35018195b683b5f85e2e97a6a6b0177042943c2a874f42ac6622bceb1495e2b3` | `cd786d8e1d46ca6a7986e4a684fe4da7057b62214e98a6513860f82ea3bef91e` | `4c8d1fea5dc9af6467f6135f50f6b27da3d7a4f96f940a7794a23d2447650cc0` |
| Annapurna | `2026-08-20T03:58:58Z` | `f510f3b059d9488c3363871902c6db80a5cbba74937be15ecd9b30c163bd0d9a` | `a07ff0e0c45990ffcb29288cba62f32bec89f9a6d67ce792d5a52b7cc2e81c69` | `a36906a2a4119e2687283b31723a84aac7b1f02fdc62d655fbf24bb5be01c0c1` | `450a36a133d112639d2984673ebe0c296bafa2a0c607e50c312da851b0ba4d2d` | `9be255ece26eeb79db18c05ad03add4e11b907045fd0e78f03c3b63369b608a7` |
| Langtang | `2026-08-20T04:00:58Z` | `637f24ab600b9b451e05237a96e6c0765460bf23ec884ea7c4fab644320a4252` | `055c904eb0e88a9e55a681c15eb5aef6520083f47ba9df4b97beaef8ff8b180a` | `f40eb3591eb6af70bfb3c75243464236b27e86938aebf5691031168807ff0aec` | `034759e535a076f694e3a4bc0eade2c38219cbf9c72c9d6433dcc931c2b7a03e` | `e16d1f1754a404099b4e43a74ab0c9d77f814ae09707cf93922a67407a6c45e0` |

## Next areas

The next narrow passes should cover Tyrol, the Swiss and French Alps, the Japan
Alps, the Georgian Caucasus, New Zealand's Southern Alps, Peru's Cordillera
Blanca, and protected trekking areas in Bhutan. Himachal Pradesh has a clean
79-row source snapshot but still needs full review. Pakistan and Tibet should
wait for stable park or trekking-area bounds and a clear source review.

This work adds no service, schedule, or always-on process. Monthly
infrastructure cost stays at `$0`.
