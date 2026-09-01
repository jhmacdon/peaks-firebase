# Respectable peak-bagging list registry v1.4

This audit is a dated, skeptical lower-bound registry. It is not a full world census. The JSON file beside this note holds the sources, rules, 83 accepted units, rejects, open questions, and next researched set.

## Coverage

- Confirmed list units: 83
- Current exact units: 22 (26.5060%)
- Ready but unmerged exact units: 16
- Current plus ready: 38 of 83 (45.7831%)
- Majority mark for this registry: 42
- More exact units needed: 4
- `coverageClaimSupported`: `false`
- `majorityClaimSupported`: `false`

The ready stack is PRs #158, #162, #164, and #165. It holds the former seven queued units, eight reviewed DoBIH units, and the Korean Forest Service 100 Famous Mountains. Ready does not mean merged or imported.

## Nine added units

| Unit | Region | Roster key | Import state |
| --- | --- | --- | --- |
| Mountaineers Five Majors | North America | 5; all required | Exact live owner rows; rights not proved |
| Mountaineers Baker's Dozen | North America | 18; any 13 | Exact live owner rows; rights not proved |
| Mountaineers Cascade Classics | North America | 18; all required | Exact live owner rows; rights not proved |
| Mountaineers Everett Classic Eight | North America | 8; all required, at most 3 per year | Exact live owner rows; rights not proved |
| Mountaineers Olympic Peaks | North America | 15 | Blocked: the current page says both any 10 and all 15 |
| NZAC 100 Peaks Challenge | Australasia | 100; all under current use | Blocked: permission required; not queued |
| 臺灣小百岳 / Taiwan Small 100 | Asia | 100 | Blocked: split owners and permission required |
| MCSA Stellenbosch 10 Peaks Challenge | Africa | 23; any 10 | Exact owner-linked Google Drive PDF; rights not proved |
| 日本三百名山 / JAC Japan 300 Mountains | Asia | 300 | Blocked: permission, no formal rule, and two source defects |

The source capture audit has SHA-256 `9a99235af11e268d07ddf76ce1f16a4b31d1a8b247a1009bcfee3db4632ec8ec`. It pins exact normalized rosters for NZAC (`548d345ca6a6b4345af22da6313854a6ecc870d43ec7191a47fb15a0d1fea370`), Taiwan (`50568f482c52da651ace62a31ddb34e45a1abf96a01b97c888e9ad938a1ac591`), MCSA (`56c7417736c1bfa5d3756377c640825284f8b2d3f3e17434732599f6ec2a468c`), and JAC (`97ef9b9adda9dab69e6d82c5dbc8dd2a4c1246141b93ce2b7a6fbdab5446b24e`). The owner-linked NZAC and MCSA files are Google-hosted, not immutable club releases. The Mountaineers roster checks and CMC candidate checks used live owner HTML and have no immutable roster artifact.

The Taiwan capture preserves its source-key fault: row 38 uses `PKNO=100`; later displayed row numbers are one above `PKNO`, ending at row 100 with `PKNO=99`. The JAC source also says volcanic or conservation closures can prevent literal completion. Its roster PDF still has a truncated row and a conflicting row.

The regional totals are North America 35, Europe 30, Asia 6, Australasia 4, Global 5, Africa 2, and South America 1. This still shows a strong North American and British/Irish bias.

## Researched six-unit set

The four Mountaineers units with clear rules, plus NZAC and MCSA, form a cross-region six-unit set. If each gets a separate importer, rights decision, and review, exact coverage would reach 44 of 83 (53.0120%). None is queued yet. That result would be a majority of this dated lower-bound registry only. It would never prove a worldwide majority.

Olympic Peaks stays out because its current completion text conflicts. The two CMC candidates stay outside the denominator because the owner publishes neither exact row manifests nor stable inclusion keys, so they fail R1 and R3. Taiwan stays out because the roster owner and award operator differ and both sources reserve rights. JAC stays out because permission is required, no formal award or current rule was found, and the PDF has a truncated row and a conflicting row.

## Cost

This docs-only audit adds no infrastructure. Fixed monthly cost: $0.
