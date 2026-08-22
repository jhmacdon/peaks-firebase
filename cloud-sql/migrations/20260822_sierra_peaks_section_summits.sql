-- 78 summits needed by the Sierra Peaks Section list.
--
-- Each row matched a unique OpenStreetMap natural=peak node read on 2026-08-22. The source-list point is within 598 m of that node, within 100 m for more than nine in ten matches, and each match was checked by name, elevation and distance.
-- Coordinates, elevations and prominence come from the saved Peakbagger list-map fixture; GNIS is not used.
-- Monthly cost impact: $0. This is catalog data only.

BEGIN;

CREATE TEMP TABLE sierra_peaks_osm_incoming (
  id text, name text, elevation double precision, prominence double precision,
  lat double precision, lng double precision,
  osm_id text, wikidata_id text, osm_name text, peakbagger_id text, source_list_id int
) ON COMMIT DROP;

INSERT INTO sierra_peaks_osm_incoming (
  id, name, elevation, prominence, lat, lng,
  osm_id, wikidata_id, osm_name, peakbagger_id, source_list_id
) VALUES
    ('3BFD0C3D4B0C09D63729', 'Norman Clyde Peak', 4258.0865, 131.125, 37.07428, -118.473243, '358806931', 'Q8525889', 'Norman Clyde Peak', '2731', 5051),  -- 5051: Norman Clyde Peak
    ('0B0FBF398E3059C79B9F', 'Caltech Peak', 4216.4813, 174.6809, 36.68897, -118.39071, '358796033', 'Q35732519', 'Caltech Peak', '2789', 5051),  -- 5051: Caltech Peak
    ('B125A5EF5BC512BFD515', 'Black Kaweah', 4199.0162, 185.0136, 36.54531, -118.51614, '358795997', 'Q4921100', 'Black Kaweah', '2801', 5051),  -- 5051: Black Kaweah
    ('785053865DFFF232AAA2', 'Mount Mendel', 4172.9254, 158.557, 37.175151, -118.681877, '358798784', 'Q6922150', 'Mount Mendel', '2690', 5051),  -- 5051: Mount Mendel
    ('EB6D8E8E1E98DA0C69BD', 'Midway Mountain', 4166.9208, 423.0929, 36.6435, -118.48343, '358770742', 'Q49050081', 'Midway Mountain', '2794', 5051),  -- 5051: Midway Mountain
    ('B192D1FE26916FEABC28', 'Mount Gayley', 4116.5374, 138.3487, 37.103011, -118.500006, '358775730', 'Q49052787', 'Mount Gayley', '2724', 5051),  -- 5051: Mount Gayley
    ('3E8A0EAAE59724F47076', 'Mount Pinchot', 4113.5808, 642.5489, 36.9474, -118.40543, '358799104', 'Q25206397', 'Mount Pinchot', '2750', 5051),  -- 5051: Mount Pinchot
    ('DD5ECBCB504D02EA3D22', 'Mount Pickering', 4106.8752, 265.0236, 36.527205, -118.291531, '358799074', 'Q49054020', 'Mount Pickering', '2844', 5051),  -- 5051: Mount Pickering
    ('A8972DEB365F455EAEF9', 'Mount Newcomb', 4090.0198, 190.5, 36.54005, -118.29336, '358798932', 'Q49053781', 'Mount Newcomb', '2840', 5051),  -- 5051: Mount Newcomb
    ('DBA69E9AB242DC796BF6', 'Mount Hilgard', 4074.0787, 282.0619, 37.36063, -118.8268, '358798143', 'Q49053024', 'Mount Hilgard', '2670', 5051),  -- 5051: Mount Hilgard
    ('3BD98092A7820CDF561A', 'Mount Jordan', 4064.4775, 194.6453, 36.682423, -118.449802, '358796122', 'Q49053242', 'Mount Jordan', '2791', 5051),  -- 5051: Mount Jordan
    ('8A858C5969C8332C2409', 'Black Giant', 4064.0203, 344.363, 37.10238, -118.64877, '358796905', 'Q35727572', 'Black Giant', '2709', 5051),  -- 5051: Black Giant
    ('F3015B79205F7C4C0675', 'Joe Devel Peak', 4062.4658, 140.0556, 36.5155, -118.29655, '358798344', 'Q49039891', 'Joe Devel Peak', '2846', 5051),  -- 5051: Joe Devel Peak
    ('3834510CA15B393AA0B1', 'North Guard', 4061.7953, 190.3781, 36.716713, -118.489861, '358771695', 'Q49057314', 'North Guard', '2782', 5051),  -- 5051: North Guard
    ('0D23C6D4A1F30C7F55CB', 'Mount McDuffie', 4046.2505, 216.8957, 37.07363, -118.64426, '358798742', 'Q49053594', 'Mount McDuffie', '2711', 5051),  -- 5051: Mount McDuffie
    ('0C7AFA9DF9B4724EBF2A', 'Mount Hitchcock', 4021.4702, 148.2547, 36.554923, -118.311772, '358798151', 'Q49053041', 'Mount Hitchcock', '2836', 5051),  -- 5051: Mount Hitchcock
    ('2D8AC90FFFA30E1AB1FA', 'Mount Wynne', 4019.0623, 118.6586, 36.937988, -118.403133, '358800700', 'Q49055296', 'Mount Wynne', '2751', 5051),  -- 5051: Mount Wynne
    ('4E841A75EA5CF10C37B8', 'Mount Chamberlin', 4015.2523, 133.9901, 36.53367, -118.31067, '358797232', 'Q49052278', 'Mount Chamberlin', '2843', 5051),  -- 5051: Mount Chamberlin
    ('AAC07432123CAFB4459E', 'Mount Huxley', 3997.6044, 116.1593, 37.13596, -118.68272, '358798244', 'Q49053149', 'Mount Huxley', '2704', 5051),  -- 5051: Mount Huxley
    ('97701F4B725096FF5D07', 'Charybdis', 3991.9046, 328.3306, 37.08683, -118.66837, '358797250', 'Q30144894', 'Charybdis', '2710', 5051),  -- 5051: Charybdis
    ('FF497C1F56A48C89DB3A', 'Merriam Peak', 3987.5155, 271.3939, 37.309397, -118.765144, '358798786', 'Q49049265', 'Merriam Peak', '2677', 5051),  -- 5051: Merriam Peak
    ('E68A350110E1D8DD9B9D', 'Mount Genevra', 3978.9506, 148.2242, 36.683627, -118.434291, '358766485', 'Q49052794', 'Mount Genevra', '2790', 5051),  -- 5051: Mount Genevra
    ('149371A2EE19F8EE8A74', 'Temple Crag', 3963.5582, 94.9147, 37.10964, -118.49157, '358796267', 'Q7698508', 'Temple Crag', '2722', 5051),  -- 5051: Temple Crag
    ('F213ACF1A0F31B2D7423', 'Mount McGee', 3954.719, 396.5143, 37.13911, -118.73824, '358798752', 'Q49053595', 'Mount McGee', '2703', 5051),  -- 5051: Mount McGee
    ('694F6596C09188CC3CB9', 'Scylla', 3946.2761, 89.916, 37.08023, -118.68983, '358799587', 'Q49072080', 'Scylla', '2713', 5051),  -- 5051: Scylla
    ('7A5B9249A156DA81F7AF', 'Gemini', 3922.1969, 261.4879, 37.29681, -118.81694, '358797908', 'Q49031258', 'Gemini', '2679', 5051),  -- 5051: Gemini
    ('565A8010F1080FC27FFF', 'Goodale Mountain', 3900.5561, 220.157, 36.97212, -118.38645, '358797948', 'Q49032276', 'Goodale Mountain', '2747', 5051),  -- 5051: Goodale Mountain
    ('36FBFA0E8B29BA08108F', 'Kern Point', 3899.5198, 190.0733, 36.59691, -118.44448, '358796127', 'Q49041310', 'Kern Point', '2797', 5051),  -- 5051: Kern Point
    ('5597ED020794CF880136', 'Pyramid Peak', 3895.5574, 172.4863, 36.90658, -118.46215, '358799260', 'Q49065790', 'Pyramid Peak', '2754', 5051),  -- 5051: Pyramid Peak
    ('6CBA92720B32CA2E392A', 'Wheel Mountain', 3895.4964, 233.2025, 37.04684, -118.62951, '358800588', 'Q49088906', 'Wheel Mountain', '2712', 5051),  -- 5051: Wheel Mountain
    ('443CDFEA11DEFE93A142', 'Marion Peak', 3878.6714, 353.3546, 36.956847, -118.522501, '358798711', 'Q49047977', 'Marion Peak', '2749', 5051),  -- 5051: Marion Peak
    ('AEC104B6B59879758F73', 'Kearsarge Peak', 3858.6766, 198.2419, 36.78948, -118.34716, '358798381', 'Q49040970', 'Kearsarge Peak', '13530', 5051),  -- 5051: Kearsarge Peak
    ('F76F6A35A06599D30BBF', 'Devils Crags', 3847.7342, 325.2826, 37.03838, -118.61261, '7929571552', NULL, NULL, '13541', 5051),  -- 5051: Devils Crags
    ('5A364E772AEC032C6308', 'State Peak', 3846.8808, 195.9559, 36.93196, -118.54548, '358800070', 'Q49077754', 'State Peak', '13534', 5051),  -- 5051: State Peak
    ('02E4586440DC0323F938', 'Mount Reinstein', 3842.004, 228.3257, 37.07956, -118.7383, '358799400', 'Q49054308', 'Mount Reinstein', '2685', 5051),  -- 5051: Mount Reinstein
    ('42A231B99CA752E492CA', 'Mount Tinemaha', 3830.1168, 175.5648, 37.03629, -118.39637, '358796289', 'Q49054855', 'Mount Tinemaha', '13538', 5051),  -- 5051: Mount Tinemaha
    ('3FB657ABC3B8ECDB65D1', 'West Vidette', 3830.0558, 74.2493, 36.73383, -118.4198, '7942773353', 'Q106764050', 'West Vidette', '13528', 5051),  -- 5051: West Vidette
    ('D6ADE9A6B73F28EC8008', 'Mount Florence', 3825.6058, 249.6312, 37.739901, -119.316431, '358797817', 'Q27218316', 'Mount Florence', '2619', 5051),  -- 5051: Mount Florence
    ('8D8FB4F47D7028522B64', 'Emerald Peak', 3825.1486, 187.2082, 37.16536, -118.76379, '358806416', 'Q49028004', 'Emerald Peak', '13542', 5051),  -- 5051: Emerald Peak
    ('55C0A7F8D95C5EB811BD', 'Needham Mountain', 3801.8009, 542.7574, 36.454583, -118.537974, '358801795', 'Q49056506', 'Needham Mountain', '13518', 5051),  -- 5051: Needham Mountain
    ('A6ABF694965E1615EAB9', 'Glacier Ridge', 3788.725, 250.3322, 36.617642, -118.558654, '7900131684', 'Q49687567', 'Glacier Ridge', '13525', 5051),  -- 5051: Glacier Ridge
    ('424F5F952EA20E207FCD', 'Finger Peak', 3779.9772, 262.7376, 37.02998, -118.73032, '358797784', 'Q49028864', 'Finger Peak', '2716', 5051),  -- 5051: Finger Peak
    ('6C1614338DDA98E4FD3D', 'The Hermit', 3769.2787, 128.9609, 37.162912, -118.718328, '358800341', 'Q49082445', 'The Hermit', '2702', 5051),  -- 5051: The Hermit
    ('4E8B520C4F0FE97D0775', 'Mount Hooper', 3765.9564, 462.8388, 37.292503, -118.894858, '358798167', 'Q49053075', 'Mount Hooper', '13546', 5051),  -- 5051: Mount Hooper
    ('C06F34709934F91C2C8B', 'East Vidette', 3764.9201, 85.4964, 36.74401, -118.40062, '358765126', 'Q49027116', 'East Vidette', '13527', 5051),  -- 5051: East Vidette
    ('0A688DA3049830576585', 'Mount Warren', 3757.8182, 615.6046, 37.98983, -119.22349, '358800536', 'Q49055093', 'Mount Warren', '16290', 5051),  -- 5051: Mount Warren
    ('47D38B0D897BE1B71227', 'Observation Peak', 3756.9343, 243.7486, 37.02322, -118.52374, '358798970', 'Q49058122', 'Observation Peak', '13539', 5051),  -- 5051: Observation Peak
    ('93F92143EDC02A9DA23C', 'Mount Guyot', 3753.2158, 419.6182, 36.50994, -118.36191, '358798030', 'Q1297421', 'Mount Guyot', '2847', 5051),  -- 5051: Mount Guyot
    ('F9F3CD58F5C0EFD29F11', 'Picket Guard Peak', 3753.1853, 135.9103, 36.57659, -118.47344, '358795611', 'Q49061038', 'Picket Guard Peak', '13524', 5051),  -- 5051: Picket Guard Peak
    ('A64F27C844E3363835C4', 'Clyde Minaret', 3744.2242, 357.8352, 37.66028, -119.1739, '8676752930', 'Q119627596', 'Clyde Minaret', '2627', 5051),  -- 5051: Clyde Minaret
    ('09ACB10B3909E54E0C77', 'Lippincott Mountain', 3735.5983, 382.1278, 36.521386, -118.563095, '358796153', 'Q49044472', 'Lippincott Mountain', '13522', 5051),  -- 5051: Lippincott Mountain
    ('F3420DFA01397FDDBEF0', 'Pilot Knob', 3734.1962, 212.537, 37.27348, -118.75729, '358799093', 'Q49061284', 'Pilot Knob', '13544', 5051),  -- 5051: Pilot Knob
    ('999C3571F1DE78E24A3E', 'Goat Mountain', 3720.846, 293.309, 36.86946, -118.57432, '358766612', 'Q49031773', 'Goat Mountain', '13535', 5051),  -- 5051: Goat Mountain
    ('DC885F5A21AE599A6907', 'Mount Henry', 3720.7546, 280.5989, 37.18324, -118.82722, '358798113', 'Q49052994', 'Mount Henry', '2684', 5051),  -- 5051: Mount Henry
    ('F3918F6F00F2E632D844', 'Mount Eisen', 3704.844, 13.716, 36.498393, -118.568498, '358801212', 'Q49052549', 'Mount Eisen', '2778', 5051),  -- 5051: Mount Eisen
    ('FEE33F8745F0DDC65DEE', 'Mount Izaak Walton', 3690.305, 163.129, 37.470228, -118.889884, '358798315', 'Q49053196', 'Mount Izaak Walton', '13548', 5051),  -- 5051: Mount Izaak Walton
    ('C56BC9AE3F59BF555E2C', 'Whorl Mountain', 3667.9022, 202.692, 38.074091, -119.383348, '358796339', 'Q49089731', 'Whorl Mountain', '13559', 5051),  -- 5051: Whorl Mountain
    ('8835D048B1EBCCFE1D1F', 'Virginia Peak', 3652.2965, 137.7086, 38.06585, -119.35793, '358796314', 'Q49087095', 'Virginia Peak', '13558', 5051),  -- 5051: Virginia Peak
    ('D0BC5AC55AD3E872634D', 'Tunemah Peak', 3627.0286, 225.0948, 36.99543, -118.68835, '358777522', 'Q49085181', 'Tunemah Peak', '2719', 5051),  -- 5051: Tunemah Peak
    ('278E6D4B49EB62C37483', 'Whaleback', 3577.4681, 168.5849, 36.630201, -118.53153, '7900152231', 'Q49698945', 'Whaleback', '13526', 5051),  -- 5051: Whaleback
    ('BC6C5605F990C9514B11', 'Gray Peak', 3526.3836, 182.2399, 37.67448, -119.42002, '358795514', 'Q49033261', 'Gray Peak', '13555', 5051),  -- 5051: Gray Peak
    ('2848BF14D62ADD93D7AC', 'Iron Mountain', 3399.4954, 221.803, 37.6116, -119.16455, '358798305', 'Q49039006', 'Iron Mountain', '13551', 5051),  -- 5051: Iron Mountain
    ('3E37374975DB58915E81', 'Coyote Peaks', 3320.6131, 127.7112, 36.312088, -118.447233, '358801117', 'Q35736284', 'Coyote Peaks', '13514', 5051),  -- 5051: Coyote Peaks
    ('A9D14C53D95079563940', 'Pettit Peak', 3289.3711, 243.2304, 37.98552, -119.48041, '358795609', 'Q49060900', 'Pettit Peak', '2600', 5051),  -- 5051: Pettit Peak
    ('526CB5D8D546576336C4', 'Piute Mountain', 3212.9882, 447.5378, 38.03373, -119.54786, '358795617', 'Q49062469', 'Piute Mountain', '2598', 5051),  -- 5051: Piute Mountain
    ('C41FB6C1E09B3D81614C', 'Cartago Peak', 3210.367, 180.9902, 36.32457, -118.10213, '11032920927', 'Q120442596', 'Cartago Peak', '13519', 5051),  -- 5051: Cartago Peak
    ('9BBA1C9E0B4CC513222C', 'Volunteer Peak', 3195.9499, 100.7059, 38.00618, -119.48843, '358796320', 'Q49087170', 'Volunteer Peak', '13560', 5051),  -- 5051: Volunteer Peak
    ('7C61F0E1587C7A903630', 'Black Hawk Mountain', 3148.2487, 299.466, 38.20596, -119.70902, '358796907', 'Q35727580', 'Black Hawk Mountain', '13561', 5051),  -- 5051: Black Hawk Mountain
    ('6192CADAF62A83ED99B3', 'North Maggie Mountain', 3115.7266, 199.3392, 36.276772, -118.637698, '11032874091', 'Q120442522', 'North Maggie Mountain', '13515', 5051),  -- 5051: North Maggie Mountain
    ('DB224E8A4E5E7AD5FCA8', 'Angora Mountain', 3106.7654, 139.9337, 36.26453, -118.44585, '358800771', 'Q35724239', 'Angora Mountain', '13513', 5051),  -- 5051: Angora Mountain
    ('092095BE12453A038DDA', 'Spanish Mountain', 3064.9774, 473.0801, 36.909157, -118.891329, '358776365', 'Q49076206', 'Spanish Mountain', '2714', 5051),  -- 5051: Spanish Mountain
    ('BC740649B7404AF26AD6', 'Disaster Peak', 3064.0934, 205.6486, 38.44874, -119.73364, '358764773', 'Q49024981', 'Disaster Peak', '13563', 5051),  -- 5051: Disaster Peak
    ('A2578C74FA9963F0A7B9', 'Smith Mountain', 2905.0488, 320.9239, 36.1273, -118.22436, '358802191', 'Q49074809', 'Smith Mountain', '13512', 5051),  -- 5051: Smith Mountain
    ('34C191B2D4E08C1D97C5', 'Crag Peak', 2895.0514, 277.429, 36.11514, -118.15198, '358801124', 'Q35736346', 'Crag Peak', '13511', 5051),  -- 5051: Crag Peak
    ('453E1AB2AD0406F3D51C', 'Moses Mountain', 2844.4546, 347.2891, 36.27866, -118.68103, '358801777', 'Q49051683', 'Moses Mountain', '2854', 5051),  -- 5051: Moses Mountain
    ('E27B9164FC24C6FEAA8A', 'Homers Nose', 2751.3382, 303.0931, 36.38474, -118.73905, '358786073', 'Q49036913', 'Homer''s Nose', '2850', 5051),  -- 5051: Homers Nose
    ('4B5FC7A5AD963E713064', 'Taylor Dome', 2685.6538, 217.109, 35.85635, -118.30342, '8285403004', 'Q120442434', 'Taylor Dome', '13509', 5051),  -- 5051: Taylor Dome
    ('8C97D6F24B8141F2B75D', 'Spanish Needle', 2399.0503, 272.8265, 35.77155, -118.0012, '11032874094', 'Q120442403', 'Spanish Needle', '13505', 5051)  -- 5051: Spanish Needle
