BEGIN;

CREATE TABLE IF NOT EXISTS destination_photo_candidates (
    id              TEXT PRIMARY KEY,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    image_url       TEXT NOT NULL CHECK (image_url ~ '^https://[^[:space:]]+$'),
    source_page_url TEXT NOT NULL CHECK (source_page_url ~ '^https://[^[:space:]]+$'),
    source_kind     TEXT NOT NULL CHECK (btrim(source_kind) <> ''),
    photographer    TEXT NOT NULL CHECK (btrim(photographer) <> ''),
    license_name    TEXT NOT NULL CHECK (btrim(license_name) <> ''),
    license_url     TEXT NOT NULL CHECK (license_url ~ '^https://[^[:space:]]+$'),
    image_width     INT CHECK (image_width IS NULL OR image_width > 0),
    image_height    INT CHECK (image_height IS NULL OR image_height > 0),
    focal_x         SMALLINT NOT NULL DEFAULT 50 CHECK (focal_x BETWEEN 0 AND 100),
    focal_y         SMALLINT NOT NULL DEFAULT 50 CHECK (focal_y BETWEEN 0 AND 100),
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'denied')),
    final_image_url TEXT,
    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,
    review_note     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (destination_id, source_page_url),
    CHECK (
      (status = 'pending'
        AND final_image_url IS NULL
        AND reviewed_by IS NULL
        AND reviewed_at IS NULL)
      OR
      (status = 'approved'
        AND final_image_url IS NOT NULL
        AND reviewed_by IS NOT NULL
        AND reviewed_at IS NOT NULL)
      OR
      (status = 'denied'
        AND final_image_url IS NULL
        AND reviewed_by IS NOT NULL
        AND reviewed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_destination_photo_candidates_review_queue
    ON destination_photo_candidates (status, created_at, id);

COMMIT;
