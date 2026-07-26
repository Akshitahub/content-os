import type { NextConfig } from "next";
import { validateRequiredEnv } from "./lib/env";

// Fails the build/boot outright if a variable the app cannot run without is
// missing, rather than deploying a broken app that fails confusingly on
// its first real request. See lib/env.ts for exactly what's checked and why.
validateRequiredEnv();

// Content-Security-Policy — restricts script execution to this app's own
// origin plus the one confirmed external <script> tag this app loads
// (Razorpay's checkout widget, see components/settings/SettingsContent.tsx).
// 'unsafe-inline' is kept for script-src/style-src because this app isn't
// on nonce-based CSP (that requires converting every page to dynamic
// rendering — a bigger, riskier change); it still blocks any *other*
// origin from injecting a <script src>, which is the actual XSS mitigation
// that matters here. style-src/font-src/img-src/connect-src/frame-src
// allow the other real external dependencies this app has: Google Fonts
// (post preview card rendering), Pollinations (AI image generation),
// Supabase (*.supabase.co, for both the API and Storage-hosted media), and
// Razorpay's own domains (checkout + its fraud-detection/analytics calls,
// which span several razorpay.com and cardinalcommerce.com subdomains).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://image.pollinations.ai https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co https://app.posthog.com https://*.razorpay.com https://*.cardinalcommerce.com",
  "frame-src https://*.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

const nextConfig: NextConfig = {
  // @resvg/resvg-js (lib/image/meme-compositor.ts) ships a native .node
  // binding loaded via require() — bundling it fails ("asset is not
  // placeable in ESM chunks"), so it needs native Node.js require instead,
  // same as sharp (already externalized by Next.js's own default list).
  serverExternalPackages: ["@resvg/resvg-js"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Content-Security-Policy", value: CSP },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]
  },
};

export default nextConfig;
