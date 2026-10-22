"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { SensorRecord } from "@/lib/types";
import { STATIONS, MAIN_DEVICE_ID, COMPARE_DEVICE_ID } from "@/lib/types";
import { fmt, formatDateTime } from "@/lib/stats";
import { SECTORS_16, sectorIndex } from "@/lib/wind";

// Esri World Imagery: tile satelit gratis, tanpa API key, cukup atribusi.
// Terbit via ArcGIS Online, batas wajar untuk trafik non-komersial skala skripsi.
const ESRI_IMAGERY_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIBUTION =
  'Tile &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

// Ikon default Leaflet mengandalkan path gambar yang tidak ikut di-bundle Next.js;
// diganti dengan marker SVG inline per device agar tidak ada request 404 ke marker-icon.png.
function markerIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">
      <svg width="30" height="30" viewBox="0 0 30 30"><path d="M15 2C9 2 4 7 4 13c0 8 11 15 11 15s11-7 11-15c0-6-5-11-11-11z" fill="${color}" stroke="#fff" stroke-width="1.5"/><circle cx="15" cy="13" r="4.5" fill="#fff"/></svg>
      <span style="margin-top:-2px;background:${color};color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;white-space:nowrap">${label}</span>
    </div>`,
    iconSize: [60, 44],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

const BRAND = "#0f5249";
const ALERT = "#9a4a0b";

export default function MapPanel({ latestByDevice }: { latestByDevice: Record<string, SensorRecord | undefined> }) {
  const main = latestByDevice[MAIN_DEVICE_ID];
  const compare = latestByDevice[COMPARE_DEVICE_ID];
  const mainStation = STATIONS[MAIN_DEVICE_ID];
  const compareStation = STATIONS[COMPARE_DEVICE_ID];
  const center: [number, number] = [
    (mainStation.latitude + compareStation.latitude) / 2,
    (mainStation.longitude + compareStation.longitude) / 2,
  ];

  return (
    <div className="overflow-hidden rounded-md border border-line" style={{ height: 420 }}>
      <MapContainer center={center} zoom={17} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer url={ESRI_IMAGERY_URL} attribution={ESRI_ATTRIBUTION} maxZoom={19} />
        <Marker position={[mainStation.latitude, mainStation.longitude]} icon={markerIcon(BRAND, "AQMS-01")}>
          <Popup>
            <StationPopup title={mainStation.name} subtitle="Alat IoT utama · objek penelitian" record={main} />
          </Popup>
        </Marker>
        <Marker position={[compareStation.latitude, compareStation.longitude]} icon={markerIcon(ALERT, "Stasiun 02")}>
          <Popup>
            <StationPopup title={compareStation.name} subtitle="Objek pembanding · data referensi independen" record={compare} />
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}

function StationPopup({ title, subtitle, record }: { title: string; subtitle: string; record?: SensorRecord }) {
  if (!record) {
    return (
      <div className="min-w-[200px] text-sm">
        <p className="font-semibold">{title}</p>
        <p className="text-xs text-muted">{subtitle}</p>
        <p className="mt-2 text-muted">Belum ada data.</p>
      </div>
    );
  }
  const sector = SECTORS_16[sectorIndex(record.windDirection)];
  return (
    <div className="min-w-[220px] text-sm">
      <p className="font-semibold">{title}</p>
      <p className="text-xs text-muted">{subtitle}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-muted">PM2.5</dt>
        <dd className="text-right tabular">{fmt(record.pm25)} µg/m³</dd>
        <dt className="text-muted">PM10</dt>
        <dd className="text-right tabular">{fmt(record.pm10)} µg/m³</dd>
        <dt className="text-muted">Angin</dt>
        <dd className="text-right tabular">
          {fmt(record.windSpeed)} m/s, {sector.code}
        </dd>
      </dl>
      <p className="mt-2 text-xs text-muted">{formatDateTime(record.ts)}</p>
    </div>
  );
}
