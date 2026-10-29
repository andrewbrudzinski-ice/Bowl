/** Metallic gold: the default league accent (logo chips, and the starting color in the league wizard). */
export const BRAND_ACCENT = "#dcb048";
/** Earlier default accents (the original sky blue, and the short-lived warm amber) are treated as "no custom accent" and show as gold. */
export const LEGACY_ACCENTS = ["#38bdf8", "#e3a032"];
export const isDefaultAccent = (hex: string | null | undefined) => !hex || LEGACY_ACCENTS.includes(hex.toLowerCase()) || hex.toLowerCase() === BRAND_ACCENT;
