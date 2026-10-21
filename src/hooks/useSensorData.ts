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

// Batas jumlah baris yang diambil: 7 hari x 144 data/hari (interval 10 menit).
const MAX_ROWS = 1008;

function sortAsc(list: SensorRecord[]): SensorRecord[] {
  return [...list].sort((a, b) => a.ts - b.ts);
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
        setRecords(sortAsc((data as SensorRow[]).map(normalizeRow)));
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
    const channel = supabase
      .channel("sensor-udara-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: SENSOR_TABLE },
        (payload) => {
          const rec = normalizeRow(payload.new as SensorRow);
          setRecords((prev) => {
            if (prev.some((p) => p.ts === rec.ts && p.deviceId === rec.deviceId)) return prev;
            const next = sortAsc([...prev, rec]);
            return next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next;
          });
          setLastFetched(Date.now());
        },
      )
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setLive("live");
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setLive("offline");
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
