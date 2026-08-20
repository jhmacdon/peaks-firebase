# Parking-capacity calibration

How `src/parking-capacity.ts` turns a lot polygon's area into a range of cars,
where its constants came from, and how well it does. Calibrated 2026-08-20.

`research-parking.md` §2.5 proposed polygon area as a capacity proxy at 30 m² a
space and said in the same breath that nobody had checked the ratio, because
Overpass was down when the regression was due. This is that regression.

## What ships

    cars = 0.1261 * area^0.7354        area in m²

Evaluated at the product's bucket edges, that gives the areas the shipped
function actually compares against:

| Range | Area |
|---|---|
| `under_10` | 75 – 383 m² |
| `10_to_25` | 383 – 1,330 m² |
| `25_to_50` | 1,330 – 3,413 m² |
| `50_to_100` | 3,413 – 8,759 m² |
| `100_plus` | 8,759 – 50,000 m² |

Below 75 m² and above 50,000 m² the function returns null. 75 m² is where the
curve reaches three cars; a three-car gravel apron is a pullout, and
`TrailheadParkingType` already has a word for that. 50,000 m² is past the
99.9th percentile of the calibration's own areas (38,506 m²), so a polygon
that large is being extrapolated at — and in the NPS layer it is mis-mapped
rather than enormous: eight of 6,739 lots exceed it, one of them a 250,506 m²
ring that is plainly not one lot.

Nothing exports a vehicle count. The curve is a centre line through a cloud a
full order of magnitude wide, and the honest unit of publication is the range.

## The area contract

**Binding on every caller.** `areaM2` must be the *geodesic ground area of one
lot's footprint, net of interior rings* — in PostGIS, `ST_Area(geom::geography)`,
which is what this schema's `geography(...)` columns give for free. The
calibration was fitted on geodesic areas, so a caller measuring anything else is
measuring a different quantity than these constants describe. Two ways to get it
wrong, both of which move buckets silently.

**1. Never pass a planar Web Mercator (EPSG:3857) area.** Mercator inflates area
by 1/cos²(latitude):

| Latitude | Area inflation | Effect on cars (through the 0.735 exponent) |
|---|---|---|
| 35°N | ×1.49 | ×1.34 |
| 45°N | ×2.00 | ×1.66 |
| 49°N | ×2.32 | ×1.86 |

That is enough to push the majority of lots a full bucket high, in the direction
that tells a hiker there is more parking than there is.

**2. A multi-part feature is not one lot.** Measured on the NPS public parking
layer, 1,114 of 6,739 features carry more than one ring:

| | Features | Effect |
|---|---|---|
| ≥1 *interior* ring (hole, median, planted island) | 1,006 | Using gross instead of net area flips **232** bucket assignments |
| >1 *exterior* ring (genuinely multi-part) | 147 | Sum-of-parts and largest-part disagree on **36** |
| both | 39 | |

Holes are not a rounding error: the median hole is 15% of its exterior ring, the
90th percentile 42%, and 60 features have holes covering more than half.

Two lots either side of a road are two lots. **The contract: split per exterior
part and call this once per part, or make no claim.** Never sum disjoint parts
into one answer.

Enforcement belongs at the call site, where the geometry is — this module takes
a number and cannot tell a good one from a bad one. The wiring task owns it.

## The data

Every `amenity=parking` **way** in the contiguous United States carrying both a
polygon and a numeric `capacity` tag, pulled from Overpass on 2026-08-20 over
twenty region boxes, dense ones subdivided.

- 67,590 distinct ways.
- 56,124 usable pairs after filtering.

| Dropped | Count | Why |
|---|---|---|
| decks and street parking | 11,119 | `parking=multi-storey`, `underground`, `rooftop`, `carports`, `street_side`, `lane`, `layby` — a stacked or linear lot obeys a different rule |
| non-numeric capacity | 144 | free text where an integer was expected |
| under 10 m² | 17 | not a polygon anybody meant |
| outside 8–1,000 m² a car | 186 (0.33%) | physical validity, not distribution trimming: a surface stall cannot be smaller than a car, and no real lot spends a tenth of a hectare on one |

