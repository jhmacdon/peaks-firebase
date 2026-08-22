-- 216 summits needed by the Hundred Peaks Section list.
--
-- Each row matched a unique OpenStreetMap natural=peak node read on 2026-08-22. The source-list point is within 598 m of that node, within 100 m for more than nine in ten matches, and each match was checked by name, elevation and distance.
-- Coordinates, elevations and prominence come from the saved Peakbagger list-map fixture; GNIS is not used.
-- Monthly cost impact: $0. This is catalog data only.

BEGIN;

CREATE TEMP TABLE hundred_peaks_osm_incoming (
  id text, name text, elevation double precision, prominence double precision,
  lat double precision, lng double precision,
  osm_id text, wikidata_id text, osm_name text, peakbagger_id text, source_list_id int
) ON COMMIT DROP;

INSERT INTO hundred_peaks_osm_incoming (
  id, name, elevation, prominence, lat, lng,
  osm_id, wikidata_id, osm_name, peakbagger_id, source_list_id
) VALUES
    ('9A2F5CC975F6488B4632', 'Bighorn Mountain', 3354.6593, 121.4933, 34.09065, -116.81861, '11051943989', NULL, 'Bighorn Mountain', '13431', 5052),  -- 5052: Bighorn Mountain
    ('A4D2E249541826525AEB', 'Dragons Head', 3310.6766, 65.8673, 34.08966, -116.83063, '11051944009', NULL, 'Dragon''s Head', '13430', 5052),  -- 5052: Dragons Head
    ('47F39D4087931109E80C', 'Charlton Peak', 3298.2103, 91.7448, 34.1148, -116.85371, '358781954', NULL, 'Charlton Peak', '1413', 5052),  -- 5052: Charlton Peak
    ('5286700F71A437E597DC', 'Shields Peak', 3262.4878, 35.5397, 34.12721, -116.88216, '358808723', NULL, 'Shields Peak', '1408', 5052),  -- 5052: Shields Peak
    ('7C9B6F6500B1AD955211', 'San Bernardino East Peak', 3257.2452, 55.6565, 34.12561, -116.91029, '358802082', NULL, 'San Bernardino East Peak', '1410', 5052),  -- 5052: San Bernardino East Peak
    ('692818683A5F0ED5D093', 'Jean Peak', 3247.1563, 68.4886, 33.80607, -116.67912, '358808173', NULL, 'Jean Peak', '1482', 5052),  -- 5052: Jean Peak
    ('F7036436BC7D659E0155', 'San Bernardino Peak', 3246.2724, 75.1637, 34.12232, -116.92237, '358802080', NULL, 'San Bernardino Peak', '1412', 5052),  -- 5052: San Bernardino Peak
    ('4C77A9C1218EA6FB7CE2', 'Folly Peak', 3194.304, 0, 33.81852, -116.68553, '358808065', NULL, 'Folly Peak', '1479', 5052),  -- 5052: Folly Peak
    ('F70B91CECD9C422447EB', 'Dobbs Peak', 3187.9032, 17.9832, 34.098344, -116.859806, '358783082', NULL, 'Dobbs Peak', '1418', 5052),  -- 5052: Dobbs Peak
    ('20527EA34689D5C85EDA', 'Marion Mountain', 3155.6249, 72.2986, 33.79594, -116.68876, '358808310', NULL, 'Marion Mountain', '1483', 5052),  -- 5052: Marion Mountain
    ('81FF791CED4B7661A3C6', 'Grinnell Mountain', 3135.5995, 149.7787, 34.12508, -116.80765, '358801372', NULL, 'Grinnell Mountain', '1409', 5052),  -- 5052: Grinnell Mountain
    ('3E189BA33DC69B2B3264', 'Newton Drury Peak', 3105.3938, 38.7096, 33.80829, -116.68655, '358795042', NULL, 'Newton Drury Peak', '13432', 5052),  -- 5052: Newton Drury Peak
    ('D4F44B66FDB913D72033', 'Lake Peak', 3097.0728, 0.3048, 34.114573, -116.811744, '358808222', NULL, 'Lake Peak', '1414', 5052),  -- 5052: Lake Peak
    ('93528818384EA9264A94', 'Sugarloaf Mountain', 3033.7963, 594.9391, 34.19888, -116.81431, '358793058', NULL, 'Sugarloaf Mountain', '1402', 5052),  -- 5052: Sugarloaf Mountain
    ('FBAE200590883E0EACA3', 'Cornell Peak', 2967.228, 82.4789, 33.81361, -116.66253, '358782525', 'Q35735967', 'Cornell Peak', '1481', 5052),  -- 5052: Cornell Peak
    ('C080BCE395C76B2C8185', 'Pine Mountain', 2941.6248, 262.6462, 34.31374, -117.64422, '358801914', NULL, 'Pine Mountain', '1332', 5052),  -- 5052: Pine Mountain
    ('6A38B8BB6EF3822B96C6', 'Dawson Peak', 2920.045, 129.7229, 34.30309, -117.63598, '358801158', NULL, 'Dawson Peak', '1336', 5052),  -- 5052: Dawson Peak
    ('C704F36903E92FF750B1', 'Galena Peak', 2841.9552, 13.4112, 34.071055, -116.846416, '358784516', NULL, 'Galena Peak', '1421', 5052),  -- 5052: Galena Peak
    ('543D65F587C473A6C147', 'Little San Gorgonio Peak', 2789.4382, 185.5013, 34.06039, -116.88468, '358801611', NULL, 'Little San Gorgonio Peak', '1425', 5052),  -- 5052: Little San Gorgonio Peak
    ('0791FB3EEE8E6F29F700', 'Onyx Peak', 2779.6541, 205.3438, 34.19266, -116.70958, '2589434463', NULL, 'Onyx Peak', '1404', 5052),  -- 5052: Onyx Peak
    ('1F428CA80AD8556D7659', 'Wysup Peak', 2738.9633, 78.9127, 34.1592, -116.71581, '9201323668', NULL, 'Wysup Peak', '31836', 5052),  -- 5052: Wysup Peak
    ('69D3DC4609638CA24210', 'Mount Hawkins', 2697.48, 27.432, 34.341212, -117.80568, '2174634903', 'Q49052941', 'Mount Hawkins', '1322', 5052),  -- 5052: Mount Hawkins
    ('BB9CC296C1C738ABEB41', 'Red Tahquitz', 2670.2309, 42.4586, 33.75872, -116.65244, '358808597', NULL, 'Red Tahquitz', '1487', 5052),  -- 5052: Red Tahquitz
    ('637240F4F7FF67B24734', 'Wilshire Peak', 2645.664, 12.192, 34.064001, -116.914946, '358804427', NULL, 'Wilshire Peak', '1423', 5052),  -- 5052: Wilshire Peak
    ('EDDDE1ACFDE554E93725', 'Etiwanda Peak', 2639.9033, 88.7578, 34.228321, -117.572526, '2565773426', NULL, 'Etiwanda Peak', '1361', 5052),  -- 5052: Etiwanda Peak
    ('D4A0BCA3F1432F95BE64', 'Castle Rocks', 2622.4992, 88.3006, 33.830451, -116.714767, '358816444', 'Q35733186', 'Castle Rocks', '1477', 5052),  -- 5052: Castle Rocks
    ('0FBB058548ECE7A80E83', 'Thunder Mountain', 2611.5874, 109.728, 34.26535, -117.60601, '358796474', NULL, 'Thunder Mountain', '1349', 5052),  -- 5052: Thunder Mountain
    ('5B6A08B01809F85C7DB9', 'Butler Peak', 2600.3402, 527.8222, 34.2566, -117.00774, '358800985', NULL, 'Butler Peak', '1394', 5052),  -- 5052: Butler Peak
    ('F5B0336DF70B8B7BFB66', 'Middle Hawkins', 2594.4881, 64.2518, 34.33513, -117.81405, '8963693641', NULL, 'Middle Hawkins', '1325', 5052),  -- 5052: Middle Hawkins
    ('F1949661176F72C498B2', 'Wright Mountain', 2593.147, 100.1573, 34.33384, -117.63368, '358802478', NULL, 'Wright Mountain', '1326', 5052),  -- 5052: Wright Mountain
    ('2A2479F897C8374C1A59', 'Bighorn Peak', 2574.036, 102.6566, 34.23368, -117.59744, '358800902', NULL, 'Bighorn Peak', '1359', 5052),  -- 5052: Bighorn Peak
    ('8F2045C77CE182250A85', 'Mount Lewis', 2558.1864, 146.2735, 34.37229, -117.8062, '358787654', 'Q49053403', 'Mount Lewis', '1306', 5052),  -- 5052: Mount Lewis
    ('AE482A1FA5682225842F', 'Delamar Mountain', 2553.4315, 366.0038, 34.29087, -116.94541, '358801183', NULL, 'Delamar Mountain', '1385', 5052),  -- 5052: Delamar Mountain
    ('48309864854EC1BB9719', 'Crafts Peak', 2549.8044, 127.5283, 34.2511, -117.02943, '358801122', NULL, 'Crafts Peak', '1396', 5052),  -- 5052: Crafts Peak
    ('275525797553D1990496', 'Cedar Mountain', 2542.093, 70.6526, 34.06829, -116.92825, '358801046', NULL, 'Cedar Mountain', '1422', 5052),  -- 5052: Cedar Mountain
    ('9DFBDB3CED95AEA01647', 'Heart Bar Peak', 2538.923, 74.8589, 34.1644, -116.76264, '358785639', NULL, 'Heart Bar Peak', '1405', 5052),  -- 5052: Heart Bar Peak
    ('AB464AFC2AD68E339E70', 'Sunday Peak', 2530.8763, 568.8482, 35.78223, -118.5849, '358793098', 'Q49080068', 'Sunday Peak', '2879', 5052),  -- 5052: Sunday Peak
    ('9B3C4239A38B50D2BD5F', 'Cerro Noroeste', 2527.0054, 204.3989, 34.8311, -119.20342, '358802956', 'Q5064949', 'Cerro Noroeste', '1264', 5052),  -- 5052: Cerro Noroeste
    ('3CEFD62028D74D33B475', 'Mount Williamson', 2512.7712, 1.2192, 34.373793, -117.862019, '3647801209', NULL, NULL, '1309', 5052),  -- 5052: Mount Williamson
    ('E145A91D543E78F1D37E', 'Gold Mountain', 2510.6071, 214.7621, 34.28848, -116.83932, '358801335', NULL, 'Gold Mountain', '1387', 5052),  -- 5052: Gold Mountain
    ('417E580DD2B59FB2D7A0', 'Bertha Peak', 2500.3049, 203.1797, 34.28299, -116.89936, '358800887', NULL, 'Bertha Peak', '1389', 5052),  -- 5052: Bertha Peak
    ('CA4889386C64BD32D11F', 'Three Sisters', 2468.7276, 64.3738, 34.14959, -116.66506, '9201323667', NULL, 'Three Sisters', '13429', 5052),  -- 5052: Three Sisters
    ('C699F2630670FB979F9E', 'Santa Rosa Mountain', 2459.3093, 100.8583, 33.53837, -116.4617, '358808699', NULL, 'Santa Rosa Mountain', '1506', 5052),  -- 5052: Santa Rosa Mountain
    ('F345B1D8DBB8E5B7558D', 'Waterman Mountain', 2450.3177, 425.9275, 34.33651, -117.93683, '358796489', 'Q7974334', 'Waterman Mountain', '1324', 5052),  -- 5052: Waterman Mountain
    ('583C94AAA1EE9A9CF916', 'Lily Rock', 2439.7411, 35.2958, 33.76023, -116.68324, '358808250', NULL, 'Lily Rock', '1486', 5052),  -- 5052: Lily Rock
    ('33E1C6637E724BBADE26', 'Pleasant View Ridge', 2435.0167, 310.9874, 34.38995, -117.90924, '4101050147', NULL, 'Pleasant View Ridge', '1301', 5052),  -- 5052: Pleasant View Ridge
    ('C8C75B2559088E92ECC6', 'Grays Peak', 2424.1049, 69.8602, 34.26112, -116.97124, '358804303', NULL, 'Grays Peak', '1391', 5052),  -- 5052: Grays Peak
    ('8A57634F07D626DF6B7A', 'Mount Jenkins', 2419.8072, 273.5275, 35.70879, -117.99282, '358795169', 'Q49053217', 'Mount Jenkins', '2875', 5052),  -- 5052: Mount Jenkins
    ('19953FC120762906E65C', 'South Peak', 2404.3234, 85.0087, 33.74369, -116.64892, '358816481', NULL, 'South Peak', '1489', 5052),  -- 5052: South Peak
    ('1A471A3D16BF42D0BBE6', 'Keller Peak', 2402.3117, 319.979, 34.19596, -117.04954, '358801540', NULL, 'Keller Peak', '1400', 5052),  -- 5052: Keller Peak
    ('82178B202B97435C4539', 'Will Thrall Peak', 2393.7163, 54.2544, 34.38439, -117.90247, '358802455', 'Q49090127', 'Will Thrall Peak', '1303', 5052),  -- 5052: Will Thrall Peak
    ('26F0929029CE29AF8130', 'Slide Peak', 2391.5218, 101.5898, 34.20393, -117.03634, '358792724', NULL, 'Slide Peak', '1401', 5052),  -- 5052: Slide Peak
    ('655EAAE0DFF987E57243', 'Birch Mountain', 2387.1936, 87.569, 34.0761, -116.94759, '358800908', NULL, 'Birch Mountain', '1420', 5052),  -- 5052: Birch Mountain
    ('01CBED282831327AD850', 'South Mount Hawkins', 2374.2091, 95.6767, 34.31184, -117.81038, '358785559', 'Q7567986', 'South Mount Hawkins', '1334', 5052),  -- 5052: South Mount Hawkins
    ('3D27EB6C67CB97B5B30A', 'Black Mountain', 2369.759, 140.1775, 33.82429, -116.75769, '358800917', 'Q35727792', 'Black Mountain', '1478', 5052),  -- 5052: Black Mountain
    ('2E3AA20ED7ADB0FE431C', 'Pallett Mountain', 2369.6066, 142.8598, 34.38564, -117.88557, '358808463', NULL, 'Pallett Mountain', '1302', 5052),  -- 5052: Pallett Mountain
    ('CB2ED3FDDE4365716CE3', 'Twin Peaks', 2368.6922, 377.1595, 34.31587, -117.92662, '358795142', 'Q49086145', 'Twin Peaks', '1330', 5052),  -- 5052: Twin Peaks
    ('7D2D51DEB2457B781B06', 'White Mountain', 2356.3783, 84.521, 34.35088, -117.01465, '358802444', NULL, 'White Mountain', '1373', 5052),  -- 5052: White Mountain
    ('64A1D06AE8CD7F31E73E', 'Antsell Rock', 2355.6163, 162.7022, 33.73017, -116.64137, '358800779', 'Q35724341', 'Antsell Rock', '1490', 5052),  -- 5052: Antsell Rock
    ('ECE8CBE6BED764CD8A8D', 'Sorrell Peak', 2348.0878, 304.1904, 35.41759, -118.28908, '358802204', 'Q49075665', 'Sorrell Peak', '2897', 5052),  -- 5052: Sorrell Peak
    ('2B88CCA8ACD492DA56BB', 'Tip Top Mountain', 2324.3743, 217.0176, 34.25172, -116.69155, '358802318', NULL, 'Tip Top Mountain', '1395', 5052),  -- 5052: Tip Top Mountain
    ('ECF4AA5D6927ACAD2C2D', 'Little Bear Peak', 2321.3568, 75.4075, 34.2913, -116.97045, '3420876499', NULL, 'Little Bear Peak', '1384', 5052),  -- 5052: Little Bear Peak
    ('3BA88B05A7A4E1519A09', 'Apache Peak', 2309.3172, 204.917, 33.71865, -116.62693, '358800785', 'Q35724349', 'Apache Peak', '1491', 5052),  -- 5052: Apache Peak
    ('05CC4E62809C73502F91', 'Goodykoontz Peak', 2308.5552, 73.091, 34.36996, -117.88346, '3038274253', NULL, 'Goodykoontz peak', '13435', 5052),  -- 5052: Goodykoontz Peak
    ('4410D67E940274E04B6B', 'Granite Peaks', 2294.6868, 200.345, 34.29768, -116.72678, '358801361', NULL, 'East Peak', '1380', 5052),  -- 5052: Granite Peaks
    ('134B766EA7311D95485C', 'Kratka Ridge', 2294.2601, 234.8484, 34.34662, -117.89912, '12756657045', NULL, 'Kratka Ridge', '1319', 5052),  -- 5052: Kratka Ridge
    ('71D6A600D2A1731E6894', 'Reyes Peak', 2291.0902, 640.2629, 34.63086, -119.28165, '358802009', NULL, 'Reyes Peak', '1279', 5052),  -- 5052: Reyes Peak
    ('F58040D5177DACD6EA39', 'Spitler Peak', 2290.9073, 151.8514, 33.70228, -116.62223, '358808768', NULL, 'Spitler Peak', '1492', 5052),  -- 5052: Spitler Peak
    ('C519D9FD9B71FB82D11F', 'Winston Peak', 2285.0551, 144.3533, 34.35834, -117.93591, '358794844', 'Q49090598', 'Winston Peak', '1311', 5052),  -- 5052: Winston Peak
    ('8293965915B015EDACC6', 'Black Mountain', 2269.4189, 438.8815, 35.74168, -118.52378, '358800924', 'Q35727736', 'Black Mountain', '2882', 5052),  -- 5052: Black Mountain
    ('03F85FAA09D061E28CA7', 'Haddock Mountain', 2267.5291, 182.8495, 34.62352, -119.24084, '9727695942', NULL, 'Haddock Mountain', '1280', 5052),  -- 5052: Haddock Mountain
    ('6B3DDC3B57E986707EB1', 'Ross Mountain', 2256.5868, 46.6039, 34.32502, -117.75649, '358791374', 'Q49069478', 'Ross Mountain', '1328', 5052),  -- 5052: Ross Mountain
    ('D37D6987514140C1D5AA', 'Alamo Mountain', 2255.3676, 768.4008, 34.66703, -118.95889, '358807755', 'Q35723818', 'Alamo Mountain', '1283', 5052),  -- 5052: Alamo Mountain
    ('34C02135159EDF2AFF77', 'Mount Akawie', 2222.9674, 118.7501, 34.35236, -117.91685, '2384861809', NULL, 'Akawie Peak', '1314', 5052),  -- 5052: Mount Akawie
    ('3513CE69BB10DE96CC5A', 'Wild View Peak', 2212.2384, 17.6784, 34.312568, -117.675204, '12070810624', NULL, 'Wild View Peak', '30952', 5052),  -- 5052: Wild View Peak
    ('2CD677C258658E6F5D6B', 'Mineral Mountain', 2208.1236, 47.9755, 34.23675, -116.68159, '358801744', NULL, 'Mineral Mountain', '1398', 5052),  -- 5052: Mineral Mountain
    ('9C694DBFE948AF08F82A', 'Morris Peak', 2200.8998, 217.8101, 35.69044, -117.98732, '358789434', 'Q49051631', 'Morris Peak', '2876', 5052),  -- 5052: Morris Peak
    ('63562B8C70D5D8177533', 'Tecuya Mountain', 2186.3914, 389.5039, 34.84248, -118.98178, '358802275', 'Q7692923', 'Tecuya Mountain', '1263', 5052),  -- 5052: Tecuya Mountain
    ('EB5B8D731ADE66C4F680', 'Palm View Peak', 2186.2085, 358.0486, 33.67913, -116.5908, '358808470', NULL, 'Palm View Peak', '1493', 5052),  -- 5052: Palm View Peak
    ('F501E6DED419E42822F7', 'Skinner Peak', 2173.6507, 263.1643, 35.56697, -118.12707, '358803128', 'Q49074284', 'Skinner Peak', '2887', 5052),  -- 5052: Skinner Peak
    ('2B855766018F15CF259E', 'Pacifico Mountain', 2171.3038, 476.189, 34.38188, -118.03458, '358801861', 'Q49059274', 'Pacifico Mountain', '1304', 5052),  -- 5052: Pacifico Mountain
    ('FD0BA2355A3027182C05', 'Pyramid Peak', 2154.997, 93.9698, 33.65283, -116.57247, '358790885', NULL, 'Pyramid Peak', '1495', 5052),  -- 5052: Pyramid Peak
    ('E355D30D24FC973CEDD4', 'Pine Mountain', 2148.2609, 89.5198, 33.64884, -116.56052, '358790620', NULL, 'Pine Mountain', '1496', 5052),  -- 5052: Pine Mountain
    ('60214422C23C35421550', 'Gobblers Knob', 2115.6168, 97.475, 34.3136, -117.59496, '7576486106', NULL, 'Gobblers Knob', '1333', 5052),  -- 5052: Gobblers Knob
    ('5528207AFFE5124FAA94', 'Thorn Point', 2114.0623, 182.9714, 34.60652, -119.12807, '358802303', NULL, 'Thorn Point', '1281', 5052),  -- 5052: Thorn Point
    ('B1F8C5FEDE221A254950', 'Sugarloaf Peak', 2110.4352, 13.4112, 34.241587, -117.634613, '358802234', NULL, 'Sugarloaf Peak', '1356', 5052),  -- 5052: Sugarloaf Peak
    ('F8F189E7FE48CA2AF3B6', 'Heald Peak', 2104.5526, 223.266, 35.59007, -118.31005, '358785628', 'Q49035745', 'Heald Peak', '2891', 5052),  -- 5052: Heald Peak
    ('8260FA5E617374383699', 'Lion Peak', 2095.6829, 67.117, 33.64105, -116.57183, '358787909', NULL, 'Lion Peak', '1497', 5052),  -- 5052: Lion Peak
    ('844FEF098CA5FEDB11AE', 'McDonald Peak', 2095.6524, 84.7649, 34.63342, -118.94056, '358801713', NULL, 'McDonald Peak', '1287', 5052),  -- 5052: McDonald Peak
    ('3033E7A0601B472A92C0', 'Cone Peak', 2088.3677, 79.6442, 33.6669, -116.59872, '358807949', 'Q35735654', 'Cone Peak', '13433', 5052),  -- 5052: Cone Peak
    ('339E031B26768001336F', 'Split Mountain', 2084.131, 328.7268, 35.75173, -118.48207, '358808771', 'Q49076491', 'Split Mountain', '2881', 5052),  -- 5052: Split Mountain
    ('F04D4265E979BB1FE765', 'Sewart Mountain', 2083.8262, 119.9388, 34.64063, -118.90707, '358802155', NULL, 'Sewart Mountain', '1286', 5052),  -- 5052: Sewart Mountain
    ('109B652B95FE87CD71E5', 'Thomas Mountain', 2083.0642, 606.7044, 33.61965, -116.68115, '358802296', NULL, 'Thomas Mountain', '1500', 5052),  -- 5052: Thomas Mountain
    ('6EBFDBFE69FE8DB2A5FD', 'Lookout Mountain', 2082.1498, 46.6039, 34.2487, -117.67516, '358801634', 'Q49046579', 'Lookout Mountain', '1352', 5052),  -- 5052: Lookout Mountain
    ('E7882B17D850C5F7D277', 'Big Pine Mountain', 2079.6504, 670.1638, 34.69716, -119.65317, '358807814', 'Q4906126', 'Big Pine Mountain', '1252', 5052),  -- 5052: Big Pine Mountain
    ('A5F8D614E3600A737D23', 'Bohna Peak', 2072.3352, 91.6534, 35.75983, -118.59456, '358807839', 'Q35728613', 'Bohna Peak', '2880', 5052),  -- 5052: Bohna Peak
    ('2D74B527BB436FCD4C77', 'Pinyon Peak', 2071.0246, 138.6535, 35.68224, -118.08981, '358790649', 'Q49062319', 'Pinyon Peak', '2884', 5052),  -- 5052: Pinyon Peak
    ('B859DDCB7E977D0B411C', 'Hawes Peak', 2060.8747, 87.0204, 34.2993, -117.05235, '358801401', NULL, 'Hawes Peak', '1379', 5052),  -- 5052: Hawes Peak
    ('8BF945EB02D13E5071D9', 'Silver Peak', 2060.1737, 285.0794, 34.33767, -116.81055, '358802176', NULL, 'Silver Peak', '1374', 5052),  -- 5052: Silver Peak
    ('CA5699CA233D6451EC3F', 'Shay Mountain', 2049.8714, 258.5009, 34.30841, -117.08629, '358802159', NULL, 'Shay Mountain', '1377', 5052),  -- 5052: Shay Mountain
    ('62630BEDE304E008F0CA', 'Mill Peak', 2039.3254, 93.6041, 34.19214, -117.08092, '358801741', NULL, 'Mill Peak', '1403', 5052),  -- 5052: Mill Peak
    ('0F5B4B30A07E80BD7657', 'Russell Peak', 2038.5938, 222.5954, 35.67382, -117.95804, '9133407865', NULL, 'Russell Peak', '13423', 5052),  -- 5052: Russell Peak
    ('6AAC4CF77026998F3BC6', 'San Rafael Peak', 2031.7968, 241.9502, 34.62383, -119.0015, '358792164', NULL, 'San Rafael Peak', '1289', 5052),  -- 5052: San Rafael Peak
    ('98102B0418C8176DD5D8', 'Backus Peak', 2028.5354, 84.7649, 35.65739, -117.93452, '9133466919', NULL, 'Backus Peak', '13424', 5052),  -- 5052: Backus Peak
    ('4EC552F6E7C03A3C41DD', 'Little Shay Mountain', 2025.335, 109.9718, 34.29743, -117.07356, '358801613', NULL, 'Little Shay Mountain', '1381', 5052),  -- 5052: Little Shay Mountain
    ('C9CDFE53DB6A93A05C88', 'Constance Peak', 2025.2741, 262.8595, 34.13842, -116.9969, '358801095', NULL, 'Constance Peak', '1407', 5052),  -- 5052: Constance Peak
    ('F15DF3FAADD8954641BF', 'San Guillermo Mountain', 2014.3013, 337.0478, 34.69537, -119.14788, '358795929', NULL, 'San Guillermo Mountain', '1278', 5052),  -- 5052: San Guillermo Mountain
    ('616374AF524E3C21D5B4', 'Granite Mountain', 2011.1618, 113.9952, 34.37161, -118.0709, '358804299', 'Q49032740', 'Granite Mountain', '1307', 5052),  -- 5052: Granite Mountain
    ('822FE10FF15DAF720E1B', 'San Rafael Mountain', 2010.4913, 380.5123, 34.71099, -119.81408, '358792162', NULL, 'San Rafael Mountain', '1250', 5052),  -- 5052: San Rafael Mountain
    ('088138F20A153C696969', 'Snowy Peak', 1992.4776, 208.9404, 34.6495, -118.88883, '358802202', NULL, 'Snowy Peak', '1285', 5052),  -- 5052: Snowy Peak
    ('74FBE1A738E0E7F4DF5F', 'Mount Gleason', 1990.3745, 492.6178, 34.3766, -118.17731, '358808091', 'Q49052827', 'Mount Gleason', '1305', 5052),  -- 5052: Mount Gleason
    ('8DA3168EF63F6555EFD2', 'Buck Point', 1962.7291, 202.8749, 34.21584, -117.54227, '9121215173', NULL, 'Buck Point', '1367', 5052),  -- 5052: Buck Point
    ('A475A5DEF9E1937C7405', 'Lightner Peak', 1958.6143, 179.8015, 35.52955, -118.56267, '358801587', 'Q49044175', 'Lightner Peak', '2893', 5052),  -- 5052: Lightner Peak
    ('7826452C4C6FCB25463A', 'Bare Mountain', 1950.5676, 188.9455, 34.3982, -117.99183, '358800857', 'Q35725860', 'Bare Mountain', '1299', 5052),  -- 5052: Bare Mountain
    ('F10BB514CC55B0F4061B', 'Topatopa Bluff', 1940.6616, 14.3256, 34.498673, -119.107188, '9074640454', NULL, 'Topatopa Bluff', '13427', 5052),  -- 5052: Topatopa Bluff
    ('DF1D1BEB8B76FAB76706', 'Weldon Peak', 1938.3451, 74.3407, 35.35641, -118.29056, '358804421', 'Q49088029', 'Weldon Peak', '13425', 5052),  -- 5052: Weldon Peak
    ('0D092A8A81B08AC22611', 'Ingham Peak', 1937.004, 22.86, 34.290919, -117.077584, '358801477', NULL, 'Ingham Peak', '1386', 5052),  -- 5052: Ingham Peak
    ('04C56E90128FB1A27CD6', 'Round Top', 1925.8788, 69.7992, 34.35265, -118.06785, '358791399', 'Q49070168', 'Roundtop', '1315', 5052),  -- 5052: Round Top
    ('AD5EE0BD901273C55142', 'Butterfly Peak', 1914.6926, 94.7014, 33.62171, -116.5806, '358800989', 'Q35730938', 'Butterfly Peak', '1499', 5052),  -- 5052: Butterfly Peak
    ('AF527DF77D5450560077', 'Monument Peak', 1913.4125, 106.0704, 32.89231, -116.42065, '358801760', NULL, 'Monument Peak', '1465', 5052),  -- 5052: Monument Peak
    ('5BCD120CA7B92264A44A', 'Lockwood Peak', 1912.2847, 195.5292, 34.70956, -119.06977, '358795945', NULL, 'Lockwood Peak', '1277', 5052),  -- 5052: Lockwood Peak
    ('30585842E6FC167FF2ED', 'White Mountain', 1905.9144, 260.543, 34.63149, -118.84811, '358802446', NULL, 'White Mountain', '1288', 5052),  -- 5052: White Mountain
    ('A4F67E3DF1D49B57CE9C', 'Samon Peak', 1898.3554, 93.8784, 34.73482, -119.64613, '358802070', NULL, 'Samon Peak', '1249', 5052),  -- 5052: Samon Peak
    ('AF0D40796A9C799A556F', 'McKinley Mountain', 1897.319, 136.8552, 34.70247, -119.84533, '358808320', NULL, 'McKinley Mountain', '1251', 5052),  -- 5052: McKinley Mountain
    ('B5B57438EB6133A67655', 'Black Mountain', 1891.1011, 174.3151, 34.65413, -118.86179, '358800921', 'Q35727933', 'Black Mountain', '1284', 5052),  -- 5052: Black Mountain
    ('A08DB9819F1A153230ED', 'Mount Hillyer', 1889.5771, 98.4504, 34.345626, -118.020427, '358801437', 'Q49053033', 'Mount Hillyer', '1317', 5052),  -- 5052: Mount Hillyer
    ('612FD03BACE9A224B971', 'Combs Peak', 1887.6569, 408.8892, 33.39446, -116.60572, '358782404', 'Q35735601', 'Combs Peak', '1449', 5052),  -- 5052: Combs Peak
    ('A42F3697DD1BC38E353A', 'Bald Eagle Peak', 1883.6945, 82.4484, 35.54498, -118.47877, '358800834', 'Q35724829', 'Bald Eagle Peak', '2892', 5052),  -- 5052: Bald Eagle Peak
    ('BCDF38EE193E33D37572', 'Black Mountain', 1875.4039, 122.1943, 34.23273, -116.58853, '358780846', NULL, 'Black Mountain', '1399', 5052),  -- 5052: Black Mountain
    ('21ECF55314DE3C0F7838', 'San Ysidro Benchmark', 1871.8378, 9.1135, 33.254116, -116.498425, '358802110', NULL, 'San Ysidro Mountain', '1455', 5052),  -- 5052: San Ysidro Benchmark
    ('F1E4C5C0D7990123B720', 'Rattlesnake Mountain', 1870.2833, 122.2858, 34.35559, -117.08565, '358801983', NULL, 'Rattlesnake Mountain', '13428', 5052),  -- 5052: Rattlesnake Mountain
    ('F6F489388B7B83CFA456', 'Mayan Peak', 1862.4499, 267.1877, 35.46409, -118.19551, '358788784', 'Q49048445', 'Mayan Peak', '2888', 5052),  -- 5052: Mayan Peak
    ('B2C6E95BC9227C825EAC', 'Nicolls Peak', 1852.5439, 293.0957, 35.6197, -118.29705, '358796450', 'Q49056926', 'Nicolls Peak', '2890', 5052),  -- 5052: Nicolls Peak
    ('565AAD4C888A2E26AE3D', 'Monte Arido', 1832.8538, 353.9947, 34.53939, -119.4668, '358801756', NULL, 'Monte Arido', '1275', 5052),  -- 5052: Monte Arido
    ('0A8FC16C6DD34EE8BBE1', 'Butterbredt Peak', 1829.2267, 203.6369, 35.38374, -118.15364, '358796365', 'Q35730912', 'Butterbredt Peak', '2889', 5052),  -- 5052: Butterbredt Peak
    ('D968A27608B269A71D40', 'Luna Mountain', 1819.595, 174.7723, 34.34403, -117.12804, '358801669', NULL, 'Luna Mountain', '1372', 5052),  -- 5052: Luna Mountain
    ('3D6FB98CE67F46EDFC5C', 'Mount Disappointment', 1817.5834, 64.5262, 34.24645, -118.1052, '358807978', 'Q6920446', 'Mount Disappointment', '1353', 5052),  -- 5052: Mount Disappointment
    ('07ADA246807A163D2F47', 'Mount Lawlor', 1816.8823, 227.0455, 34.27072, -118.10385, '351571186', 'Q49053366', 'Mount Lawlor', '1347', 5052),  -- 5052: Mount Lawlor
    ('FE6B099B4F1F7C8BD8C8', 'Garnet Peak', 1801.0632, 143.6218, 32.92571, -116.45871, '453970862', NULL, 'Garnet Peak', '1464', 5052),  -- 5052: Garnet Peak
    ('0CE3DC34BC672B9E6D87', 'Middle Peak', 1798.5029, 237.7745, 32.98025, -116.60024, '358801732', NULL, 'Middle Peak', '1459', 5052),  -- 5052: Middle Peak
    ('C6FBBE42FBCC8B389FE3', 'Sheephead Mountain', 1798.1066, 166.3294, 32.82123, -116.46377, '358802161', NULL, 'Sheephead Mountain', '1469', 5052),  -- 5052: Sheephead Mountain
    ('1A97321797A39AD6987D', 'Bighorn Mountain', 1796.4912, 4.2672, 34.309365, -116.631182, '9632166464', NULL, 'Bighorn Mountains', '1376', 5052),  -- 5052: Bighorn Mountain
    ('76F4FB2CD8C26776D50B', 'Cuyama Peak', 1792.9555, 378.4702, 34.75401, -119.47614, '358801144', NULL, 'Cuyama Peak', '1269', 5052),  -- 5052: Cuyama Peak
    ('2B8F409AC0EA5C4E1EEC', 'Mount Mooney', 1782.6838, 69.5858, 34.3058, -118.00718, '358804329', 'Q49053665', 'Mount Mooney', '1335', 5052),  -- 5052: Mount Mooney
    ('5BDB01622E75BE8740F1', 'Peak Mountain', 1781.0683, 401.4216, 34.90216, -119.85874, '358801890', NULL, 'Peak Mountain', '1246', 5052),  -- 5052: Peak Mountain
    ('033175390232278424C2', 'Rattlesnake Peak', 1775.6429, 284.287, 34.27187, -117.77701, '358832779', 'Q49066875', 'Rattlesnake Peak', '1346', 5052),  -- 5052: Rattlesnake Peak
    ('FC530C8ACD51323FB28B', 'Sunset Peak', 1767.5047, 387.8885, 34.2166, -117.68938, '358802254', 'Q49080227', 'Sunset Peak', '1366', 5052),  -- 5052: Sunset Peak
    ('89B79D63011568FAA2BF', 'Mount Deception', 1767.4133, 82.1741, 34.24899, -118.11469, '6050413125', NULL, 'Mount Deception', '1351', 5052),  -- 5052: Mount Deception
    ('0D4492CCC07E59B3A385', 'Allen Peak', 1767.1999, 186.2023, 34.08087, -116.98659, '358800745', NULL, 'Allen Peak', '1419', 5052),  -- 5052: Allen Peak
    ('2A983CBF508C925B82C0', 'Indian Mountain', 1765.9198, 254.2642, 33.78205, -116.78845, '358801474', NULL, 'Indian Mountain', '1484', 5052),  -- 5052: Indian Mountain
    ('8F063DBC1468A4E12595', 'Liebre Mountain', 1763.6338, 325.0387, 34.7164, -118.66495, '358808244', 'Q49044160', 'Liebre Mountain', '1293', 5052),  -- 5052: Liebre Mountain
    ('1AEDC842D65B75AC041E', 'Iron Spring Mountain', 1756.471, 330.0984, 33.45326, -116.69725, '358786392', NULL, 'Iron Spring Mountain', '1446', 5052),  -- 5052: Iron Spring Mountain
    ('2EDC7AD12693B102E9F5', 'McPherson Peak', 1752.6914, 146.9441, 34.8887, -119.81321, '358801716', NULL, 'McPherson Peak', '1247', 5052),  -- 5052: McPherson Peak
    ('AD6B01820AA10FF58E1B', 'Mount Markham', 1750.5578, 139.2631, 34.23675, -118.0992, '358788670', 'Q49053537', 'Mount Markham', '1357', 5052),  -- 5052: Mount Markham
    ('7524FD465ECCDBB08AD0', 'Villager Peak', 1750.5274, 171.9986, 33.38824, -116.21914, '358794195', NULL, 'Villager Peak', '1509', 5052),  -- 5052: Villager Peak
    ('B80EF1BF3D713B83B09C', 'The Pinnacles', 1750.0702, 274.7467, 34.307172, -117.228134, '358802292', NULL, 'The Pinnacles', '1378', 5052),  -- 5052: The Pinnacles
    ('9252081E7F80FFE9A8EA', 'Occidental Peak', 1748.3023, 70.866, 34.23497, -118.08368, '3238713826', 'Q49058174', 'Occidental Peak', '1358', 5052),  -- 5052: Occidental Peak
    ('70748A88DF088DFEDF00', 'Cush-Pii', 1746.3821, 260.8174, 32.96082, -116.57198, '358802225', NULL, 'Cush-Pii', '1460', 5052),  -- 5052: Cush-Pii
    ('D7D63B1AA5C448FB1C42', 'Garnet Mountain', 1738.8535, 73.0606, 32.93814, -116.48569, '358801293', NULL, 'Garnet Mountain', '1462', 5052),  -- 5052: Garnet Mountain
    ('343C405DD5A6135458FE', 'Bailey Peak', 1736.1408, 291.9374, 34.25823, -117.36667, '9341795320', NULL, 'Bailey Peak', '25543', 5052),  -- 5052: Bailey Peak
    ('67269B7CF3DE78951307', 'Queen Mountain', 1734.0682, 382.9202, 34.05238, -116.09948, '358808569', 'Q49066155', 'Queen Mountain', '1511', 5052),  -- 5052: Queen Mountain
    ('8F827717F6FAC1554633', 'Cahuilla Mountain', 1718.8282, 485.1502, 33.57378, -116.78278, '358801003', 'Q35732464', 'Cahuilla Mountain', '1445', 5052),  -- 5052: Cahuilla Mountain
    ('BAB35A24AF914A8EF4AF', 'Iron Mountain', 1718.6148, 176.2963, 34.34875, -118.22917, '347424406', 'Q49039000', 'Iron Mountain', '1318', 5052),  -- 5052: Iron Mountain
    ('151893075B54AC904797', 'Granite Mountain', 1717.5785, 604.6927, 33.05113, -116.47951, '358801360', NULL, 'Granite Mountain', '1457', 5052),  -- 5052: Granite Mountain
    ('AFA85CDCF46404C608A2', 'Cole Point', 1709.4708, 98.237, 34.42159, -118.07207, '9331239486', NULL, 'Cole Point', '1298', 5052),  -- 5052: Cole Point
    ('FB5088AC3311C0BF855C', 'Mount Lowe', 1708.0078, 89.093, 34.23214, -118.10619, '358788235', 'Q6921904', 'Mount Lowe', '1360', 5052),  -- 5052: Mount Lowe
    ('F65D6992BEA04CA9DD71', 'Lookout Mountain', 1703.8015, 187.0253, 33.55336, -116.57412, '358801631', 'Q30607637', 'Lookout Mountain', '1505', 5052),  -- 5052: Lookout Mountain
    ('CD8126307FBB2BF9C83B', 'Chief Peak', 1703.3443, 261.427, 34.51053, -119.1679, '358802617', 'Q35734312', 'Chief Peak', '1282', 5052),  -- 5052: Chief Peak
    ('5A3BF8DC4479314F6388', 'Santa Cruz Peak', 1703.0395, 161.3306, 34.66924, -119.81177, '358792243', NULL, 'Santa Cruz Peak', '1255', 5052),  -- 5052: Santa Cruz Peak
    ('B88B6943631AF6E2C02A', 'Mount Inspiration', 1701.0278, 254.2946, 33.93575, -116.19551, '4588137509', NULL, 'Inspiration Peak', '1520', 5052),  -- 5052: Mount Inspiration
    ('73FD9B710B727539F24F', 'Josephine Peak', 1695.0842, 212.8418, 34.28563, -118.15381, '358801529', 'Q49040240', 'Josephine Peak', '1341', 5052),  -- 5052: Josephine Peak
    ('C7BBD13EBA8844BD5ECF', 'Beauty Peak', 1692.6763, 131.2774, 33.4397, -116.72397, '358780483', 'Q35726727', 'Beauty Peak', '1447', 5052),  -- 5052: Beauty Peak
    ('79F40196FDF1F7917FC1', 'Chaparrosa Peak', 1692.2496, 95.0976, 34.15003, -116.56524, '358781938', NULL, 'Chaparrosa Peak', '1406', 5052),  -- 5052: Chaparrosa Peak
    ('648AA0F2DDDA38CDD138', 'Old Man Mountain', 1689.1102, 166.2684, 34.51699, -119.45328, '358801844', NULL, 'Old Man Mountain', '1276', 5052),  -- 5052: Old Man Mountain
    ('8B20F661C20CAE455180', 'Deer Mountain', 1687.4642, 62.0268, 34.29342, -117.11158, '358801170', NULL, 'Deer Mountain', '1383', 5052),  -- 5052: Deer Mountain
    ('A9DDEB7DD748E44126FF', 'Eureka Peak', 1681.8864, 23.7744, 34.032488, -116.350313, '3453149593', 'Q5411211', 'Eureka Peak', '1516', 5052),  -- 5052: Eureka Peak
    ('6BE25BBFF5524DB34E89', 'Mount Marie Louise', 1680.8501, 170.8099, 34.284424, -117.239613, '6673182889', NULL, 'Mount Marie Louise', '1388', 5052),  -- 5052: Mount Marie Louise
    ('E5760D93C0A35518AB91', 'Sugarpine Mountain', 1670.1821, 70.2259, 34.26011, -117.3771, '9341795298', NULL, 'Sugarpine Mountain', '1392', 5052),  -- 5052: Sugarpine Mountain
    ('48949DE61329C98B4E5A', 'Little Berdoo Peak', 1666.1587, 323.7281, 33.86123, -116.08901, '7556757628', NULL, 'Little Berdoo Point', '1522', 5052),  -- 5052: Little Berdoo Peak
    ('5FC99BB2BB64B2F0DF34', 'Ryan Mountain', 1665.031, 280.4465, 33.98625, -116.13469, '358795804', 'Q22078113', 'Ryan Mountain', '1518', 5052),  -- 5052: Ryan Mountain
    ('4DF9BAF53DE416CA951A', 'Boucher Hill', 1661.5562, 88.9102, 33.33498, -116.91958, '358800950', 'Q35728861', 'Boucher Hill', '1453', 5052),  -- 5052: Boucher Hill
    ('EB6A019EA134316F580C', 'Condor Peak', 1658.8435, 204.2465, 34.32565, -118.21888, '346349212', 'Q35735624', 'Condor Peak', '1327', 5052),  -- 5052: Condor Peak
    ('60B7DB7BB30775921561', 'Bernard Peak', 1655.064, 21.336, 33.868555, -116.080449, '7556739330', NULL, 'Bernard Point', '1521', 5052),  -- 5052: Bernard Peak
    ('A7DCA1933D3EB4AB0C39', 'Mount Sally', 1650.6444, 137.6782, 34.27245, -118.0142, '358791983', 'Q49054449', 'Mount Sally', '1345', 5052),  -- 5052: Mount Sally
    ('8461D1FE311F6A004B6D', 'Monrovia Peak', 1649.5776, 458.0839, 34.21321, -117.96952, '1309769736', 'Q49051020', 'Monrovia Peak', '1369', 5052),  -- 5052: Monrovia Peak
    ('4F1734E9E5FE8A44D92C', 'Mount Minerva Hoyt', 1648.7546, 63.0936, 34.0133, -116.22676, '4588162005', 'Q49053635', 'Mt. Minerva Hoyt', '34287', 5052),  -- 5052: Mount Minerva Hoyt
    ('33B45210C5C7B7DED90B', 'Cajon Mountain', 1633.667, 131.6736, 34.27239, -117.4199, '8541825049', NULL, 'Cajon Mountain', '1390', 5052),  -- 5052: Cajon Mountain
    ('66E3B5F0BD2D3D829FFF', 'Whale Peak', 1630.3142, 822.0456, 33.02942, -116.31614, '358794606', NULL, 'Whale Peak', '1458', 5052),  -- 5052: Whale Peak
    ('273C68D9426CF8721D7C', 'Cleghorn Mountain', 1626.4128, 242.316, 34.29384, -117.41259, '358801078', 'Q35734964', 'Cleghorn Mountain', '1382', 5052),  -- 5052: Cleghorn Mountain
    ('CFF473CB92E552E6BA44', 'Lizard Head', 1621.536, 12.192, 34.69911, -119.479853, '358801624', NULL, 'Lizard Head', '1270', 5052),  -- 5052: Lizard Head
    ('DE2B67B93DEDAF4761B4', 'Lost Horse Mountain', 1618.2442, 127.8941, 33.93656, -116.13624, '358808282', 'Q49046902', 'Lost Horse Mountain', '1519', 5052),  -- 5052: Lost Horse Mountain
    ('3850195B54BFAA489162', 'Rabbit Peak', 1617.8784, 64.1299, 34.35699, -118.09521, '358790922', 'Q49066284', 'Rabbit Peak', '1313', 5052),  -- 5052: Rabbit Peak
    ('A2C8B800ECB41013F7B6', 'Rock Point', 1616.0496, 60.899, 33.59898, -116.58787, '358808618', NULL, 'Rock Point', '1502', 5052),  -- 5052: Rock Point
    ('0DD75A9E6254C6D66538', 'Round Mountain', 1608.3382, 106.1618, 34.36172, -117.14365, '358802039', NULL, 'Round Mountain', '1371', 5052),  -- 5052: Round Mountain
    ('55EF26B070B9A7DEBCB6', 'Mount Emma', 1607.6981, 234.7874, 34.46052, -118.06858, '358801239', 'Q49052612', 'Mount Emma', '1297', 5052),  -- 5052: Mount Emma
    ('93F1BB94E5FB145878D0', 'Asbestos Mountain', 1605.1378, 378.8969, 33.627613, -116.459142, '358800811', 'Q35724498', 'Asbestos Mountain', '1498', 5052),  -- 5052: Asbestos Mountain
    ('2F33DFEDC64D8E1D027F', 'Red Mountain', 1604.1624, 630.0826, 35.34869, -117.58405, '358791038', NULL, 'Red Mountain', '3775', 5052),  -- 5052: Red Mountain
    ('3EB281FE42BA36703691', 'San Sevaine', 1602.4555, 50.9626, 34.21696, -117.48982, '9121203028', NULL, 'San Sevaine', '1365', 5052),  -- 5052: San Sevaine
    ('CCE8EA75275C5194B0F5', 'Black Mountain', 1598.7674, 597.6214, 35.47506, -117.84248, '358780867', 'Q35727728', 'Black Mountain', '3773', 5052),  -- 5052: Black Mountain
    ('A81066E403702E209A6F', 'Onyx Peak', 1596.7253, 141.8844, 35.65686, -118.22679, '358801856', 'Q49058724', 'Onyx Peak', '2885', 5052),  -- 5052: Onyx Peak
    ('A2CFAA22F8DB745AB198', 'Cross Mountain', 1586.6974, 304.099, 35.27896, -118.13667, '358782713', 'Q35736524', 'Cross Mountain', '2898', 5052),  -- 5052: Cross Mountain
    ('C1734A7E4C32D7E0F67F', 'Sawtooth Mountain', 1585.2038, 164.5006, 34.66062, -118.55283, '358792352', 'Q49071614', 'Sawtooth Mountain', '1295', 5052),  -- 5052: Sawtooth Mountain
    ('77D9D0B65576D16D589F', 'Rouse Hill', 1582.7045, 188.8236, 33.67158, -116.7717, '358802045', NULL, 'Rouse Hill', '1494', 5052),  -- 5052: Rouse Hill
    ('73216A9C9ACC4CB0DEFB', 'Mount McDill', 1581.8206, 238.7498, 34.56639, -118.275, '358788853', 'Q49053587', 'Mount McDill', '27495', 5052),  -- 5052: Mount McDill
    ('62491294BA3EA673EE66', 'Fox Mountain', 1575.5722, 259.5372, 34.8137, -119.60007, '358801268', NULL, 'Fox Mountain', '1248', 5052),  -- 5052: Fox Mountain
    ('4D2FB36F4D1C836FA2EF', 'Five Fingers', 1574.3225, 232.8367, 35.68883, -117.90948, '358784071', 'Q49029155', 'Five Fingers', '2877', 5052),  -- 5052: Five Fingers
    ('5A48E8DBDE2D5AFFBBED', 'Sheep Mountain', 1567.2511, 102.2604, 33.58582, -116.37647, '358792526', NULL, 'Sheep Mountain', '1503', 5052),  -- 5052: Sheep Mountain
    ('CD9120A273887549865E', 'Smith Mountain', 1559.3873, 251.399, 34.28123, -117.86362, '358792742', 'Q49074806', 'Smith Mountain', '1343', 5052),  -- 5052: Smith Mountain
    ('2FC0387EE789576C5519', 'Warren Point', 1555.5163, 117.1956, 34.05507, -116.40716, '3351286134', NULL, 'Warren Peak', '1515', 5052),  -- 5052: Warren Point
    ('A0E2DD75F9AF70187D56', 'Eagle Crag', 1547.4696, 23.4696, 33.387349, -116.956523, '358783258', NULL, 'Eagle Crag', '1450', 5052),  -- 5052: Eagle Crag
    ('0DD7493742D393DBC7D1', 'Old Mount Emma', 1542.6842, 71.628, 34.47615, -118.0524, '9166422500', NULL, 'Old Mount Emma', '1296', 5052),  -- 5052: Old Mount Emma
    ('416C4F77535DC16B3CC6', 'Hildreth Peak', 1538.9352, 257.6779, 34.60036, -119.55183, '358801436', NULL, 'Hildreth Peak', '1271', 5052),  -- 5052: Hildreth Peak
    ('11CB2684BFBCADC2C7CA', 'Little Cahuilla Mountain', 1535.7653, 155.3261, 33.607, -116.81023, '358801594', NULL, 'Little Cahuilla Mountain', '1444', 5052),  -- 5052: Little Cahuilla Mountain
    ('F6A1064BDBD5FF95EE51', 'Fox Mountain', 1534.9423, 151.5466, 34.3144, -118.19906, '9150279734', NULL, 'Fox Mountain', '1331', 5052),  -- 5052: Fox Mountain
    ('809F44614529B05CC8D8', 'Iron Mountain', 1534.2413, 97.6884, 34.33888, -118.0911, '358804308', 'Q49038999', 'Iron Mountain', '1323', 5052),  -- 5052: Iron Mountain
    ('BDCF5A48B7DF3E978752', 'Chuckwalla Mountain', 1532.8087, 261.305, 35.27247, -118.09517, '358782128', 'Q35734646', 'Chuckwalla Mountain', '2899', 5052)  -- 5052: Chuckwalla Mountain
