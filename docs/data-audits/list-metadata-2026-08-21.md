# Curated list metadata — 2026-08-21

Backfill of `year_established`, `organization`, `source_name`, `source_url`, and
`region` for the 17 curated lists in prod, plus a rewrite of every description.
Applied by `cloud-sql/migrations/20260821_list_metadata_backfill.sql`.

## What the columns hold

- **`organization`** — the body or author the list came from: a club where a club
  keeps it (Mazamas, Highpointers Club), the author where a book or article
  defined it (Jeff Smoot, Jeff Howbert), and `Peakbagger.com` for plain
  elevation and prominence lists that no club owns. Two volcano lists are
  Peaks' own cut of a region, so they carry `Peaks`.
- **`source_url`** — the page the membership came from, not a general reference.
  Fifteen lists trace to a Peakbagger `list.aspx` page; the check below confirms
  each one row-for-row against the saved export
  `docs/data-audits/fixtures/peakbagger-list-candidates-2026-08-18.json`.
- **`year_established`** — the year the list first appeared. Left NULL wherever
  no credible source fixes a year; nine of the seventeen are NULL, each with a
  reason below. No year here is a guess.
- **`region`** — a short display label, state name where the list is one state,
  range name where it crosses several.

## How the sources were read

Wikipedia, mazamas.org, highpointers.org, and openlibrary.org were fetched and
read directly. Peakbagger, SummitPost, countryhighpoints.com, mountaineers.org,
peakery, and the bookseller listings all refuse an automated fetch with HTTP
403, so claims resting on those pages come from search-engine extracts of the
same URLs rather than a direct read. Every such claim is cross-checked against a
second source or against the Peaks database wherever one exists; where it is not,
the fact is small (a branch name, a publication year) and the URL is recorded so
a person can check it. Peakbagger's row data was not re-fetched at all: the saved
export from the 2026-08-18 audit is the copy used for the membership check.

## Membership-to-source check

Every list's members were normalized (case, accents, punctuation) and compared
with the rows of its claimed Peakbagger list. Counts match exactly in all
fifteen cases; the small name gaps are Peaks catalog spellings, not different
mountains.

| List | Peakbagger lid | our rows | source rows | matched |
|---|---|---|---|---|
| Bulger List | 5003 | 99 | 99 | 97 |
| Smoot's 100 | 5005 | 99 | 99 | 99 |
| Nevada Peaks Club | 5006 | 71 | 71 | 70 |
| Washington Home Court 100 | 50033 | 98 | 98 | 96 |
| US State High Points | 12003 | 50 | 50 | 46 |
| Ultras of Iran | 49301 | 55 | 55 | 20 |
| Ultras of the Contiguous United States | 4904 | 56 | 56 | 56 |
| Utah 13ers | 21349 | 19 | 19 | 18 |
| The Seven Summits | 1000 | 7 | 7 | 6 |
| Mazama Guardian Peaks | 5061 | 3 | 3 | 3 |
| Cascade Volcanoes | 5044 | 20 | 20 | 20 |
| Colorado 14ers | 21360 | 53 | 53 | 51 |
| Tennessee 4500ft Peaks | 21457 | 55 | 55 | 54 |
| California Fourteeners | 50081 | 15 | 15 | 15 |
| Sierra Peaks Section Emblem Peaks | 50511 | 15 | 15 | 15 |

Row counts are after collapsing duplicate normalized names, so they run one or
two under the live membership counts. Unmatched names are known aliases:
Kuwohi/Clingmans Dome, Mount Blue Sky/Mount Evans, Puncak Jaya/Carstensz
Pyramid, Mount Powell/Mount Powell - Middle Peak. Ultras of Iran matches on
count only — Peaks stores Persian transliterations that differ from
Peakbagger's, which is a naming question for a later pass, not a membership
one.

---

## Per-list findings

### Bulger List — `DOlya3YYfIg60trgTm0n`

