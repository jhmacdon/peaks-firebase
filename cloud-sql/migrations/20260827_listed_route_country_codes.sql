-- Country bindings for listed summits that would otherwise be unable to use
-- the official-source route workflow. Reviewed against their stored list
-- membership and coordinates on 2026-08-27. This is a data-only change with
-- no backend run-rate cost.

BEGIN;

CREATE TEMP TABLE reviewed_listed_route_country_codes (
  destination_id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$')
) ON COMMIT DROP;

INSERT INTO reviewed_listed_route_country_codes (
  destination_id,
  country_code
) VALUES
  ('34KEavCCcuUNZWv8UuY6', 'CA'),
  ('0pxrv7Pm5FJQfJanDNY1', 'IR'),
  ('1dDdyZXsnRTJDVlcoWP0', 'IR'),
  ('2u2g8D6u8T3iXlOwLWTS', 'IR'),
  ('4M1uxgffOf6kuT4NLcbk', 'IR'),
  ('8RtxmvglalqMYeuCTLvS', 'IR'),
  ('a2oDS7QqaovFBlRCiGXO', 'IR'),
  ('a8LDD6QexdP1INgsBfc9', 'IR'),
  ('AecjDeJD9luk8ChKnNRz', 'IR'),
  ('ajwwC13Orb2BIxQTD6qF', 'IR'),
  ('B8wLc86X1ZoD5O3nBmiW', 'IR'),
  ('CHweaKLg1fGcpoci1Gx4', 'IR'),
  ('crUbc3USP003iV9Xdoe6', 'IR'),
  ('EACILOFqUz1ItCxH6deY', 'IR'),
  ('EvitlqYB5Kbthk5tGhJN', 'IR'),
  ('f6mP432tM7NlSR5E6nMU', 'IR'),
  ('FLGHATRKL1TXqqmZeBM2', 'IR'),
  ('FZI7lrBAgnsJdFKJfnQO', 'IR'),
  ('G2QqtuyuwkUVnl0FYA3W', 'IR'),
  ('gCZ5rOAHOekawEpPRolg', 'IR'),
  ('GtJ1pwABZk5wYzk0d74x', 'IR'),
  ('GyDlhnelCmu7uDbRnzHW', 'IR'),
  ('h3RoFTzS6l3CqrPo6S9G', 'IR'),
  ('hEz7Y1XeIKotKNR69lCt', 'IR'),
  ('HPip0yjU22m0WxF8tpWi', 'IR'),
  ('HrhwKWmyn75o4znDus62', 'IR'),
  ('JNWY3TH4NE3OndN8DLcN', 'IR'),
  ('jTv9y4Sq7TvtiDAXwS4e', 'IR'),
  ('jV1NV38NQFieTvJqUv6o', 'IR'),
  ('MEiToXwMuoUOcvrpDI3A', 'IR'),
  ('Mu45hKnSTkJyZQLoGm7k', 'IR'),
  ('MxosdDRtDUlE15F21eCv', 'IR'),
  ('nbvhhDMiwOu4Z1g58JzS', 'IR'),
  ('OifnoEQLZ6g3rEFkHt6U', 'IR'),
  ('p7pnGUGjaQvuDmnG3y1F', 'IR'),
  ('PAmHvi1mN0ipLttrgT8n', 'IR'),
  ('QdRNXQjwbfsbCyO6kF95', 'IR'),
  ('rtFqaEtaxIVqlYmeuJZB', 'IR'),
  ('TIyWbKHq15Fnebqr3znZ', 'IR'),
  ('twQw4he9wS0drW2UOVeL', 'IR'),
  ('U8qYesc5tGYjBThlOO6R', 'IR'),
  ('VHx0GGHpY7bhXTNPsfFm', 'IR'),
  ('Vn5IPC5YV4VDkdfndqoD', 'IR'),
  ('WhaNiU908JVsLn1hBYqx', 'IR'),
  ('wptEwJanIeR2Ra1crRgF', 'IR'),
  ('wtCfBhfLUOO4FWvEpiyZ', 'IR'),
  ('xXBFERkogjok3tsBDB1I', 'IR'),
  ('YxIWrDP7na2dauKyKSss', 'IR'),
  ('ZrestpxHEZThYALKinc1', 'IR'),
  ('1T9eHiZHOtYpxegzsLfa', 'US'),
  ('3emaF4pUfokHJww9Szmq', 'US'),
  ('3rQsILBFZmHbfKaFIXUp', 'US'),
  ('4OScQ3BILWrz102KUBqK', 'US'),
  ('6PxfQ1g48SrbplzGd6UH', 'US'),
  ('6s9CmQr2yMvzNfVJEIYg', 'US'),
  ('81R5i2lkUjv00DZ7RWGZ', 'US'),
  ('9kaCDHKOy2e3iUXLnJCt', 'US'),
  ('9tG5PRGWHnMyoCRIbvx5', 'US'),
  ('Aby3Le6Og0IrHQd2Y028', 'US'),
  ('ALqz9FFNmjlxUy3I0D8t', 'US'),
  ('AO7D7nRZCWNIsEfCiX0q', 'US'),
  ('APWWTYFkwvuUFc3TP1m9', 'US'),
  ('auJp6P3XMRtdqqlrfuK4', 'US'),
  ('BNOf7VQlQTGgaFAoQR9m', 'US'),
  ('cN9ut8s5QFAEfZk3x4pR', 'US'),
  ('DktIYsKS7FSC6nfKl7D2', 'US'),
  ('dZSVuW8UKm6ew42jKNtk', 'US'),
  ('ezbmyiogBEtXfr1u8Efn', 'US'),
  ('fhwF42r3wqqGqWRnTxYO', 'US'),
  ('FiE3SJrTIGZ65AvKJWir', 'US'),
  ('fqmRerhNxOiGSz6zwk0v', 'US'),
  ('H9qZwk8ZT0trQrC3cVYp', 'US'),
  ('hx7c0VtKJPgBIa8RXc0U', 'US'),
  ('jdMjIuB0srR0zCnWgkVK', 'US'),
  ('Kn5GarPOyjoLF2FLD8y8', 'US'),
  ('n2KmRVKY4mJUT06CR5Gz', 'US'),
  ('olUVpqTDVciqg3oY0Qcd', 'US'),
  ('Ov5BdqX0NIMsUqzWbOeT', 'US'),
  ('p8tLTkJdGMQ99RcUM4L7', 'US'),
  ('qLCxTqGIZZjRp3b85lLn', 'US'),
  ('QrFfAL0tnfDpdRYCIQDG', 'US'),
  ('r8BbID4eb58zpo65zd2x', 'US'),
  ('RuYF0uc8HhdOht3gfLI6', 'US'),
  ('Sid1mcxRpH8eU8U4pCmi', 'US'),
  ('tVyKW5iRVH1SOWwIgPDv', 'US'),
  ('wACJ8afoa5oXlaevB2NV', 'US'),
  ('WTvp1YylonOWs96fWy2B', 'US'),
  ('XFB1gLqHWRTXXyyxwXfQ', 'US'),
  ('xsH3VSb4bBgTHh9WgI6q', 'US'),
  ('xsqwv3NzPTOsOzgnXfvm', 'US'),
  ('y9O6V8RMMjsALvJlSXRF', 'US');

