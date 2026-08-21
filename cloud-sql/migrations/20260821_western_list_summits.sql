-- 91 summits the Desert Peaks Section, the Tahoe Ogul Peaks and the South
-- Beyond 6000 need, all of them mapped in OpenStreetMap.
--
-- Names, OSM node IDs and Wikidata IDs come from OpenStreetMap natural=peak
-- nodes read on 2026-08-21. No coordinate here comes from GNIS.
--
-- COORDINATES. Each row had two candidate points: the OSM node, and the peak's
-- own point in Peakbagger's list map feed (LLL.aspx), which gives five decimals
-- rather than the tile-quantised value the 2026-08-18 export carried. USGS 3DEP
-- was sampled at both, at 1 m resolution, and the row keeps whichever point
-- reads higher; where the two readings agree within 2 m the OSM node wins. The
-- Peakbagger point wins on 62 of these 91 rows, by up to 99 m -- an OSM node
-- placed off the high point reads low in 3DEP, which is the defect the
-- Northeast pass's correction note describes. The two points are close in any
-- case: across 371 exact-name matches their median separation is 16 m.
--
-- ELEVATIONS keep the OSM ele tag only where it lands within 3 m of the figure
-- the source list publishes; 62 of these 91 tags do not, and those rows take
-- the published figure instead. That is the check the Northeast pass added
-- after The Bulge went in low: a node off the high point agrees with its own
-- low tag, so agreement with 3DEP at the node proves nothing.
--
-- Eight rows carry a name OpenStreetMap uses and the source list does not.
-- The list import reaches each by reviewed destination override: Granite Peak,
-- Superstition Peak, Indian Head Peak and Orocopia Mountain on the Desert Peaks
-- list; Silver Peak and Wade Peak on the Tahoe Ogul list; Hallback and Plott
-- Balsam on South Beyond 6000.
--
-- This migration also corrects one existing row. Middle Sister
-- (dQvlhlqanHJh4h4JSkP7), in the Sweetwater Mountains of California, stored
-- 3062 m -- the height of Oregon's Middle Sister, which the catalog holds
-- separately as U0r2Ys42V3pk8j8Hqtje at exactly that figure. The Tahoe Ogul
-- list publishes 10,862.4 ft (3310.9 m) and the row's own OSM node 358798800
-- tags 3306 m, so the stored value was about 249 m low. It takes the published
-- figure, and the PointZ moves with it.
--
-- Written up in docs/data-audits/peakbagger-lists-2026-08-21.md.

BEGIN;

-- The rows. One VALUES list, so the whole batch reads in one place.
CREATE TEMP TABLE western_osm_incoming (
  id text, name text, elevation double precision, prominence double precision,
  lat double precision, lng double precision,
  osm_id text, wikidata_id text, elevation_source text, coordinate_source text,
  country_code text, state_code text
) ON COMMIT DROP;

