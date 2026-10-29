import { ImageResponse } from "next/og";
import { MarkArt } from "@/components/brand";

export const size = { width: 48, height: 48 };
export const contentType = "image/png";
/** Browser-tab favicon: the mark on a dark rounded square with a gold edge. */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: 48, height: 48, borderRadius: 11, border: "2px solid #d6a93a", background: "#0e0e0e", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={40} height={40} viewBox="0 0 64 64">
          {MarkArt({ onAccent: false })}
        </svg>
      </div>
    ),
    size
  );
}
