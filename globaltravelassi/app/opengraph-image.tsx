import { ImageResponse } from "next/og";

export const alt = "GLOBALTRAVELASSI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #050d1b 0%, #0e2140 60%, #152d55 100%)",
          color: "#ffffff",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 30, letterSpacing: 6, color: "#e8d39e" }}>
          GLOBALTRAVELASSI
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, lineHeight: 1.1 }}>
          <span>Visa and travel,</span>
          <span style={{ color: "#dcc08a" }}>planned step by step.</span>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#cfd4de" }}>
          Algeria · North Africa · Europe
        </div>
      </div>
    ),
    { ...size },
  );
}
