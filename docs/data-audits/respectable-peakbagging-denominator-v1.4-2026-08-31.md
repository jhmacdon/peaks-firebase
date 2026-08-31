# Respectable peak-bagging list registry v1.4

This audit is a dated, skeptical lower-bound registry. It is not a full world census. The JSON file beside this note holds the sources, rules, 85 accepted units, rejects, open questions, and next researched set.

## Coverage

- Confirmed list units: 85
- Current exact units: 22 (25.8824%)
- Ready but unmerged exact units: 16
- Current plus ready: 38 of 85 (44.7059%)
- Majority mark for this registry: 43
- More exact units needed: 5
- `coverageClaimSupported`: `false`
- `majorityClaimSupported`: `false`

The ready stack is PRs #158, #162, #164, and #165. It holds the former seven queued units, eight reviewed DoBIH units, and the Korean Forest Service 100 Famous Mountains. Ready does not mean merged or imported.

## Eleven added units

| Unit | Region | Roster key | Import state |
| --- | --- | --- | --- |
| Mountaineers Five Majors | North America | 5; all required | Exact live owner rows; rights not proved |
| Mountaineers Baker's Dozen | North America | 18; any 13 | Exact live owner rows; rights not proved |
| Mountaineers Cascade Classics | North America | 18; all required | Exact live owner rows; rights not proved |
| Mountaineers Everett Classic Eight | North America | 8; all required, at most 3 per year | Exact live owner rows; rights not proved |
| Mountaineers Olympic Peaks | North America | 15 | Blocked: the current page says both any 10 and all 15 |
| Colorado Mountain Club Bicentennials | North America | Highest 200 | Blocked: no owner row manifest or stable inclusion keys |
| Colorado Mountain Club All 13ers | North America | 637 | Blocked: no owner row manifest or stable inclusion rule |
| NZAC 100 Peaks Challenge | Australasia | 100; all under current use | Exact owner-linked Google Sheet; rights not proved |
| 臺灣小百岳 / Taiwan Small 100 | Asia | 100 | Blocked: government roster and ATUNAS award have separate owners |
| MCSA Stellenbosch 10 Peaks Challenge | Africa | 23; any 10 | Exact owner-linked Google Drive PDF; rights not proved |
| 日本三百名山 / JAC Japan 300 Mountains | Asia | 300 | Blocked: no formal rule or award, plus two source defects |

The source capture audit has SHA-256 `9a99235af11e268d07ddf76ce1f16a4b31d1a8b247a1009bcfee3db4632ec8ec`. It pins exact normalized rosters for NZAC (`548d345ca6a6b4345af22da6313854a6ecc870d43ec7191a47fb15a0d1fea370`), Taiwan (`50568f482c52da651ace62a31ddb34e45a1abf96a01b97c888e9ad938a1ac591`), MCSA (`56c7417736c1bfa5d3756377c640825284f8b2d3f3e17434732599f6ec2a468c`), and JAC (`97ef9b9adda9dab69e6d82c5dbc8dd2a4c1246141b93ce2b7a6fbdab5446b24e`). The owner-linked NZAC and MCSA files are Google-hosted, not immutable club releases. The Mountaineers and CMC checks used live owner HTML and have no immutable roster artifact.

The regional totals are North America 37, Europe 30, Asia 6, Australasia 4, Global 5, Africa 2, and South America 1. This still shows a strong North American and British/Irish bias.

## Researched six-unit set

The four Mountaineers units with clear rules, plus NZAC and MCSA, form a cross-region six-unit set. If each gets a separate importer, rights decision, and review, exact coverage would reach 44 of 85 (51.7647%). None is queued yet. That result would be a majority of this dated lower-bound registry only. It would never prove a worldwide majority.

Olympic Peaks stays out because its current completion text conflicts. The two CMC units stay out because the owner does not publish exact row manifests. Taiwan stays out because the roster owner and award operator differ. JAC stays out because no formal award or current rule was found, and the PDF has a truncated row and a conflicting row.

## Cost

This docs-only audit adds no infrastructure. Fixed monthly cost: $0.
