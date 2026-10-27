"use client";
import { useEffect, useState } from "react";
import { Check, Download, Link2, Share2 } from "lucide-react";

/** Copy / native-share a link, and optionally download a scorecard image. The link respects the league's visibility. */
export function ShareBar({ path, title, imageHref, note }: { path: string; title: string; imageHref?: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  // Whether the browser can share natively is only known on the client. Deciding it during render would make the server HTML (no Share
  // button) differ from the first client render on every phone — a hydration error — so it is set after mount.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare("share" in navigator), []);
  const url = () => (typeof window === "undefined" ? path : new URL(path, window.location.origin).toString());
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(url()); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt("Copy this link", url()); } }}>
        {copied ? <Check size={14} aria-hidden /> : <Link2 size={14} aria-hidden />}{copied ? "Link copied" : "Copy link"}
      </button>
      {canShare ? (
        <button type="button" className="btn btn-sm" onClick={() => navigator.share({ title, url: url() }).catch(() => {})}><Share2 size={14} aria-hidden />Share</button>
      ) : null}
      {imageHref ? <a className="btn btn-sm" href={imageHref} download><Download size={14} aria-hidden />Scorecard image</a> : null}
      {note ? <span className="faint text-xs">{note}</span> : null}
    </div>
  );
}
