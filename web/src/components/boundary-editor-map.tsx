"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";

interface BoundaryEditorMapProps {
  lat: number;
  lng: number;
  name?: string | null;
  boundary: GeoJSON.Polygon | null;
  onBoundaryChange: (boundary: GeoJSON.Polygon | null) => void;
}

export default function BoundaryEditorMap({
  lat,
  lng,
  name,
  boundary,
  onBoundaryChange,
}: BoundaryEditorMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const drawnItems = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const onChangeRef = useRef(onBoundaryChange);
  onChangeRef.current = onBoundaryChange;

  const syncBoundary = useCallback(() => {
    const layers = drawnItems.current.getLayers();
    if (layers.length === 0) {
      onChangeRef.current(null);
      return;
    }
    const layer = layers[0] as L.Polygon;
    const geojson = layer.toGeoJSON();
    onChangeRef.current(geojson.geometry as GeoJSON.Polygon);
  }, []);

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
        '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      maxZoom: 17,
    }).addTo(map);

    // Destination point marker
    const icon = L.divIcon({
      className: "",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    if (name) marker.bindPopup(name);

    // Feature group for drawn shapes
    const items = drawnItems.current;
    items.clearLayers();
    map.addLayer(items);

    // Load existing boundary
    if (boundary) {
      const polygon = L.geoJSON(
        { type: "Feature", geometry: boundary, properties: {} } as GeoJSON.Feature,
        {
          style: { color: "#2563eb", weight: 2, fillOpacity: 0.15 },
        }
      );
      polygon.eachLayer((layer) => items.addLayer(layer));
    }

    // Draw controls
    const drawControl = new (L.Control as any).Draw({
      position: "topright",
      draw: {
        polygon: {
          allowIntersection: false,
          shapeOptions: { color: "#2563eb", weight: 2, fillOpacity: 0.15 },
        },
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: {
        featureGroup: items,
        remove: true,
      },
    });
    map.addControl(drawControl);

    // Events
    map.on((L as any).Draw.Event.CREATED, (e: any) => {
      // Only allow one boundary — clear existing
      items.clearLayers();
      items.addLayer(e.layer);
      syncBoundary();
    });

    map.on((L as any).Draw.Event.EDITED, () => {
      syncBoundary();
    });

    map.on((L as any).Draw.Event.DELETED, () => {
      syncBoundary();
    });

    // Fit view
    if (boundary && items.getLayers().length > 0) {
      map.fitBounds(items.getBounds().pad(0.3));
    } else {
      map.setView([lat, lng], 15);
    }

    return () => {
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, name]);

  return <div ref={mapRef} className="h-96 rounded-xl z-0" />;
}
