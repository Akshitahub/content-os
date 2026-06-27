import Link from "next/link"
import { Globe, Zap, Sparkles, Star, ArrowRight, Check } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { ScrollNavHandler } from "@/components/landing/ScrollNavHandler"

export default async function RootPage() {
  let primaryHref = "/signup"
  let primaryLabel = "Get started free"
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    primaryHref = user ? "/dashboard" : "/signup"
    primaryLabel = user ? "Go to dashboard" : "Get started free"
  } catch {
    // default to signup if auth check fails
  }

  return (
    <>
      <style>{`
        @keyframes heroFrame {
          0%, 25%   { opacity: 1; }
          33.33%, 100% { opacity: 0; }
        }
        .hero-frame-1 { animation: heroFrame 8s infinite 0s; }
        .hero-frame-2 { animation: heroFrame 8s infinite 2.67s; }
        .hero-frame-3 { animation: heroFrame 8s infinite 5.33s; }

        @keyframes stepReveal {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fl-step-1 { animation: stepReveal 0.5s forwards 0.5s;  opacity: 0; }
        .fl-step-2 { animation: stepReveal 0.5s forwards 1.4s;  opacity: 0; }
        .fl-step-3 { animation: stepReveal 0.5s forwards 2.3s;  opacity: 0; }
        .fl-step-4 { animation: stepReveal 0.5s forwards 3.2s;  opacity: 0; }

        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .fl-pulse { animation: pulse 1.5s infinite 3.5s; }

        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        .cursor { animation: blink 0.9s infinite; }

        @keyframes fillBar { from{width:0%} to{width:85%} }
        .fill-bar { animation: fillBar 2s ease-out 0.3s forwards; width: 0%; }
      `}</style>

      <ScrollNavHandler />

      <div className="min-h-screen bg-white text-gray-900">
        {/* NAVBAR */}
        <nav
          id="landing-nav"
          className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
          style={{ backgroundColor: "transparent" }}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-8">
            <span className="nav-logo-dark flex items-center gap-2" style={{ display: "flex" }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path d="M13 2L4 13h7l-2 7 9-11h-7l2-7z" fill="white" stroke="white" strokeWidth="1" strokeLinejoin="round" />
              </svg>
              <span className="font-semibold tracking-tight text-white" style={{ fontSize: "0.95rem" }}>ContentOS</span>
            </span>
            <span className="nav-logo-light items-center gap-2" style={{ display: "none" }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path d="M13 2L4 13h7l-2 7 9-11h-7l2-7z" fill="#7c3aed" stroke="#7c3aed" strokeWidth="1" strokeLinejoin="round" />
              </svg>
              <span className="font-semibold tracking-tight text-gray-900" style={{ fontSize: "0.95rem" }}>ContentOS</span>
            </span>
            <div className="flex items-center gap-4 sm:gap-6">
              <Link href="/login" className="nav-link text-sm font-medium transition-colors" style={{ color: "#ffffff" }}>
                Sign in
              </Link>
              <Link href={primaryHref} className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-violet-700 hover:scale-[1.02]">
                {primaryLabel}
              </Link>
            </div>
          </div>
        </nav>

        {/* HERO */}
        <section className="relative overflow-hidden px-6 pb-24 pt-32 sm:px-8 sm:pb-32 sm:pt-40" style={{ backgroundColor: "#0f0f0f" }}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(124,58,237,0.18) 0%, transparent 70%)" }} />
          <div className="relative mx-auto max-w-6xl">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-violet-300">
                  <Sparkles className="h-3 w-3" />
                  AI Content Operating System
                </span>
                <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-[3.4rem]">
                  Your brand URL →{" "}
                  <span className="text-violet-400">30 days</span> of content
                </h1>
                <p className="mt-6 max-w-lg text-lg leading-relaxed text-gray-400">
                  ContentOS learns your brand voice from your website and generates hooks, captions, reels, carousels, ad copy, and email sequences — tailored to you, not templates.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <Link href={primaryHref} className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-violet-700 hover:scale-[1.02]">
                    Start for free <ArrowRight className="h-4 w-4" />
                  </Link>
                  <a href="#how" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-white/5">
                    Watch demo
                  </a>
                </div>
                <div className="mt-8 flex items-center gap-3">
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <span className="text-sm text-gray-400">Trusted by 500+ ecommerce brands</span>
                </div>
              </div>

              <div className="relative mx-auto h-72 w-full max-w-md rounded-2xl border border-white/10 lg:h-80" style={{ backgroundColor: "#1a1a1a" }}>
                <div className="hero-frame-1 absolute inset-0 flex flex-col items-start justify-center rounded-2xl p-8" style={{ opacity: 0 }}>
                  <p className="mb-3 text-xs font-medium uppercase tracking-widest text-gray-500">Step 1 — Paste your brand URL</p>
                  <div className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                    <Globe className="h-4 w-4 shrink-0 text-violet-400" />
                    <span className="text-sm text-white">yourbrand.com<span className="cursor ml-0.5 text-violet-400">|</span></span>
                  </div>
                  <button className="mt-4 rounded-full bg-violet-600 px-5 py-2 text-xs font-semibold text-white" aria-hidden="true" tabIndex={-1}>
                    Analyse my brand →
                  </button>
                </div>

                <div className="hero-frame-2 absolute inset-0 flex flex-col items-start justify-center rounded-2xl p-8" style={{ opacity: 0 }}>
                  <p className="mb-3 text-xs font-medium uppercase tracking-widest text-gray-500">Step 2 — AI analysis</p>
                  <p className="mb-4 text-sm text-white">Analysing your brand voice…</p>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="fill-bar h-full rounded-full bg-violet-500" />
                  </div>
                  <div className="mt-4 space-y-2">
                    {["Scraping website content", "Detecting tone & voice", "Building brand profile"].map((t) => (
                      <div key={t} className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                        {t}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="hero-frame-3 absolute inset-0 flex flex-col items-start justify-center rounded-2xl p-8" style={{ opacity: 0 }}>
                  <p className="mb-3 text-xs font-medium uppercase tracking-widest text-gray-500">Step 3 — 30 days ready</p>
                  <div className="grid w-full grid-cols-6 gap-2">
                    {["bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-yellow-500", "bg-pink-500", "bg-orange-500"].map((color, i) => (
                      <div key={i} className={`${color} flex h-14 items-center justify-center rounded-lg text-xs font-bold text-white opacity-90`}>
                        {i + 1}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-gray-400">6 content types · 30 posts generated</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* LOGOS */}
        <section className="border-b border-gray-100 bg-white px-6 py-12 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <p className="mb-6 text-center text-sm text-gray-400">Works for brands selling on</p>
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6">
              {["Shopify", "WooCommerce", "Instagram", "Amazon", "Meesho", "Myntra", "D2C Website"].map((brand) => (
                <span key={brand} className="rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600">
                  {brand}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" className="bg-white px-6 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <span className="mb-3 inline-block rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-violet-600">How it works</span>
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Three steps. Zero guesswork.</h2>
            </div>
            <div className="grid gap-8 sm:grid-cols-3">
              {[
                { Icon: Globe, step: "01", title: "Paste your URL", desc: "Drop in your website or store URL. ContentOS reads your pages, products, and copy to understand your brand." },
                { Icon: Sparkles, step: "02", title: "AI learns your brand", desc: "Our AI extracts your tone, audience, and positioning — building a brand profile unique to you." },
                { Icon: Zap, step: "03", title: "Generate everything", desc: "Hooks, captions, reels, carousels, email sequences — 30 days of on-brand content in one click." },
              ].map(({ Icon, step, title, desc }) => (
                <div key={step} className="rounded-2xl border border-gray-100 p-8 transition-shadow hover:shadow-md">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
                    <Icon className="h-5 w-5 text-violet-600" />
                  </div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-violet-400">Step {step}</p>
                  <h3 className="mb-2 text-lg font-bold text-gray-900">{title}</h3>
                  <p className="text-sm leading-relaxed text-gray-500">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURES GRID */}
        <section className="px-6 py-20 sm:px-8 sm:py-28" style={{ backgroundColor: "#0f0f0f" }}>
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Everything your content team needs</h2>
              <p className="mt-3 text-gray-400">Six tools. One platform. Zero creative blocks.</p>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              {[
                { title: "Hook Generator", desc: "Scroll-stopping first lines tuned to your brand voice, with the reasoning behind each one.", icon: "⚡" },
                { title: "Reel Scripts", desc: "Full voiceover scripts with hooks, body, and CTAs — ready to record in 60 seconds.", icon: "🎬" },
                { title: "Carousels", desc: "Slide-by-slide content plans for educational and product carousels that actually get saved.", icon: "🎠" },
                { title: "Email Sequences", desc: "Welcome, nurture, and launch sequences written in your brand's tone, not a generic template.", icon: "📧" },
                { title: "Influencer Outreach", desc: "Personalized DM and email pitches for collaborations — tailored to each creator's niche.", icon: "🤝" },
                { title: "Fastlane", desc: "Our flagship: paste your URL, get 30 days of planned, ready-to-post content instantly.", icon: "🚀", highlight: true },
              ].map(({ title, desc, icon, highlight }) => (
                <div key={title} className={`rounded-2xl p-6 transition-all hover:scale-[1.01] ${highlight ? "border border-violet-500/30 bg-violet-950/40" : "border border-white/5 bg-white/5"}`}>
                  <div className="mb-3 text-2xl" aria-hidden="true">{icon}</div>
                  <h3 className="mb-1.5 font-semibold text-white">{title}</h3>
                  <p className="text-sm leading-relaxed text-gray-400">{desc}</p>
                  {highlight && <span className="mt-3 inline-block rounded-full bg-violet-600/20 px-2.5 py-0.5 text-xs font-semibold text-violet-300">Flagship</span>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FASTLANE SHOWCASE */}
        <section className="bg-white px-6 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <span className="mb-4 inline-block rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-violet-600">The flagship feature</span>
                <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                  30 days of content.{" "}<span className="text-violet-600">One click.</span>
                </h2>
                <p className="mt-4 text-lg leading-relaxed text-gray-500">
                  Fastlane reads your entire brand, builds a content strategy, and generates a full month of posts — hooks, captions, format types, and posting schedule included. No prompting. No editing templates. Just done.
                </p>
                <Link href={primaryHref} className="mt-8 inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-violet-700">
                  Try Fastlane free <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="rounded-2xl p-8" style={{ backgroundColor: "#0f0f0f" }}>
                <p className="mb-6 text-xs font-semibold uppercase tracking-widest text-gray-500">Fastlane running…</p>
                <div className="space-y-4">
                  <div className="fl-step-1 flex items-center gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                    <span className="text-sm text-white">Learning your brand</span>
                    <span className="ml-auto text-xs text-emerald-400">✓</span>
                  </div>
                  <div className="fl-step-2 flex items-center gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                    <span className="text-sm text-white">Analysing trends</span>
                    <span className="ml-auto text-xs text-emerald-400">✓</span>
                  </div>
                  <div className="fl-step-3 flex items-center gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                    <span className="text-sm text-white">Building strategy</span>
                    <span className="ml-auto text-xs text-emerald-400">✓</span>
                  </div>
                  <div className="fl-step-4 flex items-center gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/20">
                      <span className="fl-pulse h-2 w-2 rounded-full bg-violet-400" />
                    </div>
                    <span className="text-sm text-white">Generating 30 posts…</span>
                  </div>
                </div>
                <div className="mt-8 rounded-xl border border-white/5 bg-white/5 p-4">
                  <p className="text-xs text-gray-500">Preview — Post #1</p>
                  <p className="mt-2 text-sm leading-relaxed text-gray-200">
                    &ldquo;The feeling of putting something handmade on and just knowing — this was made for you. Shop our new collection → link in bio&rdquo;
                  </p>
                  <div className="mt-2 flex gap-2">
                    <span className="rounded bg-violet-900/40 px-2 py-0.5 text-xs text-violet-300">Hook</span>
                    <span className="rounded bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">Instagram</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section className="border-t border-gray-100 bg-white px-6 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <span className="mb-3 inline-block rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-violet-600">Pricing</span>
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Simple, honest pricing</h2>
            </div>
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="flex flex-col rounded-2xl border border-gray-200 p-8">
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-gray-900">Free</h3>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-gray-900">₹0</span>
                    <span className="text-gray-400">/mo</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">No credit card needed</p>
                </div>
                <ul className="mb-8 flex-1 space-y-3">
                  {["10 generations / month", "1 brand profile", "Hook & caption tools"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" /> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="rounded-full border border-gray-200 px-5 py-2.5 text-center text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
                  Get started free
                </Link>
              </div>

              <div className="relative flex flex-col rounded-2xl border-2 border-violet-600 p-8 shadow-lg shadow-violet-100">
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-4 py-1 text-xs font-bold text-white">Most popular</span>
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-gray-900">Starter</h3>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-gray-900">₹999</span>
                    <span className="text-gray-400">/mo</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">Billed monthly</p>
                </div>
                <ul className="mb-8 flex-1 space-y-3">
                  {["100 generations / month", "3 brand profiles", "All content formats", "Fastlane (30-day planner)"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <Check className="h-4 w-4 shrink-0 text-violet-500" /> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="rounded-full bg-violet-600 px-5 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-violet-700">
                  Start Starter plan
                </Link>
              </div>

              <div className="flex flex-col rounded-2xl border border-gray-200 p-8">
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-gray-900">Pro</h3>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-gray-900">₹2,999</span>
                    <span className="text-gray-400">/mo</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">Billed monthly</p>
                </div>
                <ul className="mb-8 flex-1 space-y-3">
                  {["500 generations / month", "10 brand profiles", "All content formats", "Fastlane (30-day planner)", "Influencer Outreach module", "Priority support"].map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" /> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="rounded-full border border-gray-200 px-5 py-2.5 text-center text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
                  Start Pro plan
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* TESTIMONIALS */}
        <section className="px-6 py-20 sm:px-8 sm:py-28" style={{ backgroundColor: "#0f0f0f" }}>
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Brands love it</h2>
            </div>
            <div className="grid gap-6 sm:grid-cols-3">
              {[
                { quote: "I used to spend 2 hours on a Sunday planning content. Now I run Fastlane on Monday morning and I'm done in 4 minutes.", name: "Priya M.", role: "Founder, handmade jewellery brand", initials: "PM", color: "bg-violet-600" },
                { quote: "The hooks it generates actually sound like me. Not some American SaaS voice — my voice. That was the thing I was most afraid of with AI tools.", name: "Rajan S.", role: "D2C wellness brand", initials: "RS", color: "bg-blue-600" },
                { quote: "Switched from a freelancer to ContentOS. Same output quality, a fraction of the cost, and I can generate on-demand instead of waiting a week.", name: "Anika T.", role: "Home décor brand, Meesho", initials: "AT", color: "bg-emerald-600" },
              ].map(({ quote, name, role, initials, color }) => (
                <div key={name} className="rounded-2xl border border-white/5 bg-white/5 p-6">
                  <div className="mb-4 flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <p className="mb-6 text-sm leading-relaxed text-gray-300">&ldquo;{quote}&rdquo;</p>
                  <div className="flex items-center gap-3">
                    <div className={`${color} flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white`}>{initials}</div>
                    <div>
                      <p className="text-sm font-semibold text-white">{name}</p>
                      <p className="text-xs text-gray-400">{role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="px-6 py-24 sm:px-8 sm:py-32" style={{ backgroundColor: "#0a0a0a" }}>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">Start generating content today</h2>
            <p className="mt-4 text-lg text-gray-400">Your brand URL is all you need to get started.</p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link href={primaryHref} className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-8 py-4 text-base font-semibold text-white transition-all hover:bg-violet-700 hover:scale-[1.02]">
                {primaryLabel} <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
            <p className="mt-4 text-sm text-gray-500">Free plan available · No credit card required</p>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="border-t px-6 py-12 sm:px-8" style={{ backgroundColor: "#0f0f0f", borderColor: "#1f1f1f" }}>
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-10 sm:grid-cols-4">
              <div className="sm:col-span-1">
                <div className="flex items-center gap-2">
                  <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                    <path d="M13 2L4 13h7l-2 7 9-11h-7l2-7z" fill="#7c3aed" stroke="#7c3aed" strokeWidth="1" strokeLinejoin="round" />
                  </svg>
                  <span className="font-semibold text-white">ContentOS</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-gray-400">The AI content operating system for ecommerce brands.</p>
              </div>
              <div>
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">Product</p>
                <ul className="space-y-3">
                  {[{ label: "How it works", href: "#how" }, { label: "Fastlane", href: "/signup" }, { label: "Pricing", href: "#pricing" }].map(({ label, href }) => (
                    <li key={label}><a href={href} className="text-sm text-gray-400 hover:text-white transition-colors">{label}</a></li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">Account</p>
                <ul className="space-y-3">
                  {[{ label: "Sign in", href: "/login" }, { label: "Sign up", href: "/signup" }, { label: "Dashboard", href: "/dashboard" }].map(({ label, href }) => (
                    <li key={label}><Link href={href} className="text-sm text-gray-400 hover:text-white transition-colors">{label}</Link></li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">Legal</p>
                <ul className="space-y-3">
                  {[{ label: "Privacy Policy", href: "/privacy" }, { label: "Terms of Service", href: "/terms" }].map(({ label, href }) => (
                    <li key={label}><Link href={href} className="text-sm text-gray-400 hover:text-white transition-colors">{label}</Link></li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-10 border-t pt-6" style={{ borderColor: "#1f1f1f" }}>
              <p className="text-xs text-gray-600">&copy; {new Date().getFullYear()} ContentOS. Built by Akshita Singh. All rights reserved.</p>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}