The validity bounds bind on a third of a percent of the sample, which is the
point of quoting them — they catch data errors without shaping the fit.

**Licensing.** The pull is ODbL. No per-lot OSM data is stored in this
repository or in any Peaks artifact: the deliverable is the fitted
coefficients, the spread statistics, the bucket boundaries and the validation
numbers — aggregate analysis only. The raw pulls stayed in a session scratchpad
and were deleted when the study finished.

## Why not one national ratio

Median area per car, by segment:

| Segment | n | Median m²/car |
|---|---|---|
| All US OSM lots | 56,124 | 28.5 |
| … paved | 26,564 | 29.4 |
| … unpaved | 2,066 | 40.6 |
| … surface untagged | 27,494 | 27.0 |
| **Trailhead context** | **914** | **39.3** |
| … paved | 302 | 37.8 |
| … unpaved | 285 | 42.6 |
| … surface untagged | 327 | 37.0 |
| USFS page prose (held out) | 63 | 57.0 |
| … pages mentioning no trailer | 54 | 51.6 |

That ladder — **28.5 → 39.3 → 57.0** — is the load-bearing evidence in this
document. It is what rejected the national calibration, and it is measured on
samples of 56,124, 914 and 63 rather than inferred from an accuracy score.

"Trailhead context" means the lot is within 150 m of an OSM
`highway=trailhead`/`information=trailhead` node (10,521 of them nationally),
or its `name` mentions a trail.

A trailhead lot spends about 40% more area per car than the national median,
and the Forest Service's own prose about its own trailheads puts the figure
twice as high as the national one. A gravel turnaround with no stripes, room to
swing a truck and a snow pile in the corner holds fewer cars per hectare than a
striped lot behind a supermarket. Calibrating nationally and applying the
result to trailheads over-counts them by roughly a factor of two — one whole
bucket, every time. So the constants come from the 914-lot trailhead subset
rather than the 56,124-lot national one, and that choice costs real precision:
the national fit is far better measured, and we are deliberately not using it.

## Why a curve and not a ratio

Area per car falls as lots grow — the fixed overhead of an approach, a
turnaround and an apron is most of a four-car pullout and almost none of a
250-car lot. Ordinary least squares of log(capacity) on log(area) over the 658
trailhead-context pairs in the 70% fitting slice gives an exponent of 0.7354.

Bootstrap, 2,000 resamples:

| Quantity | Estimate | 95% CI |
|---|---|---|
| exponent | 0.7354 | 0.698 – 0.773 |
| coefficient | 0.1261 | 0.101 – 0.159 |
| area at 10 cars | 383 m² | 364 – 402 |
| area at 25 cars | 1,330 m² | 1,236 – 1,448 |
| area at 50 cars | 3,413 m² | 3,051 – 3,892 |
| area at 100 cars | 8,759 m² | 7,490 – 10,475 |

A through-origin ratio is exponent 1, which sits outside that interval: the
ratio form is not merely worse, it is excluded by the data. The national
sample's exponent is 0.7907, also outside it — one more reason the two
populations get separate treatment.

Residual standard deviation is 0.497 in log space, a 1σ spread of ×1.64. Real
trailhead lots run from 11 to 250 m² a car. That spread, not the centre line,
is why the answer is a range.

## Accuracy

Measured with the gates applied, over the lots the function actually answers
for. The trailhead-context rows are the ones that matter — that is the
population this is calibrated for and applied to. The national slice is
reported for completeness and is the least relevant number here, being
dominated by urban lots this function is not for.

| Set | Answered | Exact bucket | Correct or adjacent |
|---|---|---|---|
| **Trailhead-context held-out OSM pairs** | 242 of 256 | **62.8%** | 97.9% |
| **USFS page prose** | 62 of 63 | **50.0%** | 91.9% |
| National held-out slice (30% id hash) | 15,197 of 16,805 | 54.8% | 97.8% |

