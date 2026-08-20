import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#181816",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <svg height="116" viewBox="0 0 32 32" width="116">
          <path d="M1 27 11 10l10 17H1Z" fill="#46ADBC" />
          <path d="M11 27 21 6l10 21H11Z" fill="#46ADBC" />
        </svg>
      </div>
    ),
    size
  );
}
