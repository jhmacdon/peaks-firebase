# Trail stretch names

The trail graph used glacier polygons to set terrain type, then chose the display
name from the path's trail names. This produced rows such as “Three Fingers summit
trail · Glacier.” The app folds adjacent segments only when both name and kind
match, so a trail crossing ice could repeat the trail name four times.

The importer now keeps the containing polygon's name and OSM ID in the offline
segment manifest. Named ice uses that name. Unnamed ice uses “Glacier Crossing” or
“Snowfield Crossing.” An unnamed member way cannot hide its named multipolygon;
conflicting polygon names keep the generic crossing label. Short terrain features
keep their names during smoothing. Reviewed display names still take precedence.
Trail aliases remain available for search. The stored provenance schema is unchanged.

## Run the audit

From `cloud-sql/migrate`, after `npm ci`:

```sh
mkdir -p .cache/stretch-audit
npm run audit:trail-stretch-names -- \
  --snapshot .cache/stretch-audit/snapshot.ndjson \
  --output .cache/stretch-audit/report.json
```

The command uses `cloud-sql/scripts/peaks-psql` in a repeatable-read, read-only
transaction. It scans every Peaks-owned active and pending route, including those
without segments. It reads labels and links, not paths or private session data.
Each table is read once; the command assembles route records locally. The query
fetches 5,000 rows at a time, limits each fetch to five minutes, and uses at most
one database worker. The whole snapshot has a twenty-minute limit. Existing output
files cause an error rather than an overwrite.

Recheck a saved snapshot without database access:

```sh
npm run audit:trail-stretch-names -- \
  --input .cache/stretch-audit/snapshot.ndjson \
  --output .cache/stretch-audit/rechecked.json
```

The report includes a snapshot hash, route and segment counts, and every affected
route ID, segment ID, ordinal, name, and kind. Findings are review candidates:

| Finding | Review |
| --- | --- |
| `ice_named_as_trail` | Ice has a trail, path, or road label. Check its source polygon. |
| `ice_uses_path_name` | Ice takes a path alias without an ice or crossing label. Check whether the name describes the crossing. |
| `name_repeated_across_kinds` | One name repeats across terrain changes. Keep the terrain changes, then review each label. |
| `adjacent_name_variants` | Adjacent labels differ only by case or spacing. Use one spelling. |
| `adjacent_trail_aliases` | Different adjacent trail labels share a source alias. Confirm whether they describe one stretch. |
| `unnamed_ice` | The app has no display name for an ice crossing. |
| `missing_segments`, `missing_segment` | Segment labels cannot be checked. Section counts identify routes with a separate section model. |

Same-name, same-kind source splits already fold to one app row and do not trigger
a duplicate finding. A later return to a trail also remains valid. No rule merges
glacier or scramble stretches into ordinary trail, guesses a glacier name, or
changes production data.

## Review and repair

The scan checks stored labels, not whether a glacier boundary or trail identity is
correct on the ground. Use source geometry and current evidence before changing
names. Rebuild future manifests with the naming fix. Existing rows need a separate,
reviewed repair: importers preserve existing segment rows, and frozen or reviewed
segments must not be overwritten by an ordinary import.

For a repair, retain the before/after names, affected shared routes, source evidence,
and a rerun of this audit. Take the required database backup before any bulk write.
This audit and importer change add no service or recurring infrastructure cost.
