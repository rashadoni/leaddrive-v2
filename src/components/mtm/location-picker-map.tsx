"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useState } from "react"
import { MapContainer, Marker, useMapEvents, useMap } from "react-leaflet"
import L from "leaflet"
import { CartoVectorBasemap } from "./carto-vector-basemap"

const markerIcon = L.divIcon({
  className: "custom-marker",
  html: `<div style="
    width: 32px; height: 32px; border-radius: 50%;
    background: #6C63FF;
    border: 3px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    cursor: grab;
  "></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
})

interface Props {
  latitude: number | null
  longitude: number | null
  onChange: (lat: number, lng: number) => void
}

function ClickHandler({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(
        Math.round(e.latlng.lat * 1000000) / 1000000,
        Math.round(e.latlng.lng * 1000000) / 1000000,
      )
    },
  })
  return null
}

function InvalidateSize() {
  const map = useMap()
  useEffect(() => {
    setTimeout(() => map.invalidateSize(), 100)
  }, [map])
  return null
}

function FullScreenMap({ latitude, longitude, onChange, onClose }: Props & { onClose: () => void }) {
  const defaultCenter: [number, number] = [40.4093, 49.8671]
  const hasPosition = latitude != null && longitude != null && latitude !== 0 && longitude !== 0
  const center: [number, number] = hasPosition ? [latitude!, longitude!] : defaultCenter

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Overlay */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} onClick={onClose} />

      {/* Map container */}
      <div style={{
        position: "relative", margin: "40px", flex: 1, borderRadius: 12, overflow: "hidden",
        boxShadow: "0 25px 50px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          background: "#1e293b", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>
            Click on map to set location
            {hasPosition && (
              <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 12, fontSize: 12 }}>
                {latitude!.toFixed(6)}, {longitude!.toFixed(6)}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "#6C63FF", color: "#fff", border: "none", borderRadius: 6,
              padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>

        {/* Map */}
        <div style={{ flex: 1 }}>
          <MapContainer center={center} zoom={hasPosition ? 16 : 13} style={{ height: "100%", width: "100%" }}>
            <CartoVectorBasemap />
            <ClickHandler onChange={onChange} />
            <InvalidateSize />
            {hasPosition && (
              <Marker position={[latitude!, longitude!]} icon={markerIcon} />
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  )
}

export default function LocationPickerMap({ latitude, longitude, onChange }: Props) {
  const [expanded, setExpanded] = useState(false)
  const hasPosition = latitude != null && longitude != null && latitude !== 0 && longitude !== 0

  return (
    <>
      {/* Compact preview — click to expand */}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        style={{
          width: "100%", height: 120, borderRadius: 8, border: "1px solid var(--border, #e2e8f0)",
          background: hasPosition ? "#f0f9ff" : "#f8fafc",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          cursor: "pointer", gap: 6, transition: "all 0.15s",
        }}
      >
        <span style={{ fontSize: 28 }}>{hasPosition ? "📍" : "🗺️"}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
          {hasPosition ? `${latitude!.toFixed(4)}, ${longitude!.toFixed(4)}` : "Click to set location on map"}
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>
          {hasPosition ? "Click to change" : "Open map picker"}
        </span>
      </button>

      {/* Full screen map modal */}
      {expanded && (
        <FullScreenMap
          latitude={latitude}
          longitude={longitude}
          onChange={onChange}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  )
}