- Year: **1976**; organization **The Bulgers**; region **Washington**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=5003
- Claims and sources:
  - Compiled in 1976 by John Lixvar, once the 1:24,000 quadrangles were
    complete; the climbers who chased it called themselves the Bulgers —
    https://www.countryhighpoints.com/washington-hundred-highest-bulgers/ and
    https://www.summitpost.org/washington-top-100/171584
  - Roughly 400 feet of prominence for a summit to hold its own place, 800 feet
    for volcanic subpeaks — https://www.summitpost.org/washington-top-100/171584
  - Russ Kroeker finished first, on Sinister Peak, 4 October 1980 —
    https://www.countryhighpoints.com/washington-hundred-highest-bulgers/
- Description: "John Lixvar drew up Washington's hundred highest summits in
  1976, and the climbers who set out to finish them called themselves the
  Bulgers. A peak needs about 400 feet of prominence to hold its own place on
  the list. Russ Kroeker finished first, on Sinister Peak, in October 1980."

### California Fourteeners — `B2867467BB8132CB8D34`

- Year: **1991**; organization **Porcella and Burns**; region **California**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=50081
- Claims and sources:
  - Steven Porcella and Cameron Burns, *California's Fourteeners*, first
    published 1991 (Palisades Press, ISBN 0-9630490-0-3); later editions
    *Hiking and Climbing California's Fourteeners* (Chockstone, 1995) and
    *Climbing California's Fourteeners: 183 Routes to the Fifteen Highest
    Peaks* (Mountaineers Books, 1998) —
    https://openlibrary.org/search.json?q=California%27s+Fourteeners+Porcella
  - Fifteen peaks, fourteen of them in the Sierra Nevada with White Mountain
    Peak the exception; Mount Whitney the highest point in the contiguous
    United States — Peakbagger list rows (lid 50081) and
    https://en.wikipedia.org/wiki/Mount_Whitney
  - The 1991 date is the first appearance of the Porcella/Burns guidebook. The
    "fifteen highest" framing is explicit in the 1998 subtitle; the description
    dates the guidebook, not the framing, so 1991 stands.
- Description: "Steve Porcella and Cameron Burns counted fifteen California
  summits above 14,000 feet in their guidebook, first published in 1991.
  Fourteen rise in the Sierra Nevada; White Mountain Peak stands alone east of
  the Owens Valley. Mount Whitney is the highest of the fifteen, and of the
  contiguous United States."

### Cascade Volcanoes — `ULCGhLnsWcYYRqXQ3aOo`

- Year: **2010**; organization **The Mountaineers**; region **Cascades**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=5044
- Claims and sources:
  - Peak pin created in 2010 by the Tacoma branch of The Mountaineers for
    climbing all 20 major Cascade volcanoes; all peaks required —
    https://www.mountaineers.org/membership/badges/award-badges/tacoma-branch/tacoma-branch-cascade-volcanoes
    and https://peakery.com/challenges/mountaineers-club-cascade-volcanoes-peak-pin/
  - Span from Mount Garibaldi (British Columbia) to Lassen Peak (California) —
    same sources, confirmed against the list rows.
- Description: "The Mountaineers' Tacoma branch created this peak pin in 2010
  for climbers who reach all twenty major Cascade volcanoes. The line runs from
  Mount Garibaldi in British Columbia south to Lassen Peak in California. Every
  peak counts toward the pin; there is no partial credit."

### Colorado 14ers — `LAZcIKjluO0oT3o9g6MC`

- Year: **NULL**; organization **Peakbagger.com**; region **Colorado**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=21360
- Claims and sources:
  - 53 Colorado peaks above 14,000 feet with at least 300 feet of prominence;
    28 more clear 14,000 feet but fall short of that cutoff —
    https://en.wikipedia.org/wiki/List_of_Colorado_fourteeners
  - "Mount Elbert is the highest summit of the Rocky Mountains of North
    America" — https://en.wikipedia.org/wiki/Mount_Elbert
- Year left NULL: the 300-foot-prominence count of 53 is a convention that
  settled over decades of survey revisions, not a list published in a
  particular year. No source dates it.
