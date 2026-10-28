import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { MarkArt } from "@/components/brand";

export async function GET(req: NextRequest, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = Math.min(Math.max(parseInt(size, 10) || 192, 48), 1024);
  const maskable = req.nextUrl.searchParams.get("maskable") === "1";
  const pad = maskable ? px * 0.2 : px * 0.1;
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, background: "#0a0d12", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: px - pad * 2, height: px - pad * 2, borderRadius: px * 0.22, background: "#38bdf8", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width={(px - pad * 2) * 0.78} height={(px - pad * 2) * 0.78} viewBox="0 0 64 64">
            {MarkArt({ onAccent: true })}
          </svg>
        </div>
      </div>
    ),
    { width: px, height: px }
  );
}