The ship bar was 80% correct-or-adjacent on both required sets. Both clear it —
and that is worth much less than it sounds.

### The adjacency bar is mostly bucket geometry

With buckets this wide and a residual spread of ×1.64, the correct-or-adjacent
band spans a factor of five or more in cars. Simulating a model with the
*correct* scale and nothing but the observed log-normal noise:

| Model | Exact | Correct or adjacent |
|---|---|---|
| Correctly scaled | ~68% | ~98% |
| Wrong by ×1.66 | ~56% | ~94% |
| **Wrong by ×2.0** | ~48% | **~90%** |

A model wrong by a full factor of two — precisely the mistake calibrating on
the national population would have made — still clears an 80% adjacency bar.
**The bar cannot distinguish this calibration from the one it replaced.** What
discriminates is exact accuracy, and behind that the m²/car scale ladder in the
segment table above. `__tests__/parking-capacity.test.ts` runs this simulation
and pins the claim, so it cannot quietly rot.

### Two honest caveats on the prose number

**The 91.9% is a selection-maximum.** The thresholds themselves were analytic
throughout — the fitted curve evaluated at the bucket edges, never tuned to any
dataset. But five candidate threshold families (national analytic, national
DP-optimal, trailhead with borrowed exponent, trailhead pure, trailhead
DP-optimal) were each scored against the prose set before this one was chosen,
and the prose score was part of why. On n = 62 that makes 91.9% optimistic. The
prose set is held out from *fitting*; it is not held out from *model selection*.

**50.0% exact is below par, and the errors lean one way.** A correctly scaled
model should reach about 68%. Against the prose set the shipped curve reaches
50%, with **19 over-claims against 12 under-claims** — it still reads high
against the most rural population in the study. Over-claiming is the
user-unsafe direction: it tells a hiker there is more parking than there is.
Some of that gap is trailer parking (the trailer-free prose median is 51.6 m²
a car against 57.0 overall), and some is genuine residual bias.

The 1,608 held-out OSM lots the floor declines were nearly all correct
`under_10` calls given up on purpose. The gate costs exact accuracy to buy the
right to stay quiet about pullouts.

USFS prose confusion, truth down the side, prediction across:

|  | under_10 | 10_to_25 | 25_to_50 | 50_to_100 | 100_plus |
|---|---|---|---|---|---|
| **under_10** | 9 | 8 | 1 | 0 | 0 |
| **10_to_25** | 2 | 15 | 7 | 2 | 0 |
| **25_to_50** | 0 | 5 | 6 | 1 | 0 |
| **50_to_100** | 0 | 1 | 2 | 1 | 0 |
| **100_plus** | 0 | 0 | 1 | 1 | 0 |

The five two-bucket misses are genuine disagreements between polygon and prose,
not bad joins — several sit at zero distance from the trailhead point. They run
both ways: ORV staging aprons that the Forest Service rates for a few dozen
vehicles while the mapped polygon covers a couple of hundred m² a vehicle, and
tightly striped lots doing better than 25 m² a car. Where a mapped polygon
includes the gravel a lot spills onto, or excludes half a striped lot, no
area-based method can recover the count.

## The held-out prose set

The Forest Service publishes parking prose on its trailhead pages, and 2,735 of
those pages were already cached under `docs/trailheads/data/raw/`. A regex over
the `field-rec-parking-info` block found 108 pages stating a vehicle count, and
the same pages carry an exact latitude and longitude. Cross-checked against the
40 rows an LLM pass had extracted into `fs-page-sections.jsonl`, the regex
agreed on 35 of 36 overlapping pages.

Each of the 108 was joined to the nearest mapped lot polygon within 120 m —
OSM first, NPS lot polygons as a fallback. 63 found one. The rest have no
mapped lot, which is its own finding about coverage.

**It was never used for fitting, and it was used for model selection.** No
constant was fitted to it and no threshold was tuned on it — the thresholds are
the curve at the bucket edges throughout. But five candidate threshold families
were scored against it before one was chosen, so its 91.9% is a maximum over
five, on n = 62. Treat it as strong evidence about *scale* and weak evidence
about the last few points of accuracy.

