# Route start access

How a hiker reaches the start of a route: by car, by lift, or by public
transport. The app offers car directions only to a parking start. For a lift or
transit start it says "Take the cable car to Säntis" and links to a timetable.

## Where it lives

On the route's start destination (the one with the `trailhead` feature), in
`destinations.metadata.start_access`. For a lift or transit start, that
destination is the station where the hike begins: the stop you ride **to**,
such as the Säntis summit station at the top of the cable car, not the valley
station you board at. `station_name` names that stop, and it is the stop the
app searches a timetable for.

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
- `lift`: you reach the start by passenger aerial lift or funicular; the start
  is its arrival station. Use mode `cable_car`, `gondola`, `chair_lift` or
  `funicular`.
- `transit`: you reach the start by scheduled public transport; the start is
  the stop you get off at. Use mode `train`, `bus`, `tram`, `boat`, or
  `funicular` for a funicular in the rail timetable.
- `station_name` is that arrival stop's name as the timetable knows it. In
  Switzerland prefer the OSM `uic_name` over `name` when the two differ: the
  app searches the SBB timetable for it. When null, the app uses the
  destination's name.
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
and always sends the key: the object above, or `null` for no value. Route
destination rows also carry `country_code`, which picks the timetable. No
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
| `lift` | Take the cable car to Säntis | Timetable (SBB) or Transit |
| `transit` | Take the train to Lauterbrunnen | Timetable (SBB) or Transit |

For a start in Switzerland or Liechtenstein, Timetable opens
`https://www.sbb.ch/<lang>?nach=<station_name>`, which fills the SBB "To" field
with the arrival stop and leaves "From" to the rider (checked 2026-10-24;
`?stop=` is ignored). `<lang>` is `de`, `fr`, `it` or `en`, from the phone's
first preferred language. Elsewhere, or with no stop name, the action reads
Transit and opens transit directions to the start in the user's maps app.
