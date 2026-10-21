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
  title: "Dasbor Kualitas Udara | Stasiun 02 FMIPA UNTAN",
  description:
    "Pemantauan PM2.5, PM10, dan VOC berbasis IoT 4G LTE serta analisis sebaran polutan dengan pemodelan Wind Rose di Pontianak.",
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