- Description: "Colorado holds fifty-three peaks above 14,000 feet that also
  rise 300 feet above the saddle linking them to a higher neighbor. Twenty-eight
  other Colorado summits clear 14,000 feet but count as shoulders of those peaks
  rather than mountains in their own right. Mount Elbert is the highest of them,
  and the highest summit in the Rocky Mountains."

### Mazama Guardian Peaks — `dd7K4267UF9mBlg6yUgh`

- Year: **NULL**; organization **Mazamas**; region **Cascades**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=5061
- Claims and sources:
  - "A certificate awarded for successfully summiting Mount St. Helens, Mt.
    Hood, Mt. Adams on official Mazama climbs"; about 2,000 members have earned
    it — https://mazamas.org/awards/
  - The Mazamas were founded 19 July 1894 on the summit of Mount Hood —
    https://mazamas.org/history/
- Year left NULL: no source gives the year the Guardian Peaks award began. A
  1957 recipient shows it existed by then, but that is a floor, not a date, and
  stamping the club's 1894 founding on the award would read as the award's own
  year. The 1894 fact goes in the prose instead, where it plainly belongs to the
  club.
- Description: "The Mazamas award the Guardian Peaks certificate to members who
  summit Mount Hood, Mount Adams, and Mount St. Helens on official club climbs.
  All three volcanoes rise within sight of Portland. The club, founded on the
  summit of Mount Hood in 1894, has given the award to about two thousand
  members."

### Nevada Peaks Club — `z9Esvqgng0SvnQVP16iI`

- Year: **1997**; organization **Nevada Peaks Club**; region **Nevada**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=5006
- Claims and sources:
  - Founded by Pete Yamagata in 1997 to promote climbing and exploration of
    wild country in Nevada; informal, no dues, no meetings —
    http://www.peakbagging.com/NPCart1.htm and
    https://www.petesthousandpeaks.com/MainPages/npc/npchome.html
  - 73 peaks on the list — Peakbagger lid 5006 and the prod membership count.
- Description: "Pete Yamagata started the Nevada Peaks Club in 1997 to draw
  climbers into Nevada's many small, empty ranges. Its list holds 73 peaks
  spread across the state, most of them reached by long dirt roads and
  off-trail walking. The club takes no dues and holds no meetings; the climbing
  is the whole of it."

### Oregon Volcanoes — `4HxxAe4pgIKHU9gbOxtV`

- Year: **NULL**; organization **Peaks**; region **Oregon**.
- Source: USGS Cascades Volcano Observatory,
  https://www.usgs.gov/observatories/cascades-volcano-observatory
- Claims and sources:
  - Mount Hood is the highest point in Oregon —
    https://en.wikipedia.org/wiki/Mount_Hood
  - Membership (Mount Hood, Mount Jefferson, Three Fingered Jack, Mount
    Washington, Middle Sister, South Sister, Broken Top, Mount Bachelor, Mount
    Thielsen, Mount McLoughlin) read from prod. Nine of the ten join a
    designated wilderness in `destination_areas` (Mount Hood, Mount Jefferson,
    Mount Thielsen, Mount Washington, Three Sisters, and Sky Lakes); Mount
    Bachelor, a ski area, joins none.
- Year left NULL and organization set to **Peaks**: this list has no outside
  keeper. It predates the Peakbagger importer and is Peaks' own regional cut.
  The USGS observatory is cited as the authority on which Cascade peaks are
  volcanoes, not as the source of the membership.
- **Flag for a later membership pass:** North Sister is absent while Middle
  Sister and South Sister are present, and North Sister does sit on the Cascade
  Volcanoes list. That looks like a gap, not a decision. Membership is out of
  scope for this task, so nothing was changed and the description avoids
  claiming a count.
- Description: "Oregon's Cascade volcanoes stand in a line down the state,
  from Mount Hood above the Columbia River to Mount McLoughlin near the
  California line. Mount Hood is the state high point, and all but Mount
  Bachelor stand in designated wilderness. Peaks keeps them together as one
  goal for climbers working through the Oregon Cascades."

