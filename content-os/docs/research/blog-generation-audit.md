# Blog Generation & Editing — Audit

Audit-only, 2026-08-18. No code changes made.

## 1. How `wordLimit` is actually used

Route (`app/api/v1/ai/blog/generate/route.ts:19`) validates
`wordLimit: 200-2000, default 800`; the UI only ever sends one of three
presets — 500 / 800 / 1200 (Short/Medium/Long).

**Prompt text** (`lib/ai/prompts.ts:516`): *"Target approximately
${wordLimit} words total for the body — stay within roughly 15% of this
target, don't pad with filler to hit it and don't cut real substance short
to stay under it."*

**`max_tokens` formula** (`lib/ai/blog-generator.ts:37`):
`Math.max(1800, Math.round(wordLimit * 3))`.

**The requested `wordLimit` is never stored.** The DB insert
(`route.ts:97-105`) and the `blog_posts` schema (migration
`021_blog_posts.sql`) have no column for it — once a post exists, there's
no way to recover what length was actually asked for, only an indirect
proxy via `ai_generation_logs.completion_tokens`.

**Real posts checked** (all 3 rows that exist in `blog_posts`):

| post | actual word count | closest preset | delta |
|---|---|---|---|
| "Step‑by‑Step Guide to Automate Instagram Posts..." | 880 | 800 (Medium) | +10%, within stated tolerance |
| "How SocioPosts Automates Instagram Content..." | 467 | 500 (Short) if that's what was asked | -6.6%, within tolerance — but -41.6% if 800 was actually requested (unrecoverable which) |
| "Reddit Strategy" | 361 | 500 (smallest available) | -27.8% minimum, a clear miss regardless |

One of the three posts was generated on the old `llama-3.3-70b-versatile`
model roughly a minute before Groq's deprecation cutover that broke it
app-wide (fixed in an earlier session) — two other attempts in the same
window failed outright with `404 model_not_found` before the third
succeeded, direct evidence of mid-migration instability affecting a real
generation that day.

## 2. Blog UI: read-only or editable?

Two separate surfaces, with inconsistent capability:

**`components/generate/BlogPostGenerator.tsx`** (right after generation) —
has a client-side-only editor (`BlogPostEditor`, editable title
input/body textarea/meta_description input) toggled by an "Edit this post"
button. **It has no save path.** The only network write in this component
is a rating `PUT` (`user_rating` only) — the server's `PUT` handler
(`app/api/v1/brands/[brandId]/blog-posts/[postId]/route.ts:9-12`) only
accepts `{ user_rating, is_saved }` at the schema level; title/body/meta
edits exist only in React state and are lost on navigation or refresh
unless the user copies the text out manually.

The "Regenerate" button calls the same `generate()` function as the
initial generation — a **full regeneration that inserts a brand-new row**,
not a re-save of the existing one. The original row is untouched.

**`app/(dashboard)/brands/[brandId]/library/page.tsx`** (saved-posts
library) — **purely read-only**: truncated title/body preview, a star
rating control, and a copy button. No edit affordance, no detail/full-view
page exists elsewhere in the app (confirmed via repo-wide grep).

**Net finding: there is no working inline-edit-and-save capability for
blog posts anywhere in the app today** — the only edit UI that exists is
disconnected from persistence.

## 3. Real quality issues (from the 3 real posts)

- **Templated, near-identical closing CTAs across all three posts**
  despite different brands — same "rhetorical question → get started free
  → restated benefit" shape every time.
- **Generic "In today's X landscape" / listicle-intro openers** in two of
  three posts, despite the system prompt explicitly banning fluffy
  openings.
- **Weak title**: one post's title is literally "Reddit Strategy" — two
  words, no SEO specificity, despite the prompt requiring an
  "SEO-friendly, compelling, under 70 characters" title. Quality is
  inconsistent across generations of the same feature.
- **Formatting defect in the older-model post**: subheadings render with a
  stray trailing comma and leading whitespace (e.g. `"Understanding
  Reddit,\n   Reddit is a platform..."`), visually indistinguishable from
  body prose since the UI renders `body` as one unstyled
  `whitespace-pre-wrap` block.
- **Word-count misses** — see §1; one post undershoots even the smallest
  UI preset by ~28%, unprovable against a specific target since the
  target itself isn't stored.
- All three sample posts are about "SocioPosts" itself rather than a real
  external customer brand — likely internal test generations, small
  sample size (n=3), worth keeping in mind when weighing these findings.

## 4. Storage format: partial-edit-capable or not?

`body` is a single `TEXT NOT NULL` column
(`supabase/migrations/021_blog_posts.sql`) — no structured JSON/section
representation exists (contrast `email_sequences.emails: Json` in the same
schema, which *is* structured). The model is instructed to produce
structure only as plain-text lines separated by `\n\n` inside that one
string — subheadings have no schema-level marker distinguishing them from
paragraphs, which is exactly why the comma-suffixed pseudo-headings above
render as a formatting glitch rather than a real heading.

**Factually**: the current schema only supports treating `body` as one
opaque string. Any paragraph/section-level editing would require
parsing/re-serializing that free-text blob (client- or server-side) since
the database carries no structural boundaries to address independently.

No changes made. Full methodology available on request.