;

DO $$
DECLARE
  tile record;
BEGIN
  FOR tile IN
    SELECT DISTINCT floor(lat * 2)::int AS blat, floor(lng * 2)::int AS blng
    FROM sierra_peaks_osm_incoming
    ORDER BY 1, 2
  LOOP
    WITH prepared AS (
      SELECT
        id, name, lower(name) AS search_name, elevation, prominence,
        ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
        jsonb_strip_nulls(jsonb_build_object('osm', osm_id, 'wikidata', wikidata_id)) AS external_ids,
        jsonb_build_object(
          'source', 'osm',
          'catalog_audit', 'peakbagger-lists-2026-08-22',
          'elevation_source', 'peakbagger',
          'coordinate_source', 'peakbagger',
          'prominence_source', 'peakbagger',
          'peakbagger_id', peakbagger_id,
          'names', jsonb_strip_nulls(jsonb_build_object('display', name, 'osm_default', osm_name))
        ) AS metadata,
        osm_id, wikidata_id, peakbagger_id,
        source_list_id
      FROM sierra_peaks_osm_incoming
      WHERE floor(lat * 2)::int = tile.blat
        AND floor(lng * 2)::int = tile.blng
    )
    INSERT INTO destinations (
      id, name, search_name, elevation, prominence, location, geohash,
      type, activities, features, owner, country_code, state_code,
      external_ids, metadata, created_at, updated_at
    )
    SELECT
      p.id, p.name, p.search_name, p.elevation, p.prominence, p.location, NULL,
      'point', ARRAY['outdoor-trek']::activity_type[], ARRAY['summit']::destination_feature[],
      'peaks', 'US', 'CA', p.external_ids, p.metadata, now(), now()
    FROM prepared p
    WHERE
      NOT EXISTS (SELECT 1 FROM destinations d WHERE d.external_ids->>'osm' = p.osm_id)
      AND (p.wikidata_id IS NULL OR NOT EXISTS (SELECT 1 FROM destinations d WHERE d.external_ids->>'wikidata' = p.wikidata_id))
      AND NOT EXISTS (
        SELECT 1 FROM destinations d
        WHERE d.location IS NOT NULL
          AND d.search_name = p.search_name
          AND ST_DWithin(d.location, p.location, 500)
      )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

