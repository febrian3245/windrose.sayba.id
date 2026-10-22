// Contoh kode kirim data untuk ESP32 LilyGo T-Call A7670E (Arduino).
// Bukan firmware lengkap: hanya bagian HTTPS POST ke Supabase.
// Pembacaan sensor (PMS5003, BME688, anemometer, wind vane), koneksi 4G (TinyGSM),
// dan Deep Sleep 10 menit ditempatkan di firmware utama.
//
// Endpoint  : POST {SUPABASE_URL}/rest/v1/rpc/kirim_data_sensor
// Header    : apikey: {SUPABASE_PUBLISHABLE_KEY}, Content-Type: application/json
// Balasan   : 200 + "uuid" (tersimpan) | 200 + null (waktu sama sudah ada, aman diulang)
//             403 kode 28000 (kunci salah) | 400 kode 23514 (nilai di luar batas sensor)
//
// Nilai rahasia JANGAN di-commit. Simpan di secrets.h yang ada di .gitignore.

#include <ArduinoJson.h>
#include "secrets.h"  // SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DEVICE_ID, DEVICE_KEY

struct Pengukuran {
  float pm25, pm10;
  int vocIndex;
  float suhu, rh, tekanan;
  float kecAngin;
  int arahAngin;          // derajat arah DATANG angin, 0 = Utara
  float baterai;
  const char* waktuIso;   // "2026-10-22T10:00:00+07:00" dari GPS/NTP; nullptr = waktu server
};

String buatPayload(const Pengukuran& d) {
  JsonDocument doc;
  doc["p_device_id"] = DEVICE_ID;
  doc["p_kunci"] = DEVICE_KEY;
  doc["p_pm2_5"] = d.pm25;
  doc["p_pm10"] = d.pm10;
  doc["p_voc_index"] = d.vocIndex;
  doc["p_temperature"] = d.suhu;
  doc["p_humidity"] = d.rh;
  doc["p_pressure"] = d.tekanan;
  doc["p_wind_speed"] = d.kecAngin;
  doc["p_wind_direction"] = d.arahAngin;
  doc["p_battery_volt"] = d.baterai;
  if (d.waktuIso) doc["p_created_at"] = d.waktuIso;
  String out;
  serializeJson(doc, out);
  return out;
}

// `http` = klien HTTPS dari TinyGSM/ArduinoHttpClient yang sudah terhubung ke host Supabase.
// Kembalikan true bila data tersimpan atau sudah ada (tidak perlu diulang).
template <typename HttpClientT>
bool kirimKeSupabase(HttpClientT& http, const Pengukuran& d) {
  const String body = buatPayload(d);
  http.beginRequest();
  http.post("/rest/v1/rpc/kirim_data_sensor");
  http.sendHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
  http.sendHeader("Content-Type", "application/json");
  http.sendHeader("Content-Length", body.length());
  http.beginBody();
  http.print(body);
  http.endRequest();

  const int status = http.responseStatusCode();
  http.skipResponseHeaders();
  http.stop();
  // 400/403 = data atau kunci salah: mengulang tidak akan berhasil, jangan habiskan baterai.
  // Status lain (timeout, 5xx) = simpan ke antrean SPIFFS dan kirim ulang pada siklus berikutnya.
  return status == 200 || status == 400 || status == 403;
}
