import { ImageResponse } from "next/og";

export const alt = "ブルースペース｜レンタルスペース公式予約サイト";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(160deg, #0f2d5c 0%, #1a3a6c 50%, #1e4d8c 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 16,
              background: "rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 52,
              fontWeight: 900,
              color: "#ffffff",
            }}
          >
            B
          </div>
          <span style={{ fontSize: 56, fontWeight: 900, color: "#ffffff" }}>
            ブルースペース
          </span>
        </div>
        <span style={{ fontSize: 28, color: "rgba(255,255,255,0.8)", marginBottom: 16 }}>
          レンタルスペース公式予約サイト
        </span>
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 24,
          }}
        >
          {["仲介手数料なし最安値", "30分単位予約", "当日予約10%OFF", "24時間営業"].map(
            (chip) => (
              <div
                key={chip}
                style={{
                  padding: "8px 20px",
                  borderRadius: 20,
                  background: "rgba(255,255,255,0.12)",
                  color: "rgba(255,255,255,0.9)",
                  fontSize: 20,
                }}
              >
                {chip}
              </div>
            ),
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}
