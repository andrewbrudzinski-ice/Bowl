import { readFile } from "node:fs/promises";
import path from "node:path";

const FILES = [
  { weight: 500 as const, file: "plus-jakarta-sans-latin-500-normal.woff" },
  { weight: 800 as const, file: "plus-jakarta-sans-latin-800-normal.woff" },
];

/**
 * Plus Jakarta Sans for generated images (link previews, scorecards). Satori reads TTF/OTF/WOFF (not WOFF2), so these are static WOFF
 * copies of the same typeface the site uses. Shipped with serverless builds through outputFileTracingIncludes in next.config.mjs.
 */
export async function ogFonts() {
  return Promise.all(
    FILES.map(async ({ weight, file }) => ({
      name: "Jakarta",
      data: await readFile(path.join(process.cwd(), "src", "app", "fonts", file)),
      weight,
      style: "normal" as const,
    }))
  );
}
