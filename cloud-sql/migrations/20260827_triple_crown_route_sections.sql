-- Human-scale divisions for long catalog routes. Coverage fractions share the
-- same one-way route domain as session_routes.covered_intervals, so the app can
-- show stable section progress without downloading or re-matching track data.

CREATE TABLE IF NOT EXISTS route_sections (
    route_id        TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    section_id      TEXT NOT NULL,
    ordinal         INT NOT NULL,
    label           TEXT NOT NULL CHECK (btrim(label) <> ''),
    region          TEXT,
    detail          TEXT,
    start_fraction  DOUBLE PRECISION NOT NULL CHECK (start_fraction >= 0 AND start_fraction < 1),
    end_fraction    DOUBLE PRECISION NOT NULL CHECK (end_fraction > 0 AND end_fraction <= 1),
    PRIMARY KEY (route_id, section_id),
    UNIQUE (route_id, ordinal),
    CHECK (end_fraction > start_fraction)
);

GRANT SELECT ON route_sections TO "peaks-api";
