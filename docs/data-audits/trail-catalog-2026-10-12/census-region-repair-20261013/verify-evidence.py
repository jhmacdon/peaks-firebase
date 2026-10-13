#!/usr/bin/env python3
"""Verify saved Census responses and replay this four-place, offline proposal."""
import hashlib
import json
import math
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ring_check(lng, lat, ring):
    # Local equirectangular distances are a conservative screening aid here,
    # not a boundary survey. All four points must stand >5 km inside the polygon.
    scale = 6371000 * math.pi / 180
    projected = [((x-lng)*scale*math.cos(math.radians(lat)), (y-lat)*scale) for x,y in ring]
    inside = False
    distance = math.inf
    for i,(x1,y1) in enumerate(projected):
        x2,y2 = projected[(i+1) % len(projected)]
        if (y1 > 0) != (y2 > 0) and x1 + (-y1)*(x2-x1)/(y2-y1) > 0:
            inside = not inside
        dx,dy=x2-x1,y2-y1
        t=max(0,min(1,-(x1*dx+y1*dy)/(dx*dx+dy*dy))) if dx or dy else 0
        distance=min(distance,math.hypot(x1+t*dx,y1+t*dy))
    return inside,distance


def verify():
    receipts=json.loads((ROOT/'source-requests.json').read_text())
    for receipt in receipts:
        assert digest(ROOT/receipt['file']) == receipt['sha256'], receipt['file']
        assert urlparse(receipt['url']).hostname == 'tigerweb.geo.census.gov'
    by_file={r['file']:r for r in receipts}
    layer=json.loads((ROOT/'layer-0.json').read_text())
    assert layer['id']==0 and 'January 1, 2026' in layer['description']
    fc=json.loads((ROOT/'washington-state.geojson').read_text())
    assert not fc.get('exceededTransferLimit') and len(fc['features'])==1
    feature=fc['features'][0]
    assert feature['properties']=={'GEOID':'53','STATE':'53','NAME':'Washington','STUSAB':'WA'}
    geom=feature['geometry']
    assert geom['type']=='Polygon', 'Review a changed source geometry type'
    rows=[json.loads(line.strip()) for line in (ROOT/'linked-region-preflight.txt').read_text().splitlines() if line.lstrip().startswith('{')]
    assert len(rows)==38 and all(len(r['places'])==2 for r in rows)
    assert all(p['state_code'] is None for r in rows for p in r['places'])
    expected_ids={'Ndsk2Ad2F6r9sXR8cK0m','6PxfQ1g48SrbplzGd6UH','YtzjvQqup3gqmAYnz0l4','APWWTYFkwvuUFc3TP1m9'}
    proposals=[]
    blocked=[]
    for row in rows:
        for place in row['places']:
            if place['id'] not in expected_ids:
                blocked.append({'destination_id':place['id'],'name':place['name'],'route_id':row['route_id'],'reason':'outside_approved_us_census_repair_scope','existing_country_code':place['country_code']})
                continue
            assert place['country_code'] is None and place['state_code'] is None
            name='point-'+place['id']+'.json'
            receipt=by_file[name]
            query=parse_qs(urlparse(receipt['url']).query)
            source_point=json.loads(query['geometry'][0])
            assert source_point=={'x':place['lng'],'y':place['lat'],'spatialReference':{'wkid':4326}}
            assert query['spatialRel']==['esriSpatialRelIntersects'] and query['outFields']==['GEOID,STATE,NAME,STUSAB']
            result=json.loads((ROOT/name).read_text())
            assert 'error' not in result and not result.get('exceededTransferLimit') and len(result['features'])==1
            assert result['features'][0]['attributes']==feature['properties']
            inside=False
            edge_distance=math.inf
            for ring in geom['coordinates']:
                hit,dist=ring_check(place['lng'],place['lat'],ring)
                inside ^= hit
                edge_distance=min(edge_distance,dist)
            assert inside and edge_distance > 5000, 'Ambiguous/near-boundary point needs separate review'
            evidence={'source_name':'U.S. Census Bureau TIGERweb States','source_url':receipt['url'],'source_layer_url':'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0','source_vintage':'2026-01-01','retrieved_at':receipt['retrievedAt'],'point_response_sha256':receipt['sha256'],'boundary_sha256':by_file['washington-state.geojson']['sha256'],'state_geoid':'53','method':'unique Census state polygon intersection at unchanged catalog XY; saved polygon interior cross-check','coordinate':{'lat':place['lat'],'lng':place['lng']},'approx_boundary_distance_m':round(edge_distance,3),'near_boundary_reject_threshold_m':5000,'attribution':'Source: U.S. Census Bureau'}
            proposals.append({'destination_id':place['id'],'name':place['name'],'expected_lat':place['lat'],'expected_lng':place['lng'],'expected_external_ids':place['external_ids'],'expected_features':place['features'],'before':{'country_code':None,'state_code':None},'after':{'country_code':'US','state_code':'WA'},'route_id':row['route_id'],'region_source':evidence})
    assert len(proposals)==4 and {p['destination_id'] for p in proposals}==expected_ids and len(blocked)==72
    return {'version':1,'mode':'reviewed_proposal_no_database_writes','linked_preflight_sha256':digest(ROOT/'linked-region-preflight.txt'),'scope':{'region_only_routes':38,'linked_places':76,'proposed_destinations':4,'affected_rejected_routes':2,'outside_us_scope_places':72,'outside_us_scope_routes':36},'proposals':proposals,'blocked':blocked,'limitations':['The 5 km margin is a review threshold, not a stated Census accuracy bound. These four points stand far inside Washington in the saved polygon and each returns exactly one state in the Census service.','The source establishes administrative region at existing XY. It does not attest route geometry, destination identity, elevation, or route publication eligibility.','The two route metadata plans must be run again after any approved destination repair. Earlier region rejection returned before path-estimate checks; other blockers may remain.']}


if __name__=='__main__':
    result=verify()
    existing=ROOT/'proposal.json'
    if existing.exists():
        assert json.loads(existing.read_text()) == result, 'Saved proposal differs from verified evidence'
    print(json.dumps(result,indent=2,ensure_ascii=False))
