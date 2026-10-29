import { ImageResponse } from "next/og";
import { MarkArt } from "@/components/brand";
import { ogFonts } from "@/server/og-fonts";

export const alt = "Sweeper — bowling league management";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Link-preview card for the site (shown when someone shares the home page in a chat or on social). */
export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", background: "linear-gradient(135deg, #1e1e1e 0%, #0b0b0b 55%)", color: "#efefef", fontFamily: "Jakarta", padding: 80, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 800, letterSpacing: 4, color: "#e8c264" }}>BOWLING LEAGUE MANAGEMENT</div>
          <div style={{ display: "flex", fontSize: 128, fontWeight: 900, letterSpacing: -4, marginTop: 18, lineHeight: 1 }}>Sweeper</div>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 500, color: "#a1a1a1", marginTop: 28, lineHeight: 1.3, maxWidth: 640 }}>Handicaps, matchups, standings and records for the league you actually bowl in.</div>
          <div style={{ display: "flex", width: 160, height: 6, borderRadius: 3, marginTop: 44, background: "linear-gradient(90deg, #8f6a1a, #e8c264, #f6dd96)" }} />
        </div>
        <div style={{ display: "flex", width: 380, height: 380, borderRadius: 84, background: "linear-gradient(160deg, #f6dd96 0%, #d6a93a 48%, #8f6a1a 100%)", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", width: 362, height: 362, borderRadius: 75, background: "linear-gradient(160deg, #262626 0%, #0e0e0e 100%)", alignItems: "center", justifyContent: "center" }}>
            <svg width={270} height={270} viewBox="0 0 64 64">
              {MarkArt({ onAccent: false })}
            </svg>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() }
  );
}
