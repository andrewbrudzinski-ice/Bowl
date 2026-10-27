import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, background: "#38bdf8", display: "flex", alignItems: "center", justifyContent: "center", color: "#04141c", fontSize: 100, fontWeight: 900 }}>B</div>
    ),
    size
  );
}
