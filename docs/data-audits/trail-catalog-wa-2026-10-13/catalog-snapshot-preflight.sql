-- Current catalog snapshot for all 21 candidates; manifest SHA-256: f5d01dacc488efe8bcf10a483a9afe515ba377daa2700009b00f31cf15ce10c5
-- Read only, 32 bound destination IDs. No route or segment geometry reads.
-- The bounded lake polygons are required for exact shore contact checks.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
BEGIN READ ONLY;
SET LOCAL statement_timeout = '25s';
SET LOCAL lock_timeout = '2s';
WITH wanted(id) AS MATERIALIZED (VALUES
  ('0kwic89q2UWPLE6jGyk0'),
  ('1755CBB232F3FCC6A437'),
  ('3F941B9F4262007D704D'),
  ('4EDA7A56C36153040635'),
  ('4F56621F3FF823F6A480'),
  ('5hVnUW4tmqj3A6YbU0oB'),
  ('6D0E779FF39C5B648D6B'),
  ('7F9130E5AAEC9213E123'),
  ('7etiVGkvGugHxmFja3xK'),
  ('7mdR4I31n8VQQdPVN5Nd'),
  ('8gW9WZ6tngvhNn0TIDpc'),
  ('9B40DE76DC0878A92331'),
  ('9ofuJq1VreK93jZgCjcF'),
  ('C21AD354B7FEA99C277F'),
  ('DiZjSucepuEsfCtfKw6F'),
  ('E65jXwR5gzXhiQc4ak6l'),
  ('FF006293EBCD1BBDA398'),
  ('FLFBZ7rDLOFHPlUn9TMI'),
  ('GHg65nKUeQhQU3D9A7ie'),
  ('RedSHjLLfieFAySd8gFZ'),
  ('StXAAUitgEK1WrECejNX'),
  ('Vm0gOD6OdjW4lQmHn0Fj'),
  ('Yfu5QdaOWeuxpSXiN5rK'),
  ('b5keGEdwDwFwkodbuwaq'),
  ('htqW9lCp974x1tEWD8t7'),
  ('iAD3EhqmkKVKXBjJjprj'),
  ('kQJLnN0L4ee8fL0ig1Xb'),
  ('nSf6z4vL0zjdG2sXibBM'),
  ('oPjIYQZRJoeTSxvofmZj'),
  ('oXomNSntgwhCMyHqrFMA'),
  ('rQKXSjXerrmfQpTLAWbM'),
  ('xHaYBgzoxgfAZNLTfWid')
), selected AS MATERIALIZED (
  SELECT d.id,d.name,d.features::text[] AS features,d.state_code AS "stateCode",
    d.country_code AS "countryCode",ST_Y(d.location::geometry) AS lat,
    ST_X(d.location::geometry) AS lng,d.elevation,d.external_ids,
    ST_AsGeoJSON(d.boundary::geometry,15)::json AS boundary,
    (NULLIF(btrim(d.hero_image),'') IS NOT NULL
     AND NULLIF(btrim(d.hero_image_attribution),'') IS NOT NULL
     AND NULLIF(btrim(d.hero_image_attribution_url),'') IS NOT NULL) AS credited_cover
  FROM wanted JOIN destinations d USING(id)
)
SELECT jsonb_build_object('type','catalog_snapshot','manifestSha256','f5d01dacc488efe8bcf10a483a9afe515ba377daa2700009b00f31cf15ce10c5',
  'snapshotAt',transaction_timestamp(),'requestedCount',(SELECT count(*) FROM wanted),
  'returnedCount',(SELECT count(*) FROM selected),
  'missingIds',COALESCE((SELECT jsonb_agg(w.id ORDER BY w.id) FROM wanted w LEFT JOIN selected d USING(id) WHERE d.id IS NULL),'[]'::jsonb),
  'places',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM selected d),'[]'::jsonb));
ROLLBACK;
