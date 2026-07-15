"use client"

// Pure CSS animated demo — no video files, no state, no refs.
// 4 phases cycle every 8s via CSS animation-delay.
export function LiveDemo() {
  return (
    <div className="relative mx-auto w-full max-w-2xl select-none">
      <style>{`
        @keyframes typing {
          0%   { width: 0 }
          100% { width: 100% }
        }
        @keyframes cursor-blink {
          0%, 100% { opacity: 1 } 50% { opacity: 0 }
        }
        @keyframes fade-in {
          0%   { opacity: 0; transform: translateY(8px) }
          100% { opacity: 1; transform: translateY(0) }
        }
        @keyframes progress-fill {
          0%   { width: 0% }
          100% { width: 100% }
        }
        @keyframes slide-up {
          0%   { opacity: 0; transform: translateY(24px) }
          100% { opacity: 1; transform: translateY(0) }
        }
        @keyframes dot-fill {
          0%   { opacity: 0; transform: scale(0.5) }
          100% { opacity: 1; transform: scale(1) }
        }
        @keyframes phase-cycle {
          0%, 22%   { opacity: 1 }
          25%, 97%  { opacity: 0 }
          100%      { opacity: 1 }
        }
      `}</style>

      {/* Browser chrome */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl ring-1 ring-black/5">
        {/* Title bar */}
        <div className="flex items-center gap-3 border-b border-border/50 bg-muted/40 px-4 py-3">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
          </div>
          {/* URL bar */}
          <div className="flex-1 overflow-hidden rounded-md border border-border/50 bg-background px-3 py-1.5 text-xs text-muted-foreground">
            <span>socioposts.ai</span>
          </div>
        </div>

        {/* Demo area */}
        <div className="relative overflow-hidden" style={{ height: 360 }}>

          {/* ── Phase 1: URL input typing (0–2s of each 8s cycle) ──────── */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-8"
            style={{ animation: "phase-cycle 8s infinite 0s" }}
          >
            <p className="text-sm font-medium text-muted-foreground">Paste your brand&apos;s website URL</p>
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-violet-300 bg-violet-50/60 px-4 py-3 text-sm font-mono shadow-inner">
              <span
                className="inline-block overflow-hidden whitespace-nowrap border-r-2 border-violet-500"
                style={{
                  animation: "typing 1.8s steps(28, end) forwards, cursor-blink 0.7s step-end infinite",
                  maxWidth: "100%",
                }}
              >
                mynykaa.com
              </span>
            </div>
            <button className="rounded-full bg-violet-600 px-6 py-2 text-sm font-semibold text-white shadow-md">
              Extract Brand DNA →
            </button>
          </div>

          {/* ── Phase 2: Analyzing + brand card (2–4s) ──────────────────── */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8"
            style={{ animation: "phase-cycle 8s infinite 2s" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">Analyzing your brand…</p>
            <div className="w-full max-w-sm overflow-hidden rounded-xl border bg-muted/30">
              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                  style={{ animation: "progress-fill 1.8s ease-in-out forwards" }}
                />
              </div>
            </div>
            <div
              className="flex w-full max-w-sm items-center gap-4 rounded-xl border bg-card p-4 shadow-sm"
              style={{ animation: "fade-in 0.4s ease-out 0.8s both" }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-rose-500 text-lg font-bold text-white shadow">
                N
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Nykaa</p>
                <p className="truncate text-xs text-muted-foreground">Beauty & Wellness · Bold, empowering</p>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">✓ Ready</span>
            </div>
          </div>

          {/* ── Phase 3: 3 content cards sliding in (4–6s) ──────────────── */}
          <div
            className="absolute inset-0 flex flex-col gap-2.5 overflow-hidden p-5"
            style={{ animation: "phase-cycle 8s infinite 4s" }}
          >
            <p className="text-center text-xs font-semibold text-muted-foreground">Your content is ready 🎉</p>
            {[
              { emoji: "🎬", type: "Reel Script", text: "Your skin is not a problem to solve — it’s a story to tell. 💄", delay: "0s" },
              { emoji: "📸", type: "Instagram Post", text: "Bold lips, bolder you. Shop the new collection before it sells out!", delay: "0.15s" },
              { emoji: "🎠", type: "Carousel", text: "5 skincare mistakes you didn’t know were aging you faster", delay: "0.3s" },
            ].map((card) => (
              <div
                key={card.type}
                className="flex items-start gap-3 rounded-xl border bg-card p-3 shadow-sm"
                style={{ animation: `slide-up 0.4s ease-out ${card.delay} both` }}
              >
                <span className="text-base">{card.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{card.type}</p>
                  <p className="mt-0.5 text-xs text-foreground">{card.text}</p>
                </div>
                <button className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                  Use
                </button>
              </div>
            ))}
          </div>

          {/* ── Phase 4: Calendar with green dots filling (6–8s) ─────────── */}
          <div
            className="absolute inset-0 flex flex-col gap-3 p-5"
            style={{ animation: "phase-cycle 8s infinite 6s" }}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">Content Calendar — July 2025</p>
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">30 posts planned</span>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <div key={i} className="text-center text-[9px] font-semibold text-muted-foreground">{d}</div>
              ))}
              {Array.from({ length: 35 }, (_, i) => {
                const dayNum = i - 1
                const hasDot = dayNum >= 0 && dayNum < 30 && [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25, 28].includes(dayNum)
                const delayS = hasDot ? `${(dayNum / 30) * 1.5}s` : "0s"
                return (
                  <div
                    key={i}
                    className={`relative flex h-8 items-center justify-center rounded-md text-[10px] font-medium ${dayNum >= 0 && dayNum < 30 ? "bg-muted/50 text-foreground" : "text-transparent"}`}
                  >
                    {dayNum >= 0 && dayNum < 30 ? dayNum + 1 : ""}
                    {hasDot && (
                      <span
                        className="absolute bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-emerald-500"
                        style={{ animation: `dot-fill 0.3s ease-out ${delayS} both` }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>

      {/* Glow decoration */}
      <div className="pointer-events-none absolute -inset-8 -z-10 bg-gradient-radial from-violet-500/10 via-transparent to-transparent" />
    </div>
  )
}
