import { ImageResponse } from "next/og"
import { LOGO_DATA_URI } from "@/lib/design/logo-data-uri"

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_DATA_URI} width={40} height={40} alt="" />
          <span style={{ color: "#ffffff", fontSize: "28px", fontWeight: 700, letterSpacing: "-0.5px" }}>
            SocioPosts
          </span>
        </div>

        {/* Headline -- satori (what ImageResponse renders through) requires
            an explicit display on any element with more than one child
            node; flexWrap: "wrap" is the standard pattern for text that
            needs to keep wrapping naturally around an inline colored span
            like this one, rather than being forced onto a single flex row.
            Pre-existing bug, unrelated to the logo swap this file's other
            change is about -- this route was crashing (500) before it too,
            just never noticed since nothing links to it (see app/layout.tsx,
            which points its real OG meta tags at the static
            public/og-image.png instead). */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            // flexbox turns each text/element child into its own flex item
            // rather than flowing inline text, which collapses the literal
            // whitespace that used to separate them -- columnGap replaces
            // it with real, consistent spacing instead. Longhand, not the
            // `gap` shorthand -- satori's CSS support is a subset of the
            // real spec and silently no-ops on properties it doesn't
            // recognize rather than erroring, which is what happened here.
            columnGap: "14px",
            color: "#ffffff",
            fontSize: "58px",
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-1.5px",
            maxWidth: "900px",
            marginBottom: "32px",
          }}
        >
          <span>Your brand URL →</span>
          <span style={{ color: "#818cf8" }}>30 days</span>
          <span>of content</span>
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
