-- Allow a keeper list to require a stated subset of its full roster, such as
-- 13 of 18 peaks. NULL keeps the existing rule: every current member counts.
--
-- The target cannot be checked against list_destinations with a row CHECK
-- constraint because imports create the list before they create its members.
-- All reads therefore pass the stored value and current member count through
-- effective_list_completion_target(). A missing, non-positive, or stale value
-- above the member count falls back to all current members.
--
-- Cost impact: $0/month. This adds one nullable integer and an immutable SQL
-- helper; it adds no service, instance, scheduler, or always-on work.

BEGIN;

ALTER TABLE lists
    ADD COLUMN IF NOT EXISTS completion_target INT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'lists_completion_target_positive'
          AND conrelid = 'lists'::regclass
    ) THEN
        ALTER TABLE lists
            ADD CONSTRAINT lists_completion_target_positive
            CHECK (completion_target IS NULL OR completion_target > 0);
    END IF;
END;
$$;

COMMENT ON COLUMN lists.completion_target IS
    'Required member count; NULL means every current list member is required';

CREATE OR REPLACE FUNCTION effective_list_completion_target(
    configured_target INT,
    member_count INT
)
RETURNS INT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE
        WHEN GREATEST(COALESCE(member_count, 0), 0) = 0 THEN 0
        WHEN configured_target BETWEEN 1 AND GREATEST(COALESCE(member_count, 0), 0)
            THEN configured_target
        ELSE GREATEST(COALESCE(member_count, 0), 0)
    END;
$$;

COMMENT ON FUNCTION effective_list_completion_target(INT, INT) IS
    'Returns a bounded list completion target; invalid or NULL targets require all current members';

COMMIT;
