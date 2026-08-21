-- 20260821_list_metadata_backfill.sql
--
-- Fills the metadata columns added by 20260821_list_metadata.sql for all 17
-- curated lists, and replaces every description with researched prose.
--
-- Research, per-claim sources, and the reasons behind each NULL year live in
-- docs/data-audits/list-metadata-2026-08-21.md.
--
-- Conventions:
--   organization      the club, author, or registry the list came from; the two
--                     Peaks-curated volcano lists carry 'Peaks'.
--   source_url        the page the membership came from (Peakbagger for 15 of
--                     the 17), verified row-for-row against the saved export.
--   year_established  the year the list first appeared; NULL where no credible
--                     source fixes one. Never guessed.
--   description       pure prose. No trailing "Source: <url>" clause (that
--                     legacy shape is parsed out by web/src/lib/list-content.ts
--                     and is being retired), no literal \n escapes, no URLs,
--                     and never the "A public checklist..." placeholder.
--
-- Also fixes two content bugs: the "Kosiuszko" misspelling in the Seven Summits
-- description, and the list name "Ultras Of Iran".
--
-- Every statement is a plain UPDATE keyed on a stable id, so re-running the
-- file is a no-op.

BEGIN;

-- Bulger List
UPDATE lists SET
  year_established = 1976,
  organization = 'The Bulgers',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=5003',
  region = 'Washington',
  description = 'John Lixvar drew up Washington''s hundred highest summits in 1976, and the climbers who set out to finish them called themselves the Bulgers. A peak needs about 400 feet of prominence to hold its own place on the list. Russ Kroeker finished first, on Sinister Peak, in October 1980.'
WHERE id = 'DOlya3YYfIg60trgTm0n';

-- California Fourteeners
UPDATE lists SET
  year_established = 1991,
  organization = 'Porcella and Burns',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=50081',
  region = 'California',
  description = 'Steve Porcella and Cameron Burns counted fifteen California summits above 14,000 feet in their guidebook, first published in 1991. Fourteen rise in the Sierra Nevada; White Mountain Peak stands alone east of the Owens Valley. Mount Whitney is the highest of the fifteen, and of the contiguous United States.'
WHERE id = 'B2867467BB8132CB8D34';

-- Cascade Volcanoes
UPDATE lists SET
  year_established = 2010,
  organization = 'The Mountaineers',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=5044',
  region = 'Cascades',
  description = 'The Mountaineers'' Tacoma branch created this peak pin in 2010 for climbers who reach all twenty major Cascade volcanoes. The line runs from Mount Garibaldi in British Columbia south to Lassen Peak in California. Every peak counts toward the pin; there is no partial credit.'
WHERE id = 'ULCGhLnsWcYYRqXQ3aOo';

-- Colorado 14ers
UPDATE lists SET
  year_established = NULL,
  organization = 'Peakbagger.com',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=21360',
  region = 'Colorado',
  description = 'Colorado holds fifty-three peaks above 14,000 feet that also rise 300 feet above the saddle linking them to a higher neighbor. Twenty-eight other Colorado summits clear 14,000 feet but count as shoulders of those peaks rather than mountains in their own right. Mount Elbert is the highest of them, and the highest summit in the Rocky Mountains.'
WHERE id = 'LAZcIKjluO0oT3o9g6MC';

-- Mazama Guardian Peaks
UPDATE lists SET
  year_established = NULL,
  organization = 'Mazamas',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=5061',
  region = 'Cascades',
  description = 'The Mazamas award the Guardian Peaks certificate to members who summit Mount Hood, Mount Adams, and Mount St. Helens on official club climbs. All three volcanoes rise within sight of Portland. The club, founded on the summit of Mount Hood in 1894, has given the award to about two thousand members.'
WHERE id = 'dd7K4267UF9mBlg6yUgh';

-- Nevada Peaks Club
UPDATE lists SET
  year_established = 1997,
  organization = 'Nevada Peaks Club',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=5006',
  region = 'Nevada',
  description = 'Pete Yamagata started the Nevada Peaks Club in 1997 to draw climbers into Nevada''s many small, empty ranges. Its list holds 73 peaks spread across the state, most of them reached by long dirt roads and off-trail walking. The club takes no dues and holds no meetings; the climbing is the whole of it.'
WHERE id = 'z9Esvqgng0SvnQVP16iI';

-- Oregon Volcanoes
UPDATE lists SET
  year_established = NULL,
  organization = 'Peaks',
  source_name = 'USGS Cascades Volcano Observatory',
  source_url = 'https://www.usgs.gov/observatories/cascades-volcano-observatory',
  region = 'Oregon',
  description = 'Oregon''s Cascade volcanoes stand in a line down the state, from Mount Hood above the Columbia River to Mount McLoughlin near the California line. Mount Hood is the state high point, and all but Mount Bachelor stand in designated wilderness. Peaks keeps them together as one goal for climbers working through the Oregon Cascades.'
WHERE id = '4HxxAe4pgIKHU9gbOxtV';

-- Sierra Peaks Section Emblem Peaks
UPDATE lists SET
  year_established = 1955,
  organization = 'Sierra Club Angeles Chapter',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=50511',
  region = 'Sierra Nevada',
  description = 'The Sierra Club''s Angeles Chapter founded the Sierra Peaks Section in 1955 and marked fifteen summits on its peaks list as Emblem Peaks, the ones that dominate their part of the range. A member earns the section emblem by climbing ten of the fifteen plus fifteen more peaks from the full list. Mount Whitney, Mount Williamson, North Palisade, and Mount Ritter are among them.'