DO $$
DECLARE
  expected text[] := ARRAY['3BFD0C3D4B0C09D63729', '0B0FBF398E3059C79B9F', 'B125A5EF5BC512BFD515', '785053865DFFF232AAA2', 'EB6D8E8E1E98DA0C69BD', 'B192D1FE26916FEABC28', '3E8A0EAAE59724F47076', 'DD5ECBCB504D02EA3D22', 'A8972DEB365F455EAEF9', 'DBA69E9AB242DC796BF6', '3BD98092A7820CDF561A', '8A858C5969C8332C2409', 'F3015B79205F7C4C0675', '3834510CA15B393AA0B1', '0D23C6D4A1F30C7F55CB', '0C7AFA9DF9B4724EBF2A', '2D8AC90FFFA30E1AB1FA', '4E841A75EA5CF10C37B8', 'AAC07432123CAFB4459E', '97701F4B725096FF5D07', 'FF497C1F56A48C89DB3A', 'E68A350110E1D8DD9B9D', '149371A2EE19F8EE8A74', 'F213ACF1A0F31B2D7423', '694F6596C09188CC3CB9', '7A5B9249A156DA81F7AF', '565A8010F1080FC27FFF', '36FBFA0E8B29BA08108F', '5597ED020794CF880136', '6CBA92720B32CA2E392A', '443CDFEA11DEFE93A142', 'AEC104B6B59879758F73', 'F76F6A35A06599D30BBF', '5A364E772AEC032C6308', '02E4586440DC0323F938', '42A231B99CA752E492CA', '3FB657ABC3B8ECDB65D1', 'D6ADE9A6B73F28EC8008', '8D8FB4F47D7028522B64', '55C0A7F8D95C5EB811BD', 'A6ABF694965E1615EAB9', '424F5F952EA20E207FCD', '6C1614338DDA98E4FD3D', '4E8B520C4F0FE97D0775', 'C06F34709934F91C2C8B', '0A688DA3049830576585', '47D38B0D897BE1B71227', '93F92143EDC02A9DA23C', 'F9F3CD58F5C0EFD29F11', 'A64F27C844E3363835C4', '09ACB10B3909E54E0C77', 'F3420DFA01397FDDBEF0', '999C3571F1DE78E24A3E', 'DC885F5A21AE599A6907', 'F3918F6F00F2E632D844', 'FEE33F8745F0DDC65DEE', 'C56BC9AE3F59BF555E2C', '8835D048B1EBCCFE1D1F', 'D0BC5AC55AD3E872634D', '278E6D4B49EB62C37483', 'BC6C5605F990C9514B11', '2848BF14D62ADD93D7AC', '3E37374975DB58915E81', 'A9D14C53D95079563940', '526CB5D8D546576336C4', 'C41FB6C1E09B3D81614C', '9BBA1C9E0B4CC513222C', '7C61F0E1587C7A903630', '6192CADAF62A83ED99B3', 'DB224E8A4E5E7AD5FCA8', '092095BE12453A038DDA', 'BC740649B7404AF26AD6', 'A2578C74FA9963F0A7B9', '34C191B2D4E08C1D97C5', '453E1AB2AD0406F3D51C', 'E27B9164FC24C6FEAA8A', '4B5FC7A5AD963E713064', '8C97D6F24B8141F2B75D'];
  present int;
  bad_rows int;
  duplicate_ids int;
