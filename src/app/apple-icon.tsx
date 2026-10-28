import { ImageResponse } from "next/og";
import { MarkArt } from "@/components/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, background: "#38bdf8", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={132} height={132} viewBox="0 0 64 64">
          {MarkArt({ onAccent: true })}
        </svg>
      </div>
    ),
    size
  );
}