With that caveat it is still the only evidence here that is both
trailhead-specific and independent of OSM's own capacity tags, and it is the
reason to trust the trailhead calibration over the national one.

**A larger replacement now exists.** `fs-page-sections-full.jsonl` — the full
2,900-page LLM extraction, with 137 stated capacities — landed after this pull
was taken, so the calibration did not see it. Re-validating against it, with the
threshold family frozen first, would give a genuinely clean held-out number and
retire the selection caveat above. That is recorded as work for the wiring task,
not done here.

## Surface is a proxy, not a driver

The function takes a `surface` hint and does not use it. That is a measurement,
not an oversight.

Nationally the gap looks decisive — 40.6 m² a car unpaved against 29.4 paved.
Inside trailhead context it closes to 42.6 against 37.8 (n = 285 and 302), a gap
far inside the ×1.64 spread the fit already carries. Surface was standing in for
setting; once the setting is known, it has little left to say.

**That median comparison is the whole of the surviving evidence.** A
dummy-variable regression and a scoring pass run during the study also found no
gain, but both were ad-hoc scripts over the raw OSM pull, which ODbL required
deleting — so neither is reproducible from this repository, and neither is
quoted as a figure here. A future refit that wants to revisit surface should
measure it again rather than trust a remembered number.

The parameter stays in the signature because callers have the value and a
bigger trailhead sample may yet find a use for it. A test pins the current
behaviour so it cannot start shifting buckets without a recalibration behind it.

## The schema decision this feeds

Proposed for `TrailheadParking`, as a sibling of the existing
`capacity_vehicles` — a source that counted spaces keeps writing the count, and
this is what a source that only mapped a polygon can offer:

```ts
export type TrailheadParkingCapacityRange =
  | 'under_10' | '10_to_25' | '25_to_50' | '50_to_100' | '100_plus';

capacity_range?: SourcedValue<TrailheadParkingCapacityRange>;
```

`amenities.ts` is deliberately untouched by the calibration change; wiring the
schema is a separate piece of work, and the type in `parking-capacity.ts` is its
input. Whatever writes the leaf should mark its source as derived from lot
geometry, so a range and a count are never mistaken for each other downstream.

## Recalibrating

The thresholds are the curve evaluated at the bucket edges, and
`__tests__/parking-capacity.test.ts` fails if the two stop agreeing — so refit,
do not nudge. A refit needs: the OSM pull filtered as above, the trailhead
context flag, the 70/30 id hash split, and the prose set left alone until both
the constants **and the threshold family** are frozen — the family choice is
where this study leaked, and freezing it first is what makes the prose number
clean. Then re-run both validations and update the numbers here and in the
module header together.

Report exact accuracy first and adjacency second, with the simulated baseline
beside it. Adjacency alone will clear 80% for almost any scale, so quoting it
on its own overstates what a refit has shown.

Worth revisiting when any of these change:

- **The top bucket has no positive validation at all.** Look at the prose
  confusion matrix: the `100_plus` row and column contain not one correct call.
  Two prose lots are truly `100_plus` and both were called lower; one lot called
  `100_plus` was truly `25_to_50`. Nothing has confirmed the top bucket works,
  in either direction. Any copy leaning on "100+ cars" is unvalidated.

- **The trailhead sample grows.** 914 lots is the binding constraint on
  everything above; the national sample is 60 times bigger and cannot be used
  in its place.
- **The top bucket gets real evidence.** The 100-car edge has the widest
  bootstrap interval (7,490 – 10,475 m²) and the prose set contains two lots
  above it. That edge is the least trustworthy thing here.
- **NPS lots turn out to differ.** The consumer is a national-park layer, and a
  paved visitor-centre lot probably sits between the national population and
  the Forest Service one. No NPS lot carries a capacity, so this is untested,
  and it is the most likely reason the shipped numbers would be wrong in
  practice.
