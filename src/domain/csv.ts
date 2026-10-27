/** Minimal RFC 4180 CSV parsing/serialisation. Also neutralises spreadsheet formula injection on export. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim() !== "") || row.length > 1) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((x) => x.trim() !== "")) rows.push(row);
  }
  return rows;
}

export interface CsvTable {
  headers: string[];
  rows: { line: number; values: Record<string, string> }[];
}

/** Header matching ignores case, spaces and underscores so "Short Name" == "short_name". */
const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, "");

export function toTable(text: string, expected: string[]): { table: CsvTable | null; error?: string } {
  const raw = parseCsv(text);
  if (!raw.length) return { table: null, error: "The file is empty." };
  const headers = raw[0].map((h) => h.trim());
  const idx = new Map(headers.map((h, i) => [norm(h), i]));
  const missing = expected.filter((e) => !idx.has(norm(e)));
  if (missing.length) return { table: null, error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template for the expected layout.` };
  const rows = raw.slice(1).map((r, i) => {
    const values: Record<string, string> = {};
    for (const [k, col] of idx) values[k] = (r[col] ?? "").trim();
    return { line: i + 2, values };
  });
  return { table: { headers, rows } };
}

export const get = (row: { values: Record<string, string> }, key: string) => row.values[norm(key)] ?? "";

function cell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  // Formula injection guard: a leading = + - @ would execute in Excel/Sheets.
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
