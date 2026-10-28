-- Commit the enum addition before glacier DDL or data. Run as postgres.
ALTER TYPE public.destination_feature ADD VALUE IF NOT EXISTS 'glacier';
