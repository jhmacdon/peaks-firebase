"""Measure heads on saved glacier outlines with saved Copernicus GLO-30 tiles.
Run from migrate; requires GDAL Python bindings and numpy. No network or DB.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
parser = argparse.ArgumentParser()
parser.add_argument('--manifest', required=True)
parser.add_argument('--context', required=True)
parser.add_argument('--dem-dir', required=True)
parser.add_argument('--output', required=True)
a = parser.parse_args()
srs = osr.SpatialReference()
srs.ImportFromEPSG(4326)
srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
peaks = [e for e in json.loads(Path(a.context).read_text())['elements']
         if e['type'] == 'node' and e.get('tags', {}).get('natural') == 'peak' and e['tags'].get('name')]
tiles = [(p, gdal.Open(str(p))) for p in sorted(Path(a.dem_dir).glob('*DEM.tif'))]
if not tiles:
    raise RuntimeError('No saved DEM tiles')
result = {}
for place in json.loads(Path(a.manifest).read_text())['places']:
    shape = ogr.CreateGeometryFromJson(json.dumps(place['boundary']))
    best = None
    for path, ds in tiles:
        gt = ds.GetGeoTransform()
        x0, x1, y0, y1 = shape.GetEnvelope()
        c0 = max(0, math.floor((x0-gt[0])/gt[1]))
        c1 = min(ds.RasterXSize, math.ceil((x1-gt[0])/gt[1]))
        r0 = max(0, math.floor((y1-gt[3])/gt[5]))
        r1 = min(ds.RasterYSize, math.ceil((y0-gt[3])/gt[5]))
        width, height = c1-c0, r1-r0
        if width <= 0 or height <= 0:
            continue
        window = (gt[0]+c0*gt[1], gt[1], 0, gt[3]+r0*gt[5], 0, gt[5])
        mask = gdal.GetDriverByName('MEM').Create('', width, height, 1, gdal.GDT_Byte)
        mask.SetGeoTransform(window)
        mask.SetProjection(ds.GetProjection())
        vector = ogr.GetDriverByName('MEM').CreateDataSource('')
        layer = vector.CreateLayer('ice', srs, ogr.wkbMultiPolygon)
        feature = ogr.Feature(layer.GetLayerDefn())
        feature.SetGeometry(shape)
        layer.CreateFeature(feature)
        gdal.RasterizeLayer(mask, [1], layer, burn_values=[1])
        heights = ds.ReadAsArray(c0, r0, width, height)
        valid = mask.ReadAsArray().astype(bool) & np.isfinite(heights) & (heights > -1000)
        points = np.argwhere(valid)
        if not points.size:
            continue
        index = np.argmax(heights[valid])
        row, col = points[index]
        value = float(heights[valid][index])
        if best is None or value > best['elevation_m']:
            best = dict(lng=round(window[0]+(int(col)+.5)*gt[1], 8),
                        lat=round(window[3]+(int(row)+.5)*gt[5], 8), elevation_m=value, tile=path.name,
                        method='Highest valid Copernicus GLO-30 pixel centre inside the whole selected outline; 30 m surface model; not a surveyed glacier head.')
    if best is None:
        raise RuntimeError('No DEM coverage: '+place['name'])
    def distance(peak):
        return math.hypot((peak['lon']-best['lng'])*math.cos(math.radians(best['lat'])), peak['lat']-best['lat'])*111195
    nearest = sorted(peaks, key=distance)[:3]
    result[place['osm_key']] = dict(head=best, parent_candidates=[dict(
        osm_key='node:'+str(p['id']), name=p['tags']['name'], lat=p['lat'], lng=p['lon'],
        wikidata=p['tags'].get('wikidata'), distance_from_head_m=round(distance(p), 1),
        osm_elevation=p['tags'].get('ele')) for p in nearest])
Path(a.output).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'places':len(result), 'dem_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p,_ in tiles}}))
