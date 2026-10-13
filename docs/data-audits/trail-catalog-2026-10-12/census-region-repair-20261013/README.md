# Census region repair proposal

Four existing destinations can receive `country_code=US` and `state_code=WA` from the [Census TIGERweb States layer](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0). The layer uses the January 1, 2026 vintage. This proposal changes administrative metadata at the saved coordinates. It does not establish route geometry or publication readiness.

| Destination | ID | Approximate distance inside the state boundary |
| --- | --- | ---: |
| Climbers Bivouac Trailhead | `Ndsk2Ad2F6r9sXR8cK0m` | 52.75 km |
| Mount Saint Helens | `6PxfQ1g48SrbplzGd6UH` | 54.06 km |
| Cascade Pass Trailhead | `YtzjvQqup3gqmAYnz0l4` | 58.35 km |
| Sahale Peak | `APWWTYFkwvuUFc3TP1m9` | 56.61 km |

Each exact point query returned one state, Washington. [Source receipts](source-requests.json) record the complete request URLs, retrieval times, SHA-256 hashes, and selected public response headers. The saved [state polygon](washington-state.geojson) supplies an independent local containment check. The verifier rejects a point outside the polygon or within 5 km of an edge; that review margin is not a claim about Census accuracy. Distances use a local equirectangular approximation. No response requests simplified geometry or rounded coordinates.

[proposal.json](proposal.json) lists the exact four proposed changes and all 72 destinations outside this US-only repair scope. [linked-region-preflight.txt](linked-region-preflight.txt) records the 38 route checks: each has exactly two linked destinations; all 76 destinations lack a state code, and no route has a stored region. A country from at least one endpoint remains available for 36 routes. No other linked place supplies a missing state.

From this directory, run `python3 verify-evidence.py > /dev/null` to verify every source hash, the request-to-coordinate bindings, unique Census results, local containment, and the saved proposal. The script makes no network or database requests. Fetch the exact receipt URLs to collect a new source snapshot; keep the current files unchanged.

[repair-plan.sql](repair-plan.sql) defaults to a rolled-back transaction. An operator must review the evidence and rollback results before passing `-v apply_region_repair=true` to psql. The plan locks the four IDs in order, requires the saved name, coordinates, features, and external IDs, and rejects changed region values or a conflicting source record. It merges one source record into existing metadata and preserves every other field. A repeat with the same result and evidence makes no updates. The existing triggers remain enabled.

After an approved destination repair, run the normal reviewed metadata CLI for `8To4Xn3jQ1GJXQWMuj0m` and `adeCrmBWh2nHbbSH9btr`. The old plans stopped at the missing region before checking path timing, so a new run may expose another blocker. This proposal does not apply or bypass that step.

The SQL has not run against production. It adds no service, job, index, or ongoing cost; expected fixed cost change is $0/month.
