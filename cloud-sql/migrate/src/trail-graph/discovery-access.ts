import { Grid, haversine, nearest } from './geo';
import { usableTrailheadName } from './discovery-names';
import type { AccessPoint } from './catalog-types';
import type { Coord, NamedFeature } from './types';

type StartPlace = NamedFeature | AccessPoint;
const coord = (place: StartPlace): Coord => 'coord' in place ? place.coord : [place.lon, place.lat];

/** Shared indexes for start names and public road/parking evidence. */
export class DiscoveryAccess {
  private readonly roads = new Grid<AccessPoint>(250);
  private readonly named = new Grid<StartPlace>(125);
  constructor(access: AccessPoint[] = [], features: NamedFeature[] = [], readonly restrictedSegments: ReadonlySet<string> = new Set()) {
    for (const place of access) {
      this.roads.add(place.coord, place.coord, place);
      if (place.parking && usableTrailheadName(place)) this.named.add(place.coord, place.coord, place);
    }
    for (const place of features) if (place.feature === 'trailhead' && usableTrailheadName(place)) this.named.add(coord(place), coord(place), place);
  }
  hasRoadContact(point: Coord): boolean { return !!nearest(this.roads, point, 250); }
  namedStart(point: Coord): StartPlace | undefined {
    return this.named.near(point, 125).map(place => ({ place, gap: haversine(point, coord(place)) }))
      .filter(hit => hit.gap <= 125 + 1e-6).sort((a, b) => a.gap - b.gap || a.place.osm_id.localeCompare(b.place.osm_id))[0]?.place;
  }
}
