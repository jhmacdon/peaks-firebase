-- Spell out "Mt", "Mtn" and "Pk" in catalog names, merge the two duplicates
-- they created, and stop abbreviated names from coming back.
--
-- Josiah, 2026-10-13: Peaks never shows the abbreviated form. An audit of prod
-- found 53 Peaks-owned destinations, 11 PAD-US areas and 3 current catalog
-- routes with an abbreviation, and two viewpoint rows ("Mt Tom", "Mt Nonotuck")
-- sitting 29 m and 8 m from the summit rows of the same place. User-created
-- destinations and personal routes are the owner's own words and stay as typed.
-- "St" is left alone: it is the official form in many names ("Mount St.
-- Helens", "St Sunday Crag").
--
-- "Mt" before a name is "Mount"; after a name, before a generic word, it is
-- "Mountain" ("Chimney Mt Trail"). Each row below was reviewed by hand; the OSM
-- node for "mt. SomugiYama" is 蕎麦粒山, Sobatsubu-yama.
--
-- Each update matches the saved old name, so it is a no-op where the row is
-- absent or already renamed (test databases, replays). The CHECK constraints
-- are validated last and fail the migration if any abbreviated name remains.
--
-- Cost: $0/month. Data and constraints only.

BEGIN;

CREATE OR REPLACE FUNCTION peaks_name_has_abbreviation(value TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(value, '') ~* '\m(mt|mtn|pk)(\.|\M)';
$$;

-- Search treats "mt." like "mt": drop periods before expanding abbreviations.
CREATE OR REPLACE FUNCTION peaks_search_name(value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(COALESCE(string_agg(COALESCE(
    ('{"mt":"mount","mtn":"mountain","pt":"point","st":"saint",'
     '"ft":"fort","lk":"lake","pk":"peak","cr":"creek",'
     '"crk":"creek","cyn":"canyon","jct":"junction","spgs":"springs",'
     '"spr":"spring","fk":"fork","br":"bridge","brg":"bridge",'
     '"trl":"trail","hwy":"highway","rd":"road","ne":"northeast",'
     '"nw":"northwest","se":"southeast","sw":"southwest"}'::jsonb)->>word,
    word), ' ' ORDER BY ordinal), ''))
  FROM regexp_split_to_table(lower(replace(COALESCE(value, ''), '.', '')), '[[:space:]]+')
       WITH ORDINALITY AS words(word, ordinal)
  WHERE word <> '';
$$;

CREATE TEMP TABLE name_fix (id TEXT PRIMARY KEY, old_name TEXT NOT NULL, new_name TEXT NOT NULL, new_search_name TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO name_fix VALUES
  ('6E494B36867701EAC760', '10th Mt. Div. Outlook', '10th Mountain Division Outlook', '10th mountain division outlook'),
  ('69i1SKD4yvyzCucpVP4C', 'Annapurna East Pk.', 'Annapurna East Peak', 'annapurna east peak'),
  ('BrCYO36oiJWxSwr8HXeF', 'Baltistan Pk', 'Baltistan Peak', 'baltistan peak'),
  ('4CDD7BD87CA1501897BF', 'Boalsburg & Mt. Nittany Middle School Overlook', 'Boalsburg & Mount Nittany Middle School Overlook', 'boalsburg and mount nittany middle school overlook'),
  ('D975A1C7DAD0537A658D', 'County Road 4, Chimney Mt Trail', 'County Road 4, Chimney Mountain Trail', 'county road 4 chimney mountain trail'),
  ('26D59AAD11C9F471B409', 'Hickory Nut Mt Vista', 'Hickory Nut Mountain Vista', 'hickory nut mountain vista'),
  ('A81C4BC51B698E41D1AF', 'Look at Mt Hood', 'Look at Mount Hood', 'look at mount hood'),
  ('0982859924F0666546F4', 'Lower Bald MTN Cliffs', 'Lower Bald Mountain Cliffs', 'lower bald mountain cliffs'),
  ('OfsfNT4VGFL6YHeEl2vV', 'Mt. Adams Horse Camp', 'Mount Adams Horse Camp', 'mount adams horse camp'),
  ('5PqepuXMJm3ICKUx2N4h', 'Mt. Aix Trailhead', 'Mount Aix Trailhead', 'mount aix trailhead'),
  ('480D85F568F8DE4E311E', 'Mt Ascutney', 'Mount Ascutney', 'mount ascutney'),
  ('a5FldQ2Hju8GyKa2hVNd', 'Mt. Baker', 'Mount Baker', 'mount baker'),
  ('3CA7E60D65862CD3DCC6', 'Mt. Bei', 'Mount Bei', 'mount bei'),
  ('96E67A5D6D47ED09984C', 'Mt. Climont', 'Mount Climont', 'mount climont'),
  ('5750FFCA4785EC3B8598', 'Mt. Davidson Vista Point', 'Mount Davidson Vista Point', 'mount davidson vista point'),
  ('43F09331E2312A73A1C5', 'mt diablo view point over sac river', 'Mount Diablo View Point over Sacramento River', 'mount diablo view point over sacramento river'),
  ('D3AF4E07E600BD362A68', 'Mt Hood East Side View', 'Mount Hood East Side View', 'mount hood east side view'),
  ('E09813432E55BE703809', 'Mt Hood view', 'Mount Hood View', 'mount hood view'),
  ('C13196287AC23A668C22', 'Mt Kineo Fire Tower', 'Mount Kineo Fire Tower', 'mount kineo fire tower'),
  ('71ED826DACD469B68ED8', 'Mt Kwaraha', 'Mount Kwaraha', 'mount kwaraha'),
  ('75605D6FE46DB99CC332', 'Mt. Loma', 'Mount Loma', 'mount loma'),
  ('44A5B8097007CB798514', 'Mt McKay', 'Mount McKay', 'mount mckay'),
  ('E08D1A90E41998A23D99', 'Mt. Morris Dam Overlook', 'Mount Morris Dam Overlook', 'mount morris dam overlook'),
  ('8Co7s0dv32gAegPFm5Ct', 'Mt. Muller - Rd. 3040 North Trailhead', 'Mount Muller - Road 3040 North Trailhead', 'mount muller - road 3040 north trailhead'),
  ('KUhLhWZx8RXseKcLrP18', 'Mt. Muller Trailhead - Highway 101', 'Mount Muller Trailhead - Highway 101', 'mount muller trailhead - highway 101'),
  ('3E68B8AFCB2E8122FC67', 'Mt. Nebo Overlook', 'Mount Nebo Overlook', 'mount nebo overlook'),
  ('21C94761312FDB5C449B', 'Mt Rainier Overlook', 'Mount Rainier Overlook', 'mount rainier overlook'),
  ('D5AEDC1C47E9F952C08D', 'Mt. Rainier viewpoint', 'Mount Rainier Viewpoint', 'mount rainier viewpoint'),
  ('mGRFn4tHZ6sSMvmTU1gh', 'Mt. Rose Trailhead', 'Mount Rose Trailhead', 'mount rose trailhead'),
  ('E692884FE839345B0CB2', 'Mt. Scheurmann vista', 'Mount Scheurmann Vista', 'mount scheurmann vista'),
  ('6B789F4958EA35512EB5', 'Mt Shasta View Point', 'Mount Shasta View Point', 'mount shasta view point'),
  ('FFD0A0DA52D130EF9D09', 'Mt. Skatutakee Overlook', 'Mount Skatutakee Overlook', 'mount skatutakee overlook'),
  ('E1E03FA5B8D5F92F4F6E', 'mt. SomugiYama', 'Mount Sobatsubu', 'mount sobatsubu'),
  ('C4vtFBa2md8xFHpEl2VH', 'Mt. St. Helens RV Park', 'Mount St. Helens RV Park', 'mount st helens rv park'),
  ('05E3C38220479C81C918', 'Mt. Suswa', 'Mount Suswa', 'mount suswa'),
  ('BD70C66B959B5082EF57', 'Mt Thielson Viewpoint', 'Mount Thielsen Viewpoint', 'mount thielsen viewpoint'),
  ('NDmarIpatHH98S2TtWx1', 'Mt. Townsend Lower Trailhead', 'Mount Townsend Lower Trailhead', 'mount townsend lower trailhead'),
  ('RfzFpHjI8AfW2NoNRkOm', 'Mt. Townsend Upper Trailhead', 'Mount Townsend Upper Trailhead', 'mount townsend upper trailhead'),
  ('T1fRZUpc5d2Jy2Z7OFaB', 'Mt. Walker Lower Trailhead', 'Mount Walker Lower Trailhead', 'mount walker lower trailhead'),
  ('ClTKavoCB8PJQMqglfu8', 'Mt. Walker Viewpoint Trailhead', 'Mount Walker Viewpoint Trailhead', 'mount walker viewpoint trailhead'),
  ('foeNttxUj6HF8t0Y3YcZ', 'Mt. Washington - PCT McKenzie Pass Trailhead', 'Mount Washington - PCT McKenzie Pass Trailhead', 'mount washington - pct mckenzie pass trailhead'),
  ('7C4AA74CBEBFC0BE9593', 'Mt Wise', 'Mount Wise', 'mount wise'),
  ('rW6fah8PI8EJqUVLr4Im', 'Mt. Zion/Sleepy Hollow Trailhead', 'Mount Zion/Sleepy Hollow Trailhead', 'mount zion/sleepy hollow trailhead'),
  ('45E05EBC5362AF5B7466', 'Sandlick Mtn Vista', 'Sandlick Mountain Vista', 'sandlick mountain vista'),
  ('UgRiPJ7atCMc1M2sGoaZ', 'Sumas Mtn. Outpost Cabin', 'Sumas Mountain Outpost Cabin', 'sumas mountain outpost cabin'),
  ('4D7DCA82996AEB415711', 'Thorofare Mtn Overlook', 'Thorofare Mountain Overlook', 'thorofare mountain overlook'),
  ('EB0DC499DFAB75ABBEDD', 'Upper Bald MTN Cliffs', 'Upper Bald Mountain Cliffs', 'upper bald mountain cliffs'),
  ('569D2772CD5CD3342421', 'View of Mt Hood', 'View of Mount Hood', 'view of mount hood'),
  ('6BB9BA7D4C0889AAA8B0', 'View of Mt. Hood', 'View of Mount Hood', 'view of mount hood'),
  ('34844DEA6AC2C1904C47', 'Welch Mtn Overlook', 'Welch Mountain Overlook', 'welch mountain overlook'),
  ('06D1458063AB2C9A5880', '紫雲出山 (Mt.Shiude)', '紫雲出山 (Mount Shiude)', '紫雲出山 mount shiude');

UPDATE destinations d
SET name = f.new_name, search_name = f.new_search_name
FROM name_fix f
WHERE d.id = f.id AND d.name = f.old_name AND d.owner = 'peaks';

TRUNCATE name_fix;
INSERT INTO name_fix VALUES
  ('padus-6972a9224d8df54fc034', 'Eagle Creek, Oregon (Mt. Hood Nf) Wild and Scenic River', 'Eagle Creek, Oregon (Mount Hood NF) Wild and Scenic River', 'eagle creek oregon mount hood nf wild and scenic river'),
  ('padus-767db52fdd295d9c6998', 'Mt. Baker National Forest', 'Mount Baker National Forest', 'mount baker national forest'),
  ('padus-3be171c99c0270f53121', 'Mt. Charleston Wilderness', 'Mount Charleston Wilderness', 'mount charleston wilderness'),
  ('padus-1d767155b7100bf07507', 'Mt. Hillers Wilderness Study Area', 'Mount Hillers Wilderness Study Area', 'mount hillers wilderness study area'),
  ('padus-2b1f4f4f262464c5a947', 'Mt. Hood National Forest', 'Mount Hood National Forest', 'mount hood national forest'),
  ('padus-7424b9dec712b99ebfea', 'Mt. Limbo Wilderness Study Area', 'Mount Limbo Wilderness Study Area', 'mount limbo wilderness study area'),
  ('padus-05327d7c333b3472245e', 'Mt. Moriah Wilderness', 'Mount Moriah Wilderness', 'mount moriah wilderness'),
  ('padus-27e89bc3892aead9b817', 'Mt. Pennell Wilderness Study Area', 'Mount Pennell Wilderness Study Area', 'mount pennell wilderness study area'),
  ('padus-d3e3abdc3267886479c5', 'Mt. Rose Wilderness', 'Mount Rose Wilderness', 'mount rose wilderness'),
  ('padus-083e5876d1e885df0b42', 'Mt. Shasta Wilderness', 'Mount Shasta Wilderness', 'mount shasta wilderness'),
  ('padus-64b094f24829115bf4d9', 'Mt. Wrightson Wilderness', 'Mount Wrightson Wilderness', 'mount wrightson wilderness');

UPDATE areas a
SET name = f.new_name, search_name = f.new_search_name
FROM name_fix f
WHERE a.id = f.id AND a.name = f.old_name;

-- The route trigger refreshes search_name and slug stays stable.
CREATE TEMP TABLE route_name_fix (id TEXT PRIMARY KEY, old_name TEXT NOT NULL, new_name TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO route_name_fix VALUES
  ('D3fevwtILCSZnm1ruYO8', 'Mount Columbia Mt. Harvard Columbia Traverse', 'Mount Harvard–Mount Columbia Traverse'),
  ('HOusfQaJKREXQiAoJukY', 'Mt. Dickerman Trail', 'Mount Dickerman Trail'),
  ('78PrHiPheauIk0Phmcg5', 'Mt. Pugh Trail', 'Mount Pugh Trail');

UPDATE routes r
SET name = f.new_name
FROM route_name_fix f
WHERE r.id = f.id AND r.name = f.old_name AND r.owner = 'peaks';

-- Merge each duplicate viewpoint into its summit: keep the summit row, add the
-- viewpoint feature and any external IDs, then delete the duplicate. Refuse if
-- anything references the duplicate, so no link is lost to a cascade.
CREATE TEMP TABLE destination_merge (duplicate_id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO destination_merge VALUES
  ('42CA4D9FE5F7BB08B04E', '921FB1A80672059BBED0'),
  ('E5B2FBC336C7152AD98A', 'F9D606C0D53ED3730AD0');

DO $$
DECLARE
  fk RECORD;
  refs BIGINT;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'destinations'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (SELECT duplicate_id FROM destination_merge)', fk.tbl, fk.col)
      INTO refs;
    IF refs > 0 THEN
      RAISE EXCEPTION 'duplicate destination is still referenced by %.% (% rows)', fk.tbl, fk.col, refs;
    END IF;
  END LOOP;
END;
$$;

UPDATE destinations c
SET features = ARRAY(SELECT DISTINCT unnest(c.features || d.features) ORDER BY 1),
    external_ids = COALESCE(d.external_ids, '{}'::jsonb) || COALESCE(c.external_ids, '{}'::jsonb)
FROM destination_merge m
JOIN destinations d ON d.id = m.duplicate_id
WHERE c.id = m.canonical_id;

DELETE FROM destinations d
USING destination_merge m
WHERE d.id = m.duplicate_id
  AND EXISTS (SELECT 1 FROM destinations c WHERE c.id = m.canonical_id);

-- Stored search names written before this change may keep a period ("mt.
-- baker"); rebuild them with the period-free normalizer.
UPDATE destinations SET search_name = peaks_search_name(search_name) WHERE search_name LIKE '%.%';
UPDATE areas SET search_name = peaks_search_name(search_name) WHERE search_name LIKE '%.%';

-- Never again: catalog names must spell the word out. User-owned destinations
-- and personal routes keep whatever their owner typed; retired routes are
-- history and stay as published.
ALTER TABLE destinations ADD CONSTRAINT destinations_catalog_name_unabbreviated
  CHECK (owner <> 'peaks' OR NOT peaks_name_has_abbreviation(name)) NOT VALID;
ALTER TABLE areas ADD CONSTRAINT areas_name_unabbreviated
  CHECK (NOT peaks_name_has_abbreviation(name)) NOT VALID;
ALTER TABLE routes ADD CONSTRAINT routes_catalog_name_unabbreviated
  CHECK (owner <> 'peaks' OR status = 'superseded' OR NOT peaks_name_has_abbreviation(name)) NOT VALID;

ALTER TABLE destinations VALIDATE CONSTRAINT destinations_catalog_name_unabbreviated;
ALTER TABLE areas VALIDATE CONSTRAINT areas_name_unabbreviated;
ALTER TABLE routes VALIDATE CONSTRAINT routes_catalog_name_unabbreviated;

COMMIT;
