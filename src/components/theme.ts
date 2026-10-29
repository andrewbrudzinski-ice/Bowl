import type { CSSProperties } from "react";

import { BRAND_ACCENT, LEGACY_ACCENT } from "@/domain/brand";

export { BRAND_ACCENT };

/** The color to draw a league's logo chip in (the stored accent, with the old default blue mapped to the Sweeper amber). */
export function resolveAccent(hex: string | null | undefined): string {
  return !hex || hex.toLowerCase() === LEGACY_ACCENT ? BRAND_ACCENT : hex;
}

/** Chooses dark or light ink for text drawn on the accent color (WCAG-ish luminance check). */
export function accentInk(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#241707";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.3 ? "#241707" : "#fffaf0";
}

/**
 * CSS variables for a league's accent. A league on the default accent returns nothing, so the stylesheet's light/dark amber applies;
 * a custom accent sets the fill, the ink drawn on it, and a text-safe variant (pulled toward the text color so it stays readable).
 */
export function accentVars(hex: string | null | undefined): CSSProperties {
  if (!hex || hex.toLowerCase() === LEGACY_ACCENT || hex.toLowerCase() === BRAND_ACCENT) return {};
  return {
    "--accent": hex,
    "--accent-ink": accentInk(hex),
    "--accent-text": `color-mix(in srgb, ${hex} 55%, var(--color-fg))`,
  } as CSSProperties;
}
