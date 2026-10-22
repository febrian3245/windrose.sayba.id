"use client";

import { useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { SensorRecord } from "@/lib/types";
import { STATIONS, MAIN_DEVICE_ID, COMPARE_DEVICE_ID } from "@/lib/types";
import { fmt, formatDateTime } from "@/lib/stats";
import { SECTORS_16, sectorIndex, CALM_LIMIT } from "@/lib/wind";

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
const WIND_COLOR = "#1d6fd6";

// Overlay arah angin: panah besar ditempatkan DI ATAS lokasi AQMS-01 (bukan panel
// terpisah) supaya arah datang angin langsung terlihat dalam konteks peta satelit.
// `deg` memakai konvensi meteorologi (0°=Utara, arah DATANGNYA angin); panah digambar
// menunjuk ke arah datangnya angin tsb., diputar via CSS transform (transisi mulus).
function windArrowIcon(deg: number, speed: number, color: string): L.DivIcon {
  const calm = speed < CALM_LIMIT;
  const circleD = 80;
  // Lebar kanvas ikon dibuat cukup besar agar lingkaran bisa digeser jauh dari titik
  // anchor (lokasi AQMS-01 di pojok kiri-atas kanvas) tanpa terpotong.
  const canvas = 150;
  // Pusat lingkaran diposisikan absolut, BUKAN flex-center di tengah kanvas: jaraknya
  // dari titik anchor (0,0) harus melebihi radius lingkaran (40px) + separuh lebar pin
  // (≈15px), agar overlay angin tidak menimpa bentuk pin lokasi sama sekali.
  const cx = 95;
  const cy = 85;
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:${canvas}px;height:${canvas}px;pointer-events:none">
      <div style="position:absolute;left:${cx - circleD / 2}px;top:${cy - circleD / 2}px;width:${circleD}px;height:${circleD}px;border-radius:50%;background:radial-gradient(circle, ${color}3d 0%, ${color}18 60%, transparent 78%);border:1.5px dashed ${color}66;display:flex;align-items:center;justify-content:center;opacity:${calm ? 0.45 : 1}">
        <span style="position:absolute;top:-2px;left:50%;transform:translateX(-50%);font-size:9px;font-weight:700;color:#fff;background:${color}cc;padding:0 3px;border-radius:2px">U</span>
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;transform:rotate(${deg}deg);transition:transform 900ms cubic-bezier(.4,0,.2,1)">
          <svg width="38" height="38" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))">
            <path d="M12 1.5 L18 14 L12 10.5 L6 14 Z" fill="${color}" stroke="#fff" stroke-width="1"/>
            <rect x="11" y="10.5" width="2" height="11" fill="${color}" stroke="#fff" stroke-width="0.5"/>
          </svg>
        </div>
      </div>
      <svg width="${canvas}" height="${canvas}" style="position:absolute;left:0;top:0">
        <circle cx="4" cy="4" r="3" fill="${color}" />
        <line x1="6" y1="6" x2="${cx - circleD / 2 + 6}" y2="${cy}" stroke="${color}" stroke-width="2" stroke-dasharray="4,4" opacity="0.85"/>
      </svg>
    </div>`,
    // Anchor di (4,4): dekat titik lokasi AQMS-01 (sedikit offset dari 0,0 supaya garis
    // penghubung ke lingkaran terlihat utuh), bukan di tengah kanvas.
    iconSize: [canvas, canvas],
    iconAnchor: [4, 4],
  });
}

export default function MapPanel({ latestByDevice }: { latestByDevice: Record<string, SensorRecord | undefined> }) {
  const [showWind, setShowWind] = useState(true);
  const main = latestByDevice[MAIN_DEVICE_ID];
  const compare = latestByDevice[COMPARE_DEVICE_ID];
  const mainStation = STATIONS[MAIN_DEVICE_ID];
  const compareStation = STATIONS[COMPARE_DEVICE_ID];
  const center: [number, number] = [
    (mainStation.latitude + compareStation.latitude) / 2,
    (mainStation.longitude + compareStation.longitude) / 2,
  ];
  const sector = main ? SECTORS_16[sectorIndex(main.windDirection)] : null;

  return (
    <div>
      {/* Toggle hide/show layer angin: 1 kontrol yang mempengaruhi tampilan peta,
          bukan panel terpisah — sesuai permintaan "digabung jadi satu layer". */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Panah biru menunjukkan <strong className="text-ink">arah datangnya angin</strong> di lokasi AQMS-01 saat
          ini{main ? <> — dari {sector?.name} ({fmt(main.windDirection, 0)}°), {fmt(main.windSpeed)} m/s</> : null}.
        </p>
        <label className="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink select-none">
          <span
            className="relative inline-block h-5 w-9 rounded-full transition-colors"
            style={{ background: showWind ? WIND_COLOR : "var(--color-line, #d9dee3)" }}
          >
            <input
              type="checkbox"
              checked={showWind}
              onChange={(e) => setShowWind(e.target.checked)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Tampilkan atau sembunyikan arah angin di peta"
            />
            <span
              className="pointer-events-none absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: showWind ? "translateX(16px)" : "translateX(0)" }}
              aria-hidden
            />
          </span>
          Layer angin
        </label>
      </div>

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
          {showWind && main ? (
            // Marker non-interaktif (tanpa popup): HANYA overlay visual arah angin,
            // diletakkan tepat di titik AQMS-01, zIndex lebih tinggi dari marker lokasi.
            <Marker
              position={[mainStation.latitude, mainStation.longitude]}
              icon={windArrowIcon(main.windDirection, main.windSpeed, WIND_COLOR)}
              interactive={false}
              zIndexOffset={1000}
            />
          ) : null}
        </MapContainer>
      </div>

      <p className="mt-2 text-xs text-muted">
        Sumber data arah angin: anemometer AQMS-01-SAYBA, konvensi meteorologi (0° = angin datang dari Utara).
        Lingkaran pudar di sekitar panah menandakan jangkauan visual saja, bukan radius pengukuran sesungguhnya.
      </p>
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
          {fmt(record.windSpeed)} m/s, {sector.name} ({sector.code})
        </dd>
      </dl>
      <p className="mt-2 text-xs text-muted">{formatDateTime(record.ts)}</p>
    </div>
  );
}
