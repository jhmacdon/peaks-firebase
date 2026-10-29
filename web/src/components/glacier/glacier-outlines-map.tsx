"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { textPopup } from "../map-popups";

export interface GlacierOutline {
  id: string;
  name: string;
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

// Same teal selection as destination-map.tsx and area-map.tsx: a narrow
// edge and a low fill so the topo stays readable (design-tokens.md, "Area
// selections"). Fixed hex because Leaflet's SVG layer never sees CSS vars.
const ACCENT = "#46ADBC";
// Pale halo under each outline so the edge holds against white ice —
// area-map.tsx's AREA_PALE_EDGE.
const PALE_EDGE = "#CFEEF2";

/** Every glacier on one mountain. Hover names an outline, a click opens its
 * page. The roster table beside it carries the same links for keyboard and
 * screen-reader readers, so the map itself stays a pointer convenience. */
export default function GlacierOutlinesMap({
  outlines,
  credits,
  className = "h-[420px]",
}: {
  outlines: GlacierOutline[];
  /** Outline credits from the facts rows, shown in the map attribution. */
  credits: string[];
  className?: string;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!mapRef.current || outlines.length === 0) return;
    // Quarter-step zoom lets the roster fill the frame instead of snapping
    // out a whole level and leaving the mountain small in the middle.
    const map = L.map(mapRef.current, { scrollWheelZoom: false, zoomSnap: 0.25 });

    const satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
        maxZoom: 18,
        detectRetina: true,
      }
    ).addTo(map);
    const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      maxZoom: 17,
      detectRetina: true,
    });
    L.control.layers({ Satellite: satellite, Topographic: topo }, {}, { position: "topright" }).addTo(map);
    // Credits are catalog text; escape before Leaflet treats them as HTML.
    const escaped = credits.map((credit) => credit.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
    if (escaped.length) map.attributionControl.addAttribution(`Outlines: ${escaped.join(", ")}`);

    const group = L.featureGroup().addTo(map);
    for (const outline of outlines) {
      const feature = { type: "Feature", geometry: outline.boundary, properties: {} } as GeoJSON.Feature;
      L.geoJSON(feature, {
        style: { color: PALE_EDGE, weight: 4, opacity: 0.9, fillOpacity: 0 },
        interactive: false,
      }).addTo(group);
      const layer = L.geoJSON(feature, {
        style: { color: ACCENT, weight: 1.75, opacity: 1, fillColor: ACCENT, fillOpacity: 0.18 },
      });
      layer.bindTooltip(textPopup(outline.name), { sticky: true });
      layer.on("mouseover", () => layer.setStyle({ fillOpacity: 0.4, weight: 2.5 }));
      layer.on("mouseout", () => layer.setStyle({ fillOpacity: 0.18, weight: 1.75 }));
      layer.on("click", () => router.push(`/destinations/${encodeURIComponent(outline.id)}`));
      layer.addTo(group);
    }

    const fit = () => map.fitBounds(group.getBounds().pad(0.04));
    fit();
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      fit();
    });

    return () => {
      cancelAnimationFrame(frame);
      map.remove();
    };
  }, [outlines, credits, router]);

  return <div ref={mapRef} className={`map-embed bg-fill ${className}`.trim()} />;
}