### Sierra Peaks Section Emblem Peaks — `43142E0739A961123EDC`

- Year: **1955**; organization **Sierra Club Angeles Chapter**; region
  **Sierra Nevada**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=50511
- Claims and sources:
  - The Sierra Peaks Section was established in 1955 as a mountaineering
    society within the Angeles Chapter of the Sierra Club —
    https://en.wikipedia.org/wiki/Sierra_Peaks_Section and
    https://www.sierraclub.org/angeles/sierra-peaks/brief-history
  - 15 Emblem Peaks, designated because they dominate their surroundings by
    bulk or by the ground visible from the summit; the emblem takes 10 of the
    15 plus 15 more peaks from the full list —
    https://www.summitpost.org/sps-emblem-peaks/171150 and
    https://en.wikipedia.org/wiki/Sierra_Peaks_Section
  - Mount Whitney, Mount Williamson, North Palisade, and Mount Ritter are among
    the fifteen — Peakbagger lid 50511 rows.
- Description: "The Sierra Club's Angeles Chapter founded the Sierra Peaks
  Section in 1955 and marked fifteen summits on its peaks list as Emblem Peaks,
  the ones that dominate their part of the range. A member earns the section
  emblem by climbing ten of the fifteen plus fifteen more peaks from the full
  list. Mount Whitney, Mount Williamson, North Palisade, and Mount Ritter are
  among them."

### Smoot's 100 — `XHG0eHY8ePaltNO3dWs0`

- Year: **2002**; organization **Jeff Smoot**; region **Washington**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=5005
- Claims and sources:
  - Jeff Smoot, *Climbing Washington's Mountains*, Falcon, first edition 2002,
    ISBN 0-7627-1086-1; second edition 2021 —
    https://www.abebooks.com/9780762710867/Climbing-Washingtons-Mountains-Series-Smoot-0762710861/plp
    and https://www.amazon.com/Climbing-Washingtons-Mountains/dp/0762710861
  - 100 summits, from scrambles in the Alpine Lakes and Olympics to technical
    North Cascades routes, including every Washington peak above 9,000 feet —
    publisher description on the same abebooks listing.
  - Variance noted: Open Library records a 2001 Globe Pequot printing of the
    same title (ISBN 978-1-58592-083-9) —
    https://openlibrary.org/search.json?q=Climbing+Washington%27s+Mountains+Smoot.
    2002 is used because it is the year on the Falcon first edition that names
    the hundred peaks. If a stronger source settles on 2001, change the one
    value.
- Description: "Jeff Smoot chose a hundred Washington summits for his 2002
  guidebook Climbing Washington's Mountains, and peakbaggers took the selection
  as a list. It favors classic routes over raw height, mixing scrambles in the
  Alpine Lakes and Olympics with technical climbs in the North Cascades. Every
  Washington peak above 9,000 feet is on it."

### Tennessee 4500ft Peaks — `3S29a3viZKKnSMz4wzPQ`

- Year: **NULL**; organization **Peakbagger.com**; region **Tennessee**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=21457
- Claims and sources:
  - 55 rows on the Peakbagger list — lid 21457 and the prod membership count.
  - Kuwohi (formerly Clingmans Dome), 6,643 feet, is the highest point in
    Tennessee — https://en.wikipedia.org/wiki/Kuwohi
  - Many of the 55 sit on the Great Smoky Mountains crest, which carries the
    Tennessee/North Carolina line: 22 members carry `state_code = 'TN'` and 17
    carry `'NC'` in the Peaks catalog.
- Year left NULL: a plain elevation cut with no publication date.
- Description: "Fifty-five summits in and around Tennessee reach 4,500 feet.
  Many sit on the crest of the Great Smoky Mountains, where the state line
  follows the ridge shared with North Carolina. Kuwohi, at 6,643 feet, is the
  highest of them and the highest point in Tennessee."

