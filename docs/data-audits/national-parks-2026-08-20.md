# National park index audit — 2026-08-20

Source of truth: the National Park Service's list of 63 units designated as
national parks: <https://www.nps.gov/aboutus/national-park-system.htm>.

The old web filter treated the PAD-US parcel designation `NP` as the park
roster. A read-only production check found:

- The filter showed 25 of the 63 official parks and missed 38.
- Olympic National Park was one of the misses because its only production row
  has the PAD-US designation `MPA`.
- The filter also showed five places that are not among the 63 parks:
  Chimborazo Park, `Fredericksburg and Spot. National Military Park`, George
  Washington Memorial Parkway, Maggie L. Walker, and Petersburg National
  Battlefield Park.
- PAD-US splits or duplicates some parks. Grand Canyon has three same-name
  rows; Denali, Gates of the Arctic, Katmai, Lake Clark, and Wrangell-St. Elias
  each have two. The small fragments are not the right detail-page boundary.
- Great Sand Dunes and the full boundaries for several Alaska parks have a
  non-park `kind`, even though their names match the official roster.
- The old state grouping used only `state_codes[1]`. It left Death Valley out
  of Nevada, Great Smoky Mountains out of Tennessee, Yellowstone out of
  Montana and Wyoming, and Gateway Arch out of Illinois.

The fixed index uses the official roster for membership and state placement.
For each park it links to the largest same-name PAD-US boundary row. Missing
source rows now raise an error instead of making the roster silently shorter.

The production dry run after the fix returned all 63 parks, 68 state
appearances across 33 states and territories, and these three Washington
parks: Mount Rainier, North Cascades, and Olympic.
