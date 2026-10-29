# Glacier outline refresh

Research and implementation, 2026-10-28. This work used the saved OSM, NPS and
GLIMS files. It made no network requests, database calls or upstream edits, and
processed no imagery. Dates below describe observations unless marked as edit,
release or snapshot dates. The source survey below records the earlier research;
the saved WFS review resolves the Rainier subset described here, not all GLIMS
rights or the existence of newer analyses elsewhere.

## Decision for Rainier

The supplied WFS file contains 430 `glac_bound` features: 169 dated 1970-09-09
(submission 744), 133 dated 2019-08-26 (821), 126 dated 2019-09-09 (814), and
two other submission-814 features dated 2015-09-09 and 2018-09-25. Use the
**2019-09-09 / submission 814 / Portland State University** cohort for every
replacement. Prefer this later source date consistently; do not fill its gaps
with August or older features. The August and September cohorts share 133
distinct glacier IDs across their union, not 133 September features.

The supplied rights evidence identifies the **Fountain, Glenn & McNeil (2023)**
U.S. inventory as CC0: [data DOI](https://doi.org/10.15760/geology-data.03),
[paper](https://essd.copernicus.org/articles/15/4077/2023/). That grant applies to
this inventory, not all GLIMS data or the restricted Maxar source images. The
1970 cohort serves only as a historical comparison; this packet does not clear
it for replacement. Keep the restricted NPS 2021 outlines excluded.

The offline builder produces these decisions. Areas use a WGS84 ellipsoidal
Lambert equal-area projection centered on the parent mountain; the facts area
comes from each glacier's individual NPS 2021 Table 4 row.

| Glacier | OSM km² | GLIMS km² | OSM/facts → GLIMS/facts | Choice and reason |
| --- | ---: | ---: | --- | --- |
| Pyramid Glaciers | 1.130 | 0.295 | 6.418 → 1.678 | GLIMS; closer to facts, with an older-extent fit. Still flagged outside the band. |
| Van Trump Glacier | 0.738 | 0.324 | 6.319 → 2.774 | GLIMS; closer to facts, with an older-extent fit. Still flagged outside the band. |
| Ohanapecosh Glacier | 1.172 | 0.802 | 1.903 → 1.303 | GLIMS; closer, inside the band, with an older-extent fit. |
| Paradise Glacier | 1.002 | 0.454 | 1.726 → 0.782 | GLIMS; closer, inside the band, with an older-extent fit. |
| Success Glacier | 0.610 | 0.773 | 1.539 → 1.950 | OSM, flagged; GLIMS is farther from 1. Keep the Kautz/Success split question open. |
| Sarvant Glacier | 0.227 | 0.325 | 0.596 → 0.855 | OSM, flagged; GLIMS is closer, but no dated evidence establishes a newer extent. Three of four inventory parts lie outside OSM. |
| Emmons Glacier | 10.919 | 11.245 | 0.996 → 1.026 | OSM; its ratio is inside the band. |

All other glaciers keep OSM because their ratios lie in the inclusive
**[0.67, 1.5]** band. Muir Snowfield and Pinnacle keep OSM and a review flag
because they have no individual facts area. The [full table](data-audits/rainier-glacier-outline-decisions-2026-10-28.md)
and [JSON report](data-audits/rainier-glacier-outline-decisions-2026-10-28.json)
cover all 29 places, source hashes, candidate areas/ratios, overlaps, age
evidence, feature IDs, unmatched features and reasons. These are review outputs;
no production geometry changed in this session.

Matching first assembles each cohort's named parts, then requires a name or
explicit alias **and** spatial overlap: IoU ≥0.1 or intersection/candidate area
≥0.5. Singular/plural “Glacier(s)” normalize together. The data config records
`Liberty Gap Glacier` → `Liberty Cap Glacier`; NPS's `Sarvent` spelling remains
a separate facts crosswalk. Names alone cannot accept a candidate. A group that
matches several places, or several named groups that match one place, is held
as ambiguous. Empty/`WA` names remain unmatched. Point contacts and shared or
overlapping part edges require a union: `polyclip-ts` 0.16.8 dissolves those
seams, retains holes and disconnected parts, and never clips to OSM. Validate
each input polygon and the assembled MultiPolygon. The September cohort has
**27 matched systems, 55 unmatched groups/features, no ambiguous groups and no
invalid systems**. The unmatched records include 52 unnamed features, The
Turtle, Williwakas Glacier and Stevens Glacier; none enters this roster. After
the four choices the package has **51 components and 39 holes** (see the
generated preview for exact counts).

The age gate uses a verified OSM observation date when supplied. Otherwise it
records an **inference**, not a survey date: a historical cohort must have IoU
≥0.3, at least half of its area inside OSM, and IoU at least 0.1 higher than the
newer candidate's. This supports the four replacements above. For Pyramid,
historical/new IoU is 0.465/0.260; Van Trump is 0.620/0.352. A 2024 OSM edit
does not establish 2024 ice. Sarvant's older fit is poorer (0.446 vs 0.609), so
the gate keeps OSM. Unknown evidence never falls back to the snapshot date.
The rule can accept a better candidate that still falls outside the ratio band;
it retains that flag. Among eligible candidates choose the newest date, then
the smallest ratio error, then the source key for a stable tie break.

For current extents, prepare a **reviewed late-summer Sentinel-2 L2A refresh**,
starting with the clearest 2026 observations. Use OSM names, IDs, and internal
divides; protect debris-covered ice and uncertain pixels. The 2018–19 baseline
already exceeds the proposed three-year age limit. It is an input to this
review, not evidence of the 2026 margin. No ready-made 2021–26 Rainier inventory
with both verified geometry dates and verified reuse rights was established here.
That is a research limit, not a claim that none exists in GLIMS or agency archives.

The [local area audit](data-audits/rainier-glacier-osm-vs-nps-2026-10-28.csv)
sets the first review order:

| Glacier | OSM / NPS 2021 area | Action |
| --- | --- | --- |
| Pyramid; Van Trump | 6.42; 6.32 | First candidates for a retreat review. |
| Ohanapecosh; Paradise | 1.90; 1.73 | Check splits, seasonal snow, and outside margins. |
| Success | 1.54 | Compare individual Table 4 areas; also compare the Kautz–Success union. |
| Sarvant / NPS Sarvent | 0.60 | Check missing parts and names; a shrink-only mask cannot repair an undersized outline. |
| Pinnacle | OSM 0.002 km²; no matched NPS fact | About five 20 m pixels. Manual review with finer open imagery; no automatic trimming. |

An area ratio is a review signal, not a scale factor or proof of retreat. Keep
individual headline areas separate from combined histories: Kautz–Success,
Cowlitz–Ingraham, Nisqually–Wilson, and Paradise–Stevens. Muir Snowfield is not
NPS Muir Glacier. Do not change a glacier's kind or delete it from a spectral mask.

## Original source survey and rights

This survey predates the supplied WFS file. The decision above resolves the
saved Rainier cohorts and the selected PSU inventory's rights. Other datasets
and later analyses still need their own checks; “unverified” below records
the earlier source survey, not a hold on the reviewed 2019 cohort.

“Yes” means storage, modification, and display in a commercial app are allowed
under the cited terms, with the stated credit and conditions. It does not clear
accuracy or allow every source to be imported into OSM. Licence excerpts come
only from fetched pages. A public URL or “open data” catalog label alone does
not grant reuse rights.

| Exact dataset / provider | Observation and coverage | Download / API and format | Licence evidence and commercial verdict |
| --- | --- | --- | --- |
| **Data From: Inventory of Glaciers and Perennial Snowfields of the Conterminous USA**, Fountain, Glenn, McNeil; file edition `Glacier_inventory_20220929` | CONUS features ≥0.01 km²; nationwide imagery 2013–20. Rainier uses 2019 NAIP and 2018-09-25 Maxar; exact date per polygon **unverified**. | [Publisher and files](https://pdxscholar.library.pdx.edu/geology_data/3/), DOI [10.15760/geology-data.03](https://doi.org/10.15760/geology-data.03). GeoJSON, zipped Esri file geodatabase, CSV; exact URLs below. | Record: “This work is marked with CC0 1.0 Universal”. **Yes**, credit authors, edition and DOI; note changes. [CC0](https://creativecommons.org/publicdomain/zero/1.0/) permits commercial reuse. The grant covers published data, not restricted source images. |
| **USGS Data Series 549: Digital Topographic Map Showing the Extents of Glacial Ice and Perennial Snowfields at Mount Rainier, Washington, Based on the LiDAR Survey of September 2007 to October 2008**, Robinson, Sisson, Swinney (2010) | Rainier glaciers and perennial snowfields; early September 2007 and September–October 2008 surveys. Also includes a September 1970 aerial-photo layer; select the 2007–08 layer. | [Release](https://pubs.usgs.gov/ds/549/), [outline ZIP](https://pubs.usgs.gov/ds/549/DS549-Glacial_Limits.zip), shapefiles; [2007–08 metadata](https://pubs.usgs.gov/ds/549/LiDAR2008_glacial_limits.txt). ZIP not inspected. | Metadata: “Uses of this digital geologic map should not violate the spatial resolution of the data.” Edited at 1:5,000; credit USGS and authors. **Yes**, under the USGS public-domain policy below. Useful older reference, including debris margins; too old for the freshness target. |
| **GLIMS Glacier Database, Version 1**, NSIDC-0272, DOI 10.7265/N5V98602 | Global, multiple analyses per glacier. Rainier analysis IDs, source dates, submitters, and newest analysis remain **unverified**; see the audit below. | [Data access](https://www.glims.org/glacierdata/index.php), [text search](https://www.glims.org/maps/textsearch/), OGC WFS below. Shapefile, GML, KML, GMT, MapInfo; WFS can supply GeoJSON. | [NSIDC record](https://nsidc.org/data/nsidc-0272/versions/1): “As a condition of using these data, you must cite the use of this data set.” No current explicit downstream commercial licence was fetched for a Rainier subset. **Hold** until its terms and `CITATIONS.txt` are saved. Do not label all GLIMS data CC0 or CC BY because RGI is CC BY. |
| **Randolph Glacier Inventory — A Dataset of Global Glacier Outlines, Version 7.0**, NSIDC-0770 | Global, excluding ice sheets, target circa 2000; released 2023-09-19. Region 02 did not change from RGI 6.0. U.S. Cascade outlines largely use maps dated 1940s–80s. Exact Rainier row dates **unverified**. | [NSIDC](https://nsidc.org/data/nsidc-0770/versions/7); [global glacier ZIP](https://daacdata.apps.nsidc.org/pub/DATASETS/nsidc0770_rgi_v7/global_files/RGI2000-v7.0-G-global.zip), then region 02. Shapefile, attributes CSV, metadata JSON. URL also used by [OGGM](https://docs.oggm.org/en/stable/_modules/oggm/utils/_downloads.html); binary not fetched. | [Distribution policy](https://rgidata.org/user_guide/01_introduction.html): “Creative Commons Attribution 4.0 International License”. **Yes**, with consortium/analyst credit, licence link, and changes marked. **Not a Rainier freshness fix**; 2023 is the release date. |
| **ESA Glaciers Climate Change Initiative (Glaciers CCI): Randolph Glacier Inventory gridded data product, v5.0**; regional Glaciers_cci inventories | CEDA's global RGI5 raster lists 1999–2010 coverage, not Rainier-specific dates. It is a gridded area product, not fresh individual outlines. No newer Rainier outline product was found in the checked catalogs. | [CEDA record](https://catalogue.ceda.ac.uk/uuid/5daf1ff8dd2941a18bb4120ceea95721), [download directory](https://data.ceda.ac.uk/neodc/esacci/glaciers/data/randolph_glacier_inventory/gridded/v5.0) (`.dat`); [regional catalog](https://glaciers-cci.enveo.at/crdp2/index.html) (vector inventories), [project data page](https://climate.esa.int/en/projects/glaciers/data/). | [CCI policy reproduced by CDS](https://cds.climate.copernicus.eu/licences/satellite-cloud-properties-cci): “CCI data shall be made freely available without any restrictions on use.” Source acknowledgement and third-party conditions still apply. **Conditional yes** for products carrying that policy; CEDA's glacier-specific terms PDF could not be fetched. **Not selected** for Rainier. |
| **Supporting Datasets for Proglacial Topographic Change Analyses on Mount Rainier, 1960 to 2017**, USGS/Anderson (2021), DOI 10.5066/P9056ZNG | Four proglacial basins, 1960–2017; DEMs, analysis areas, and tables. Not a mountain-wide glacier inventory. | [USGS record](https://www.usgs.gov/data/supporting-datasets-proglacial-topographic-change-analyses-mount-rainier-1960-2017), [catalog](https://data.usgs.gov/datacatalog/data/USGS%3A6140d06fd34e1449c5d60008), [ScienceBase](https://www.sciencebase.gov/catalog/item/6140d06fd34e1449c5d60008). DEM rasters, shapefiles, CSV. | Indexed USGS rights mark it CC0, but the record could not be re-fetched; file terms **unverified**. Useful terrain evidence after checking child-item metadata, **not a replacement outline source**. |
| **USGS National Hydrography Dataset, High Resolution, NHDWaterbody / Waterbody – Large Scale**, Ice Mass (`FTYPE=378`, `FCODE=37800`) | Nationwide, including Rainier. Individual observation dates **unverified**. `FDATE` is a feature edit date, not the ice date. NHD retired 2023-10-01 and is no longer maintained. | [National Map layer 12](https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12), [download options](https://www.usgs.gov/national-hydrography/access-national-hydrography-products), [state files](https://prd-tnm.s3.amazonaws.com/index.html?prefix=StagedProducts/Hydrography/NHD/State/). REST JSON/GeoJSON, shapefile, file geodatabase. Query below. | **Yes** for USGS-produced data under its public-domain policy; retain metadata and credit USGS. No verified evidence these Rainier polygons improve observation age. A newly packaged download is not a new inventory. |
| **WA Hydrography – Water Bodies / DNR HYDRO**, Water Bodies (FP), glacier/snowfield code 103 | Washington. Monthly exports; observation age varies. Inspect `FTR_SRC_DT` and lineage, not just `EDIT_DT` or water-type approval dates. Rainier source dates **unverified**. | [DNR layer 1](https://gis.dnr.wa.gov/site2/rest/services/Public_Forest_Practices/WADNR_PUBLIC_FP_Hydro/MapServer/1), [state_hydro.zip](https://fortress.wa.gov/dnr/adminsa/gisdata/datadownload/state_hydro.zip). REST GeoJSON, file geodatabase. | [Metadata](https://www.arcgis.com/sharing/rest/content/items/28a0f93c33454297b4a9d3faf3da552a/info/metadata/metadata.xml?format=default&output=html): “Access Constraints: None”; “DNR makes no guarantee or warranty concerning the accuracy of information contained in the geographic data.” No explicit reuse/redistribution licence fetched. **Hold** pending a clear grant; a warranty disclaimer is not one. |
| **Glaciers**, Pierce County, derived from DNR hydrology | Rainier; published 2005-06-15 from 1:24,000 DNR/USGS sources of unspecified observation age. Portal's 2019 date is not an observation. | [Publisher metadata](https://matterhorn.co.pierce.wa.us/GISmetadata/pdbis_glaciers.html), [portal](https://gisdata-piercecowa.opendata.arcgis.com/datasets/piercecowa::glaciers). ArcGIS feature layer; generalized polygons. | Metadata says “The map was created for display purposes only.” Linked county terms were not fetched: **reuse unverified**. No demonstrated freshness gain; **not selected**. |
| **2021 Mount Rainier National Park Glacier Inventory**, NPS IRMA 2298869, `MORA_Glaciers_Sep2021_TK20230405.lpk` | Park ice and perennial snow delineated from 2021 imagery; file title says September 2021. Exact dates per margin **unverified**. | [Data.gov](https://catalog.data.gov/dataset/2021-mount-rainier-national-park-glacier-inventory), [IRMA](https://irma.nps.gov/DataStore/Reference/Profile/2298869), [LPK](https://irma.nps.gov/DataStore/DownloadFile/686386?Reference=2298869). Layer package. | **No under this task's known restriction**: NPS permission is required for other entities to use/share it. That restriction comes from the task and existing skill; the original terms could not be re-fetched, so no fresh licence quotation is asserted. Data.gov's public-access label does not override it. |
| **MORA_Surficial_Geology**, NPS Geologic Resources Inventory; ArcGIS item `90c07575af1649c09c19a40fc0c46298`, IRMA 2221339 | Park geology, including glacial-feature lines and surficial units. Ice observation dates **unverified**; no evidence of a current glacier inventory. | [FeatureServer](https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/MORA_Surficial_Geology/FeatureServer), [fetched tile-service record](https://tiles.arcgis.com/tiles/fBc8EJBxQRMcHlei/arcgis/rest/services/MORA_Surficial_Geology/MapServer). Esri vector layers; cached service supplies PNG tiles. | Fetched record gives NPS GRI copyright credit, **no explicit open licence**. **Hold**. No newer NPS REST outline service with a verified explicit open licence was established. Do not trace a restricted inventory from its web map. |
| **Inventory of Western United States Glaciers – 2020**, Ambinakudige and Abubakari (2024), DOI 10.54718/WWAJ8121 | Western U.S., Sentinel-2 observations described as 2020; exact Rainier scenes and debris treatment **unverified**. | [Dataset and attachments](https://scholarsjunction.msstate.edu/cas-publications/37/): `Inventory.zip` (shapefile), `Sentinel images.csv`, readme and scripts. [Paper](https://www.mdpi.com/2072-4292/16/23/4501). | Dataset page has no explicit data licence; attachment fetches failed. **Hold**. The paper's open-access licence and source imagery terms do not establish the outline file's licence. |

The [USGS copyright policy](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits)
states: “USGS-authored or produced data and information are considered to be in
the U.S. Public Domain.” Check dataset-specific exceptions and credit lines;
this does not clear every file hosted by a government agency.

Exact published Fountain inventory attachment URLs (all returned 403 here):

```text
GeoJSON: https://pdxscholar.library.pdx.edu/cgi/viewcontent.cgi?article=1002&context=geology_data&filename=2&type=additional
GDB ZIP: https://pdxscholar.library.pdx.edu/cgi/viewcontent.cgi?article=1002&context=geology_data&filename=4&type=additional
CSV:     https://pdxscholar.library.pdx.edu/cgi/viewcontent.cgi?article=1002&context=geology_data&filename=5&type=additional
Readme:  https://pdxscholar.library.pdx.edu/cgi/viewcontent.cgi?article=1002&context=geology_data&filename=6&type=additional
```

### GLIMS and agency checks still needed

The [RGI Region 02 guide](https://rgidata.org/user_guide/regions/rgi02.html)
confirms **submission 744**, submitter and analyst **Andrew G. Fountain**,
released **2016-02-26**, with 5,002 outlines across its contribution. Its U.S.
source maps date from the 1940s–80s. This is regional evidence: it does **not**
establish Rainier's individual `anlys_id` values or precise map years.
The 2023 Fountain paper also points to GLIMS for its newer inventory. Whether
those 2018–19 Rainier analyses are currently ingested, their submitters as stored
in GLIMS, and whether later Rainier analyses exist could not be verified.

GLIMS's [2003 MOU](https://www.glims.org/About/mou.html) says “NSIDC is to be
granted unlimited rights to make these data publicly and freely available”,
but also “It is not legally binding”. That is evidence of intended openness,
not a substitute for a current subset's downstream licence. The [NSIDC data
policy](https://nsidc.org/data/data-policies) allows dataset-specific limits.
Retrieve the subset terms and analyst citation before choosing GLIMS geometry.

Use the [documented OGC entry point](https://www.glims.org/glacierdata/index.php).
First fetch capabilities; confirm the layer and fields, then run the bounding-box
query. The layer name below is a query candidate, **not a verified capability
response from this session**. WFS requests failed here; no result count or
“no newer analyses” conclusion follows.

```text
GET https://www.glims.org/geoserver/ows?service=WFS&version=2.0.0&request=GetCapabilities

GET https://www.glims.org/geoserver/GLIMS/ows
  service=WFS
  version=2.0.0
  request=GetFeature
  typeNames=GLIMS:GLIMS_Glacier_Outlines
  srsName=urn:ogc:def:crs:EPSG::4326
  bbox=46.70,-121.90,47.05,-121.55,urn:ogc:def:crs:EPSG::4326
  outputFormat=application/json
  count=1000
```

The explicit EPSG URN uses latitude/longitude axis order in this WFS query;
STAC and GeoJSON boxes below use longitude/latitude. Check returned coordinates
against Rainier. Follow pagination; retain every temporal analysis, not just the
newest one or an RGI date snapshot. Save `glac_id`, `anlys_id`, `subm_id`,
`src_date`, `anlys_time`, `release_dt` (or returned equivalent), `glac_name`,
submitters, analysts, institution, processing description, and date uncertainty.
Keep `line_type=glac_bound`, preserve holes, and keep debris-cover polygons as
separate evidence. [Field definitions](https://www.glims.org/MapsAndDocs/downloaded_field_desc.html)
distinguish source from analysis/release date. Include unnamed polygons in the
spatial query; a name-only query can miss them.

Use these REST request parameters with GET and URL encoding. Feature dates have
**not** been verified here; service schemas were fetched. Page until
`exceededTransferLimit` is false.

| Endpoint | Parameters |
| --- | --- |
| `https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12/query` | `where=FCODE=37800`, `geometry=-121.90,46.70,-121.55,47.05`, `geometryType=esriGeometryEnvelope`, `inSR=4326`, `spatialRel=esriSpatialRelIntersects`, `outFields=*`, `outSR=4326`, `returnGeometry=true`, `f=geojson`, `resultRecordCount=1000`, `resultOffset=0`. Read source metadata through the downloaded GDB's metadata relationships. |
| `https://gis.dnr.wa.gov/site2/rest/services/Public_Forest_Practices/WADNR_PUBLIC_FP_Hydro/MapServer/1/query` | Same spatial parameters; `where=WB_CART_FTR_CD=103`, `outFields=*`, `f=geojson`. Check `FTR_SRC_DT` against lineage; metadata date 2017-03-14 does not date the polygons. |
| `https://www.arcgis.com/sharing/rest/search` | `q=(glacier OR ice) AND (MORA OR "Mount Rainier")`, `f=pjson`, `num=100`, `start=1`; advance `start`. Fetch each official candidate's `https://www.arcgis.com/sharing/rest/content/items/<item-id>?f=pjson`, `info/metadata/metadata.xml`, service, and layer definitions. Verify owner, `licenseInfo`, lineage, acquisition dates, export rights, and original dataset terms. This catalog search could not be completed here. |

ESA's [Glaciers_cci+ Phase 2 product guide, 2024-07-22](https://climate.esa.int/documents/3198/glaciers_cci-plus_d42_PUG_v02.pdf)
lists surge events (2017–22), Greenland elevation change, and Karakoram snow/length
products. Those are not new Rainier extents. Check future regional polygons on
their own merits; neither newer mass-change products nor RGI grids update a
glacier's perimeter.

## Derive a candidate from open imagery

| Imagery | Observation, coverage, format, access | Rights and credit |
| --- | --- | --- |
| **Copernicus Sentinel-2 MSI Level-2A surface reflectance** | Global land; 10 m visible/NIR, 20 m SWIR/SCL. Original SAFE/JPEG2000 and XML; Earth Search and Planetary Computer offer COGs. [Earth Search collection](https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a), [PC collection](https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a). Exact Rainier scene dates **not selected**. Catalog coverage begins in 2015; original operational global L2A began 2018-12-13, with reprocessing extending the archive. | **Yes**. [Sentinel legal notice](https://cds.climate.copernicus.eu/licences/ec-sentinel): “adaptation, modification and combination with other data and information”. Credit derived outlines: `Contains modified Copernicus Sentinel data <year>`, filling the actual observation year(s). Include licence link; no warranty or endorsement. Catalog `license=proprietary` points to these custom terms, not a commercial-use ban. |
| **USGS Landsat Collection 2 Level-2**, preferably Landsat 8/9 OLI | Worldwide long record; 30 m multispectral, coarser thermal. [PC collection](https://planetarycomputer.microsoft.com/api/stac/v1/collections/landsat-c2-l2), [USGS EarthExplorer](https://earthexplorer.usgs.gov/), [LandsatLook STAC](https://landsatlook.usgs.gov/stac-server). COG/GeoTIFF and metadata. Use acquisition times; no Rainier scene selected. | **Yes, public domain**. [USGS guide, section 6](https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/atoms/files/LSDS-2032-Landsat-Commercial-Cloud-Direct-Access-Users-Guide-v2.pdf.pdf): “no restrictions on the use or redistribution”; requested credit: “Data available from the U.S. Geological Survey.” Use PC assets for the no-paid-service route; the USGS AWS requester-pays bucket can incur charges. |

Raw Sentinel and Landsat can support OSM editing. Do not assume the same rights
for a third-party mosaic, basemap, or commercial image.

### Scene discovery and download — network required

Use the same **POST `/search` body** at either endpoint:

```text
https://earth-search.aws.element84.com/v1/search
https://planetarycomputer.microsoft.com/api/stac/v1/search
Content-Type: application/json
User-Agent: PeaksGlacierResearch/1.0
```

```json
{
  "collections": ["sentinel-2-l2a"],
  "bbox": [-121.90, 46.70, -121.55, 47.05],
  "datetime": "2026-08-01T00:00:00Z/2026-09-30T23:59:59Z",
  "query": {"eo:cloud_cover": {"lt": 20}},
  "limit": 100
}
```

For Landsat, send that body to PC with `collections=["landsat-c2-l2"]` and add
`"platform":{"in":["landsat-8","landsat-9"]}` inside `query`. For another
mountain change the box and local melt-season window. Fetch all `next` pages;
do not rely on the first 100 items. The collection definitions were fetched,
but filtered GET requests failed through the research browser. These proposed
POST requests are not evidence of successful 2026 scene selection.

Use [`pystac-client`](https://pystac-client.readthedocs.io/en/stable/usage.html)
for search and pagination. For PC, use `planetary_computer.sign_inplace` on
returned items for short-lived asset access; keep unsigned canonical URLs in
provenance, never tokens. [Microsoft's example](https://raw.githubusercontent.com/microsoft/PlanetaryComputerExamples/main/quickstarts/reading-stac.ipynb)
shows that flow. No paid compute, imagery subscription, or persistent server is
needed. Use HTTP COG window reads and ordinary local/cloud-container CPU.

Save the raw query, complete unsigned STAC items, product IDs, sensing times,
processing baselines, asset URLs, metadata, licence text/URL, retrieval time,
software versions, and SHA-256 of downloaded crops/files. Never put personal
names, emails, account identifiers, or contact URLs in request headers.

| Required band | Earth Search asset | PC Sentinel asset | Purpose |
| --- | --- | --- | --- |
| B02, B03, B04 | `blue`, `green`, `red` | `B02`, `B03`, `B04` | True colour; NDSI and red/SWIR ratio. |
| B08 | `nir` | `B08` | Vegetation/water and shadow checks. |
| B11, B12 | `swir16`, `swir22` | `B11`, `B12` | Ice discrimination and false colour. |
| Scene classification | `scl` | `SCL` | Quality mask, not a glacier inventory. Confirm each item's assets. |

Select at least three useful same-season acquisitions where possible, on dates
at least five days apart, before autumn snowfall. Require ≥95% valid coverage
per glacier per chosen scene, and clear coverage of every proposed removal on
two dates ≥10 days apart. Tile cloud percentage is only a first filter: inspect
the glacier and its 200 m surroundings for clouds, smoke, fresh snow, and cast
shadow. If conditions fail, try the previous year and record its real year.

### Ice mask and protected areas — local processing plus human review

These thresholds are **starting choices to test**, not a validated Rainier
classifier. [ESA's workflow](https://climate.esa.int/en/projects/glaciers/data/)
uses band ratios followed by manual correction, especially for debris-covered
ice and false positives over water.

1. **Prepare the OSM base.** Snapshot `natural=glacier` with all multipart
   members, holes, tags, versions, and timestamps; hash it. Keep roster,
   external IDs, and shared internal divide segments. An OSM polygon is an
   identity envelope, not a surveyed hydrologic catchment. Flag overlaps,
   gaps, and disputed divides before clipping another inventory. Use the same
   divides to compare the CC0 inventory and new masks; do not move them to
   improve an area ratio.
2. **Read and align.** Use Python, NumPy, rasterio, pyproj, Shapely/GeoPandas,
   GDAL, and optionally SciPy. Process Rainier in **EPSG:32610** on a snapped
   **20 m** grid, since B11/SCL are 20 m. Average 10 m reflectance into it; use
   nearest-neighbor for classes/masks. Keep 10 m RGB for review. Another
   mountain uses its suitable metric CRS. Rasterio's [window reads](https://rasterio.readthedocs.io/en/stable/topics/windowed-rw.html)
   avoid loading whole scenes; [`rio-cogeo`](https://cogeotiff.github.io/rio-cogeo/)
   creates/validates cropped COGs. Upsampling cannot add SWIR detail.
3. **Convert reflectance once.** Read per-asset scale/offset, baseline, and
   original metadata. Cast integers to float before subtraction. Raw baseline
   ≥04.00 products use `BOA_ADD_OFFSET` in
   `(DN + offset) / quantification_value`; some hosts already remove it.
   Verify that rather than subtracting twice. [ESA documents the change](https://sentiwiki.copernicus.eu/web/s2-products);
   [Earth Search issue 71](https://github.com/Element84/earth-search/issues/71)
   reports conflicting metadata. Hold conflicting scenes and cross-check the
   original SAFE product. DN nodata stays nodata, not bare ground.
4. **Mask uncertainty.** SCL **0, 1, 2, 3, 7, 8, 9, 10** cannot support
   removals (missing, defective, dark/shadow, unclassified, cloud/cirrus).
   Dilate cloud/cirrus/shadow masks by **60 m** as an initial buffer. Treat
   SCL 6 water as a review class, since glacier ponds/turbid water confuse
   indices. Keep SCL 11: it includes snow/ice. [Class definitions](https://custom-scripts.sentinel-hub.com/custom-scripts/sentinel-2/scene-classification/).
   Add visible smoke, terrain shadow, and fresh snow to uncertainty.
5. **Calculate clean-ice evidence.** `NDSI=(B03-B11)/(B03+B11)` and
   `R=B04/B11`, with positive-denominator guards. Start with **NDSI ≥0.4**
   or **R ≥2.0** as ice evidence. Review NDSI 0.2–0.4 and disagreement;
   dirty ice may be darker. Inspect variants 0.3/0.4/0.5 and 1.8/2.0/2.2.
   `NDVI=(B08-B04)/(B08+B04)` >0.3 can support a vegetation interpretation,
   but cannot alone prove absence of ice. Seasonal snow is not glacier ice;
   inspect more than one date and, when needed, the previous melt season.
6. **Protect debris before subtraction.** A reviewer marks **known and possible
   debris-covered ice**, using the open inventory, RGB/SWIR composites,
   crevasses, continuity with upslope ice, and dated open NAIP or field evidence
   where available. Preserve that area inside OSM. Low NDSI, bare-ground SCL,
   or no measured motion do not rule out buried/stagnant ice. Emmons, Carbon,
   Winthrop, and lower Cowlitz start as **manual-only glaciers**; flag any other
   glacier if debris is possible. Do not use the restricted NPS outline as
   the mask. If protection cannot be established, keep the whole old outline.
7. **Propose removals conservatively.** First use ratio-flagged **oversized**
   glaciers after split checks. A pixel can enter a removal proposal only when
   **NDSI <0.2 and R <1.8** on two clear dates ≥10 days apart **and** the debris
   review positively identifies ice-free ground. Uncertain means retain.
   Restrict removal components to the outside margin of the mountain's OSM ice
   union; protect shared divides with a **40 m** buffer and make new internal
   holes manual. Thus `candidate_i = OSM_i - approved_clear_ground_i`, where
   removal excludes all debris, uncertainty, and divide masks. A human clears
   every removed patch before acceptance. Sarvant, advances, and ice outside
   the old envelope need separate human-drawn extensions and a crosswalk.
   Clean-ice additions from another inventory also need review.
8. **Vectorize and simplify.** Use `rasterio.features.shapes` or GDAL
   polygonization; keep raw masks/vectors, multipart pieces, and holes. Flag
   components/holes below **0.01 km²**, without deleting existing ice. Simplify
   only changed outside edges by **≤10 m**, preserving topology and fixed
   divides. Require ≤1% area change from simplification, valid nonempty
   MultiPolygon geometry, no new overlaps, and containment in the reviewed
   envelope. A `make_valid` repair must appear in the diff and get review;
   no silent `buffer(0)` or lost components. Export EPSG:4326 lon/lat GeoJSON.

### Review packet and acceptance

Produce these PNGs per glacier at fixed scale, with north arrow, scale bar,
sensing dates, source credit, and legend:

- True colour for every chosen scene, old OSM and proposed outline; removed
  areas in red, proposed additions in blue.
- SWIR/NIR/red **B12/B08/B04**, NDSI and ratio panels, SCL/uncertainty,
  clear-observation count, and threshold-disagreement pixels.
- Debris protection and evidence dates; close views of changed termini and
  disputed divides; 2018–19 inventory comparison and finer open imagery when needed.

Save a CSV of old/new geodesic area, facts area/year/scope/uncertainty,
new/old ratio, outline/facts ratio, valid coverage, retained legacy area,
component/hole counts, thresholds, and decision. Use `pyproj.Geod` for areas;
compare grouped unions and individual glaciers. Flag **outline/facts outside
0.67–1.5**, **>10% proposed area change**, and **>40 m margin movement** for
explanation. Do not alter geometry to match a report's area. Different dates
can explain real change; different divisions can explain a difference without it.

Reject publication if debris/cloud pixels were lost, alignment is poor,
dates/rights are missing, a divide changed without review, or small ice vanished
at raster resolution. Keep old geometry with an age/gap note when a candidate
fails. A human records accept/reject/hold per glacier; a mountain-wide total
cannot clear an individual error.

A later authorized update must use existing revision, outline-parts, and queued
crossing-rematch paths. The outline drives display and crossings. Retain old
packages for rollback. Crossings remain matches against the current stored
extent, not historic ice or a prediction of safe travel. Build refreshes offline,
never during a detail GET or inside an app process.

## Freshness policy and labels

Run an annual **October review after August–September melt** for Rainier, and
check before every mountain import. Use local end-of-melt season elsewhere.
Review yearly; replace geometry only when imagery and human checks support it.
This is a workflow step, not a new service: **$0 recurring infrastructure**;
local processing/downloads only, with usage recorded. No schedule is created.

| Signal | Policy |
| --- | --- |
| Known observation >3 years old, or unknown | Review due. New downloads/edits do not reset observation age. |
| Outline/facts ratio outside 0.67–1.5 | Review dates, identity, splits, debris, and missing parts. Never auto-normalize area. |
| OSM geometry last edit >5 years old | Extra signal, not an imagery date. Inspect member ways/nodes and changeset sources; a recent relation edit may leave old boundaries. |
| >10% candidate area change, >40 m shift, breakup, new debris, or credible fresh inventory | Review even if age and ratio pass. |
| No clear melt-season view / unresolved debris | Keep extent and date; record `hold`, retry next season or with finer licensed imagery. |

The saved OSM snapshot is **2026-10-28T20:34:38Z**. Pyramid shows last edit
2024-01-12 and Van Trump 2024-09-29; neither saved object has an imagery-date
tag. Those edits do not establish a 2024 survey. The implemented gate above
uses measured historical fits as evidence of older extent; it still does not
establish a 1970s source or survey date for an OSM object.

Derive labels from stored provenance:

- Undated OSM: **“Outline as mapped in OpenStreetMap; snapshot 2026-10-28.
  Imagery date unknown.”** Append a verified source date if available.
- Complete derived margin: **“Outline derived from imagery <date or range>.”**
  Show year/month precision when that is all the evidence supports.
- Mixed extent: **“Outline partly refreshed from imagery <range>; some margins
  retained from earlier mapping.”** Give retained source/date, or unknown, in
  source details. Do not assign the whole outline a new observation date.
- Keep **“Area reported for 2021”** separate from computed outline area.

Credit mixed OSM-clipped geometry to OSM and the imagery source. [OSM's licence](https://www.openstreetmap.org/copyright)
says: “If you alter or build upon our data, you may distribute the result only
under the same license.” Treat the clipped outline collection as an **ODbL
derivative database** for this design; offer its reusable data and licence,
and keep the Sentinel notice above. Do not label OSM-derived outlines CC0
because one input is CC0. Keep independent source files and terms intact.

## Provenance and implementation impact

The [schema](../cloud-sql/migrations/20261028_glacier_02_catalog.sql) already has
`outline` (MultiPolygon geography), `outline_observed_at`, `outline_source_url`,
`outline_source_sha256`, `outline_revision`, `geometry_credit`, `geometry_license`,
facts' `observed_year`, and JSONB `provenance`. The [writer](../cloud-sql/migrate/src/import-glacier-manifest.ts)
now resolves each place's `geometry` object before writing credit, licence,
source URL/hash, observation date, snapshot date and aliases to
`destinations.metadata.glacier_catalog`. Old single-source manifests still use
their package defaults. Facts provenance stores
report/table citations, units/methods, history scope, report/source hashes, and
mountain totals. The [detail reader](../cloud-sql/api/src/lib/glacier-detail.ts)
already exposes that JSONB. [Outline-change triggers](../cloud-sql/migrations/20261028_glacier_04_refresh_search.sql)
advance revisions and queue rematches. **No new database column or geometry
table is needed.** Additive migration
`20261029_glacier_09_outline_provenance.sql` backfills the JSONB outline source
from each existing row and catalog metadata. It preserves credits and the old
snapshot date, records actual observation as null, and skips rows that already
have outline provenance. Applied migrations 01–08 stay unchanged.

The importer writes **`destination_glacier_facts.provenance.outline`**, per glacier, preserving
all existing facts provenance. Use `license` spelling to match existing data:

| JSONB key | Meaning |
| --- | --- |
| `schema_version`, `geometry_source`, `source_url` | Versioned provenance shape; actual provider/product and canonical record. Distinguish identity/divides from outer-margin source. |
| `observed_at` | Source observation day when one day applies to the complete extent; otherwise null. Never fetch/edit date. GLIMS: 2019-09-09; undated OSM: null. |
| `source_sha256`, `snapshot_at`, `analysis_ids`, `glacier_ids`, `submission_id` | Raw source hash, snapshot day and exact analysis cohort/parts. OSM and GLIMS have distinct source hashes. |
| `observed_start`, `observed_end`, `date_precision` | Range or year/month evidence; `unknown` for undated OSM. Never invent January 1 to fill a date. |
| `snapshot_at`, `retrieved_at`, `processed_at` | Separate mapping snapshot, retrieval, and processing times. |
| `method`, `parameters`, `software_versions` | Method/version; bands, thresholds, quality/debris rules, CRS/grid, resampling, simplification. For inventories, record clipping/manual changes. |
| `license`, `license_url`, `credit`, `inputs[]`, `geometry_sha256` | Output licence/credit and normalized output geometry hash; each input's dataset/version, ID, URL, observation date/range, SHA-256, licence and credit. Include OSM and its snapshot separately from scene IDs. |
| `retained_regions[]` | Archived mask/part reference and hash, reason, source date or unknown for unrefreshed debris/uncertain margins. Mixed dates must remain visible. |
| `review` | Status (`candidate`, `accepted`, `hold`, `rejected`), date, review-record reference, coverage, old/new/facts areas, scope, flags and reasons. No personal contact data needed. |

The current inventory path implements schema version 1 with `method`, licence
URL, normalized geometry hash, selected analysis/feature IDs and `review`.
The ranges, imagery processing details and retained-region fields in the design
table remain for the later Sentinel-2 path; this inventory refresh does not
claim to implement those fields or process an image.

Keep the existing `outline_observed_at` wire field as the **mapped date**:
`geometry.observed_at ?? geometry.snapshot_at`. Thus undated OSM still sends
2026-10-28 and the four GLIMS rows send 2019-09-09. Actual observation and
snapshot remain distinct in JSONB. Read-only iOS checks found
`peakscore/PeaksModels/Glaciers.swift` reading `outline_observed_at`, and
`peakscore/NewUI/Sheets/GlacierDetailView.swift` using it for “Outline as mapped
in <month year>”. That note needs no field rename or app edit. A later iOS change
may distinguish survey and snapshot wording using `glacier.provenance.outline`.

Detail reads expose each facts row's own columns and `provenance.outline`.
Destination summaries and crossing objects also return that row's credit,
licence, mapped date, source URL and `outline_provenance` JSONB. No API or app
logic branches on a glacier or mountain name.

## Offline commands and apply handoff

Use the checked-in lockfile to install `polyclip-ts` 0.16.8 in the main
session's own dependency tree. This worker left the supplied `node_modules`
symlinks intact and used local read-only package links under
`cloud-sql/migrate/.cache/outline-node_modules`, with
`NODE_PATH="$PWD/.cache/outline-node_modules:$PWD/node_modules"`. That override
is only needed while those supplied dependencies lack the new package. It
made no network request or dependency-tree writes.

From repo root, rebuild the review packet without a database:

```sh
cd cloud-sql/migrate
mkdir -p .cache
./node_modules/.bin/tsc --noEmit -p .
node --import tsx src/import-rainier-glaciers.ts \
  --report-prefix=../../docs/data-audits/rainier-glacier-outline-decisions-2026-10-28 \
  --write-manifest=.cache/rainier-outline-manifest.json > .cache/rainier-outline-preview.json
```

The reviewed output hash is
`7db50df9c523308c511feb4465fa1ae1567be9c291cadc492397e591bdaa446e`
with platform-stable metrics (9 decimals; see
[the hash record](data-audits/glacier-manifest-hashes.md)). The hash first
applied in production was built before that rounding.
The manifest binds the source bytes, cohort, matching/selection decisions and
unmatched/ambiguous review via `outline_refresh.review_sha256`. To avoid a
hash cycle, this hashes the JSON report with `output_manifest_sha256` set to
the empty string. A changed review or source changes the manifest hash.

The generic step works on another mountain's OSM manifest too:

```sh
node --import tsx src/import-rainier-glaciers.ts --osm-only \
  --write-manifest=.cache/rainier-osm.json > .cache/rainier-osm-preview.json
node --import tsx src/refresh-glacier-outlines.ts \
  --manifest=.cache/rainier-osm.json \
  --config=data/glaciers-rainier-glims-2026-10-28/outline-sources.json \
  --report-prefix=.cache/rainier-outline-review \
  --write-manifest=.cache/rainier-refreshed.json
```

Always supply the original OSM manifest; do not feed a mixed-source result
back as the OSM baseline. Raw snapshots remain immutable. The generic helper
has no database or network mode. Use the normal importer after review. It
preflights **all** shapes for validity and park coverage before the first
write, then updates one place per transaction. A changed full outline fires
the existing old/new footprint queues, revision and outline-parts triggers;
the largest polygon updates existing boundary parts/display when it changes.
Provenance-only updates do not queue crossings. An identical replay changes
no owned fields, timestamps, revisions or queue dates. The first refresh also
adds provenance to retained OSM rows; their geometry bytes stay unchanged.

Main-session DB checks, after provisioning a disposable `_test` database and
applying migration 09, from repo root:

```sh
(cd cloud-sql/api && npm run typecheck && npm run lint && npm test)
(cd cloud-sql/migrate && ./node_modules/.bin/tsc --noEmit -p . && NODE_PATH="$PWD/node_modules" npm test)
TEST_DATABASE_URL='<disposable-url-ending-_test>' \
  sh -c 'cd cloud-sql/migrate && NODE_PATH="$PWD/node_modules" NODE_ENV=test node --test --test-concurrency=1 --import tsx src/__tests__/glacier-manifest.integration.test.ts'
TEST_DATABASE_URL='<same-disposable-url-ending-_test>' \
  sh -c 'cd cloud-sql/api && NODE_ENV=test node --test --test-concurrency=1 --import tsx src/__tests__/glacier-crossings.integration.test.ts'
```

Then follow the [API contract runbook](glaciers-api-contract.md#runbook-for-the-main-session)
for checked parent/park IDs, a separately authorized target, hash-gated apply,
an identical replay, and serial crossing repairs. Do not seed all crossings
for an ordinary refresh: existing outline triggers already queue the affected
old and new footprints. Use `--seed` only to repair missing or cleared queues.
This task does not authorize production writes or deployments.

Local checks: both typechecks passed; API lint passed. Migrate has no `lint`
script; targeted ESLint on all changed glacier TS files passed using the API's
installed ESLint/typescript-eslint and migrate's tsconfig. Focused suites
passed (16 migrate tests, one DB test skipped; 11 API tests). GEOS 3.15.0,
independent of the JS checks, validated all 29 output MultiPolygons. DB cases
were left for the main session. Full `npm test` results in this sandbox:

| Package | Passed | Failed | Skipped | Cause of failures |
| --- | ---: | ---: | ---: | --- |
| API | 514 | 27 | 18 | Supertest `listen EPERM` / null server port in `admin-covers`, `api-harness`, `public-air-quality-route`, `route-error-handling`, `weather-refresh`. |
| Migrate | 1686 | 9 | 27 | `tsx` CLI IPC `listen EPERM` in `official-route-pipeline`, `standard-route-audit-scripts`, `standard-route-import-conflicts`, `standard-route-source-check`. |

Reproduce the targeted lint from `cloud-sql/migrate` with the API dependencies
installed, without changing either package's shared dependency tree:

```sh
mkdir -p .cache
cat > .cache/glacier-eslint.config.cjs <<'JS'
const path = require('node:path');
const ts = require('node:module').createRequire(path.resolve('../api/package.json'))('typescript-eslint');
module.exports = ts.config(...ts.configs.recommended, {
  languageOptions: { parserOptions: { project: path.resolve('tsconfig.json'), tsconfigRootDir: process.cwd() } },
  rules: { '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] }
});
JS
../api/node_modules/.bin/eslint --config .cache/glacier-eslint.config.cjs \
  src/glaciers/outline-geometry.ts src/glaciers/outline-refresh.ts src/glaciers/polyclip.d.ts \
  src/import-glacier-manifest.ts src/import-rainier-glaciers.ts src/refresh-glacier-outlines.ts \
  src/__tests__/glacier-outline-refresh.test.ts src/__tests__/glacier-manifest.integration.test.ts \
  src/__tests__/rainier-glaciers.test.ts
```

Logs remain in `.cache/glacier-api-npm-test.log` and
`cloud-sql/migrate/.cache/glacier-migrate-npm-test.log`. The sandbox forbids
those socket binds. Rerun the same commands in the main session with socket
access. No glacier assertion failed in the full suites.

<details>
<summary>Exact sandbox test failures</summary>

All API failures came from blocked Supertest port binding. All migrate
failures came from the blocked tsx CLI IPC socket.

| Package | File | Test |
| --- | --- | --- |
| API | `admin-covers.test.ts` | unauthenticated requests are rejected |
| API | `admin-covers.test.ts` | a signed-in user without the admin claim gets 403 |
| API | `admin-covers.test.ts` | an admin with a bad storage path gets 400 before any lookup |
| API | `api-harness.test.ts` | /health returns 200 without auth |
| API | `api-harness.test.ts` | public air-quality route validates requests without auth or a live fetch |
| API | `api-harness.test.ts` | authenticated routes reject when X-Test-User missing |
| API | `public-air-quality-route.test.ts` | fresh public response needs no auth and filters to the quantized viewport |
| API | `public-air-quality-route.test.ts` | old source data has a typed stale envelope |
| API | `public-air-quality-route.test.ts` | unknown source time is stale and never replaced with fetch time |
| API | `public-air-quality-route.test.ts` | empty viewport has a typed no-data envelope |
| API | `public-air-quality-route.test.ts` | provider no-data result keeps its source update time |
| API | `public-air-quality-route.test.ts` | source-backed results expire at six hours and invalid no-data fails closed |
| API | `public-air-quality-route.test.ts` | stale no-data responses require cache revalidation |
| API | `public-air-quality-route.test.ts` | rate limit and upstream errors have distinct typed envelopes |
| API | `public-air-quality-route.test.ts` | provider throws become typed retryable errors |
| API | `public-air-quality-route.test.ts` | strict validation rejects arrays, wrapping boxes, large views, and invalid zoom |
| API | `route-error-handling.test.ts` | GET /api/destinations/dest123 returns retryable 503 when the database connection drops |
| API | `route-error-handling.test.ts` | GET /api/routes/route123 returns retryable 503 when the database connection drops |
| API | `route-error-handling.test.ts` | GET /api/areas/area123 returns retryable 503 when the database connection drops |
| API | `route-error-handling.test.ts` | GET /api/sessions/session123 returns retryable 503 when the database connection drops |
| API | `route-error-handling.test.ts` | GET /api/lists/list123 returns retryable 503 when the database connection drops |
| API | `route-error-handling.test.ts` | GET /api/plans/plan123 returns retryable 503 when the database connection drops |
| API | `route-error-handling.test.ts` | GET /api/trip-reports/report123 returns retryable 503 when the database connection drops |
| API | `route-error-handling.test.ts` | broken SQL remains a non-retryable 500 |
| API | `route-error-handling.test.ts` | malformed JSON body returns 400, not 500 |
| API | `route-error-handling.test.ts` | body over the 5mb JSON limit returns 413, not 500 |
| API | `weather-refresh.test.ts` | POST /internal/weather-refresh without a bearer token is rejected (mirrors sweep) |
| Migrate | `official-route-pipeline.test.ts` | candidate audit accepts registry-bound official geometry and rejects drift |
| Migrate | `standard-route-audit-scripts.test.ts` | loop merger joins distinct source-backed legs into one simple loop |
| Migrate | `standard-route-audit-scripts.test.ts` | loop merger rejects a fully retraced route labelled lollipop |
| Migrate | `standard-route-audit-scripts.test.ts` | loop merger combines USGS and official stable feature IDs |
| Migrate | `standard-route-import-conflicts.test.ts` | the worker runtime can load the importer before claiming a job |
| Migrate | `standard-route-source-check.test.ts` | queue source checks resolve from the module, not the process directory |
| Migrate | `standard-route-source-check.test.ts` | check_pending_osm_routes.mts loads and documents replacement review |
| Migrate | `standard-route-source-check.test.ts` | check_pending_usgs_routes.mts loads and documents replacement review |
| Migrate | `standard-route-source-check.test.ts` | check_pending_official_routes.mts loads and documents replacement review |

</details>

Remaining imagery work: a Sentinel-2 derivation/QA helper, scene and mask
artifacts, explicit debris review, mixed-date retained regions and richer
client wording. The inventory refresh implements none of that image work.

## Human contribution back to OSM

Recommend that an experienced mapper review a small Rainier pilot after the
packet is ready. The [OSM Sentinel-2 page](https://wiki.openstreetmap.org/wiki/Sentinel-2)
lists raw Sentinel data as available to OSM. Landsat and cleared U.S. government
aerial imagery can also serve as sources. Use exact dated scenes/tiles and check
provider tracing terms; editor imagery availability does not license copying
images into Peaks. Do not trace Google Earth, restricted NPS inventory views,
or redistribute Maxar imagery from the paper. CC BY RGI/GLIMS inputs need an
OSM compatibility check; credit alone does not settle Contributor Terms and
database rights.

Discuss the proposal with Washington/U.S. mappers first. Preserve objects,
history, shared nodes, relations, names, and useful tags; reconcile newer local
edits instead of replacing the mountain wholesale. Check alignment, debris,
seasonal snow, and [glacier tagging guidance](https://wiki.openstreetmap.org/wiki/Tag:natural%3Dglacier).
Record source dates and clear changeset comments; a check date is not an image
date. Use small, reviewable batches and respond to feedback.

External inventories or generated polygons require the [Import Guidelines](https://wiki.openstreetmap.org/wiki/Import/Guidelines):
source rights, crosswalk/merge plan, sample data, local consultation, required
import review, testing, and rollback plan before upload. The [Automated Edits
code of conduct](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct)
also covers scripted/systematic changes. A human owns that discussion and any
edit. **An agent prepares evidence only; it does not upload, open community
threads, or run recurring OSM corrections.** Later re-snapshot accepted OSM
changes through the normal workflow, keeping their true imagery dates.

## Skill phase

The glacier import skill holds this as phase 9, "Outline freshness refresh"
(`.agents/skills/peaks-glacier-import/SKILL.md`).
