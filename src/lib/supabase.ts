import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Klien Supabase hanya dibuat bila kedua variabel lingkungan tersedia.
// Tanpa itu, dasbor berjalan dalam mode demo memakai data dummy lokal.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(url as string, anonKey as string, {
      auth: { persistSession: false },
    });
  }
  return client;
}

export const SENSOR_TABLE = "sensor_udara_log";
