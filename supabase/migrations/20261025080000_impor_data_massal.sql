-- Impor data massal dari berkas CSV/Excel oleh admin.
--
-- Alasan memakai satu RPC untuk banyak baris (bukan memanggil
-- kelola_tambah_data berulang dari peramban): seluruh baris diproses dalam
-- satu transaksi, jauh lebih cepat untuk ratusan baris, dan jumlah baris yang
-- masuk serta yang dilewati dapat dilaporkan kembali dengan tepat.
--
-- Baris pada waktu yang sudah ada DILEWATI, bukan ditimpa. Data pengukuran
-- adalah rekaman penelitian: penimpaan diam-diam berisiko menghilangkan data
-- asli tanpa jejak. Koreksi dilakukan sadar lewat kelola_ubah_data.

create or replace function public.kelola_impor_data(
  p_sumber text,
  p_baris jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_masuk integer := 0;
  v_dilewati integer := 0;
  v_jumlah integer;
  v_item jsonb;
  v_waktu timestamptz;
begin
  if not public.apakah_admin() then
    raise exception 'Akses ditolak: butuh role admin' using errcode = '42501';
  end if;

  if p_sumber not in ('wrose01', 'stasiun02') then
    raise exception 'p_sumber harus wrose01 atau stasiun02' using errcode = '22023';
  end if;

  if jsonb_typeof(p_baris) <> 'array' then
    raise exception 'p_baris harus berupa array JSON' using errcode = '22023';
  end if;

  -- Batas aman agar satu permintaan tidak membebani basis data.
  if jsonb_array_length(p_baris) > 5000 then
    raise exception 'Maksimal 5000 baris per impor (berkas ini % baris)', jsonb_array_length(p_baris)
      using errcode = '54000';
  end if;

  for v_item in select * from jsonb_array_elements(p_baris)
  loop
    v_waktu := (v_item->>'created_at')::timestamptz;

    if v_waktu > now() + interval '10 minutes' then
      raise exception 'Baris dengan waktu % berada di masa depan', v_waktu using errcode = '22007';
    end if;

    if p_sumber = 'wrose01' then
      insert into public.data_wrose01
        (created_at, pm2_5, pm10, voc_index, temperature, humidity, pressure, wind_speed, wind_direction, battery_volt)
      values (
        v_waktu,
        (v_item->>'pm2_5')::numeric,
        (v_item->>'pm10')::numeric,
        (v_item->>'voc_index')::integer,
        (v_item->>'temperature')::numeric,
        (v_item->>'humidity')::numeric,
        (v_item->>'pressure')::numeric,
        (v_item->>'wind_speed')::numeric,
        (v_item->>'wind_direction')::integer,
        (v_item->>'battery_volt')::numeric
      )
      on conflict (created_at) do nothing;
    else
      insert into public.data_stasiun02
        (created_at, pm2_5, pm10, voc_index, temperature, humidity, pressure, wind_speed, wind_direction, battery_volt)
      values (
        v_waktu,
        (v_item->>'pm2_5')::numeric,
        (v_item->>'pm10')::numeric,
        (v_item->>'voc_index')::integer,
        (v_item->>'temperature')::numeric,
        (v_item->>'humidity')::numeric,
        (v_item->>'pressure')::numeric,
        (v_item->>'wind_speed')::numeric,
        (v_item->>'wind_direction')::integer,
        (v_item->>'battery_volt')::numeric
      )
      on conflict (created_at) do nothing;
    end if;

    get diagnostics v_jumlah = row_count;
    if v_jumlah > 0 then
      v_masuk := v_masuk + 1;
    else
      v_dilewati := v_dilewati + 1;
    end if;
  end loop;

  return jsonb_build_object('masuk', v_masuk, 'dilewati', v_dilewati);
end;
$$;

comment on function public.kelola_impor_data is
  'Admin mengimpor banyak baris pengukuran sekaligus (dari CSV/Excel) ke '
  'data_wrose01 atau data_stasiun02. Baris pada waktu yang sudah ada dilewati, '
  'tidak ditimpa. Mengembalikan {"masuk": n, "dilewati": n}.';

revoke all on function public.kelola_impor_data(text, jsonb) from public, anon;
grant execute on function public.kelola_impor_data(text, jsonb) to authenticated;
