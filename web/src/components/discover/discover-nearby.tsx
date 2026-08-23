"use client";

import { useEffect, useState } from "react";
import DestinationCard from "../destination-card";
import { DISCOVER_GRID, DiscoverSection, SectionLink } from "./discover-section";
import { useDiscoverState } from "./discover-state";
import {
  getNearbyDestinations,
  type SearchDestination,
} from "../../lib/actions/search";

const NEARBY_RADIUS_METERS = 50000;
const NEARBY_LIMIT = 12;

/**
 * Objectives near the reader — the one section that cannot be server
 * rendered, since only the browser knows where they are.
 *
 * It renders nothing at all until geolocation has actually succeeded AND
 * returned something: no pending state, no "turn location on" card, no empty
 * heading. It is last in the stack for that reason — a section that appears
 * a second late should push nothing else down the page.
 */
export function DiscoverNearby() {
  const { lat, lng } = useDiscoverState();
  const [nearby, setNearby] = useState<SearchDestination[]>([]);

  useEffect(() => {
    if (lat === null || lng === null) return;
    let cancelled = false;

    getNearbyDestinations(lat, lng, NEARBY_RADIUS_METERS, NEARBY_LIMIT)
      .then((results) => {
        if (!cancelled) setNearby(results);
      })
      .catch(() => {
        if (!cancelled) setNearby([]);
      });

    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  if (nearby.length === 0) return null;

  return (
    <DiscoverSection
      id="nearby"
      title="Nearby"
      description="Objectives close to where you are now."
      action={<SectionLink href="/map">Open the map</SectionLink>}
    >
      <div className={DISCOVER_GRID}>
        {nearby.map((dest) => (
          <DestinationCard
            key={dest.id}
            id={dest.id}
            name={dest.name}
            elevation={dest.elevation}
            features={dest.features}
            distance_m={dest.distance_m}
            imageUrl={dest.hero_image}
            imageFocalX={dest.hero_image_focal_x}
            imageFocalY={dest.hero_image_focal_y}
          />
        ))}
      </div>
    </DiscoverSection>
  );
}
