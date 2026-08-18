# Peakbagger list audit — 2026-08-18

Peakbagger showed 889 developed lists. Peaks had 15 lists and 711 list links.
The audit did not import every gap. Many source lists are grids, county high
points, near copies of other lists, or large specialist goals.

## Added

- [Porcella/Burns California Fourteeners](https://www.peakbagger.com/list.aspx?lid=50081): 15 of 15 source peaks matched one Peaks destination by name and elevation.
- [Sierra Peaks Section Emblem Peaks](https://www.peakbagger.com/list.aspx?lid=50511): 15 of 15 source peaks matched one Peaks destination by name and elevation.

## Refreshed

- [Cascade Volcanoes Peak Pin](https://www.peakbagger.com/list.aspx?lid=5044): add Little Tahoma, raising the list from 19 to 20 peaks.
- [Colorado 14,000-foot Peaks](https://www.peakbagger.com/list.aspx?lid=21360): use the current 53 source rows. Mount Blue Sky and Crestone Peak East keep the existing destination rows for their former or shorter names. North Maroon Peak replaces Challenger Point.
- [Tennessee 4500-foot Peaks](https://www.peakbagger.com/list.aspx?lid=21457): use the current 55 source rows. Kuwohi keeps the existing Clingmans Dome row. High Rock is new to Peaks and comes from [OpenStreetMap node 356773747](https://www.openstreetmap.org/node/356773747).

## Held for a destination audit

- Adirondack 46ers: 37 of 46 rows matched by exact name and elevation.
- AMC New England 4000-footers: 51 of 67 matched.
- Oregon Top 100 Peaks: 88 of 100 matched.
- Traditional Colorado Centennial Peaks: 96 of 100 matched.

The importer stops when a source row is missing, unclear, repeated, or has an
unexpected list count. It runs as a dry run unless `--apply` is present.

This work adds no service, job, or steady compute cost. Monthly cost impact: $0.
