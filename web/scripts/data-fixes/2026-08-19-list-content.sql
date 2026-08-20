-- Data fix: two list-content typos found in the 2026-08-19 self-audit
-- (web/docs/audits/2026-08-19-peaks-self-audit.md, section 2 "/lists").
--
-- NOT executed by any script or CI step. This file is a reviewed-by-hand
-- fix a human runs manually against prod with psql. No prod database writes
-- happen as part of implementing this task.
--
-- 1. "The Seven Summits" description misspells Mount Kościuszko (the peak
--    the Messner list omits in favor of Puncak Jaya) as "Kosiuszko".
-- 2. The "Ultras Of Iran" list name has the wrong case on "Of" — should
--    read "Ultras of Iran", matching sentence-case list naming elsewhere
--    (e.g. "Ultras of the Contiguous United States").
--
-- IDs pinned from the live catalog (getpeaks.app, checked 2026-08-19) and
-- guarded with a matching current name, so this fails safe (0 rows
-- affected) rather than misfiring if either row has since changed.

BEGIN;

UPDATE lists
SET description = REPLACE(description, 'Kosiuszko', 'Kościuszko')
WHERE id = 'hPNDxe5mvtLjtlTnWlnf'
  AND name = 'The Seven Summits'
  AND description LIKE '%Kosiuszko%';

UPDATE lists
SET name = 'Ultras of Iran'
WHERE id = 'cJb67d0QVHo9F7qSLUGi'
  AND name = 'Ultras Of Iran';

COMMIT;

-- Verify before/after:
--   SELECT id, name, description FROM lists WHERE id IN ('hPNDxe5mvtLjtlTnWlnf', 'cJb67d0QVHo9F7qSLUGi');
