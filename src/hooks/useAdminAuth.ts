"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export type AuthStatus = "memuat" | "keluar" | "masuk";

export interface AdminAuthState {
  status: AuthStatus;
  email: string | null;
  // true hanya bila profil pengguna di Supabase punya role 'admin'.
  // Nilai ini sekadar untuk MENAMPILKAN tombol kelola; izin tulis yang
  // sesungguhnya diputuskan server di dalam RPC kelola_* (defense in depth).
  isAdmin: boolean;
  error: string | null;
  masuk: (email: string, password: string) => Promise<boolean>;
  keluar: () => Promise<void>;
}

export function useAdminAuth(): AdminAuthState {
  const configured = isSupabaseConfigured();
  const [status, setStatus] = useState<AuthStatus>(configured ? "memuat" : "keluar");
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Membaca role dari profil_pengguna: RLS membatasi baris ke milik pemanggil,
  // jadi query ini tidak pernah membocorkan role pengguna lain.
  const muatProfil = useCallback(async (uid: string, mail: string | null) => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data } = await supabase.from("profil_pengguna").select("role").eq("id", uid).maybeSingle();
    setEmail(mail);
    setIsAdmin(data?.role === "admin");
    setStatus("masuk");
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let batal = false;

    supabase.auth.getSession().then(({ data }) => {
      if (batal) return;
      const sesi = data.session;
      if (sesi?.user) void muatProfil(sesi.user.id, sesi.user.email ?? null);
      else setStatus("keluar");
    });

    // Sinkron bila sesi berubah di tab lain atau token kedaluwarsa.
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sesi) => {
      if (batal) return;
      if (sesi?.user) void muatProfil(sesi.user.id, sesi.user.email ?? null);
      else {
        setEmail(null);
        setIsAdmin(false);
        setStatus("keluar");
      }
    });

    return () => {
      batal = true;
      sub.subscription.unsubscribe();
    };
  }, [muatProfil]);

  const masuk = useCallback(async (mail: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) {
      setError("Supabase belum dikonfigurasi (mode demo).");
      return false;
    }
    setError(null);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email: mail, password });
    if (err) {
      // Pesan bawaan Supabase berbahasa Inggris dan generik; diterjemahkan agar jelas.
      setError(err.message === "Invalid login credentials" ? "Email atau sandi salah." : err.message);
      return false;
    }
    if (data.user) await muatProfil(data.user.id, data.user.email ?? null);
    return true;
  }, [muatProfil]);

  const keluar = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    setEmail(null);
    setIsAdmin(false);
    setStatus("keluar");
  }, []);

  return { status, email, isAdmin, error, masuk, keluar };
}
