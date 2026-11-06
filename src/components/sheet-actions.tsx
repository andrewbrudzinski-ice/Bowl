"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Printer, Share2 } from "lucide-react";

type Standalone = Navigator & { standalone?: boolean };

/**
 * Getting the sheet onto paper or into a chat.
 *  - Phones and tablets: the sheet as a PDF handed to the system share sheet (save to Files, print, Messages, Mail). The PDF is fetched ahead of the
 *    tap, because browsers only allow sharing straight from a tap and a fetch in between would lose that.
 *  - A plain download link always works as a fallback.
 *  - Print, for a desktop browser. A web app saved to a phone's Home Screen can't print (iOS ignores window.print() there), so it is hidden then.
 */
export function SheetActions({ pdfHref, fileName, title }: { pdfHref: string; fileName: string; title: string }) {
  const [canShare, setCanShare] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    const nav = navigator as Standalone;
    setStandalone(nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches);
    const probe = new File([""], fileName, { type: "application/pdf" });
    if (typeof nav.canShare === "function" && typeof nav.share === "function" && nav.canShare({ files: [probe] })) {
      setCanShare(true);
      fetch(pdfHref, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((blob) => live.current && setFile(new File([blob], fileName, { type: "application/pdf" })))
        .catch(() => live.current && setCanShare(false)); // no ready file: fall back to the plain download link
    }
    return () => {
      live.current = false;
    };
  }, [pdfHref, fileName]);

  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title });
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // closed the share sheet
      setMessage("Couldn't open the share sheet. Opening the PDF instead.");
      window.open(pdfHref, "_blank");
    }
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {canShare ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={share} disabled={!file} aria-busy={!file}>
          <Share2 size={14} aria-hidden />
          {file ? "Share or save PDF" : "Preparing PDF…"}
        </button>
      ) : (
        <a className="btn btn-primary btn-sm" href={pdfHref} target="_blank" rel="noopener">
          <Download size={14} aria-hidden />
          Open PDF
        </a>
      )}
      {canShare ? (
        <a className="btn btn-sm" href={pdfHref} target="_blank" rel="noopener">
          <Download size={14} aria-hidden />
          Open PDF
        </a>
      ) : null}
      {!standalone ? (
        <button type="button" className="btn btn-sm" onClick={() => window.print()}>
          <Printer size={14} aria-hidden />
          Print
        </button>
      ) : null}
      <span className="muted text-[13px]" role="status">{message}</span>
    </div>
  );
}
