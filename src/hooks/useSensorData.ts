"use client";

import { useCallback, useEffect, useState } from "react";
import dummyRows from "@/data/dummy-sensor.json";
import { getSupabase, isSupabaseConfigured, SENSOR_TABLE } from "@/lib/supabase";
import { normalizeRow, type SensorRecord, type SensorRow } from "@/lib/types";

export type SourceMode = "supabase" | "demo";
export type LoadStatus = "loading" | "ready" | "error";
export type LiveStatus = "connecting" | "live" | "offline" | "not-applicable";

export interface SensorDataState {
  records: SensorRecord[];
  mode: SourceMode;
  status: LoadStatus;
  live: LiveStatus;
  error: string | null;
  lastFetched: number | null;
  reload: () => void;
}

// Batas jumlah baris yang diambil: AQMS-01 7 hari x 144 data/hari (10 menit) = 1008,
// + Stasiun02 7 hari x 24 data/hari (1 jam) = 168. Dibulatkan ke atas untuk aman.
const MAX_ROWS = 1200;

function sortAsc(list: SensorRecord[]): SensorRecord[] {
  return [...list].sort((a, b) => a.ts - b.ts);
}

// Data dummy (sumber = 'dummy') hanya ditampilkan selama device yang bersangkutan
// belum punya hasil ukur. Keputusan dibuat PER DEVICE (bukan global) karena AQMS-01-SAYBA
// dan STASIUN-02-UNTAN berpindah dari data uji ke data asli secara independen.
function preferMeasured(list: SensorRecord[]): SensorRecord[] {
  const measuredDevices = new Set(list.filter((r) => !r.isDummy).map((r) => r.deviceId));
  return list.filter((r) => !r.isDummy || !measuredDevices.has(r.deviceId));
}

function loadDemo(): SensorRecord[] {
  return sortAsc((dummyRows as SensorRow[]).map(normalizeRow));
}

export function useSensorData(): SensorDataState {
  const configured = isSupabaseConfigured();
  const [records, setRecords] = useState<SensorRecord[]>(() => (configured ? [] : loadDemo()));
  const [status, setStatus] = useState<LoadStatus>(configured ? "loading" : "ready");
  const [live, setLive] = useState<LiveStatus>(configured ? "connecting" : "not-applicable");
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  // Status "loading" di-set di handler (bukan di dalam effect) agar tidak memicu render berantai.
  const reload = useCallback(() => {
    setStatus("loading");
    setNonce((n) => n + 1);
  }, []);

  // Pengambilan awal data historis dari Supabase.
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from(SENSOR_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          setStatus("error");
          return;
        }
        setRecords(preferMeasured(sortAsc((data as SensorRow[]).map(normalizeRow))));
        setError(null);
        setStatus("ready");
        setLastFetched(Date.now());
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Langganan Realtime: setiap INSERT baru dari stasiun langsung masuk ke dasbor.
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let wasOffline = false;
    const channel = supabase
      .channel("sensor-udara-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: SENSOR_TABLE },
        (payload) => {
          const rec = normalizeRow(payload.new as SensorRow);
          setRecords((prev) => {
            if (prev.some((p) => p.ts === rec.ts && p.deviceId === rec.deviceId)) return prev;
            const next = preferMeasured(sortAsc([...prev, rec]));
            return next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next;
          });
          setLastFetched(Date.now());
        },
      )
      // Status SUBSCRIBED datang SEBELUM server selesai memasang langganan Postgres.
      // Data yang masuk di jeda itu (atau saat koneksi putus) tidak dikirim ulang oleh
      // Realtime, jadi riwayat diambil ulang begitu langganan Postgres benar-benar siap.
      .on("system", {}, (msg: { extension?: string; status?: string }) => {
        if (msg?.extension === "postgres_changes" && msg?.status === "ok") {
          setLive("live");
          setNonce((n) => n + 1);
        }
      })
      .subscribe((s) => {
        if (s === "SUBSCRIBED") {
          setLive("live");
          if (wasOffline) setNonce((n) => n + 1);
          wasOffline = false;
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          setLive("offline");
          wasOffline = true;
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    records,
    mode: configured ? "supabase" : "demo",
    status,
    live,
    error,
    lastFetched,
    reload,
  };
}