INSERT INTO western_osm_incoming (
  id, name, elevation, prominence, lat, lng,
  osm_id, wikidata_id, elevation_source, coordinate_source, country_code, state_code
) VALUES
    ('30D506AFF3DECCF80536', 'Mount Inyo', 3358.7, 303.0, 36.7352480, -117.9856030, '358796103', 'Q49053173', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Mount Inyo
    ('7C654D33260F7F45B2B8', 'New York Butte', 3251.3, 343.0, 36.6480910, -117.9325590, '358771532', 'Q49056800', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: New York Butte
    ('343277F0217AE8E71B42', 'Porter Peak', 2766.1, 158.4, 36.0499300, -117.0563700, '358790784', 'Q49063541', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Porter Peak
    ('CEF0A74391A0AD09A789', 'Last Chance Mountain', 2578.1, 724.8, 37.2804200, -117.6997600, '358769125', 'Q49043565', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Last Chance Mountain
    ('D5514E5AD91E469C5D62', 'Mount Palmer', 2418.7, 220.6, 36.9068400, -117.1331200, '358795605', 'Q49053929', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Mount Palmer
    ('2E1827D1FFFF72C0A155', 'North Guardian Angel', 2258.1, 224.6, 37.3163100, -113.0582800, '356673767', 'Q49057316', 'peakbagger', 'peakbagger', 'US', 'UT'),  -- 5053 Desert Peaks Section: North Guardian Angel
    ('B192805DB041197D96B5', 'Manly Peak', 2192.2, 782.9, 35.9150642, -117.1169637, '358788517', 'Q49047766', 'peakbagger', 'osm', 'US', 'CA'),  -- 5053 Desert Peaks Section: Manly Peak
    ('AAAA8EC1849FA2036DC4', 'Edgar Peak', 2183.0, 675.1, 34.9555464, -115.5363809, '358816160', NULL, 'osm', 'osm', 'US', 'CA'),  -- 5053 Desert Peaks Section: Edgar Peak
    ('3D71C3D05DEC2720BA2E', 'South Guardian Angel', 2180.5, 372.7, 37.2955100, -113.0599100, '356674137', 'Q49075826', 'peakbagger', 'peakbagger', 'US', 'UT'),  -- 5053 Desert Peaks Section: South Guardian Angel
    ('374DDE99270FC140F005', 'Granite Peak', 2071.3, 865.3, 34.7936000, -115.6953200, '358795039', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Granite Mountain
    ('E92C58EFBD7A7F486310', 'Tucki Mountain', 2050.1, 563.2, 36.4997000, -117.1301500, '358796577', 'Q49085084', 'osm', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Tucki Mountain
    ('7FECAE8A7605E39AC3CD', 'Rabbit Peak', 2028.0, 370.0, 33.4333082, -116.2390262, '358808578', NULL, 'osm', 'osm', 'US', 'CA'),  -- 5053 Desert Peaks Section: Rabbit Peak
    ('408CD0F245956DC6F9A7', 'Panamint Butte', 2006.8, 28.7, 36.4339460, -117.3559750, '358790359', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Panamint Butte
    ('4DDC0AF1EE1A0AD948A7', 'Martinez Mountain', 2001.0, 523.9, 33.5541900, -116.3452100, '358801706', NULL, 'osm', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Martinez Mountain
    ('0E2EC042AA6D2096D3AE', 'Needle Peak', 1769.0, 500.3, 35.8864100, -117.0286200, '358789644', 'Q25346034', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Needle Peak
    ('4A96BAD746B07FEDCB88', 'Corkscrew Peak', 1768.7, 201.5, 36.7706700, -117.0042400, '358764112', 'Q35735945', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Corkscrew Peak
    ('79F1CC316D8C9A990407', 'Eagle Mountain', 1631.0, 682.5, 33.7441760, -115.7398430, '7556686045', NULL, 'osm', 'osm', 'US', 'CA'),  -- 5053 Desert Peaks Section: Eagle Mountain
    ('F8EE2FFC7F2574A1BCD0', 'Superstition Peak', 1541.0, 561.3, 33.4110200, -111.4007600, '359285748', NULL, 'osm', 'peakbagger', 'US', 'AZ'),  -- 5053 Desert Peaks Section: Superstition Benchmark
    ('8BAE170534A22DD6D254', 'Brown Peak', 1508.8, 513.7, 36.1155144, -116.3853131, '358781159', 'Q35729569', 'peakbagger', 'osm', 'US', 'CA'),  -- 5053 Desert Peaks Section: Brown Peak
    ('7D80FB99E35686AE86F4', 'Black Butte', 1374.8, 869.4, 33.5614000, -115.3448400, '358780817', 'Q35727508', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Black Butte
    ('BBC65FE6A560F3558464', 'Sombrero Peak', 1290.6, 100.2, 32.8324470, -116.2914000, '358792788', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Sombrero Peak
    ('E4C0401BDB75224180EF', 'Pinto Mountain', 1215.1, 384.6, 33.9537200, -115.7993900, '358790639', 'Q49062272', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Pinto Mountain
    ('33E139BE5A1C807721A1', 'Indian Head Peak', 1211.1, 228.4, 33.2925700, -116.4301800, '358808164', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Indianhead
    ('FB7D97084DDF67BEFC52', 'Orocopia Mountain', 1163.4, 639.2, 33.5690330, -115.7797860, '7556631806', NULL, 'peakbagger', 'osm', 'US', 'CA'),  -- 5053 Desert Peaks Section: Orocopia Mountains High Point
    ('6385B9B977BB20DAFCEC', 'Eagle Mountain', 1160.9, 512.4, 36.2113113, -116.3564279, '358783265', 'Q49026510', 'peakbagger', 'osm', 'US', 'CA'),  -- 5053 Desert Peaks Section: Eagle Mountain
    ('87B52DDE1641425E00FC', 'Castle Dome Peak', 1155.6, 640.8, 33.0847000, -114.1434400, '359243898', NULL, 'peakbagger', 'peakbagger', 'US', 'AZ'),  -- 5053 Desert Peaks Section: Castle Dome Peak
    ('6628C2FD3B29952BBBB9', 'Chemehuevi Peak', 1126.3, 548.9, 34.5521900, -114.5627400, '358782012', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Chemehuevi Peak
    ('F69509B66D82505FB858', 'Kino Peak', 975.1, 470.5, 32.1096150, -112.9553810, '359247545', 'Q49041820', 'peakbagger', 'peakbagger', 'US', 'AZ'),  -- 5053 Desert Peaks Section: Kino Peak
    ('1B53FE237CE680F3DB3B', 'Picacho Peak', 591.9, 339.2, 32.9712700, -114.6640500, '358808522', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5053 Desert Peaks Section: Picacho Peak
    ('F508A495C79EFDE6EF0D', 'Wheeler Peak', 3556.3, 115.9, 38.4186900, -119.2887500, '358800590', 'Q49088954', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Wheeler Peak
    ('B7A295966758397F487B', 'South Sister', 3463.0, 234.4, 38.4829227, -119.3000092, '358800021', 'Q49076088', 'osm', 'osm', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: South Sister
    ('57053B6E3D19BD8F22EA', 'Jobs Sister', 3299.0, 120.6, 38.8623424, -119.8845479, '7929394984', NULL, 'osm', 'osm', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Jobs Sister
    ('03005F77BCA3DCF9E2EE', 'Silver Peak', 3283.0, 46.1, 38.5641000, -119.7599900, '358799671', 'Q49073969', 'osm', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Silver Peak - Southwest Summit
    ('645E26DBAC63701B09B9', 'Stevens Peak', 3061.0, 166.9, 38.7337400, -119.9817800, '358800078', 'Q49078100', 'osm', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Stevens Peak
    ('3F199A65D0D0FDA9B5D1', 'Hawkins Peak', 3056.0, 665.4, 38.7385168, -119.8724013, '358798087', 'Q49035349', 'peakbagger', 'osm', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Hawkins Peak
    ('A8A01E05C7C786AB0D9F', 'Raymond Peak', 3055.0, 393.6, 38.6037965, -119.8332346, '358799318', 'Q49066972', 'osm', 'osm', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Raymond Peak
    ('6FEAC771C1B780AEAE34', 'Dicks Peak', 3042.0, 477.5, 38.9005020, -120.1509717, '358764727', 'Q49024858', 'osm', 'osm', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Dicks Peak
    ('9C00DC2862632A3E01CC', 'Jacks Peak', 3002.0, 126.1, 38.8903000, -120.1541000, '358768176', 'Q49039432', 'osm', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Jacks Peak
    ('429588EE3D8C2DEAC238', 'Reynolds Peak', 2975.6, 264.0, 38.5795790, -119.8377240, '358799410', 'Q49068316', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Reynolds Peak
    ('8938338C97799E68458D', 'Lookout Peak', 2922.2, 164.7, 38.5106337, -119.8732592, '358798637', 'Q49046719', 'peakbagger', 'osm', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Lookout Peak
    ('BDB51854C7630AEA04CF', 'Waterhouse Peak', 2895.0, 429.2, 38.7761800, -119.9648600, '7929421688', NULL, 'osm', 'osm', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Waterhouse Peak
    ('57F939699CF9B1E9A28A', 'Markleeville Peak', 2871.6, 345.5, 38.6615200, -119.8982400, '358798712', 'Q49047997', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Markleeville Peak
    ('EFD345E44CEAD0C8AF7A', 'Wade Peak', 2855.0, 84.8, 38.8166392, -119.8424878, '7515963927', NULL, 'osm', 'osm', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Wade Benchmark
    ('0FCAD5C78A5D8C9D0448', 'The Nipple', 2853.4, 213.0, 38.6401240, -119.9326290, '358800349', 'Q49082730', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: The Nipple
    ('193224B99F5534E67961', 'Mokelumne Peak', 2845.9, 462.6, 38.5381800, -120.0944400, '358798853', 'Q48800417', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Mokelumne Peak
    ('C45B7338BD4774132D1C', 'Red Peak', 2836.7, 36.6, 38.9255000, -120.2212200, '358773364', 'Q7304711', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Red Peak
    ('C91D45D3A81A3F611774', 'Rubicon Peak', 2798.0, 80.1, 38.9886400, -120.1333400, '358773932', 'Q7376080', 'osm', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Rubicon Peak
    ('2D39EB65DF828AF48F0B', 'Genoa Peak', 2788.0, 558.4, 39.0430100, -119.8814100, '357558013', 'Q49031271', 'osm', 'peakbagger', 'US', 'NV'),  -- 5055 Tahoe Ogul Peaks: Genoa Peak
    ('E25833DD2E6101EF33A8', 'McConnell Peak', 2773.4, 18.0, 38.9483770, -120.2430260, '358770413', 'Q8523856', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: McConnell Peak
    ('95D1AEB93F827699039F', 'Da-ek Dow Go-et Mountain', 2764.0, 207.0, 38.6367700, -119.8966300, '358798331', 'Q49039640', 'osm', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Da-ek Dow Go-et Mountain
    ('EDF67E31B8D6847DF0B4', 'Desert Creek Peak', 2735.2, 508.9, 38.6140400, -119.3156800, '357557848', NULL, 'peakbagger', 'peakbagger', 'US', 'NV'),  -- 5055 Tahoe Ogul Peaks: Desert Creek Peak
    ('74156EAF69C3C8B4657A', 'Needle Peak', 2734.2, 86.0, 39.2006400, -120.3010600, '358798923', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Needle Peak
    ('F99A94D9E0A77B5D98E3', 'Silver Peak', 2724.0, 63.6, 38.9344400, -120.2305700, '358775307', 'Q7516231', 'osm', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Silver Peak
    ('F89C3A277B604E8B1622', 'Lyon Peak', 2713.0, 83.5, 39.2065900, -120.3155600, '358798683', NULL, 'osm', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Lyon Peak
    ('5B4B5B8960745D2516C9', 'Twin Peaks', 2707.0, 411.6, 39.1123900, -120.2319200, '358800465', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Twin Peaks
    ('2FF585F8C53F4544E3B7', 'Tells Peak', 2706.7, 82.9, 38.9599270, -120.2547000, '358800320', 'Q7697644', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Tells Peak
    ('CFCC958CB3FAC0E20D89', 'Ellis Peak', 2663.2, 324.3, 39.0686300, -120.1981800, '358797709', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Ellis Peak
    ('E94FCB4ECF33BF12998A', 'Duane Bliss Peak', 2639.0, 214.6, 39.0805472, -119.8780200, '357557879', 'Q49025997', 'osm', 'osm', 'US', 'NV'),  -- 5055 Tahoe Ogul Peaks: Duane Bliss Peak
    ('106B2BB720A40407DBE9', 'Mount Mildred', 2559.5, 89.2, 39.1460600, -120.3300100, '358798811', 'Q49053626', 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Mount Mildred
    ('64FC578D822C1543A53E', 'English Mountain', 2552.0, 392.2, 39.4465100, -120.5512100, '314759943', NULL, 'osm', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: English Mountain
    ('AE1139453830E078A133', 'Haskell Peak', 2473.2, 434.6, 39.6624200, -120.5526900, '358798076', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Haskell Peak
    ('8F8B1AF97055D541DE52', 'Black Buttes', 2451.9, 225.2, 39.3953100, -120.5592800, '314758666', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Black Buttes
    ('4F717096289B74E89F35', 'Snow Mountain', 2445.9, 422.4, 39.2403600, -120.4623600, '358776179', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Snow Mountain
    ('AF6EBA8A0BB6C83736F2', 'Signal Peak', 2390.9, 205.8, 39.3390200, -120.5355700, '358799650', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Signal Peak
    ('32B22BED1D62B3F836DE', 'Old Man Mountain', 2376.8, 203.9, 39.3702700, -120.5220400, '358798975', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Old Man Mountain
    ('78CFCFAA550BD6B89ADC', 'Devils Peak', 2352.1, 169.5, 39.2830600, -120.4405700, '358764694', NULL, 'peakbagger', 'peakbagger', 'US', 'CA'),  -- 5055 Tahoe Ogul Peaks: Devils Peak
    ('7F5CB8C0FB656B7DFBB6', 'Balsam Cone', 2010.6, 119.5, 35.7893700, -82.2558400, '357800650', NULL, 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Balsam Cone
    ('612C3B47DD8D8C14DA6B', 'Cattail Peak', 2007.0, 48.2, 35.7984500, -82.2564100, '357801144', 'Q31619938', 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Cattail Peak
    ('582D770B86903CB6C187', 'Mount Gibbes', 2002.9, 147.6, 35.7391100, -82.2850600, '357809782', NULL, 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Mount Gibbes
    ('4E99D27A0AECBCA24169', 'Hallback', 1948.7, 60.9, 35.7489000, -82.2753100, '357805389', 'Q31626288', 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Mount Hallback
    ('BE192B36FB0FE5E71E6A', 'Blackstock Knob', 1931.9, 143.9, 35.7381300, -82.3184500, '357806579', NULL, 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Blackstock Knob
    ('EAD4118060445E2322E4', 'Celo Knob', 1929.0, 191.4, 35.8523200, -82.2485200, '357801165', 'Q5058413', 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Celo Knob
    ('2C73DE8F23C7BA9B6B80', 'Waterrock Knob', 1917.4, 594.7, 35.4641206, -83.1376565, '357788673', 'Q7974395', 'peakbagger', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Waterrock Knob
    ('16B7C3B40591D342EF8B', 'Roan High Bluff', 1910.4, 59.1, 36.0931700, -82.1455400, '9029471895', NULL, 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Roan High Bluff
    ('F392A92D9F914E1CA963', 'Mount Lyn Lowry', 1903.2, 113.2, 35.4637306, -83.1105269, '357809791', NULL, 'peakbagger', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Mount Lyn Lowry
    ('1EFABB2C69093E67C100', 'Gibbs Mountain', 1902.2, 46.3, 35.8405700, -82.2479200, '357807441', 'Q31624935', 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Gibbs Mountain
    ('68E436FEB2ACB5A6F587', 'Luftee Knob', 1894.3, 107.7, 35.6925501, -83.2150517, '357777350', 'Q31632125', 'osm', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Luftee Knob
    ('C7DB3DDCAF27EF5915D8', 'Black Balsam Knob', 1893.4, 300.2, 35.3278465, -82.8744813, '357800805', 'Q4920316', 'peakbagger', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Black Balsam Knob
    ('A888AA0A1BFF8C0EA37F', 'Winter Star Mountain', 1892.3, 97.1, 35.8177500, -82.2490900, '357804126', 'Q31644361', 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Winter Star Mountain
    ('1A9604F845C715D31FAB', 'Mount Yonaguska', 1883.4, 73.5, 35.6941639, -83.2482968, '357809796', 'Q31644887', 'osm', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Mount Yonaguska
    ('A6B0902C6F5BE4D6AFFD', 'Marks Knob', 1878.3, 83.3, 35.6800565, -83.2485099, '357777663', 'Q14708031', 'osm', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Marks Knob
    ('0FD3B4F4E00BA03A9203', 'Big Cataloochee Mountain', 1875.2, 204.8, 35.6718987, -83.1758673, '357806506', 'Q31616769', 'osm', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Big Cataloochee Mountain
    ('F4C2561D765BBF317DFE', 'Mount Hardy', 1866.0, 240.9, 35.3031598, -82.9276329, '357809786', 'Q31424756', 'osm', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Mount Hardy
    ('7CD8EB254710E2CB7EF6', 'Reinhart Knob', 1862.5, 74.2, 35.3507000, -82.9769900, '357808899', 'Q31425732', 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Reinhart Knob
    ('CF2AF8F1DB888CB8A5F4', 'Plott Balsam', 1856.0, 125.2, 35.4802254, -83.0881678, '357803267', NULL, 'osm', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Plott Balsam Mountain
    ('B6740BD1E55F705E8407', 'Sam Knob', 1852.9, 130.2, 35.3298500, -82.8949900, '357809142', 'Q31425877', 'peakbagger', 'peakbagger', 'US', 'NC'),  -- 5180 South Beyond 6000: Sam Knob
    ('3EC67494D4C968E01B69', 'Tennent Mountain', 1850.2, 49.2, 35.3370510, -82.8690201, '357809407', 'Q31426204', 'peakbagger', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Tennent Mountain
    ('B97C4FD08C31BA25ECE2', 'Craggy Dome', 1847.7, 300.4, 35.7059484, -82.3667902, '357807103', 'Q31424300', 'peakbagger', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Craggy Dome
    ('8455670EC06E4B4A4437', 'Grassy Cove Top', 1844.0, 105.8, 35.3484401, -82.8640201, '357807485', 'Q31424660', 'osm', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Grassy Cove Top
    ('6550EE5FA6E0E39E9D33', 'Yellow Face', 1840.4, 97.3, 35.4509345, -83.1506992, '357789796', NULL, 'peakbagger', 'osm', 'US', 'NC'),  -- 5180 South Beyond 6000: Yellow Face
    ('F7400127FB57D8C6A4BA', 'Chestnut Bald', 1829.0, 57.3, 35.3069400, -82.8890500, '357806964', 'Q31424159', 'peakbagger', 'peakbagger', 'US', 'NC')  -- 5180 South Beyond 6000: Chestnut Bald
;

-- THE INSERT RUNS ONCE PER TWO-DEGREE TILE, AND THAT IS DELIBERATE.
--
-- link_areas_on_destination_insert is a statement trigger. It takes the
-- envelope of every row in the statement, expands it by two degrees, and treats
-- every protected area touching that box as a candidate -- then runs ST_Covers
-- and a 50 m geography ST_DWithin against each. These rows span the continent,
-- from a North Carolina bald at -82 to the Sierra at -120, so as one statement
-- the candidate set was 2,605 of the 3,869 areas and the geometry work was
-- 91 x 2,605. That INSERT ran 27 minutes without finishing.
--
-- One tile at a time keeps each envelope small: the worst tile here draws 434
-- areas against 16 rows, and the batch's geometry work falls about ninefold.
-- The rows, the guards and the result are identical either way.
DO $$
DECLARE
  tile record;
BEGIN
  FOR tile IN
    SELECT DISTINCT floor(lat / 2)::int AS blat, floor(lng / 2)::int AS blng
    FROM western_osm_incoming
    ORDER BY 1, 2
  LOOP
    WITH prepared AS (
      SELECT
        id,
        name,
        lower(name) AS search_name,
        elevation,
        prominence,
        ST_SetSRID(ST_MakePoint(lng, lat, elevation), 4326)::geography AS location,
        jsonb_strip_nulls(jsonb_build_object('osm', osm_id, 'wikidata', wikidata_id)) AS external_ids,
        jsonb_build_object(
          'source', 'osm',
          'catalog_audit', 'peakbagger-lists-2026-08-21b',
          'elevation_source', elevation_source,
          'coordinate_source', coordinate_source,
          'prominence_source', 'peakbagger',
          'names', jsonb_build_object('display', name, 'osm_default', name)
        ) AS metadata,
        osm_id,
        wikidata_id, country_code,
        state_code
      FROM western_osm_incoming
      WHERE floor(lat / 2)::int = tile.blat
        AND floor(lng / 2)::int = tile.blng
    ),
    existing_osm AS (
      SELECT external_ids->>'osm' AS ident FROM destinations
      WHERE external_ids->>'osm' IS NOT NULL
    ),
    existing_wikidata AS (
      SELECT external_ids->>'wikidata' AS ident FROM destinations
      WHERE external_ids->>'wikidata' IS NOT NULL
    )
    INSERT INTO destinations (
      id, name, search_name, elevation, prominence, location, geohash,
      type, activities, features, owner, country_code, state_code,
      external_ids, metadata, created_at, updated_at
    )
    SELECT
      p.id, p.name, p.search_name, p.elevation, p.prominence, p.location, NULL,
      'point',
      ARRAY['outdoor-trek']::activity_type[],
      ARRAY['summit']::destination_feature[],
      'peaks',
      p.country_code, p.state_code,
      p.external_ids, p.metadata, now(), now()
    FROM prepared p
    -- Three guards, each the negation of one way an existing row could already
    -- be this peak: its own identifier, its Wikidata identity, or a same-named
    -- summit within 500 m. Separate NOT EXISTS clauses rather than one OR, so
    -- each can use its own index; the test is the same either way.
    WHERE
      NOT EXISTS (SELECT 1 FROM existing_osm e WHERE e.ident = p.osm_id)
      AND (
        p.wikidata_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM existing_wikidata e WHERE e.ident = p.wikidata_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM destinations d
        WHERE d.location IS NOT NULL
          AND ST_DWithin(d.location, p.location, 500)
          AND d.search_name = p.search_name
      )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

-- Middle Sister, California. The elevation and the PointZ move together.
UPDATE destinations
SET elevation = 3310.9,
    location = ST_SetSRID(
      ST_MakePoint(ST_X(location::geometry), ST_Y(location::geometry), 3310.9), 4326
    )::geography,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'elevation_source', 'peakbagger',
      'elevation_repair', jsonb_build_object(
        'audit', 'peakbagger-lists-2026-08-21b',
        'was', 3062,
        'reason', 'stored the height of Oregon''s Middle Sister'
      )
    )
WHERE id = 'dQvlhlqanHJh4h4JSkP7'
  AND name = 'Middle Sister'
  AND state_code = 'CA'
  AND elevation = 3062;

DO $$
DECLARE
  expected text[] := ARRAY[
      '30D506AFF3DECCF80536', '7C654D33260F7F45B2B8', '343277F0217AE8E71B42', 'CEF0A74391A0AD09A789',
      'D5514E5AD91E469C5D62', '2E1827D1FFFF72C0A155', 'B192805DB041197D96B5', 'AAAA8EC1849FA2036DC4',
      '3D71C3D05DEC2720BA2E', '374DDE99270FC140F005', 'E92C58EFBD7A7F486310', '7FECAE8A7605E39AC3CD',
      '408CD0F245956DC6F9A7', '4DDC0AF1EE1A0AD948A7', '0E2EC042AA6D2096D3AE', '4A96BAD746B07FEDCB88',
      '79F1CC316D8C9A990407', 'F8EE2FFC7F2574A1BCD0', '8BAE170534A22DD6D254', '7D80FB99E35686AE86F4',
      'BBC65FE6A560F3558464', 'E4C0401BDB75224180EF', '33E139BE5A1C807721A1', 'FB7D97084DDF67BEFC52',
      '6385B9B977BB20DAFCEC', '87B52DDE1641425E00FC', '6628C2FD3B29952BBBB9', 'F69509B66D82505FB858',
      '1B53FE237CE680F3DB3B', 'F508A495C79EFDE6EF0D', 'B7A295966758397F487B', '57053B6E3D19BD8F22EA',
      '03005F77BCA3DCF9E2EE', '645E26DBAC63701B09B9', '3F199A65D0D0FDA9B5D1', 'A8A01E05C7C786AB0D9F',
      '6FEAC771C1B780AEAE34', '9C00DC2862632A3E01CC', '429588EE3D8C2DEAC238', '8938338C97799E68458D',
      'BDB51854C7630AEA04CF', '57F939699CF9B1E9A28A', 'EFD345E44CEAD0C8AF7A', '0FCAD5C78A5D8C9D0448',
      '193224B99F5534E67961', 'C45B7338BD4774132D1C', 'C91D45D3A81A3F611774', '2D39EB65DF828AF48F0B',
      'E25833DD2E6101EF33A8', '95D1AEB93F827699039F', 'EDF67E31B8D6847DF0B4', '74156EAF69C3C8B4657A',
      'F99A94D9E0A77B5D98E3', 'F89C3A277B604E8B1622', '5B4B5B8960745D2516C9', '2FF585F8C53F4544E3B7',
      'CFCC958CB3FAC0E20D89', 'E94FCB4ECF33BF12998A', '106B2BB720A40407DBE9', '64FC578D822C1543A53E',
      'AE1139453830E078A133', '8F8B1AF97055D541DE52', '4F717096289B74E89F35', 'AF6EBA8A0BB6C83736F2',
      '32B22BED1D62B3F836DE', '78CFCFAA550BD6B89ADC', '7F5CB8C0FB656B7DFBB6', '612C3B47DD8D8C14DA6B',
      '582D770B86903CB6C187', '4E99D27A0AECBCA24169', 'BE192B36FB0FE5E71E6A', 'EAD4118060445E2322E4',
      '2C73DE8F23C7BA9B6B80', '16B7C3B40591D342EF8B', 'F392A92D9F914E1CA963', '1EFABB2C69093E67C100',
      '68E436FEB2ACB5A6F587', 'C7DB3DDCAF27EF5915D8', 'A888AA0A1BFF8C0EA37F', '1A9604F845C715D31FAB',
      'A6B0902C6F5BE4D6AFFD', '0FD3B4F4E00BA03A9203', 'F4C2561D765BBF317DFE', '7CD8EB254710E2CB7EF6',
      'CF2AF8F1DB888CB8A5F4', 'B6740BD1E55F705E8407', '3EC67494D4C968E01B69', 'B97C4FD08C31BA25ECE2',
      '8455670EC06E4B4A4437', '6550EE5FA6E0E39E9D33', 'F7400127FB57D8C6A4BA'
  ];
  present int;
  z_off int;
  bad_meta int;
  shared_osm int;
  shared_wikidata int;
BEGIN
  SELECT count(*) INTO present FROM destinations WHERE id = ANY(expected);
  IF present <> 91 THEN
    RAISE EXCEPTION 'western OSM summits: % of 91 rows present', present;
  END IF;

  -- Every catalog row keeps its elevation in the PointZ as well as the column.
  SELECT count(*) INTO z_off FROM destinations
  WHERE id = ANY(expected)
    AND (location IS NULL OR elevation IS NULL
         OR abs(ST_Z(location::geometry) - elevation) > 0.001);
  IF z_off <> 0 THEN
    RAISE EXCEPTION 'western OSM summits: % row(s) whose PointZ disagrees with elevation', z_off;
  END IF;

  SELECT count(*) INTO bad_meta FROM destinations
  WHERE id = ANY(expected)
    AND (metadata->>'catalog_audit' IS DISTINCT FROM 'peakbagger-lists-2026-08-21b'
         OR owner IS DISTINCT FROM 'peaks'
         OR NOT ('summit'::destination_feature = ANY(features))
         OR country_code IS NULL);
  IF bad_meta <> 0 THEN
    RAISE EXCEPTION 'western OSM summits: % row(s) missing provenance, owner, feature or country', bad_meta;
  END IF;

  -- No OSM node id may reach two destinations. That one IS true catalog-wide
  -- today, so it is checked outright rather than scoped to these rows.
  SELECT count(*) INTO shared_osm FROM (
    SELECT external_ids->>'osm' AS osm FROM destinations
    WHERE external_ids->>'osm' IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  ) t;
  IF shared_osm <> 0 THEN
    RAISE EXCEPTION 'western OSM summits: % OSM node id(s) shared by two destinations', shared_osm;
  END IF;

  -- Wikidata ids are NOT unique across this catalog. 305 items are shared by
  -- two or more destinations today, nearly all of them European rows where one
  -- item covers a hill group -- twelve German and Dutch hills share Q1749655.
  -- So this asserts only what the migration answers for: that no Wikidata id it
  -- writes reaches a destination other than the one meant to carry it.
  SELECT count(*) INTO shared_wikidata
  FROM destinations mine
  JOIN destinations other
    ON other.external_ids->>'wikidata' = mine.external_ids->>'wikidata'
   AND other.id <> mine.id
  WHERE mine.id = ANY(expected)
    AND mine.external_ids->>'wikidata' IS NOT NULL;
  IF shared_wikidata <> 0 THEN
    RAISE EXCEPTION 'western OSM summits: % Wikidata id(s) written here also reach another destination', shared_wikidata;
  END IF;

  -- Both Middle Sister rows are pre-existing Firestore-era destinations, not
  -- rows this migration inserts, so a bare schema (test-db/provision.sh; no
  -- Firestore migration ever ran there) never holds them. Gate each check on
  -- the row's existence first: a fresh test database skips the assertion
  -- (nothing to check), while prod -- where both rows are real -- still gets
  -- the strict value check.
  IF EXISTS (SELECT 1 FROM destinations WHERE id = 'dQvlhlqanHJh4h4JSkP7')
     AND NOT EXISTS (
       SELECT 1 FROM destinations
       WHERE id = 'dQvlhlqanHJh4h4JSkP7'
         AND abs(elevation - 3310.9) < 0.001
         AND abs(ST_Z(location::geometry) - 3310.9) < 0.001
     )
  THEN
    RAISE EXCEPTION 'Middle Sister still does not read 3310.9 m in both places';
  END IF;

  IF EXISTS (SELECT 1 FROM destinations WHERE id = 'U0r2Ys42V3pk8j8Hqtje')
     AND NOT EXISTS (
       SELECT 1 FROM destinations
       WHERE id = 'U0r2Ys42V3pk8j8Hqtje' AND abs(elevation - 3062) < 0.001
     )
  THEN
    RAISE EXCEPTION 'the Oregon Middle Sister row moved; it should not have';
  END IF;
END $$;

COMMIT;
