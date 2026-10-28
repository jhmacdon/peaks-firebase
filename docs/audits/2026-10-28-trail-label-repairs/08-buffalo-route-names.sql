-- Reviewed titles only; backup 1793170232146. See 08-buffalo-route-names.review.json.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='180s';
DO $repair$
DECLARE c jsonb; old_hash text; kept_hash text;
BEGIN
  FOR c IN SELECT value FROM jsonb_array_elements('[{"id": "wv-catalog-10563e8b00db29d1218726fa", "name": "Buf- And Buf-Med Loop", "expected_hash": "3a2642e07e64926878885fdd71196ef1", "preserved_hash": "82eee03145db1b0e893d126fb49f42a0", "after": "Buffalo Mountain Loop via Trail 11"}, {"id": "wv-catalog-9ff041ff3229f8ae6736be67", "name": "Buf- And Buf-Easy Loop", "expected_hash": "bb53ae86436c170b87cb00f65ff6df57", "preserved_hash": "6a2c029def82452e0a2a5339511a3187", "after": "Buffalo Mountain Loop via Trail 19"}]'::jsonb) LOOP
    SELECT md5(to_jsonb(r)::text) INTO old_hash FROM routes r WHERE id=c->>'id' AND owner='peaks' AND status='active' FOR UPDATE;
    IF old_hash IS DISTINCT FROM c->>'expected_hash' THEN RAISE EXCEPTION 'Route changed since review: %',c->>'id'; END IF;
    UPDATE routes SET name=c->>'after',search_name=peaks_search_name(c->>'after'),updated_at=now() WHERE id=c->>'id';
    SELECT md5((to_jsonb(r)-ARRAY['name','search_name','updated_at'])::text) INTO kept_hash FROM routes r WHERE id=c->>'id';
    IF kept_hash IS DISTINCT FROM c->>'preserved_hash' THEN RAISE EXCEPTION 'Non-name route data changed: %',c->>'id'; END IF;
    IF (SELECT name FROM routes WHERE id=c->>'id') IS DISTINCT FROM c->>'after' THEN RAISE EXCEPTION 'Route name did not match'; END IF;
  END LOOP;
END $repair$;
SELECT jsonb_build_object('id',id,'name',name,'search_name',search_name,'preserved_hash',md5((to_jsonb(r)-ARRAY['name','search_name','updated_at'])::text)) FROM routes r WHERE id IN ('wv-catalog-10563e8b00db29d1218726fa','wv-catalog-9ff041ff3229f8ae6736be67') ORDER BY id;
COMMIT;