BEGIN
  SELECT count(*) INTO present FROM destinations WHERE id = ANY(expected);
  IF present <> 78 THEN
    RAISE EXCEPTION 'sierra_peaks_osm_incoming: % of 78 rows present', present;
  END IF;

  SELECT count(*) INTO bad_rows FROM destinations
  WHERE id = ANY(expected)
    AND (location IS NULL OR elevation IS NULL
         OR abs(ST_Z(location::geometry) - elevation) > 0.001
         OR metadata->>'catalog_audit' IS DISTINCT FROM 'peakbagger-lists-2026-08-22'
         OR owner IS DISTINCT FROM 'peaks'
         OR country_code IS DISTINCT FROM 'US'
         OR state_code IS DISTINCT FROM 'CA'
         OR NOT ('summit'::destination_feature = ANY(features)));
  IF bad_rows <> 0 THEN
    RAISE EXCEPTION 'sierra_peaks_osm_incoming: % invalid row(s)', bad_rows;
  END IF;

  SELECT count(*) INTO duplicate_ids FROM (
    SELECT external_ids->>'osm' AS ident
    FROM destinations
    WHERE external_ids->>'osm' IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  ) duplicates;
  IF duplicate_ids <> 0 THEN
    RAISE EXCEPTION 'sierra_peaks_osm_incoming: % shared OSM id(s)', duplicate_ids;
  END IF;
END $$;

COMMIT;
