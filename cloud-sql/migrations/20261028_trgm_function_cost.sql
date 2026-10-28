-- Price pg_trgm's comparison functions so the planner uses trigram indexes.
--
-- pg_trgm ships these functions with the default COST 1, so the planner
-- treats a trigram compare like an equality check and judges a full scan of
-- route_search_terms (164k rows) cheaper than its GIN index. "mount stuart"
-- spent 35 s in that scan on the db-f1-micro; the index plan takes 0.27 s.
-- destination_search_rows had the same problem (6.5 s against 0.14 s).
-- COST 100 flips those plans and still lets truly broad queries ("trail"
-- matches 64% of terms) scan.
--
-- ALTER EXTENSION pg_trgm UPDATE may recreate these functions at COST 1;
-- rerun this file after any pg_trgm upgrade.
--
-- Apply manually as postgres (CI does not run migrations):
--   psql -h 127.0.0.1 -U postgres -d peaks -f cloud-sql/migrations/20261028_trgm_function_cost.sql

BEGIN;

ALTER FUNCTION public.similarity(text, text) COST 100;
ALTER FUNCTION public.similarity_op(text, text) COST 100;
ALTER FUNCTION public.similarity_dist(text, text) COST 100;
ALTER FUNCTION public.word_similarity(text, text) COST 100;
ALTER FUNCTION public.word_similarity_op(text, text) COST 100;
ALTER FUNCTION public.word_similarity_commutator_op(text, text) COST 100;
ALTER FUNCTION public.word_similarity_dist_op(text, text) COST 100;
ALTER FUNCTION public.word_similarity_dist_commutator_op(text, text) COST 100;
ALTER FUNCTION public.strict_word_similarity(text, text) COST 100;
ALTER FUNCTION public.strict_word_similarity_op(text, text) COST 100;
ALTER FUNCTION public.strict_word_similarity_commutator_op(text, text) COST 100;
ALTER FUNCTION public.strict_word_similarity_dist_op(text, text) COST 100;
ALTER FUNCTION public.strict_word_similarity_dist_commutator_op(text, text) COST 100;

COMMIT;
