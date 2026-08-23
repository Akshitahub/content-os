import { ImageResponse } from "next/og"
import { LogoIcon } from "@/components/shared/LogoIcon"

export const runtime = "edge"

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          width: "1200px",
          height: "630px",
          background: "#0f0f0f",
          padding: "80px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Violet glow */}
        <div
          style={{
            position: "absolute",
            top: "-120px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "800px",
            height: "400px",
            background: "radial-gradient(ellipse at center, rgba(99,102,241,0.25) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />

        {/* Logo row */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "40px" }}>
          <LogoIcon size={40} />
          <span style={{ color: "#ffffff", fontSize: "28px", fontWeight: 700, letterSpacing: "-0.5px" }}>
            SocioPosts
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            color: "#ffffff",
            fontSize: "58px",
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-1.5px",
            maxWidth: "900px",
            marginBottom: "32px",
          }}
        >
          Your brand URL →{" "}
          <span style={{ color: "#818cf8" }}>30 days</span> of content
        </div>

        {/* Sub-text */}
        <div
          style={{
            color: "#9ca3af",
            fontSize: "24px",
            lineHeight: 1.5,
            maxWidth: "700px",
            marginBottom: "44px",
          }}
        >
          AI hooks, captions, reels &amp; carousels, tailored to your brand voice, not templates.
        </div>

        {/* Feature pills */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {["⚡ Hooks", "✍️ Captions", "🎬 Reels", "🎠 Carousels", "📧 Emails"].map((label) => (
            <div
              key={label}
              style={{
                background: "rgba(99,102,241,0.15)",
                border: "1px solid rgba(99,102,241,0.35)",
                borderRadius: "100px",
                padding: "10px 22px",
                color: "#a5b4fc",
                fontSize: "18px",
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  )
}
