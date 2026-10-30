@AGENTS.md

## Before every commit

Run BOTH of these from this directory (`content-os/`), not just tsc -- tsc doesn't catch bundler errors (e.g. sharp pulled into the client bundle broke every Vercel deploy from c0bd043 to cef3240):

```
npx tsc --noEmit
NEXT_PUBLIC_SUPABASE_URL=https://ci-dummy.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-dummy-anon-key SUPABASE_SERVICE_ROLE_KEY=ci-dummy-service-role-key GROQ_API_KEY=ci-dummy-groq-key npx next build
```

The dummy env matches `.github/workflows/ci.yml` (lib/env.ts requires these four at config load). CI also runs `npx tsx scripts/check-client-imports.ts`: never import sharp, fs, path, child_process or lib/image/text-contrast.ts from anything a "use client" file can reach -- use lib/design/contrast-math.ts for colour helpers.
