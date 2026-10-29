"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { textPopup } from "./map-popups";

interface DestinationMapProps {
  lat: number;
  lng: number;
  name?: string | null;
  boundary?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  /** Height/shape of the embed. The container owns the radius, so a mosaic
   * tile can crop this square while a section container rounds it. */
  className?: string;
  /** false turns off every pan/zoom handler — the hero-mosaic tile reads as
   * a still map that links to the live one further down the page. */
  interactive?: boolean;
  /** "satellite" opens on Esri imagery with a Topographic switch and draws
   * the outline with the area map's pale halo, which a thin teal edge needs
   * to stay visible over snow and ice. Glacier pages use it; every other
   * place keeps the topo default. */
  basemap?: "topo" | "satellite";
}

// Marker and boundary carry the Peaks teal (design-tokens.md, "Accent
// budget" — a map selection is one of the places the accent is spent), on a
// narrow pale edge with a low-opacity fill so the topo underneath stays
// readable. Fixed hex rather than the token: these are painted into a
// Leaflet canvas/SVG layer, which never sees the page's CSS variables.
const ACCENT = "#46ADBC";
// Pale halo under the outline on imagery — area-map.tsx's AREA_PALE_EDGE.
const PALE_EDGE = "#CFEEF2";
const TOPO_TILE = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const TOPO_ATTRIBUTION =
  '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';
const SATELLITE_TILE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTRIBUTION =
  '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';

export default function DestinationMap({
  lat,
  lng,
  name,
  boundary,
  className = "h-80",
  interactive = true,
  basemap = "topo",
}: DestinationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    const map = L.map(mapRef.current, {
      scrollWheelZoom: false,
      dragging: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      zoomControl: interactive,
    });
    mapInstance.current = map;

    // OpenTopoMap serves no @2x tiles, so Leaflet's retina path fetches the
    // next zoom level at half tile size instead — the contour lines and
    // place names stop looking soft on a high-density display.
    const topo = L.tileLayer(TOPO_TILE, { attribution: TOPO_ATTRIBUTION, maxZoom: 17, detectRetina: true });
    if (basemap === "satellite") {
      const satellite = L.tileLayer(SATELLITE_TILE, {
        attribution: SATELLITE_ATTRIBUTION,
        maxZoom: 18,
        detectRetina: true,
      }).addTo(map);
      if (interactive) {
        L.control
          .layers({ Satellite: satellite, Topographic: topo }, {}, { position: "topright" })
          .addTo(map);
      }
    } else {
      topo.addTo(map);
    }

    const icon = L.divIcon({
      className: "",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${ACCENT};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

    const marker = L.marker([lat, lng], { icon }).addTo(map);
    // textPopup builds the popup node with textContent, never an HTML string —
    // a destination name is user-reachable data and must never reach Leaflet
    // as markup.
    if (name && interactive) marker.bindPopup(textPopup(name));

    const feature = boundary
      ? ({ type: "Feature", geometry: boundary, properties: {} } as GeoJSON.Feature)
      : null;
    if (feature && basemap === "satellite") {
      L.geoJSON(feature, {
        style: { color: PALE_EDGE, weight: 5, opacity: 0.95, fillOpacity: 0 },
        interactive: false,
      }).addTo(map);
    }
    const polygon = feature
      ? L.geoJSON(feature, {
          style:
            basemap === "satellite"
              ? { color: ACCENT, weight: 2, opacity: 1, fillColor: ACCENT, fillOpacity: 0.15 }
              : { color: ACCENT, weight: 1.5, opacity: 0.7, fillOpacity: 0.12 },
        }).addTo(map)
      : null;

    const fitView = () => {
      if (polygon) {
        map.fitBounds(polygon.getBounds().pad(0.3));
      } else {
        map.setView([lat, lng], 13);
      }
    };

    fitView();

    // A container sized with percentage heights (the hero mosaic's tiles
    // are `h-full` inside a grid) can measure 0×0 the first time Leaflet
    // reads it, and `fitBounds` on a zero-size map lands on whole-world
    // zoom — which is exactly what the mosaic's map tile used to show.
    // Re-measuring and re-fitting on the next frame costs nothing on a map
    // that was already sized right.
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      fitView();
    });

    return () => {
      cancelAnimationFrame(frame);
      map.remove();
      mapInstance.current = null;
    };
  }, [lat, lng, name, boundary, interactive, basemap]);

  // `map-embed` styles the Leaflet attribution down to a 10px muted line
  // (globals.css) so the credit stays legible without competing with the
  // page. bg-fill is what shows while tiles are still in flight.
  //
  // Deliberately no z-index here. Leaflet paints its panes at z 400-1000,
  // which has to stay under the app's own chrome — but pinning `z-0` on
  // this element makes it a stacking context, which flattens those panes
  // into one layer and lets any sibling overlay (a scrim, a click target)
  // paint over the tile attribution. Containment belongs to whatever wraps
  // this: `isolate` on the wrapper, or `z-0` passed in via className.
  return <div ref={mapRef} className={`map-embed bg-fill ${className}`.trim()} />;
}
