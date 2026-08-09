// The SocioPosts brand mark — a calendar with an "S" squiggle, replacing the
// earlier lightning-bolt mark everywhere it appeared (navbar, footer, auth/
// onboarding/legal headers, sidebar, OG image). Self-contained (own dark
// rounded-square background baked into the artwork via viewBox 0 0 240 240),
// so callers don't need to wrap it in a colored box the way the old
// stroke-only bolt icon required.
//
// Plain inline SVG with no Tailwind classes on its internals — deliberately,
// so this same component also renders correctly inside app/og/route.tsx's
// edge-runtime ImageResponse (satori), which doesn't process CSS classes.
export function LogoIcon({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" fill="none" aria-hidden="true" className={className}>
      <rect width="240" height="240" rx="48" fill="#0f0f0f" />
      <rect x="65" y="78" width="110" height="98" rx="16" fill="none" stroke="#7c3aed" strokeWidth="7" />
      <line x1="65" y1="104" x2="175" y2="104" stroke="#7c3aed" strokeWidth="7" />
      <circle cx="98" cy="58" r="6" fill="#7c3aed" />
      <circle cx="142" cy="58" r="6" fill="#7c3aed" />
      <path
        d="M138 122 C138 116 130 114 122 114 C114 114 108 117 108 122 C108 127 114 129 122 130 C130 131 138 133 138 139 C138 145 130 148 122 148 C114 148 109 145 109 141"
        stroke="#a78bfa"
        strokeWidth="5.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}
