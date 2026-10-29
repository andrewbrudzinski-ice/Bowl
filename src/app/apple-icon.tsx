import { ImageResponse } from "next/og";
import { MarkArt } from "@/components/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
/** iOS rounds the corners itself, so the artwork is full-bleed: near-black with a thin gold inner frame around the mark. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, background: "linear-gradient(160deg, #262626 0%, #0b0b0b 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 156, height: 156, borderRadius: 34, border: "3px solid #d6a93a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width={112} height={112} viewBox="0 0 64 64">
            {MarkArt({ onAccent: false })}
          </svg>
        </div>
      </div>
    ),
    size
  );
}
