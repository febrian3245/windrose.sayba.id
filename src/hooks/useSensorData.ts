"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dummyRows from "@/data/dummy-sensor.json";
import { getSupabase, isSupabaseConfigured, SENSOR_TABLE, COMPARE_TABLE } from "@/lib/supabase";
import { normalizeRow, MAIN_DEVICE_ID, COMPARE_DEVICE_ID, type SensorRecord, type SensorRow } from "@/lib/types";

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

// Batas jumlah baris per tabel: WROSE-01 7 hari x 144 data/hari (10 menit) = 1008,
// Stasiun02 7 hari x 24 data/hari (1 jam) = 168. Dibulatkan ke atas untuk aman.
const MAX_ROWS_MAIN = 1050;
const MAX_ROWS_COMPARE = 200;

function sortAsc(list: SensorRecord[]): SensorRecord[] {
  return [...list].sort((a, b) => a.ts - b.ts);
}

function loadDemo(): SensorRecord[] {
  return sortAsc(
    (dummyRows as SensorRow[]).map((row) => normalizeRow(row, row.device_id ?? MAIN_DEVICE_ID)),
  );
}

export function useSensorData(): SensorDataState {
  const configured = isSupabaseConfigured();
  const [mainRecords, setMainRecords] = useState<SensorRecord[]>([]);
  const [compareRecords, setCompareRecords] = useState<SensorRecord[]>([]);
  const [demoRecords] = useState<SensorRecord[]>(() => (configured ? [] : loadDemo()));
  const [status, setStatus] = useState<LoadStatus>(configured ? "loading" : "ready");
  const [live, setLive] = useState<LiveStatus>(configured ? "connecting" : "not-applicable");
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  // Gabungkan 2 seri device (WROSE-01 + Stasiun02) jadi 1 daftar terurut untuk UI,
  // TANPA mencampur nilainya — masing-masing baris tetap membawa deviceId aslinya,
  // sehingga semua panel bisa memfilter per device sesuai kebutuhan (ISPU/Wind Rose
  // hanya WROSE-01, panel pembanding memakai keduanya secara terpisah). Dihitung via
  // useMemo (bukan state+effect) agar tidak memicu render berantai.
  const records = useMemo(
    () => (configured ? sortAsc([...mainRecords, ...compareRecords]) : demoRecords),
    [configured, mainRecords, compareRecords, demoRecords],
  );

  // Status "loading" di-set di handler (bukan di dalam effect) agar tidak memicu render berantai.
  const reload = useCallback(() => {
    setStatus("loading");
    setNonce((n) => n + 1);
  }, []);

  // Pengambilan awal data historis dari Supabase: 2 query terpisah ke 2 tabel fisik.
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;

    Promise.all([
      supabase.from(SENSOR_TABLE).select("*").order("created_at", { ascending: false }).limit(MAX_ROWS_MAIN),
      supabase.from(COMPARE_TABLE).select("*").order("created_at", { ascending: false }).limit(MAX_ROWS_COMPARE),
    ]).then(([mainRes, compareRes]) => {
      if (cancelled) return;
      if (mainRes.error) {
        setError(mainRes.error.message);
        setStatus("error");
        return;
      }
      if (compareRes.error) {
        setError(compareRes.error.message);
        setStatus("error");
        return;
      }
      setMainRecords(sortAsc((mainRes.data as SensorRow[]).map((r) => normalizeRow(r, MAIN_DEVICE_ID))));
      setCompareRecords(sortAsc((compareRes.data as SensorRow[]).map((r) => normalizeRow(r, COMPARE_DEVICE_ID))));
      setError(null);
      setStatus("ready");
      setLastFetched(Date.now());
    });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Langganan Realtime: setiap INSERT baru dari KEDUA tabel langsung masuk ke dasbor,
  // masing-masing di-append ke seri device-nya sendiri (tidak pernah dicampur).
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let wasOffline = false;
    let mainReady = false;
    let compareReady = false;

    const markReady = (which: "main" | "compare") => {
      if (which === "main") mainReady = true;
      else compareReady = true;
      if (mainReady && compareReady) {
        setLive("live");
        setNonce((n) => n + 1);
      }
    };

    const channel = supabase
      .channel("sensor-udara-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: SENSOR_TABLE },
        (payload) => {
          const rec = normalizeRow(payload.new as SensorRow, MAIN_DEVICE_ID);
          setMainRecords((prev) => {
            if (prev.some((p) => p.ts === rec.ts)) return prev;
            const next = sortAsc([...prev, rec]);
            return next.length > MAX_ROWS_MAIN ? next.slice(next.length - MAX_ROWS_MAIN) : next;
          });
          setLastFetched(Date.now());
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: COMPARE_TABLE },
        (payload) => {
          const rec = normalizeRow(payload.new as SensorRow, COMPARE_DEVICE_ID);
          setCompareRecords((prev) => {
            if (prev.some((p) => p.ts === rec.ts)) return prev;
            const next = sortAsc([...prev, rec]);
            return next.length > MAX_ROWS_COMPARE ? next.slice(next.length - MAX_ROWS_COMPARE) : next;
          });
          setLastFetched(Date.now());
        },
      )
      // Status SUBSCRIBED datang SEBELUM server selesai memasang langganan Postgres.
      // Data yang masuk di jeda itu (atau saat koneksi putus) tidak dikirim ulang oleh
      // Realtime, jadi riwayat diambil ulang begitu KEDUA langganan Postgres benar-benar siap.
      .on("system", {}, (msg: { extension?: string; status?: string; channel?: string }) => {
        if (msg?.extension === "postgres_changes" && msg?.status === "ok") {
          markReady("main");
          markReady("compare");
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
