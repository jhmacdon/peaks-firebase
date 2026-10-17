"""Download WA trail layers from public ArcGIS services as GeoJSON (paged).

Usage: python3 -I fetch_arcgis.py <out_dir>
"""
import json
import sys
import time
import urllib.parse
import urllib.request

WA_BBOX = "-124.85,45.54,-116.91,49.0"

LAYERS = {
    "usfs_trails": (
        "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0",
        "1=1",
    ),
    "nps_trails": (
        "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0",
        "UNITCODE IN ('MORA','OLYM','NOCA','LACH','ROLA','SAJH','EBLA')",
    ),
    "wa_state_parks_trails": (
        "https://services5.arcgis.com/4LKAHwqnBooVDUlX/ArcGIS/rest/services/Trails/FeatureServer/0",
        "1=1",
    ),
}


def get(url, params):
    full = url + "/query?" + urllib.parse.urlencode(params)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(full, timeout=120) as resp:
                return json.load(resp)
        except Exception as exc:  # network hiccup: back off and retry
            print(f"  retry {attempt + 1}: {exc}", flush=True)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"failed: {full}")


def fetch(name, url, where, out_dir):
    common = {
        "where": where,
        "geometry": WA_BBOX,
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
    }
    ids = get(url, {**common, "returnIdsOnly": "true", "f": "json"})
    object_ids = sorted(ids.get("objectIds") or [])
    print(f"{name}: {len(object_ids)} features", flush=True)
    features = []
    for start in range(0, len(object_ids), 100):
        chunk = object_ids[start:start + 100]
        page = get(url, {
            "objectIds": ",".join(map(str, chunk)),
            "outFields": "*",
            "outSR": 4326,
            "f": "geojson",
        })
        features.extend(page.get("features", []))
        print(f"  {name}: {len(features)}/{len(object_ids)}", flush=True)
    with open(f"{out_dir}/{name}.geojson", "w") as fh:
        json.dump({"type": "FeatureCollection", "source": url, "where": where,
                   "bbox": WA_BBOX, "features": features}, fh)


if __name__ == "__main__":
    out = sys.argv[1]
    for layer, (layer_url, layer_where) in LAYERS.items():
        fetch(layer, layer_url, layer_where, out)
