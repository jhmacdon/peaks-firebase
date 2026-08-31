# DoBIH Majority-Four Source Audit — 2026-08-31

## Status

This change freezes four source rosters. It does not add an importer, resolve the
698 new identities, create routes, queue cover photos, or write production data.
The lists must stay unpublished until every identity, destination cover, safe
route, and route cover passes review.

These four units would move the checked list denominator from 38 of 83 to 42 of
83 only after that work passes. This source fixture alone does not change
coverage.

The follow-up [identity analysis](./keeper-list-dobih-majority-four-identities-2026-08-31.md)
checks the 317 prior overlaps against a fresh read-only catalog snapshot and
finds 169 safe new catalog matches. It leaves 530 identities open and still
does not add an importer.

The change adds no service, timer, job, or other running resource. Run-rate
change: **$0/month**.

## Pinned source

| Input | SHA-256 |
| --- | --- |
| DoBIH v18.5 archive | `0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021` |
| DoBIH v18.5 CSV | `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea` |
| Canonical source metadata | `54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402` |
| Majority-four fixture | `de3b4025b66e5f7dde1decb2e7a48784044054e0280de46df2d81cc8c8de0eec` |

DoBIH v18.5 was released on 2026-07-26 under CC BY 4.0. The builder rejects any
other archive metadata or CSV bytes.

## Exact rosters

| List | Exact selection | Count | Roster SHA-256 |
| --- | --- | ---: | --- |
| Hewitts of England and Wales | `Hew=1 AND Country IN (E,ES,W)` | 316 | `8f3b40a77804c91d6f7da955024bce0bfe49bda384a857b82c5797cdaa63bf22` |
| Birketts | `B=1 AND Country=E` | 541 | `970e671250616e38c0f9767acf26f058c7d2ebecd69568457512cfc25f9918d7` |
| Synges | `Sy=1 AND Country=E` | 670 | `8d9bb012fea4f2c5135ff972c83d354b43f8706add77f125649527beb67acaff` |
| Great Britain Submarilyns | `sMa=1 AND Country IN (E,ES,S,W)` | 100 | `80a544c71e8331545620c11510eafb26b18581f8db1a1c2544db5d2bce0c29e0` |

The filters use DoBIH country codes. `ES` means the England–Scotland border.
Great Britain uses `E,ES,S,W`, not `Country != I`, so a later Isle of Man or
Channel Islands row cannot enter by mistake.

The four rosters contain 1,627 memberships across 1,015 source identities. They
reuse 317 identities from the Corbetts, Wainwrights, and queued DoBIH open-eight
work. They add 698 identities that still need review.

Hewitts and Nuttalls are accepted variants of one [LDWA Register
1](https://ldwa.org.uk/hillwalkers/register1.php) unit. Peaks freezes the 316-hill
Hewitt roster and does not count Nuttalls as another unit. Birketts and Synges
overlap on 488 hills, but the [LDWA Register
2](https://ldwa.org.uk/hillwalkers/register2.php) keeps them as separate
completion registers. Tim Synge also describes the current 670-hill roster in
his [first-person account](https://www.ukhillwalking.com/articles/destinations/climbing_the_synges_-_670_lakeland_fells-16710).

The Submarilyn roster follows the current 100-hill [Pedantic Press completion
register](https://www.pedantic.org.uk/886), not the old 2017 roster.

## Publication blocks

Pillar Rock, DoBIH 2390, belongs to both the Birketts and Synges. It is an
exposed rock climb. The LDWA permits completion without it. Peaks must not
publish a hiking route to Pillar Rock. A weak count-only waiver would let a user
skip the wrong hill, so exact optional-member support or a safe technical-climb
model should come first.

The Hewitts include access-controlled firing-range hills:

- `dobih:2711` Mickle Fell;
- `dobih:2713` Little Fell;
- `dobih:2735` Murton Fell;
- `dobih:2877` High Willhays.

Any later route must use approved access, carry the current range warning, and
never imply unrestricted entry. The current rules are on the [Warcop public
access](https://www.gov.uk/guidance/north-england-public-access-to-military-areas)
and [Dartmoor public access](https://www.gov.uk/government/publications/dartmoor-guaranteed-public-access)
pages.

Birketts and Synges also include four named fell tops with zero measured drop.
They are valid author-picked targets, as Wainwrights are, but they are not all
independent topographic summits. County-highpoint lists remain out of scope
because their non-summit points need a different destination model.
