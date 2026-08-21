"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface ListMapMarker {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  completed: boolean;
}

interface ListMapProps {
  markers: ListMapMarker[];
  className?: string;
}

const TOPO_TILE = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const TOPO_ATTRIBUTION =
  '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';

// Same teal as components/plan-map.tsx's/route-map.tsx's/area-map.tsx's
// ACCENT — one map selection color across the site (design-tokens.md,
// "Accent budget"). Fixed hex rather than the token: painted into a
// Leaflet canvas/SVG layer, which never sees the page's CSS variables.
const ACCENT = "#46ADBC";

export default function ListMap({
  markers,
  className = "h-80 w-full sm:h-96",
}: ListMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  const markersJson = JSON.stringify(markers);

  useEffect(() => {
    if (!mapRef.current) return;

    mapInstance.current?.remove();

    const map = L.map(mapRef.current, { scrollWheelZoom: false });
    mapInstance.current = map;

    L.tileLayer(TOPO_TILE, {
      attribution: TOPO_ATTRIBUTION,
      maxZoom: 17,
      // OpenTopoMap serves no @2x tiles, so Leaflet's retina path fetches
      // the next zoom level at half tile size instead — contour lines and
      // place names stop looking soft on a high-density display.
      detectRetina: true,
    }).addTo(map);

    const parsedMarkers = JSON.parse(markersJson) as ListMapMarker[];

    const bounds = L.latLngBounds([]);

    for (const marker of parsedMarkers) {
      // Completed reads as a filled teal dot; remaining reads as a
      // teal-outlined, white-filled dot — "not yet" without a second color.
      const circle = L.circleMarker([marker.lat, marker.lng], {
        radius: 5,
        weight: 1.5,
        fillOpacity: 0.95,
        ...(marker.completed
          ? { fillColor: ACCENT, color: "#ffffff" }
          : { fillColor: "#ffffff", color: ACCENT }),
      }).addTo(map);
      circle.bindPopup(
        detailLink(
          marker.name ?? "Unnamed destination",
          `/destinations/${encodeURIComponent(marker.id)}`
        )
      );
      bounds.extend([marker.lat, marker.lng]);
    }

    // Same re-measure shape as plan-map.tsx's/area-map.tsx's fitView — a
    // container sized with a percentage height can measure 0×0 on first
    // mount, which sends fitBounds to whole-world zoom.
    const fitView = () => {
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.12), { maxZoom: 12 });
      }
    };

    fitView();
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      fitView();
    });

    return () => {
      cancelAnimationFrame(frame);
      map.remove();
      mapInstance.current = null;
    };
  }, [markersJson]);

  return (
    <div
      ref={mapRef}
      className={`map-embed bg-fill ${className}`.trim()}
      role="region"
      aria-label="List map"
    />
  );
}

// Builds the popup as DOM nodes via textContent, never an interpolated HTML
// string — a destination name is user-reachable data and must never reach
// Leaflet as markup (same contract as plan-map.tsx's/area-map.tsx's
// detailLink and map-popups.ts's textPopup/popupLink).
function detailLink(label: string, href: string): HTMLElement {
  const wrapper = document.createElement("div");
  const title = document.createElement("div");
  title.textContent = label;
  title.style.fontWeight = "600";
  const link = document.createElement("a");
  link.href = href;
  link.textContent = "View details";
  link.style.display = "inline-block";
  link.style.marginTop = "4px";
  link.style.color = ACCENT;
  wrapper.append(title, link);
  return wrapper;
}