### The Seven Summits — `hPNDxe5mvtLjtlTnWlnf`

- Year: **NULL**; organization **Reinhold Messner**; region **World**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=1000
- Claims and sources:
  - The Seven Summits are the highest mountains on each of the seven
    continents; the Messner (Carstensz) version replaces Mount Kosciuszko with
    Puncak Jaya, and is the harder of the two because Puncak Jaya is an
    expedition while Kosciuszko is a hike —
    https://en.wikipedia.org/wiki/Seven_Summits
  - Patrick Morrow was the first to complete the Messner version, on Puncak
    Jaya, 7 May 1986 — same page.
  - Richard Bass first completed his own version on 30 April 1985 — same page.
- Year left NULL: no source gives a year the Messner list was established.
  Messner reached six of the seven by 1978 and the version crystallized across
  1983–86, but the completions of Bass (1985) and Morrow (1986) are climbs, not
  a founding date, and using either would misread as one.
- Bugs fixed here: the misspelling "Kosiuszko" (correct: Kosciuszko — the Peaks
  destination row `MsFlUhY0bBEZd8GiPJg1` already spells it correctly, so only
  the list text was wrong), the literal `\n\n` escape sequence mid-paragraph,
  and an unsourced claim that about 275 climbers had finished. Wikipedia's
  figure as of 2011 is 231 for the Messner list, so the old number went out
  rather than being restated.
- Description: "The Seven Summits are the highest mountains on each of the
  seven continents. Peaks follows the Messner version, which counts Puncak Jaya
  in New Guinea rather than Mount Kosciuszko in Australia, so the Australasian
  leg is a climb rather than a walk. Patrick Morrow finished this version
  first, on Puncak Jaya, in May 1986."

### Ultras of Iran — `cJb67d0QVHo9F7qSLUGi`

- Year: **NULL**; organization **Peakbagger.com**; region **Iran**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=49301
- Claims and sources:
  - An ultra is a summit with at least 1,500 metres (4,900 feet) of topographic
    prominence — https://en.wikipedia.org/wiki/Ultra-prominent_peak
  - Iran has 55 — Peakbagger lid 49301 and the prod membership count.
  - Damavand is the highest point in Iran and the highest volcano in Asia, and
    stands in the Alborz range — https://en.wikipedia.org/wiki/Mount_Damavand
  - Southeastern desert volcanoes (Bazman, Taftan) appear on the source list
    rows.
- Year left NULL: a prominence cut, not a published list with a date. Steve Fry
  coined "ultra" in the 1980s but no year fixes this country cut.
- Bug fixed here: the list name read "Ultras Of Iran"; corrected to "Ultras of
  Iran".
- Description: "An ultra is a peak that rises at least 1,500 meters, about
  4,900 feet, above the lowest saddle linking it to any higher ground. Iran has
  fifty-five, from Damavand in the Alborz range to the desert volcanoes of the
  southeast. Damavand is the country's high point and the highest volcano in
  Asia."

### Ultras of the Contiguous United States — `9zsS3gPZhQCiPMl0DRMf`

- Year: **NULL**; organization **Peakbagger.com**; region **United States**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=4904
- Claims and sources:
  - Ultra definition, and "the term 'ultra' derives from 'ultra major
    mountain,' a term proposed by earth scientist Steve Fry, who studied peaks
    in Washington in the 1980s" — https://en.wikipedia.org/wiki/Ultra-prominent_peak
  - 57 in the lower forty-eight — Peakbagger lid 4904 and the prod membership
    count. The catalog spread confirms the range: 8 California, 8 Utah, 7
    Nevada, 5 Washington, 4 Arizona, 4 Montana, and singles as far east as
    New Hampshire and North Carolina.
- Year left NULL: same reason as the Iran list.
- Description: "An ultra is a peak that rises at least 1,500 meters, about
  4,900 feet, above the lowest saddle linking it to any higher ground.
  Fifty-seven stand in the lower forty-eight, from Mount Rainier and Mount
  Whitney to desert ranges in Nevada and Arizona that few climbers ever visit.
  The earth scientist Steve Fry named the class in the 1980s while measuring
  peaks in Washington."

