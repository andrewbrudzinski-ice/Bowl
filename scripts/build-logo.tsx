/* Usage: npm run build:logo
 * Writes public/logo.svg (full illustration) and public/logo-mark.svg (compact mark) from src/components/brand.tsx, so the files used by the
 * README and social previews always match the app. */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SweeperLogo, SweeperMark } from "../src/components/brand";

const dir = path.resolve(__dirname, "..", "public");
fs.writeFileSync(path.join(dir, "logo.svg"), renderToStaticMarkup(<SweeperLogo />) + "\n");
fs.writeFileSync(path.join(dir, "logo-mark.svg"), renderToStaticMarkup(<SweeperMark size={256} />) + "\n");
console.log("wrote public/logo.svg and public/logo-mark.svg");
