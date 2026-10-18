/** Local source-name corrections, not changes to distance or quality gates.
 * Keep the seed intact in output; record each correction in route notes. */
export interface ResolutionHint { trailhead?: string; objective?: { name: string; feature: string }; trails?: string[]; note: string; via?: string[] }
export const RESOLUTION_HINTS: Record<string, ResolutionHint> = {
  'Gothic Basin Trail': { trails: ['Monte Cristo Trail', 'Gothic Basin Trail'], objective: { name: 'Foggy Lake', feature: 'lake' }, note: 'The seed notes name Foggy Lake as the objective. The gated Monte Cristo approach is mapped as Monte Cristo Trail.' },
  'Pinnacle Saddle via Pinnacle Peak Trail': { objective: { name: 'Pinnacle Saddle', feature: 'viewpoint' }, note: 'OSM node 891288375 maps Pinnacle Saddle as a viewpoint. Use that named saddle, not the Pinnacle Peak trail end.' },
  'Discovery Park Loop Trail': { trails: ['Discovery Park Loop Trail'], note: 'Use the mapped Discovery Park loop relation in Seattle. The generic Loop Trail name previously resolved near Moss Lake.' },
  'Mount Fremont Lookout': { trailhead: 'Sunrise Rim Trailhead', note: 'Start at the Sunrise visitor-center parking area, beside the mapped Sunrise Rim Trailhead; Sunrise Point is a different trailhead.' },
  'Dege Peak via Sourdough Ridge Trail': { trailhead: 'Sunrise Rim Trailhead', note: 'Start at the Sunrise visitor-center parking area, beside the mapped Sunrise Rim Trailhead; Sunrise Point is a different trailhead.' },
  'Yellow Aster Butte Trail': { trails: ['Tomyhoi Trail', 'Yellow Aster Butte Trail'], note: 'The mapped Tomyhoi approach joins Yellow Aster Butte Trail above their shared trailhead.' },
  'Wallace Falls via Woody Trail': { objective: { name: 'Upper Wallace Falls Viewpoint', feature: 'viewpoint' }, note: 'The seed notes specify the upper falls viewpoint, not the lower waterfall.' },
  'Mount Constitution via Twin Lakes': { trailhead: 'Mount Constitution and Mountain Lake Trailhead', trails: ['Mountain Lake Loop Trail', 'Twin Lakes Trail', 'Little Summit Trail'], via: ['Twin Lakes'], note: 'Use the mapped Mountain Lake trailhead and pass Twin Lakes before the summit; the guessed Mount Constitution Trail name is absent from the sources.' },
  'Bowl and Pitcher Loop': { trails: ['Bowl and Pitcher Loop Trail'], note: 'The source names the loop Bowl and Pitcher Loop Trail; the seed guessed Riverside trail 25.' },
};
