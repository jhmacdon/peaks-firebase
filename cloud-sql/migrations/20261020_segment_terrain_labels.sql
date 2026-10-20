-- Why a segment carries a terrain kind: one row per relabel or split piece
-- written by `terrain:apply`. Segment provenance stays source credit only
-- (is_valid_route_provenance), so the review evidence lives here.
-- No foreign key: a later split deletes the segment, and the record should
-- outlive it.
CREATE TABLE IF NOT EXISTS segment_terrain_labels (
  id BIGSERIAL PRIMARY KEY,
  segment_id TEXT NOT NULL,
  parent_segment_id TEXT,
  route_id TEXT NOT NULL,
  from_kind TEXT,
  kind TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_by TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources) = 'array'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS segment_terrain_labels_segment ON segment_terrain_labels (segment_id);
GRANT SELECT, INSERT ON segment_terrain_labels TO "peaks-api";
GRANT USAGE ON SEQUENCE segment_terrain_labels_id_seq TO "peaks-api";
