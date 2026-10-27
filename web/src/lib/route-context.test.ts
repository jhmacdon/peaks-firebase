import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeRoutePlaces,parseRoutePlacePage,type RoutePlace } from './route-context';
const place=(id:string,along:number):RoutePlace=>({id,name:id,features:['campsite'],elevation:null,
 lat:48,lng:-121,route_offset_m:15,distance_along_m:along,is_linked:false});
test('route pages reject partial rows and missing continuation state',()=>{
 const p={items:[place('camp',9250)],nextCursor:null,distanceThroughMeters:55057};
 assert.deepEqual(parseRoutePlacePage(p),p);
 assert.throws(()=>parseRoutePlacePage({...p,nextCursor:undefined}));
 assert.throws(()=>parseRoutePlacePage({...p,items:[{...p.items[0],distance_along_m:undefined}]}));
 assert.throws(()=>parseRoutePlacePage({...p,items:[place('camp',-1)]}));
});
test('route pages preserve first encounter and server distance order',()=>{
 const first=[place('trailhead',0),place('camp',9250)];
 const next=[place('summit',27635),place('camp',45750),place('trailhead',55057)];
 const result=mergeRoutePlaces(first,next);
 assert.deepEqual(result.map(p=>p.id),['trailhead','camp','summit']);
 assert.deepEqual(result.map(p=>p.distance_along_m),[0,9250,27635]);
 assert.equal(first.length,2);
});