;

DO $$
DECLARE
  tile record;
BEGIN
  FOR tile IN
    SELECT DISTINCT floor(lat * 2)::int AS blat, floor(lng * 2)::int AS blng
    FROM hundred_peaks_osm_incoming
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
      FROM hundred_peaks_osm_incoming
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
  expected text[] := ARRAY['9A2F5CC975F6488B4632', 'A4D2E249541826525AEB', '47F39D4087931109E80C', '5286700F71A437E597DC', '7C9B6F6500B1AD955211', '692818683A5F0ED5D093', 'F7036436BC7D659E0155', '4C77A9C1218EA6FB7CE2', 'F70B91CECD9C422447EB', '20527EA34689D5C85EDA', '81FF791CED4B7661A3C6', '3E189BA33DC69B2B3264', 'D4F44B66FDB913D72033', '93528818384EA9264A94', 'FBAE200590883E0EACA3', 'C080BCE395C76B2C8185', '6A38B8BB6EF3822B96C6', 'C704F36903E92FF750B1', '543D65F587C473A6C147', '0791FB3EEE8E6F29F700', '1F428CA80AD8556D7659', '69D3DC4609638CA24210', 'BB9CC296C1C738ABEB41', '637240F4F7FF67B24734', 'EDDDE1ACFDE554E93725', 'D4A0BCA3F1432F95BE64', '0FBB058548ECE7A80E83', '5B6A08B01809F85C7DB9', 'F5B0336DF70B8B7BFB66', 'F1949661176F72C498B2', '2A2479F897C8374C1A59', '8F2045C77CE182250A85', 'AE482A1FA5682225842F', '48309864854EC1BB9719', '275525797553D1990496', '9DFBDB3CED95AEA01647', 'AB464AFC2AD68E339E70', '9B3C4239A38B50D2BD5F', '3CEFD62028D74D33B475', 'E145A91D543E78F1D37E', '417E580DD2B59FB2D7A0', 'CA4889386C64BD32D11F', 'C699F2630670FB979F9E', 'F345B1D8DBB8E5B7558D', '583C94AAA1EE9A9CF916', '33E1C6637E724BBADE26', 'C8C75B2559088E92ECC6', '8A57634F07D626DF6B7A', '19953FC120762906E65C', '1A471A3D16BF42D0BBE6', '82178B202B97435C4539', '26F0929029CE29AF8130', '655EAAE0DFF987E57243', '01CBED282831327AD850', '3D27EB6C67CB97B5B30A', '2E3AA20ED7ADB0FE431C', 'CB2ED3FDDE4365716CE3', '7D2D51DEB2457B781B06', '64A1D06AE8CD7F31E73E', 'ECE8CBE6BED764CD8A8D', '2B88CCA8ACD492DA56BB', 'ECF4AA5D6927ACAD2C2D', '3BA88B05A7A4E1519A09', '05CC4E62809C73502F91', '4410D67E940274E04B6B', '134B766EA7311D95485C', '71D6A600D2A1731E6894', 'F58040D5177DACD6EA39', 'C519D9FD9B71FB82D11F', '8293965915B015EDACC6', '03F85FAA09D061E28CA7', '6B3DDC3B57E986707EB1', 'D37D6987514140C1D5AA', '34C02135159EDF2AFF77', '3513CE69BB10DE96CC5A', '2CD677C258658E6F5D6B', '9C694DBFE948AF08F82A', '63562B8C70D5D8177533', 'EB5B8D731ADE66C4F680', 'F501E6DED419E42822F7', '2B855766018F15CF259E', 'FD0BA2355A3027182C05', 'E355D30D24FC973CEDD4', '60214422C23C35421550', '5528207AFFE5124FAA94', 'B1F8C5FEDE221A254950', 'F8F189E7FE48CA2AF3B6', '8260FA5E617374383699', '844FEF098CA5FEDB11AE', '3033E7A0601B472A92C0', '339E031B26768001336F', 'F04D4265E979BB1FE765', '109B652B95FE87CD71E5', '6EBFDBFE69FE8DB2A5FD', 'E7882B17D850C5F7D277', 'A5F8D614E3600A737D23', '2D74B527BB436FCD4C77', 'B859DDCB7E977D0B411C', '8BF945EB02D13E5071D9', 'CA5699CA233D6451EC3F', '62630BEDE304E008F0CA', '0F5B4B30A07E80BD7657', '6AAC4CF77026998F3BC6', '98102B0418C8176DD5D8', '4EC552F6E7C03A3C41DD', 'C9CDFE53DB6A93A05C88', 'F15DF3FAADD8954641BF', '616374AF524E3C21D5B4', '822FE10FF15DAF720E1B', '088138F20A153C696969', '74FBE1A738E0E7F4DF5F', '8DA3168EF63F6555EFD2', 'A475A5DEF9E1937C7405', '7826452C4C6FCB25463A', 'F10BB514CC55B0F4061B', 'DF1D1BEB8B76FAB76706', '0D092A8A81B08AC22611', '04C56E90128FB1A27CD6', 'AD5EE0BD901273C55142', 'AF527DF77D5450560077', '5BCD120CA7B92264A44A', '30585842E6FC167FF2ED', 'A4F67E3DF1D49B57CE9C', 'AF0D40796A9C799A556F', 'B5B57438EB6133A67655', 'A08DB9819F1A153230ED', '612FD03BACE9A224B971', 'A42F3697DD1BC38E353A', 'BCDF38EE193E33D37572', '21ECF55314DE3C0F7838', 'F1E4C5C0D7990123B720', 'F6F489388B7B83CFA456', 'B2C6E95BC9227C825EAC', '565AAD4C888A2E26AE3D', '0A8FC16C6DD34EE8BBE1', 'D968A27608B269A71D40', '3D6FB98CE67F46EDFC5C', '07ADA246807A163D2F47', 'FE6B099B4F1F7C8BD8C8', '0CE3DC34BC672B9E6D87', 'C6FBBE42FBCC8B389FE3', '1A97321797A39AD6987D', '76F4FB2CD8C26776D50B', '2B8F409AC0EA5C4E1EEC', '5BDB01622E75BE8740F1', '033175390232278424C2', 'FC530C8ACD51323FB28B', '89B79D63011568FAA2BF', '0D4492CCC07E59B3A385', '2A983CBF508C925B82C0', '8F063DBC1468A4E12595', '1AEDC842D65B75AC041E', '2EDC7AD12693B102E9F5', 'AD6B01820AA10FF58E1B', '7524FD465ECCDBB08AD0', 'B80EF1BF3D713B83B09C', '9252081E7F80FFE9A8EA', '70748A88DF088DFEDF00', 'D7D63B1AA5C448FB1C42', '343C405DD5A6135458FE', '67269B7CF3DE78951307', '8F827717F6FAC1554633', 'BAB35A24AF914A8EF4AF', '151893075B54AC904797', 'AFA85CDCF46404C608A2', 'FB5088AC3311C0BF855C', 'F65D6992BEA04CA9DD71', 'CD8126307FBB2BF9C83B', '5A3BF8DC4479314F6388', 'B88B6943631AF6E2C02A', '73FD9B710B727539F24F', 'C7BBD13EBA8844BD5ECF', '79F40196FDF1F7917FC1', '648AA0F2DDDA38CDD138', '8B20F661C20CAE455180', 'A9DDEB7DD748E44126FF', '6BE25BBFF5524DB34E89', 'E5760D93C0A35518AB91', '48949DE61329C98B4E5A', '5FC99BB2BB64B2F0DF34', '4DF9BAF53DE416CA951A', 'EB6A019EA134316F580C', '60B7DB7BB30775921561', 'A7DCA1933D3EB4AB0C39', '8461D1FE311F6A004B6D', '4F1734E9E5FE8A44D92C', '33B45210C5C7B7DED90B', '66E3B5F0BD2D3D829FFF', '273C68D9426CF8721D7C', 'CFF473CB92E552E6BA44', 'DE2B67B93DEDAF4761B4', '3850195B54BFAA489162', 'A2C8B800ECB41013F7B6', '0DD75A9E6254C6D66538', '55EF26B070B9A7DEBCB6', '93F1BB94E5FB145878D0', '2F33DFEDC64D8E1D027F', '3EB281FE42BA36703691', 'CCE8EA75275C5194B0F5', 'A81066E403702E209A6F', 'A2CFAA22F8DB745AB198', 'C1734A7E4C32D7E0F67F', '77D9D0B65576D16D589F', '73216A9C9ACC4CB0DEFB', '62491294BA3EA673EE66', '4D2FB36F4D1C836FA2EF', '5A48E8DBDE2D5AFFBBED', 'CD9120A273887549865E', '2FC0387EE789576C5519', 'A0E2DD75F9AF70187D56', '0DD7493742D393DBC7D1', '416C4F77535DC16B3CC6', '11CB2684BFBCADC2C7CA', 'F6A1064BDBD5FF95EE51', '809F44614529B05CC8D8', 'BDCF5A48B7DF3E978752'];
  present int;
  bad_rows int;
  duplicate_ids int;
BEGIN
  SELECT count(*) INTO present FROM destinations WHERE id = ANY(expected);
  IF present <> 216 THEN
    RAISE EXCEPTION 'hundred_peaks_osm_incoming: % of 216 rows present', present;
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
    RAISE EXCEPTION 'hundred_peaks_osm_incoming: % invalid row(s)', bad_rows;
  END IF;

  SELECT count(*) INTO duplicate_ids FROM (
    SELECT external_ids->>'osm' AS ident
    FROM destinations
    WHERE external_ids->>'osm' IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  ) duplicates;
  IF duplicate_ids <> 0 THEN
    RAISE EXCEPTION 'hundred_peaks_osm_incoming: % shared OSM id(s)', duplicate_ids;
  END IF;
END $$;

COMMIT;