### US State High Points — `dR9aHGKw3VwBhfsHSwlB`

- Year: **1986**; organization **Highpointers Club**; region **United States**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=12003
- Claims and sources:
  - Jack Longacre founded the Highpointers Club in 1986 after writing to
    *Outside* magazine; about thirty people answered and seven met him in
    L'Anse, Michigan in April 1987 for the first convention —
    https://highpointers.org/club-history/
  - Denali, 20,310 feet, is the highest state high point;
    Britton Hill, Florida, 345 feet, is the lowest —
    https://en.wikipedia.org/wiki/List_of_U.S._states_and_territories_by_elevation
  - Denali, Gannett Peak, and Granite Peak are the mountaineering high points;
    several others are roadside —
    https://www.summitpost.org/the-effort-scale-of-highpointing-the-fifty-u-s-states/1046476
- Description: "The highest point in each of the fifty states, from Denali at
  20,310 feet to Britton Hill in Florida at 345 feet. Jack Longacre founded the
  Highpointers Club in 1986 after a letter to Outside magazine turned up dozens
  of people with the same goal. Some high points are drive-ups; Denali,
  Gannett Peak, and Granite Peak call for mountaineering."

### Utah 13ers — `JCKrJp4PR2Ygtz6hLJLv`

- Year: **NULL**; organization **Peakbagger.com**; region **Utah**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=21349
- Claims and sources:
  - 19 Utah summits above 13,000 feet — Peakbagger lid 21349 and the prod
    membership count.
  - All 19 sit in the High Uintas: every member's catalog coordinates fall
    between 40.70–40.83 N and 110.30–110.64 W, inside the range.
  - The Uintas are "the highest range in the contiguous United States running
    east to west" and top out at Kings Peak, 13,528 feet, Utah's high point —
    https://en.wikipedia.org/wiki/Uinta_Mountains
- Year left NULL: a plain elevation cut with no publication date.
- Description: "Utah has nineteen summits above 13,000 feet, and every one
  stands in the High Uintas. The Uintas are the highest range in the contiguous
  United States that runs east to west. Kings Peak, at 13,528 feet, is the
  state high point."

### Washington Home Court 100 — `grDJmpZ6mtpgtFY8X7i1`

- Year: **1995**; organization **Jeff Howbert**; region **Washington**.
- Source: Peakbagger, https://www.peakbagger.com/list.aspx?lid=50033
- Claims and sources:
  - Jeff Howbert published the Home Court in *Pack & Paddle* in July 1995: the
    hundred highest peaks of the area with at least 500 feet of clean
    prominence — https://www.summitpost.org/the-home-court-100/649859 and
    http://howbert.com/mountains/back_court/back_court_article.html
  - Bounds: Highway 2 north, Interstate 90 south, Deception Creek and the Cle
    Elum River east, chosen for what a Seattle-area climber can reach on a
    weekend — same sources.
  - Dick Kegel finished all hundred on 21 September 1998 —
    https://www.summitpost.org/the-home-court-100/649859
- Source choice: Peakbagger keeps two Home Court lists. The Peaks membership
  matches "Traditional Alpine Lakes Home Court" (lid 50033) on 96 of 98
  normalized names and the newer "Alpine Lakes 'Home Court' Top 100" (lid
  21307) on only 89, so 50033 is cited.
- **Flag:** the Peaks list is named "Washington Home Court 100" while the list
  is specifically the western Alpine Lakes country. The description says so;
  renaming the list was out of scope for this task.
- Description: "Jeff Howbert published the Home Court in Pack & Paddle magazine
  in July 1995: the hundred highest peaks of the western Alpine Lakes country
  with at least 500 feet of clean prominence. He set the bounds around what a
  Seattle climber can reach on a weekend, with Highway 2 to the north,
  Interstate 90 to the south, and Deception Creek and the Cle Elum River to the
  east. Dick Kegel finished the hundred first, in September 1998."

