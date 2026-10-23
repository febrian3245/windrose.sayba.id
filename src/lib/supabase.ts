import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Klien Supabase hanya dibuat bila URL dan key publik tersedia.
// Tanpa itu, dasbor berjalan dalam mode demo memakai data dummy lokal.
//
// Key publik: format baru "sb_publishable_..." (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
// atau anon key JWT lama (NEXT_PUBLIC_SUPABASE_ANON_KEY). Keduanya aman di browser
// karena tabel hanya memberi hak SELECT; jangan pernah memakai secret/service_role key di sini.
//
// process.env.NEXT_PUBLIC_* harus ditulis lengkap (bukan process.env[nama]) agar
// Next.js bisa menyisipkan nilainya ke bundel browser saat build.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
const publicKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && publicKey);
}

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(url as string, publicKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

export const SENSOR_TABLE = "data_wrose01";
export const COMPARE_TABLE = "data_stasiun02";
