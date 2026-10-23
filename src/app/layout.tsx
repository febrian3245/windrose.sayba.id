import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// IBM Plex dipilih karena dirancang untuk antarmuka teknis-ilmiah:
// angka tabular jelas untuk membaca nilai konsentrasi berdampingan.
const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "WROSE 4G LTE Pontianak | Dasbor Pemantau Kualitas Udara",
  description:
    "Pemantauan PM2.5, PM10, dan VOC oleh WROSE 4G LTE Pontianak (alat IoT skripsi), dengan analisis spasial sebaran polutan (pemodelan Wind Rose) dan pembanding data Stasiun 02 Lab Geofisika FMIPA UNTAN.",
};

export const viewport: Viewport = {
  themeColor: "#0f5249",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={`${plex.variable} ${plexMono.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
