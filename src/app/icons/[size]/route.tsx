import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { MarkArt } from "@/components/brand";

/** App icon: the Sweeper mark on black inside a metallic gold ring. `maskable=1` leaves a wider safe margin for adaptive-icon masks. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = Math.min(Math.max(parseInt(size, 10) || 192, 48), 1024);
  const maskable = req.nextUrl.searchParams.get("maskable") === "1";
  const pad = maskable ? px * 0.2 : px * 0.08;
  const outer = px - pad * 2;
  const ring = Math.max(2, px * 0.02);
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, background: "#0b0b0b", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: outer, height: outer, borderRadius: px * 0.22, background: "linear-gradient(160deg, #f6dd96 0%, #d6a93a 48%, #8f6a1a 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: outer - ring * 2, height: outer - ring * 2, borderRadius: px * 0.22 - ring, background: "linear-gradient(160deg, #262626 0%, #0e0e0e 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width={outer * 0.72} height={outer * 0.72} viewBox="0 0 64 64">
              {MarkArt({ onAccent: false })}
            </svg>
          </div>
        </div>
      </div>
    ),
    { width: px, height: px }
  );
}
