// The SocioPosts brand mark — a calendar with an "S" squiggle, replacing the
// earlier lightning-bolt mark everywhere it appeared (navbar, footer, auth/
// onboarding/legal headers, sidebar, OG image). Self-contained (own dark
// rounded-square background baked into the artwork), so callers don't need
// to wrap it in a colored box the way the old stroke-only bolt icon
// required.
//
// Real raster artwork (public/brand/logo-192.png, downscaled from the
// original 1254x1254 public/brand/logo.png) rather than hand-recreated SVG
// — the source has fine detail (the custom "S" letterform's curves, the
// calendar outline weight) that a hand-traced vector approximation would
// lose. 192px is comfortably larger than every call site's actual size
// (max 40px, so still crisp on a 4x-density display) without shipping the
// full 1254px source everywhere this renders.
//
// Plain <img>, not next/image — this codebase doesn't use next/image
// anywhere (see AGENTS.md's warning that this Next.js version has its own
// conventions), and app/og/route.tsx's edge-runtime ImageResponse (satori)
// needs its own direct image reference anyway (see that file) rather than
// reusing this component, since satori can't resolve a relative /public
// URL the way a normal page can.
export function LogoIcon({ size = 22, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/logo-192.png"
      alt="SocioPosts"
      width={size}
      height={size}
      className={className}
    />
  )
}
