import Link from "next/link"
import { Fraunces, IBM_Plex_Mono } from "next/font/google"
import { ArrowRight, Sparkles, FileText, ImageIcon, Calendar } from "lucide-react"
import { createClient } from "@/lib/supabase/server"

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
  variable: "--font-fraunces",
})

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
})

export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const primaryHref = user ? "/dashboard" : "/signup"
  const primaryLabel = user ? "Go to dashboard" : "Start free"

  return (
    <div
      className={`${fraunces.variable} ${plexMono.variable} min-h-screen`}
      style={{
        // Self-contained palette — kept separate from the dashboard's shadcn tokens
        // so the marketing surface can have its own visual identity.
        ["--paper" as string]: "#EEF1EF",
        ["--paper-deep" as string]: "#E2E7E3",
        ["--ink" as string]: "#16302E",
        ["--ink-soft" as string]: "#4C5E5A",
        ["--coral" as string]: "#FF6B4A",
        ["--mustard" as string]: "#D98E2B",
        ["--teal" as string]: "#2F6F68",
        backgroundColor: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      {/* ---------- NAV ---------- */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-8">
        <span
          className="font-medium tracking-tight"
          style={{ fontFamily: "var(--font-plex-mono)", fontSize: "0.95rem", letterSpacing: "-0.02em" }}
        >
          content<span style={{ color: "var(--coral)" }}>/</span>os
        </span>
        <nav className="flex items-center gap-6">
          <a
            href="#desk"
            className="hidden text-sm sm:inline-block"
            style={{ color: "var(--ink-soft)" }}
          >
            The desk
          </a>
          <a
            href="#how"
            className="hidden text-sm sm:inline-block"
            style={{ color: "var(--ink-soft)" }}
          >
            How it works
          </a>
          <Link href="/login" className="text-sm" style={{ color: "var(--ink-soft)" }}>
            Sign in
          </Link>
          <Link
            href={primaryHref}
            className="rounded-full px-4 py-2 text-sm font-medium text-white transition-transform hover:scale-[1.03]"
            style={{ backgroundColor: "var(--ink)" }}
          >
            {primaryLabel}
          </Link>
        </nav>
      </header>

      {/* ---------- HERO ---------- */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-10 sm:px-8 sm:pb-28 sm:pt-16">
        <p
          className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs"
          style={{
            fontFamily: "var(--font-plex-mono)",
            backgroundColor: "var(--paper-deep)",
            color: "var(--ink-soft)",
            letterSpacing: "0.06em",
          }}
        >
          AI CONTENT DESK · FOR INDIAN D2C BRANDS
        </p>

        <h1
          className="max-w-3xl text-[2.5rem] leading-[1.08] sm:text-[3.4rem]"
          style={{ fontFamily: "var(--font-fraunces)", fontWeight: 480, letterSpacing: "-0.01em" }}
        >
          Stop{" "}
          <span className="relative inline-block">
            <span style={{ color: "var(--ink-soft)", textDecoration: "line-through", textDecorationColor: "var(--coral)", textDecorationThickness: "2px" }}>
              staring at
            </span>
            <span
              className="absolute -top-7 left-0 -rotate-3 whitespace-nowrap text-2xl sm:text-3xl sm:-top-9"
              style={{ fontFamily: "var(--font-fraunces)", fontStyle: "italic", color: "var(--coral)" }}
              aria-hidden="true"
            >
              filling
            </span>
          </span>{" "}
          the blank caption box.
        </h1>

        <p className="mt-8 max-w-xl text-lg leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          Teach it your brand voice once. Get hooks, captions, and on-brand product images
          for Instagram in seconds — instead of twenty minutes overthinking one sentence.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link
            href={primaryHref}
            className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02]"
            style={{ backgroundColor: "var(--coral)" }}
          >
            {primaryLabel} <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#desk"
            className="text-sm font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--ink)" }}
          >
            See the desk
          </a>
        </div>

        {/* Draft card — before/after demo */}
        <div
          className="mt-16 grid gap-px overflow-hidden rounded-2xl sm:grid-cols-2"
          style={{ backgroundColor: "var(--ink)" }}
        >
          <div className="p-6 sm:p-8" style={{ backgroundColor: "var(--paper)" }}>
            <p style={{ fontFamily: "var(--font-plex-mono)", fontSize: "0.7rem", letterSpacing: "0.08em", color: "var(--ink-soft)" }}>
              YOUR BRAND VOICE
            </p>
            <div className="mt-4 space-y-2 text-sm" style={{ color: "var(--ink-soft)" }}>
              <p><span style={{ color: "var(--ink)" }}>Niche</span> — Handmade rudraksha & gemstone jewellery</p>
              <p><span style={{ color: "var(--ink)" }}>Tone</span> — Warm, grounded, a little poetic</p>
              <p><span style={{ color: "var(--ink)" }}>Audience</span> — Women, 22–35, into mindful living</p>
            </div>
          </div>
          <div className="p-6 sm:p-8" style={{ backgroundColor: "var(--paper-deep)" }}>
            <p style={{ fontFamily: "var(--font-plex-mono)", fontSize: "0.7rem", letterSpacing: "0.08em", color: "var(--teal)" }}>
              GENERATED CAPTION
            </p>
            <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--ink)" }}>
              Some days call for quiet strength. Our 108-bead rudraksha mala is strung by hand,
              one knot at a time — made to sit close, and stay close.
            </p>
            <p className="mt-3 text-sm font-medium" style={{ color: "var(--coral)" }}>
              Shop the mala — link in bio →
            </p>
          </div>
        </div>
      </section>

      {/* ---------- THE DESK ---------- */}
      <section id="desk" className="mx-auto max-w-6xl px-6 py-20 sm:px-8">
        <p style={{ fontFamily: "var(--font-plex-mono)", fontSize: "0.7rem", letterSpacing: "0.08em", color: "var(--ink-soft)" }}>
          THE DESK
        </p>
        <h2
          className="mt-3 max-w-lg text-3xl sm:text-4xl"
          style={{ fontFamily: "var(--font-fraunces)", fontWeight: 480 }}
        >
          Three tools. One brand voice running through all of them.
        </h2>

        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {[
            {
              index: "H–01",
              icon: Sparkles,
              title: "Hooks",
              desc: "Scroll-stopping opening lines, tuned to your tone — five at a time, with the reasoning behind each one.",
            },
            {
              index: "C–02",
              icon: FileText,
              title: "Captions",
              desc: "Full captions with hashtags and a clear call to action, written the way your brand actually talks.",
            },
            {
              index: "I–03",
              icon: ImageIcon,
              title: "Images",
              desc: "On-brand product visuals — studio, lifestyle, festive, flat lay — without a camera or a designer.",
            },
          ].map((tool) => (
            <div
              key={tool.index}
              className="rounded-2xl p-6 transition-transform hover:-translate-y-1"
              style={{ backgroundColor: "var(--paper-deep)" }}
            >
              <div className="flex items-center justify-between">
                <tool.icon className="h-5 w-5" style={{ color: "var(--teal)" }} />
                <span style={{ fontFamily: "var(--font-plex-mono)", fontSize: "0.7rem", color: "var(--ink-soft)" }}>
                  {tool.index}
                </span>
              </div>
              <h3 className="mt-5 text-xl" style={{ fontFamily: "var(--font-fraunces)", fontWeight: 480 }}>
                {tool.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-soft)" }}>
                {tool.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20 sm:px-8">
        <p style={{ fontFamily: "var(--font-plex-mono)", fontSize: "0.7rem", letterSpacing: "0.08em", color: "var(--ink-soft)" }}>
          HOW IT WORKS
        </p>
        <h2
          className="mt-3 max-w-lg text-3xl sm:text-4xl"
          style={{ fontFamily: "var(--font-fraunces)", fontWeight: 480 }}
        >
          Set it up once. Use it every time you post.
        </h2>

        <div className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {[
            {
              n: "01",
              title: "Set up your brand",
              desc: "Niche, tone, values, color palette. Five minutes — you won't need to do it again.",
            },
            {
              n: "02",
              title: "Generate on demand",
              desc: "Pick a product, a platform, a mood. Get hooks, a caption, or an image in seconds.",
            },
            {
              n: "03",
              title: "Plan your week",
              desc: "Drop what you like onto the calendar, so you always know what's going out, and when.",
            },
          ].map((step) => (
            <div key={step.n}>
              <span
                style={{ fontFamily: "var(--font-fraunces)", fontStyle: "italic", color: "var(--coral)" }}
                className="text-4xl"
              >
                {step.n}
              </span>
              <h3 className="mt-3 text-lg font-medium">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink-soft)" }}>
                {step.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex items-center gap-2 text-sm" style={{ color: "var(--ink-soft)" }}>
          <Calendar className="h-4 w-4" style={{ color: "var(--teal)" }} />
          Your content calendar lives right alongside it — no separate tool to juggle.
        </div>
      </section>

      {/* ---------- BUILT FOR ---------- */}
      <section className="mx-auto max-w-6xl px-6 py-20 sm:px-8">
        <p style={{ fontFamily: "var(--font-plex-mono)", fontSize: "0.7rem", letterSpacing: "0.08em", color: "var(--ink-soft)" }}>
          BUILT FOR
        </p>
        <h2
          className="mt-3 max-w-xl text-3xl sm:text-4xl"
          style={{ fontFamily: "var(--font-fraunces)", fontWeight: 480 }}
        >
          Brands that don&apos;t have a content team yet.
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          Built solo, for the kind of small D2C brand that&apos;s doing everything themselves right now —
          jewellery, wellness, home, gifting — and just needs one less thing to stare at on a Sunday night.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {["Jewellery & accessories", "Wellness & spiritual products", "Home & gifting", "Beauty & personal care"].map((tag) => (
            <span
              key={tag}
              className="rounded-full px-3 py-1.5 text-xs"
              style={{ backgroundColor: "var(--paper-deep)", color: "var(--ink-soft)", fontFamily: "var(--font-plex-mono)" }}
            >
              {tag}
            </span>
          ))}
        </div>
      </section>

      {/* ---------- FINAL CTA ---------- */}
      <section className="px-6 py-20 sm:px-8" style={{ backgroundColor: "var(--ink)" }}>
        <div className="mx-auto max-w-3xl text-center">
          <h2
            className="text-3xl sm:text-4xl"
            style={{ fontFamily: "var(--font-fraunces)", fontWeight: 480, color: "var(--paper)" }}
          >
            Your next caption doesn&apos;t need a blank page.
          </h2>
          <Link
            href={primaryHref}
            className="mt-8 inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-medium text-white transition-transform hover:scale-[1.03]"
            style={{ backgroundColor: "var(--coral)" }}
          >
            {primaryLabel} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-xs sm:flex-row sm:px-8" style={{ color: "var(--ink-soft)" }}>
        <span style={{ fontFamily: "var(--font-plex-mono)" }}>content/os — built by Akshita Singh</span>
        <div className="flex gap-5">
          <Link href="/login" className="hover:underline">Sign in</Link>
          <Link href="/signup" className="hover:underline">Sign up</Link>
        </div>
      </footer>
    </div>
  )
}
