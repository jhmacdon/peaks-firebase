# Luna route candidates

The scheduled route worker writes one current candidate here as
`<destination-id>.geojson`.

The durable queue also stores the candidate JSON and SHA-256 checksum. A later
run must restore the saved copy with `routes:jobs materialize` before import.
Raw source pages, GPX files, OSM XML, map images, and terrain tiles do not belong
in this directory or in git. GeoJSON files in this worker folder are ignored so
scheduled runs do not dirty the checkout.
