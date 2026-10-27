# Route air quality

`GET /api/routes/:id/air-quality` returns the same forecast JSON as
`GET /api/plans/:id/air-quality`, with `planDate: null` and no flagged trip day.
The iOS route page can pass it to its existing air-quality card.

The endpoint accepts signed-out catalog reads under the existing 120 requests
per minute limit. Active catalog routes, owners, and plan party members use the
same access rules as route detail. Missing or hidden routes return HTTP 404.
Other methods still require auth.

The forecast point is the start of the route path. A route with no path uses its
first visible linked destination, in route order. A route with no point returns
`{ "available": false, "reason": "no_location" }`. When both forecast sources
are empty, the response uses `reason: "upstream_unavailable"`.

Route and plan requests share the existing 3 km grid cells, stored HRRR smoke
rows, one-hour CAMS cache, and forecast merge. This adds about $0/month in fixed
cost. Request volume adds small database and network work; there is no new
service, schedule, minimum instance, or CPU setting. The current smoke job
samples plan cells, so a route with no stored HRRR cell uses CAMS alone.
