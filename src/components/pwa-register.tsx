"use client";
import { useEffect } from "react";

/** Registers the service worker (production only). The worker caches static assets and an offline page — never league data. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
