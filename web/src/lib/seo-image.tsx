export function SeoImage({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background:
          "radial-gradient(circle at top left, rgba(125, 211, 252, 0.36), transparent 38%), radial-gradient(circle at 85% 15%, rgba(251, 191, 36, 0.24), transparent 30%), linear-gradient(135deg, #06111f 0%, #0f172a 48%, #172554 100%)",
        color: "#f8fafc",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(148, 163, 184, 0.11) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.11) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
          maskImage:
            "linear-gradient(to bottom, rgba(0, 0, 0, 0.72), transparent 82%)",
          opacity: 0.65,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -110,
          bottom: -140,
          width: 440,
          height: 440,
          borderRadius: "9999px",
          background:
            "radial-gradient(circle, rgba(14, 165, 233, 0.35), rgba(14, 165, 233, 0.08) 45%, transparent 70%)",
          filter: "blur(8px)",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          padding: "68px 72px",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 0.3,
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 6,
              background:
                "linear-gradient(135deg, #fbbf24 0%, #22d3ee 60%, #3b82f6 100%)",
              boxShadow: "0 0 40px rgba(56, 189, 248, 0.42)",
            }}
          />
          Peaks
        </div>

        <div style={{ maxWidth: 880, display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 72,
              lineHeight: 1.02,
              fontWeight: 800,
              letterSpacing: -2.4,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.28,
              color: "rgba(226, 232, 240, 0.9)",
              maxWidth: 760,
            }}
          >
            {subtitle}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            fontSize: 20,
            color: "rgba(226, 232, 240, 0.88)",
          }}
        >
          {["Destinations", "Routes", "Lists", "Trip reports"].map((label) => (
            <div
              key={label}
              style={{
                padding: "12px 18px",
                borderRadius: 9999,
                background: "rgba(15, 23, 42, 0.52)",
                border: "1px solid rgba(148, 163, 184, 0.22)",
                backdropFilter: "blur(12px)",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
