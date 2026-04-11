"use client";

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MarkerData {
  lat: number;
  lng: number;
  name: string;
  color: string;
}

interface DestinationSearchMapProps {
  onClick: (lat: number, lng: number) => void;
  clickedPoint: { lat: number; lng: number } | null;
  markers?: MarkerData[];
}

export default function DestinationSearchMap({
  onClick,
  clickedPoint,
  markers,
}: DestinationSearchMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const clickMarkerRef = useRef<L.Marker | null>(null);
  const resultLayerRef = useRef<L.LayerGroup | null>(null);

  const handleClick = useCallback(
    (e: L.LeafletMouseEvent) => {
      onClick(e.latlng.lat, e.latlng.lng);
    },
    [onClick]
  );

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

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

    resultLayerRef.current = L.layerGroup().addTo(map);

    // Try geolocation, fallback to US center
    map.locate({ setView: true, maxZoom: 10, timeout: 5000 });
    map.on("locationerror", () => {
      map.setView([39, -98], 5);
    });

    map.on("click", handleClick);

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [handleClick]);

  // Update clicked point marker
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (clickMarkerRef.current) {
      clickMarkerRef.current.remove();
      clickMarkerRef.current = null;
    }

    if (clickedPoint) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:20px;height:20px;border-radius:50%;background:#f59e0b;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      clickMarkerRef.current = L.marker([clickedPoint.lat, clickedPoint.lng], {
        icon,
        zIndexOffset: 1000,
      }).addTo(map);
    }
  }, [clickedPoint]);

  // Update result markers
  useEffect(() => {
    const layer = resultLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (!markers) return;

    for (const m of markers) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:50%;background:${m.color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      L.marker([m.lat, m.lng], { icon })
        .bindTooltip(m.name, { direction: "top", offset: [0, -10] })
        .addTo(layer);
    }
  }, [markers]);

  return <div ref={mapRef} className="w-full h-full" />;
}
