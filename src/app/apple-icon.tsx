import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f2d5c 0%, #1e4d8c 100%)",
          borderRadius: 36,
        }}
      >
        <span
          style={{
            fontSize: 130,
            fontWeight: 900,
            color: "#ffffff",
            lineHeight: 1,
            marginTop: -8,
          }}
        >
          B
        </span>
      </div>
    ),
    { ...size },
  );
}
