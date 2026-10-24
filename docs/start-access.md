# Route start access

How a hiker reaches the start of a route: by car, by lift, or by public
transport. The app offers car directions only to a parking start. For a lift or
transit start it says "Take the cable car to Säntis" and links to a timetable.

## Where it lives

On the route's start destination (the one with the `trailhead` feature), in
`destinations.metadata.start_access`:

```json
{
  "kind": "lift",
  "mode": "cable_car",
  "station_name": "Säntis",
  "operator": "Säntis-Schwebebahn AG"
}
```

| Field | Type | Values |
|---|---|---|
| `kind` | string, required | `parking`, `lift`, `transit` |
| `mode` | string or null | `train`, `bus`, `tram`, `boat`, `cable_car`, `gondola`, `funicular`, `chair_lift` |
| `station_name` | string or null | The stop name as the timetable spells it |
| `operator` | string or null | Who runs the line, for display only |

Rules:

- **A missing value means parking.** Every route loaded before this field
  existed keeps its car directions. Write nothing for a parking start, or
  `{"kind": "parking"}`.
- `lift` is a passenger aerial lift or funicular that leaves from the start.
  Use mode `cable_car`, `gondola`, `chair_lift` or `funicular`.
- `transit` is a scheduled public stop. Use mode `train`, `bus`, `tram`,
  `boat`, or `funicular` for a funicular in the rail timetable.
- `station_name` is the name the timetable knows. In Switzerland prefer the
  OSM `uic_name` over `name` when the two differ: the app searches the SBB
  timetable with it. When null, the app uses the destination's name.
- `mode: null` is allowed but weaker: the app then says "Take the lift" or
  "Take public transport". An unknown mode is served as null; the kind stays.
- An unknown `kind` is served as null, so the app falls back to parking. Do not
  write one.

## API

`start_access` is a typed field on every destination row in:

- `GET /api/routes/:id/destinations`
- `GET /api/routes/:id` (the embedded `destinations` array)
- `GET /api/destinations/:id`

The API validates the stored value (`cloud-sql/api/src/lib/start-access.ts`)
and always sends the key: the object above, or `null` for no value. No
migration is needed; `metadata` is an existing JSONB column.

## Mapping from the trail-graph loader

The Swiss loader records `source.start_type` in `metadata.resolution`
(`cloud-sql/migrate/src/trail-graph/start-access.ts` on
`feat/trail-graph-europe`). Write `start_access` beside it on each new start
destination:

| `start_type` | `kind` | `mode` |
|---|---|---|
| `parking`, `road_contact` | `parking` (or omit) | null |
| `train_station` | `transit` | `train`; `tram` when the station's `railway=tram_stop`; `funicular` when `station=funicular` |
| `bus_stop` | `transit` | `bus` |
| `boat_stop` | `transit` | `boat` |
| `cable_car_station` | `lift` | `cable_car` |
| `lift_station` | `lift` | from the line's `aerialway`: `cable_car`, `gondola`; `chair_lift` for `chair_lift` and `mixed_lift` |

`station_name` comes from the station's `uic_name`, else the access point's
name. `operator` comes from the station's `operator` tag, else the line's.

## What the app does

| `kind` | Copy | Action |
|---|---|---|
| `parking` or null | Directions | Driving directions in the user's maps app |
| `lift` | Take the cable car to Säntis | Timetable |
| `transit` | Take the train to Lauterbrunnen | Timetable |

For a start in Switzerland or Liechtenstein, Timetable opens
`https://www.sbb.ch/en?nach=<station_name>`, which fills the SBB "To" field
(checked 2026-10-24; `?stop=` is ignored). Elsewhere it opens transit directions
to the start in the user's maps app.
