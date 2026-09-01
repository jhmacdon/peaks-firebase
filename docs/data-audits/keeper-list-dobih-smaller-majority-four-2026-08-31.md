# Smaller DoBIH Majority-Four Source Audit — 2026-08-31

## Status

This change freezes four source rosters. It does not add an importer, resolve
the 527 new identities, create routes, queue covers, or write production data.
The bundle sets publication readiness to `false`. The lists must stay unpublished
until every identity, destination cover, safe route, and route cover passes review.

These four units would move the checked list denominator from 38 of 83 to 42 of
83 only after that work passes. This source fixture alone does not change
coverage.

The follow-up [identity analysis](./keeper-list-dobih-smaller-majority-four-identities-2026-08-31.md)
checks all 121 prior overlaps and finds 168 safe new catalog matches. It leaves
359 identities open and still adds no importer.

The next [checked resolution fixture](./keeper-list-dobih-smaller-majority-four-identity-resolutions-2026-08-31.md)
closes all 359 identity rows with 10 existing destinations, 2 catalog repairs,
and 347 deterministic curated destinations. It still adds no import or
publication path.

The change adds no service, timer, job, or other running resource. Run-rate
change: **$0/month**.

## Pinned open source

| Input | SHA-256 |
| --- | --- |
| DoBIH v18.5 archive | `0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021` |
| DoBIH v18.5 CSV | `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea` |
| Canonical source metadata | `54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402` |
| Smaller majority-four fixture | `4fdc18c1b92a3cc7a54d237b1f805dd54b85368b47679eb22be1af5287c1488b` |

[DoBIH v18.5](https://www.hill-bagging.co.uk/dobih/downloads/) was
released on 2026-07-26 under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The fixture keeps the DoBIH name, source link, version, download link, license,
license link, archive hash, and CSV hash. The builder rejects different bytes or
license metadata.

## Exact rosters

| List | Exact DoBIH v18.5 selection | Count | Roster SHA-256 |
| --- | --- | ---: | --- |
| Welsh 3000s | `Number IN (1963,1964,1965,1966,1967,1968,1969,1970,1971,1972,1973,1974,1975,1976,1977)` | 15 | `749fc7dda4f61e206dc62539f9e0fd3220411c9417dfeeb93789cc07fff401e2` |
| Great Britain Submarilyns | `sMa=1 AND Country IN (E,ES,S,W)` | 100 | `80a544c71e8331545620c11510eafb26b18581f8db1a1c2544db5d2bce0c29e0` |
| Donald Deweys | `DDew=1` | 247 | `6fb396493ec9e7d48c36f697e7502b51e84d3318c81d87711cdb719ca997c490` |
| Hewitts of England and Wales | `Hew=1 AND Country IN (E,ES,W)` | 316 | `8f3b40a77804c91d6f7da955024bce0bfe49bda384a857b82c5797cdaa63bf22` |

The country filters use DoBIH codes. `ES` means the England–Scotland border.
Great Britain names `E,ES,S,W` instead of excluding Ireland, so a later Isle of
Man or Channel Islands row cannot enter by mistake.

The Welsh roster does not infer membership from a height filter. It pins all 15
DoBIH Numbers. The [British Mountaineering Council challenge page](https://thebmc.co.uk/en/how-to-run-the-welsh-3000ers)
confirms a 15-mountain challenge and warns that it is technical and rocky in
places. The BMC page supports the named challenge; the CC BY DoBIH artifact is
the source Peaks may republish.

The current [Pedantic Press completion register](https://www.pedantic.org.uk/886)
supports the 100 Great Britain Submarilyns. The [LDWA Hillwalkers Register 5](https://ldwa.org.uk/hillwalkers/register5.php)
states that there are 247 Donald Deweys and points to DoBIH for the current list.
The [LDWA Hillwalkers Register 1](https://ldwa.org.uk/hillwalkers/register1.php)
keeps the England and Wales 2,000-foot completion unit. Peaks freezes its 316
Hewitts and does not count the Nuttalls as another unit.

## Work saved against the larger four-list set

The four rosters contain 678 memberships across 648 source identities. Against
the pinned Corbetts, Wainwrights, and queued DoBIH open-eight fixtures, 121
identities already have source review and 527 are new. In this order, the lists
reuse/add `15/0`, `9/91`, `7/240`, and `120/196` identities.

The larger majority-four source set has 1,627 memberships, 1,015 identities,
and 698 new reviews. This set cuts 949 memberships, 367 distinct identities,
and 171 new reviews. It also removes Pillar Rock and the author-picked Birketts
and Synges, whose non-summit tops made the destination model less direct.

The only cross-list repeats are:

- all 15 Welsh 3000s in the Hewitts;
- 6 Great Britain Submarilyns in the Donald Deweys;
- 9 Great Britain Submarilyns in the Hewitts.

## Route publication blocks

The bundle exports four exact source-member blocks with
`routePublicationAllowed: false`:

- `dobih:2711` Mickle Fell;
- `dobih:2713` Little Fell;
- `dobih:2735` Murton Fell;
- `dobih:2877` High Willhays.

The first three are tied to Warcop Training Area. The Ministry of Defence says
not to enter when the range is in use and publishes current [Warcop firing times](https://www.gov.uk/government/publications/warcop-firing-times).
High Willhays needs the current [Dartmoor guaranteed-access and firing notice](https://www.gov.uk/government/publications/dartmoor-guaranteed-public-access).
Red flags or lamps mean live firing and no entry.

The source-only bundle cannot publish any route. A later identity resolver must
map each block to its reviewed destination, and route review must keep the block
until it proves an approved route for a current access period. A generic hiking
route or a warning pasted onto an unsafe path is not enough.

## Checks before any later import

1. Resolve all 648 identities and keep the fixture's byte-for-byte identity
   checks for the 30 repeated memberships.
2. Carry all four firing-range blocks from DoBIH Number to reviewed destination
   ID before adding any production import command.
3. Review the Welsh 3000s as separate summit routes. Do not turn the full
   technical challenge traverse into a default hiking route.
4. Add reviewed destination and route covers, then run a read-only dry run.
5. Add an apply path only in a separate reviewed change. This source change must
   not run against production.
