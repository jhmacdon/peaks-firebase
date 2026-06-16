-- Fast token-prefix search for short destination queries such as "ra" -> Rainier
-- and "k2" -> K2. Used only by the /api/search 2-character query path.
CREATE INDEX IF NOT EXISTS idx_destinations_search_name_fts
ON destinations
USING GIN (
  to_tsvector('simple', COALESCE(NULLIF(search_name, ''), lower(name)))
);
