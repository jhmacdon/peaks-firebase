# Recreation.gov campground links

Peaks uses the public Recreation Information Database (RIDB) facility API to
link existing campground records to their exact Recreation.gov pages. This
pass imports stable facility IDs only. It does not copy descriptions, photos,
amenities, campsite rows, or live availability.

Set `RIDB_API_KEY` in the shell. Never commit or print the key. A local API
snapshot can replace the live API with `--source=/path/to/facilities.json`.

Run a dry audit from `cloud-sql/migrate`:

```sh
npm run backfill:recreation-gov-campgrounds -- --report=/tmp/ridb-audit.json
```

The audit proposes a match only when one reservable RIDB campground has the
same normalized name and lies within 5 km of an existing Peaks campsite. It
holds all other nearby rows for review.

Copy approved matches into a versioned review file:

```json
{
  "version": 1,
  "matches": [
    {
      "destinationId": "destination-id",
      "destinationName": "Campground name in Peaks",
      "ridbFacilityId": "232459",
      "facilityName": "Campground name in RIDB"
    }
  ]
}
```

Preview the reviewed plan, then apply it:

```sh
npm run backfill:recreation-gov-campgrounds -- --review=/path/to/review.json
npm run backfill:recreation-gov-campgrounds -- --review=/path/to/review.json --apply
```

The apply step changes only `external_ids.ridb_facility`. It keeps all names,
locations, shapes, elevations, amenities, and other IDs. It stops if a source
or target name changed, a match lies more than 5 km apart, an ID conflicts, or
the target changed after validation. A second run makes no changes.

The clients turn each stored ID into
`https://www.recreation.gov/camping/campgrounds/{id}` and label it as an
availability check. Peaks does not claim that a date or site is available.

This manual import adds no service, job, secret, or always-on process. Added
run-rate: **$0/month**.
