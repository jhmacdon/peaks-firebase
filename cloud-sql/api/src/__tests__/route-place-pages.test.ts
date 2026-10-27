import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodeRoutePlaceCursor,routePlacePage} from '../lib/route-landmarks';
test('route place cursors reject malformed, stale and incomplete pages',()=>{
 const start=decodeRoutePlaceCursor(undefined);
 for (const raw of ['',42,Buffer.from(JSON.stringify({vertex:-1,along:0,row:0,version:'v'})).toString('base64url')])
  assert.throws(()=>decodeRoutePlaceCursor(raw));
 const row={version:'v',total_vertices:3000,last_vertex:2049,end_m:12345,items:[]};
 const page=routePlacePage(row,start);
 assert.deepEqual(decodeRoutePlaceCursor(page.nextCursor),{vertex:2049,along:12345,row:0,version:'v'});
 assert.throws(()=>routePlacePage({...row,version:'new'},decodeRoutePlaceCursor(page.nextCursor)));
 assert.throws(()=>routePlacePage({...row,last_vertex:null},start));
 assert.throws(()=>routePlacePage({...row,total_vertices:null},start));
 assert.equal(routePlacePage({...row,total_vertices:2049},start).nextCursor,null);
});
test('dense pages continue the same vertex window without dropping a result',()=>{
 const page=routePlacePage({version:'v',total_vertices:2,last_vertex:2,end_m:100,items:Array.from({length:101},(_,id)=>({id}))},decodeRoutePlaceCursor(undefined));
 assert.equal(page.items.length,100);
 assert.deepEqual(decodeRoutePlaceCursor(page.nextCursor),{vertex:1,along:0,row:100,version:'v'});
});
