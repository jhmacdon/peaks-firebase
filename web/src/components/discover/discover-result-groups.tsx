"use client";

import AreaCard from "../area-card";
import DestinationCard from "../destination-card";
import ListCard from "../list-card";
import RouteCard from "../route-card";
import { SectionHeading } from "../ui/section-heading";
import { DISCOVER_GRID } from "./discover-section";
import type { SearchScope } from "../../lib/discover-search";
import type {
  SearchAreaResult,
  SearchDestination,
  SearchRouteResult,
} from "../../lib/actions/search";
import type { ListRow } from "../../lib/actions/lists";

export interface ResultGroupsProps {
  scope: SearchScope;
  destinations: SearchDestination[];
  areas: SearchAreaResult[];
  routes: SearchRouteResult[];
  lists: ListRow[];
}

/** The four typed result grids, in the same card language and the same grid
 * rhythm as the browse sections. A group with nothing in it, or one the
 * current scope filters out, renders nothing — no empty heading. */
export function ResultGroups({
  scope,
  destinations,
  areas,
  routes,
  lists,
}: ResultGroupsProps) {
  const inScope = (kind: SearchScope) => scope === "all" || scope === kind;

  return (
    <>
      {inScope("destinations") && destinations.length > 0 ? (
        <ResultGroup title="Peaks & places">
          {destinations.map((dest) => (
            <DestinationCard
              key={dest.id}
              id={dest.id}
              name={dest.name}
              elevation={dest.elevation}
              features={dest.features}
              distance_m={dest.distance_m}
            />
          ))}
        </ResultGroup>
      ) : null}

      {inScope("areas") && areas.length > 0 ? (
        <ResultGroup title="Protected areas">
          {areas.map((area) => (
            <AreaCard key={area.id} area={area} />
          ))}
        </ResultGroup>
      ) : null}

      {inScope("routes") && routes.length > 0 ? (
        <ResultGroup title="Routes">
          {routes.map((route) => (
            <RouteCard key={route.id} route={route} />
          ))}
        </ResultGroup>
      ) : null}

      {inScope("lists") && lists.length > 0 ? (
        <ResultGroup title="Lists">
          {lists.map((list) => (
            <ListCard key={list.id} list={list} />
          ))}
        </ResultGroup>
      ) : null}
    </>
  );
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <SectionHeading>{title}</SectionHeading>
      <div className={`mt-5 ${DISCOVER_GRID}`}>{children}</div>
    </section>
  );
}
