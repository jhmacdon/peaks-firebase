"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface LocationPickerMapProps {
  lat: number;
  lng: number;
  /** Optional polyline to show for context */
  routePoints?: { lat: number; lng: number }[];
  onChange: (lat: number, lng: number) => void;
}

export default function LocationPickerMap({
  lat,
  lng,
  routePoints,
  onChange,
}: LocationPickerMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    const map = L.map(mapRef.current, {
      scrollWheelZoom: true,
      zoomControl: true,
    });
    mapInstance.current = map;

    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17,
    }).addTo(map);

    // Show route for context
    if (routePoints && routePoints.length > 1) {
      const coords = routePoints.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(coords, { color: "#2563eb", weight: 2, opacity: 0.5 }).addTo(map);
    }

    // Draggable marker
    const icon = L.divIcon({
      className: "",
      html: `<div style="width:24px;height:24px;border-radius:50%;background:#f59e0b;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);cursor:grab"></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
    markerRef.current = marker;

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      onChange(pos.lat, pos.lng);
    });

    map.setView([lat, lng], 15);

    return () => {
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Initialize once

  // Update marker position if lat/lng props change externally
  useEffect(() => {
    if (markerRef.current) {
      const current = markerRef.current.getLatLng();
      if (Math.abs(current.lat - lat) > 0.00001 || Math.abs(current.lng - lng) > 0.00001) {
        markerRef.current.setLatLng([lat, lng]);
      }
    }
  }, [lat, lng]);

  return <div ref={mapRef} className="h-[250px] rounded-lg z-0" />;
}
