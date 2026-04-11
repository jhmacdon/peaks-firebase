"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface DestinationMapProps {
  lat: number;
  lng: number;
  name?: string | null;
  boundary?: GeoJSON.Polygon | null;
}

export default function DestinationMap({ lat, lng, name, boundary }: DestinationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    const map = L.map(mapRef.current, {
      scrollWheelZoom: false,
    });
    mapInstance.current = map;

    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      maxZoom: 17,
    }).addTo(map);

    const icon = L.divIcon({
      className: "",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

    const marker = L.marker([lat, lng], { icon }).addTo(map);
    if (name) marker.bindPopup(name);

    if (boundary) {
      const polygon = L.geoJSON(
        { type: "Feature", geometry: boundary, properties: {} } as GeoJSON.Feature,
        { style: { color: "#2563eb", weight: 2, fillOpacity: 0.15 } }
      ).addTo(map);
      map.fitBounds(polygon.getBounds().pad(0.3));
    } else {
      map.setView([lat, lng], 13);
    }

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [lat, lng, name, boundary]);

  return <div ref={mapRef} className="h-80 rounded-xl z-0" />;
}