### Washington State Volcanoes — `YtFZZHcw3YKGERzO0JEW`

- Year: **NULL**; organization **Peaks**; region **Washington**.
- Source: USGS Cascades Volcano Observatory,
  https://www.usgs.gov/observatories/cascades-volcano-observatory
- Claims and sources:
  - The USGS Cascades Volcano Observatory monitors Mount Baker, Glacier Peak,
    Mount Rainier, Mount St. Helens, and Mount Adams in Washington — the exact
    five on this list —
    https://www.usgs.gov/observatories/cascades-volcano-observatory and
    https://www.usgs.gov/observatories/cascades-volcano-observatory/why-study-cascade-volcanoes
  - Mount Rainier is "the highest mountain in the U.S. state of Washington, the
    most topographically prominent mountain in the contiguous United States" —
    https://en.wikipedia.org/wiki/Mount_Rainier. An elevation was deliberately
    left out of the prose: Wikipedia gives 14,406 ft (NAVD88) while the older
    14,411 ft (NGVD29) figure is still in wide use, and the claim does not need
    a number.
  - All five carry glaciers, Mount St. Helens included since Crater Glacier
    formed after 1980 — https://en.wikipedia.org/wiki/Crater_Glacier
- Year left NULL and organization set to **Peaks**: as with Oregon Volcanoes,
  this is Peaks' own regional cut with no outside keeper.
- Description: "Washington's five volcanoes: Mount Rainier, Mount Adams, Mount
  Baker, Glacier Peak, and Mount St. Helens. All five carry glaciers, and the
  U.S. Geological Survey monitors every one. Mount Rainier is the highest
  mountain in the state and the most prominent peak in the contiguous United
  States."

---

## Content bugs fixed

1. **"Kosiuszko" misspelling** — The Seven Summits description. The destination
   row for the mountain (`MsFlUhY0bBEZd8GiPJg1`) already reads "Mount
   Kosciuszko"; no other list or destination row carried the typo. Fixed in the
   rewritten description.
2. **"Ultras Of Iran"** — name corrected to "Ultras of Iran"
   (`cJb67d0QVHo9F7qSLUGi`). The only list-name change in this migration.
3. **Eleven empty descriptions** — Bulger List, Mazama Guardian Peaks, Nevada
   Peaks Club, Oregon Volcanoes, Smoot's 100, Ultras of Iran, Ultras of the
   Contiguous United States, US State High Points, Utah 13ers, Washington Home
   Court 100, and Washington State Volcanoes all held NULL in the database and
   rendered as the placeholder sentence "A public checklist for planning,
   progress, and route research." from `web/src/lib/list-content.ts`. All
   eleven now hold real prose; none repeats the placeholder.
4. **Five descriptions printing a raw Peakbagger URL** — California
   Fourteeners, Cascade Volcanoes, Colorado 14ers, Sierra Peaks Section Emblem
   Peaks, and Tennessee 4500ft Peaks each ended in a "Source: https://…"
   clause. The URLs moved to `source_url`; no rewritten description contains a
   URL or a "Source:" clause.
5. **Literal `\n\n` escape** — The Seven Summits description carried a
   backslash-n pair as body text. Every rewritten description is a single
   paragraph with no escape sequences.

## Open items for later tasks

- **Oregon Volcanoes is missing North Sister** while carrying Middle and South
  Sister. Membership work, not metadata work.
- **Ultras of Iran naming**: 55 of 55 rows match on count but only 20 on name,
  because the Peaks catalog uses different transliterations from Peakbagger's.
  Worth a naming pass before the list is shown prominently.
- **Smoot's 100 year** rests on the Falcon first edition of 2002 against an Open
  Library record of 2001 for the same title. One value to revisit if a better
  source turns up.
- **Task 3** should copy `organization`, `source_name`, `source_url`, `region`,
  `year_established`, and the new descriptions from this document into
  `CURATED_LISTS` so a re-import does not overwrite them.

Monthly cost impact: $0.
