# DoBIH Deweys Source Audit — 2026-09-01

## Status

This change freezes the Deweys source roster. It does not add an importer,
resolve the 373 new identities, create routes, queue covers, or write production
data. The bundle sets publication readiness to `false`. The list must stay
unpublished until every identity, destination cover, safe route, and route cover
passes review.

This source bundle would add one ready roster to the dated 83-unit registry. It
would move the ready stack from 42 to 43 exact units after review. Production
stays at 22 of 83. This fixture alone does not change live coverage.

The change adds no service, timer, job, or other running resource. Run-rate
change: **$0/month**.

## Pinned open source

| Input | SHA-256 |
| --- | --- |
| DoBIH v18.5 archive | `0c39e13ac59dd3fa172ac21dd56dd0f6fef19a14af47c7a5a444cce691e9f021` |
| DoBIH v18.5 CSV | `d27bc69dbb6d30a6f171ef277408831fe8763fc9043422f4e375e63f4cc190ea` |
| Canonical source metadata | `54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402` |
| Deweys fixture | `730ac1326f97d13f41cb289028c118206feebd0270daecedcba583d5655109ea` |

[DoBIH v18.5](https://www.hill-bagging.co.uk/dobih/downloads/) was
released on 2026-07-26 under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The builder rejects any other CSV bytes or source-license record.

## Exact roster

The only source rule is `Dew=1`. It yields 425 members, deterministic list ID
`75B4485F6944A4BB43F5`, and ordered-roster SHA-256
`f0aa896b51d6a7f1ae3ec50a774c0c2b17a63288b7f74d5d54de1af143c4fd4a`.
Rows sort by DoBIH Number and keep source ordinals from 1 through 425.

The DoBIH country split is:

- Wales (`W`): 240;
- England (`E`): 174;
- England–Scotland border (`ES`): 6;
- Isle of Man (`M`): 5.

The five Isle of Man members are DoBIH Numbers `1946`, `3337`, `3338`,
`3339`, and `3340`. The bundle allows later reviewed destination identities in
`GB` and `IM`; it does not infer those identities now.

## Review work

Against the pinned Corbetts, Wainwrights, open-eight, and smaller-majority-four
fixtures, 52 Deweys already have reviewed source identities and 373 are new.
The test compares source IDs against those three exact fixture files. It also
pins their old file hashes, so adding the `Dew` parser field cannot rewrite an
older roster unnoticed.

The four firing-range source blocks from the smaller-majority-four bundle do
not occur in this roster. High Knott and Williamson's Monument do not occur
either.

DoBIH `3649`, Great Links Tor, is a technical rock summit. The bundle pins its
fixture row at ordinal 408 and exports `routePublicationAllowed: false` with
reason `technical_rock_summit`. Do not publish a route to the summit until a
review pins a non-climbing endpoint or a clear exception. The LDWA Register 5
page is the pinned access reference.

This block does not prove that every other Deweys route is safe. Each member
still needs a route review and a credited route cover before publication.

## No import path

This change adds one command that rebuilds the source fixture. It adds no
resolution builder, importer, apply flag, or production write. Tests fail if a
Deweys import or apply command appears or if a top-level Deweys importer file
is added. A later import needs its own reviewed change after all 425 identities,
destination covers, routes, and route covers pass the zero-gap checks.
