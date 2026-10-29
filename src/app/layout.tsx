import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

// Self-hosted (no request to a font CDN); one variable file covers every weight we use. License: ./fonts/OFL.txt
const jakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin-wght-normal.woff2",
  variable: "--font-jakarta",
  weight: "200 800",
  display: "swap",
});

/** Runs before first paint: applies a saved light/dark choice (otherwise the CSS follows the device setting). */
const THEME_SCRIPT = `try{var t=localStorage.getItem("sweeper-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: { default: "Sweeper · League HQ", template: "%s · Sweeper" },
  description: "Run a bowling league like a pro: handicaps, matchups, standings, records and awards.",
  applicationName: "Sweeper",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Sweeper", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f0e6" },
    { media: "(prefers-color-scheme: dark)", color: "#15110c" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2">
          Skip to content
        </a>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