WHERE id = '43142E0739A961123EDC';

-- Smoot's 100
UPDATE lists SET
  year_established = 2002,
  organization = 'Jeff Smoot',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=5005',
  region = 'Washington',
  description = 'Jeff Smoot chose a hundred Washington summits for his 2002 guidebook Climbing Washington''s Mountains, and peakbaggers took the selection as a list. It favors classic routes over raw height, mixing scrambles in the Alpine Lakes and Olympics with technical climbs in the North Cascades. Every Washington peak above 9,000 feet is on it.'
WHERE id = 'XHG0eHY8ePaltNO3dWs0';

-- Tennessee 4500ft Peaks
UPDATE lists SET
  year_established = NULL,
  organization = 'Peakbagger.com',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=21457',
  region = 'Tennessee',
  description = 'Fifty-five summits in and around Tennessee reach 4,500 feet. Many sit on the crest of the Great Smoky Mountains, where the state line follows the ridge shared with North Carolina. Kuwohi, at 6,643 feet, is the highest of them and the highest point in Tennessee.'
WHERE id = '3S29a3viZKKnSMz4wzPQ';

-- The Seven Summits
UPDATE lists SET
  year_established = NULL,
  organization = 'Reinhold Messner',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=1000',
  region = 'World',
  description = 'The Seven Summits are the highest mountains on each of the seven continents. Peaks follows the Messner version, which counts Puncak Jaya in New Guinea rather than Mount Kosciuszko in Australia, so the Australasian leg is a climb rather than a walk. Patrick Morrow finished this version first, on Puncak Jaya, in May 1986.'
WHERE id = 'hPNDxe5mvtLjtlTnWlnf';

-- Ultras of Iran (name also corrected from "Ultras Of Iran")
UPDATE lists SET
  name = 'Ultras of Iran',
  year_established = NULL,
  organization = 'Peakbagger.com',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=49301',
  region = 'Iran',
  description = 'An ultra is a peak that rises at least 1,500 meters, about 4,900 feet, above the lowest saddle linking it to any higher ground. Iran has fifty-five, from Damavand in the Alborz range to the desert volcanoes of the southeast. Damavand is the country''s high point and the highest volcano in Asia.'
WHERE id = 'cJb67d0QVHo9F7qSLUGi';

-- Ultras of the Contiguous United States
UPDATE lists SET
  year_established = NULL,
  organization = 'Peakbagger.com',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=4904',
  region = 'United States',
  description = 'An ultra is a peak that rises at least 1,500 meters, about 4,900 feet, above the lowest saddle linking it to any higher ground. Fifty-seven stand in the lower forty-eight, from Mount Rainier and Mount Whitney to desert ranges in Nevada and Arizona that few climbers ever visit. The earth scientist Steve Fry named the class in the 1980s while measuring peaks in Washington.'
WHERE id = '9zsS3gPZhQCiPMl0DRMf';

-- US State High Points
UPDATE lists SET
  year_established = 1986,
  organization = 'Highpointers Club',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=12003',
  region = 'United States',
  description = 'The highest point in each of the fifty states, from Denali at 20,310 feet to Britton Hill in Florida at 345 feet. Jack Longacre founded the Highpointers Club in 1986 after a letter to Outside magazine turned up dozens of people with the same goal. Some high points are drive-ups; Denali, Gannett Peak, and Granite Peak call for mountaineering.'
WHERE id = 'dR9aHGKw3VwBhfsHSwlB';

-- Utah 13ers
UPDATE lists SET
  year_established = NULL,
  organization = 'Peakbagger.com',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=21349',
  region = 'Utah',
  description = 'Utah has nineteen summits above 13,000 feet, and every one stands in the High Uintas. The Uintas are the highest range in the contiguous United States that runs east to west. Kings Peak, at 13,528 feet, is the state high point.'
WHERE id = 'JCKrJp4PR2Ygtz6hLJLv';

-- Washington Home Court 100
UPDATE lists SET
  year_established = 1995,
  organization = 'Jeff Howbert',
  source_name = 'Peakbagger',
  source_url = 'https://www.peakbagger.com/list.aspx?lid=50033',
  region = 'Washington',
  description = 'Jeff Howbert published the Home Court in Pack & Paddle magazine in July 1995: the hundred highest peaks of the western Alpine Lakes country with at least 500 feet of clean prominence. He set the bounds around what a Seattle climber can reach on a weekend, with Highway 2 to the north, Interstate 90 to the south, and Deception Creek and the Cle Elum River to the east. Dick Kegel finished the hundred first, in September 1998.'
WHERE id = 'grDJmpZ6mtpgtFY8X7i1';

-- Washington State Volcanoes
UPDATE lists SET
  year_established = NULL,
  organization = 'Peaks',
  source_name = 'USGS Cascades Volcano Observatory',
  source_url = 'https://www.usgs.gov/observatories/cascades-volcano-observatory',
  region = 'Washington',
  description = 'Washington''s five volcanoes: Mount Rainier, Mount Adams, Mount Baker, Glacier Peak, and Mount St. Helens. All five carry glaciers, and the U.S. Geological Survey monitors every one. Mount Rainier is the highest mountain in the state and the most prominent peak in the contiguous United States.'
WHERE id = 'YtFZZHcw3YKGERzO0JEW';

COMMIT;