DO $$
BEGIN
  IF (SELECT count(*) FROM reviewed_listed_route_country_codes) <> 91
     OR (SELECT count(*) FROM reviewed_listed_route_country_codes
         WHERE country_code = 'CA') <> 1
     OR (SELECT count(*) FROM reviewed_listed_route_country_codes
         WHERE country_code = 'IR') <> 48
     OR (SELECT count(*) FROM reviewed_listed_route_country_codes
         WHERE country_code = 'US') <> 42 THEN
    RAISE EXCEPTION 'listed route country review set is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM reviewed_listed_route_country_codes reviewed
    LEFT JOIN destinations destination
      ON destination.id = reviewed.destination_id
    WHERE destination.id IS NULL
  ) THEN
    RAISE EXCEPTION 'listed route country review references missing catalog destinations: %',
      (
        SELECT string_agg(reviewed.destination_id, ', ' ORDER BY reviewed.destination_id)
        FROM reviewed_listed_route_country_codes reviewed
        LEFT JOIN destinations destination
          ON destination.id = reviewed.destination_id
        WHERE destination.id IS NULL
      );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM destinations destination
    JOIN reviewed_listed_route_country_codes reviewed
      ON reviewed.destination_id = destination.id
    WHERE destination.location IS NULL
       OR (
         reviewed.country_code = 'CA'
         AND NOT ST_DWithin(
           destination.location,
           ST_GeogFromText('SRID=4326;POINT(-123.004672 49.850562)'),
           10000
         )
       )
       OR (
         reviewed.country_code = 'IR'
         AND NOT (
           ST_Y(destination.location::geometry) BETWEEN 24 AND 40
           AND ST_X(destination.location::geometry) BETWEEN 44 AND 64
         )
       )
       OR (
         reviewed.country_code = 'US'
         AND NOT (
           ST_Y(destination.location::geometry) BETWEEN 18 AND 50
           AND ST_X(destination.location::geometry) BETWEEN -157 AND -72
         )
       )
  ) THEN
    RAISE EXCEPTION 'listed route country review no longer matches catalog coordinates';
  END IF;
END
$$;

UPDATE destinations destination
SET country_code = reviewed.country_code,
    updated_at = now()
FROM reviewed_listed_route_country_codes reviewed
WHERE destination.id = reviewed.destination_id
  AND (
    destination.country_code IS NULL
    OR upper(btrim(destination.country_code)) !~ '^[A-Z]{2}$'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM destinations destination
    JOIN reviewed_listed_route_country_codes reviewed
      ON reviewed.destination_id = destination.id
    WHERE upper(btrim(destination.country_code))
      IS DISTINCT FROM reviewed.country_code
  ) THEN
    RAISE EXCEPTION 'listed route country code repair did not converge';
  END IF;
END
$$;

COMMIT;
