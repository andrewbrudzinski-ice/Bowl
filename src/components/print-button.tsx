"use client";
import { Printer } from "lucide-react";

/** Opens the browser's print dialog, which also offers "Save as PDF". */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-primary btn-sm no-print" onClick={() => window.print()}>
      <Printer size={14} aria-hidden />
      {label}
    </button>
  );
}
