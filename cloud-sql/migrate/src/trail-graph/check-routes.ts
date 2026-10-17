import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { args, DEFAULT_OUT, option } from './io';
import { loadRouter } from './route';
import type { Endpoint, RouteOptions } from './router';

/** Local smoke checks. Failures stay in the report; they must not become invented links. */
async function main() {
  const options = args(), out = option(options, 'out', DEFAULT_OUT), router = await loadRouter(out);
  const vertex = (id: string) => { const s = router.segments.find(s => s.node_ids.includes(id)); if (!s) throw new Error(`Missing check vertex ${id}`); return s.coords[s.node_ids.indexOf(id)]; };
  const checks: { name: string; from: Endpoint; to: Endpoint; options?: RouteOptions; note?: string }[] = [
    { name: 'Skyline Trailhead → Camp Muir', from: 'Skyline Trailhead', to: 'Camp Muir', options: { preferNames: ['Skyline Trail', 'Camp Muir Route'] } },
    { name: 'Camp Muir → Columbia Crest', from: 'Camp Muir', to: 'Columbia Crest', options: { preferNames: ['Disappointment Cleaver Route'] } },
    { name: 'Mount Si Trailhead → Haystack summit', from: 'Mount Si Trailhead', to: 'node/356546426', options: { preferNames: ['Mount Si Trail'] } },
    { name: 'Rattlesnake Lake → Rattlesnake Ledge', from: 'way/5917086', to: 'Rattlesnake Ledge', options: { preferNames: ['Rattlesnake Ledge Trail'] }, note: 'Lake point uses its nearest graph vertex at the shore.' },
    { name: 'Lake Serene Trailhead → Lake Serene', from: 'Lake Serene Trailhead', to: 'relation/16680239', options: { preferNames: ['Lake Serene Trail'] }, note: 'Typed relation ID distinguishes the hiking lake from the same-name lake near Lynnwood.' },
    { name: 'Stuart Lake Trailhead → Colchuck Lake', from: 'Stuart Lake Trailhead', to: 'relation/17094764', options: { preferNames: ['Stuart Lake Trail', 'Colchuck Lake Trail'] } },
    { name: 'Maple Pass loop', from: 'Rainy Pass Trailhead', to: 'Rainy Pass Trailhead', options: { via: ['Heather Pass', 'Maple Pass', vertex('12564704208')], preferNames: ['Maple Pass Trail', 'Heather Pass Trail'] }, note: 'Uses the named trailhead and an eastern-ridge source node on Maple Pass Loop Trail relation, so the return leg follows the loop. Heather/Maple alone permits a shorter retrace.' },
    { name: 'Skyline → Camp Muir via Panorama Point (viewpoint)', from: 'Skyline Trailhead', to: 'Camp Muir', options: { preferNames: ['Skyline Trail', 'Camp Muir Route'], via: ['node/1891140725'] }, note: 'Supplemental check forcing the expected viewpoint.' },
  ];
  // The Lake Serene relation explicitly marks this node as its stop. Preserve
  // that distinction from the lake polygon's boundary endpoint.
  const stop = router.segments.find(s => s.node_ids.includes('4505639650'));
  if (stop) checks.push({ name: 'Lake Serene Trailhead → relation stop (supplemental)', from: 'Lake Serene Trailhead', to: stop.coords[stop.node_ids.indexOf('4505639650')], options: { preferNames: ['Lake Serene Trail'] }, note: 'OSM hiking relation 4807642 stop node 4505639650; compare with the lake boundary endpoint.' });
  checks.push({ name: 'Stuart Lake Trailhead → Colchuck trail end (supplemental)', from: 'Stuart Lake Trailhead', to: vertex('46862432'), options: { preferNames: ['Stuart Lake Trail', 'Colchuck Lake Trail'] }, note: 'End of way 844433058, the last way in Colchuck Lake Trail relation 4152031; this includes travel along the lake, not merely first arrival at its shore.' });
  const results = checks.map(check => {
    try {
      const route = router.route(check.from, check.to, check.options), ids = route.segments.map(s => s.segment_id);
      return { ...check, status: 'routed' as const, total_length_m: route.total_length_m, segment_count: ids.length,
        repeated_segment_traversals: ids.length - new Set(ids).size, features_passed: route.features.map(f => ({ name: f.name, osm_id: f.osm_id, distance_along_m: f.distance_along_m })), snaps: route.snaps, segments: route.segments };
    } catch (error) { return { ...check, status: 'error' as const, error: (error as Error).message }; }
  });
  await writeFile(join(out, 'route-checks.json'), JSON.stringify(results, null, 2) + '\n');
  for (const result of results) console.log(JSON.stringify(result.status === 'routed' ? { name: result.name, status: result.status, length_m: result.total_length_m, segments: result.segment_count, repeated_segments: result.repeated_segment_traversals, features: result.features_passed?.map(f => f.name) } : result));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
