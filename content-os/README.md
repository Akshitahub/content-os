This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment variables & secrets

Copy `.env.local.example` to `.env.local` and fill in real values — see that file for what each variable does and whether it's safe to expose to the client (only `NEXT_PUBLIC_*` variables are, and only when explicitly noted).

**⚠️ Secret rotation warning:** if any API key, database credential, or other secret was ever hardcoded directly in source code at any point in this project's history — even if it has since been removed — that old value is still permanently readable in git history (`git log -p`) and in any fork/clone made before the removal. Removing a hardcoded secret from the current code does **not** invalidate it. If you have any reason to believe a real secret was ever committed, rotate it immediately at the provider (Supabase, Groq, Razorpay, Meta, etc.) rather than relying on it having been deleted from the working tree.

A full audit of this codebase found no hardcoded secrets in the current source or in git history as of the last review — this warning is left here as standing guidance for future contributors, not because a leak was found.

## Before deploying to production

Most pre-deploy hardening (fail-fast env var checks, security headers, error-detail redaction) is already in the code — see `lib/env.ts` and `next.config.ts`. Two things are **not** controllable from this codebase and need to be checked directly in each provider's dashboard before going live:

- **Auth rate limiting.** Login, signup, password reset, and email OTP all go straight from the browser to Supabase Auth (`supabase.auth.signInWithPassword`/`signUp`/`resetPasswordForEmail`/`resend`) — there is no custom Next.js API route in this app's own request path for any of these, so there is nothing in this codebase to rate-limit. Supabase Auth has its own built-in per-IP rate limits, but confirm/tighten them under **Supabase Dashboard → Authentication → Rate Limits** before launch (defaults have historically been looser than a production auth flow usually wants, and are unrelated to this app's own `checkAndIncrementUsage`-style quotas, which only cover AI generation, not login attempts).
- **Database network exposure.** This app never opens a raw Postgres connection — all data access goes through Supabase's HTTPS REST API (`@supabase/ssr`), which is TLS-only by construction and requires a per-project API key. If you ever enable direct Postgres access (e.g. for `pg_dump`/migrations tooling) via **Supabase Dashboard → Database → Network Restrictions**, restrict it to known IPs rather than leaving it open.

The `Content-Security-Policy` in `next.config.ts` was built from every external domain found by static analysis (Razorpay checkout, Google Fonts, Pollinations, Supabase, PostHog) — it has **not** been exercised against a live browser. Test the checkout flow, image generation, and post-preview rendering after your first deploy and check the browser console for CSP violations; Razorpay's checkout in particular calls several fraud-detection subdomains (Cardinal Commerce) that are allowlisted by wildcard but not individually verified.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
