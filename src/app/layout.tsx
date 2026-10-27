import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: { default: "Bowl · League HQ", template: "%s · Bowl" },
  description: "Run a bowling league like a pro: handicaps, matchups, standings, records and awards.",
  applicationName: "Bowl",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Bowl", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0d12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
