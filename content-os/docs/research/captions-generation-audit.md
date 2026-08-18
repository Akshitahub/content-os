# Captions Generation — Audit

Audit-only, 2026-08-18. No prompt or code changes made — this documents what
`lib/ai/captions-generator.ts` actually sends to Groq today and how real
output compares against its own stated rules, so a fix can be scoped
deliberately.

## 1. Exact current prompt

**Call site**: `lib/ai/captions-generator.ts:20-38`.
**Model/params**: `openai/gpt-oss-120b`, `temperature: 0.8`,
`reasoning_effort: "low"`, `max_tokens: 1200`, `response_format: json_object`.
A code comment already documents that this model burns a large share of
`max_tokens` on hidden reasoning even at `"low"` (measured 64% in one
sample) — an active constraint on how much budget is left for the caption
itself.

**System prompt** (`buildCaptionSystemPrompt()`, called with no argument, so
`includeImagePrompt` is always `false` for this pipeline):

```
You are an expert social media copywriter for Indian D2C brands. You write captions that convert — not just get likes.

CAPTION STRUCTURE (follow this every time):
1. Hook line — restate or evolve the opening hook (1 punchy line), SPECIFIC to this brand/topic — never a generic template opener

GOOD hook lines (study these):
✓ "Your skin is lying to you."
✓ "Nobody talks about this beauty mistake."
✓ "Stop searching. You found it."

BAD hook lines (never write these):
✗ "Are you tired of dull skin?"
✗ "Introducing our newest collection!"
✗ "Shop now and save 20%!"

2. Story or value — 2-4 lines building connection, value, or relatability
3. CTA line — one clear action (always ends with brand's CTA phrase + @handle)
4. [blank line]
5. [blank line]
6. Hashtags — 15-20 tags using the 5+5+5 method below

NEVER OPEN A CAPTION WITH:
- "Are you tired of..."
- "Introducing..."
- "In today's fast-paced world..."
- "Let's talk about..."
These read as generic AI filler, not a real hook.

HASHTAG STRATEGY — 5+5+5 RULE:
- 5 niche-specific (medium competition, 100K–2M posts)
- 5 brand/product-specific (low competition, unique to brand)
- 5 broad/trending (high volume, 5M+ posts)

VIBE MATCHING:
- Educational / Entertaining / Inspirational / Sales / Community — each with example openers

MANDATORY: The last 1-2 lines of caption_text MUST be the brand's CTA phrase followed by @handle on a new line.

QUALITY STANDARD (QUALITY_BAR, shared boilerplate) — sound like a skilled
human copywriter, be specific to the brand, have a clear emotional angle,
avoid corporate jargon, match tone_of_voice exactly, never mention
third-party platforms, never fabricate a real person's endorsement.

Always respond with valid JSON only. No markdown, no explanation.
```

**User prompt** (`buildCaptionUserPrompt`, `lib/ai/prompts.ts:230-289`):

```
[brand context block][past-examples block, usually empty — see §3]
Platform: {platform} — {platform-specific char/format rules}
Content type: {contentType}
{"Opening hook to use: ..." or "Create your own strong opening"}
{additional context, if any}

Write a complete social media caption following the brand voice exactly.

CRITICAL — the last 2 lines of caption_text MUST be exactly:
"{ctaPhrase} 👇\n@{handle}"
This is non-negotiable. Do not forget the @handle.

Respond with this exact JSON:
{ "caption_text": "...", "hashtags": [...15 items...], "cta": "...", "character_count": 123 }
```

**Post-processing** (`captions-generator.ts:40-59`): strips markdown fences
and control characters, extracts the first `{...}` block via regex,
`JSON.parse`s it, and only validates that `caption_text` is non-empty —
`hashtags` array length, `cta`, and the mandated ending are never checked.
`character_count` is always overwritten with `caption_text.length`,
discarding whatever the model produced for that field.

## 2. Real output quality (live data)

21 rows total in `captions`. 8 of the 10 most recent rows come from this
pipeline (identifiable by populated `platform`/`cta`/`character_count`); 2
come from a different, ad-hoc route (`generate-occasion-content`) that
writes into the same table with a different shape.

**Checked against the prompt's own rules, 8/8 sampled rows:**
- **Hashtag count: 8/8 violate.** Every sample returned exactly 5 hashtags,
  never the mandated 15-20 (5+5+5), despite that instruction appearing
  three separate times in the prompt.
- **Mandatory CTA+handle ending: 8/8 violate.** Not one caption ends with
  the brand's `cta_phrase` + `@handle` as required — real endings are
  generic sign-offs unrelated to the brand's actual CTA.
- Hashtag formatting is inconsistent between brands (some `#`-prefixed,
  some not).
- The banned-openers rule ("NEVER OPEN A CAPTION WITH...") **is** respected
  in every sample — the one rule with concrete examples is the one rule
  that's actually followed.

**Observability gap found**: zero rows in `ai_generation_logs` have
`feature = "captions"`, despite the route writing that value on both
success and failure paths. Flagged, not diagnosed further — could be a
logging bug or an RLS/insert issue.

## 3. Brand context: used vs. available-but-unused

**Used**: `name`, `description`, `niche`, `target_audience`,
`tone_of_voice`, `brand_values`, `instagram_handle`, `ai_persona`,
`brand_personality`, `target_emotion`, `cta_phrase`, `content_pillars`, plus
product `name`/`description`/`key_benefits`/`target_customer`/`price`/`ingredients`.

**Exists in the data model, never referenced in any caption prompt:**
- **`vibe`** (e.g. `"fun_playful"`, `"professional"`) — the system prompt
  has a whole "VIBE MATCHING" section the model has to infer from
  `tone_of_voice` alone, when the brand's own `vibe` field could drive it
  directly. Likely the single most actionable unused field.
- **`competitors`** — brand differentiation is a stated goal, but nothing
  tells the model who *not* to sound like.
- `product.category` — minor; `niche` often already implies it.
- `color_palette`/`primary_color`/`logo_url`/`website_url`/`onboarding_type`/
  `posting_frequency`/`target_platforms` — not plausibly relevant to text
  generation, or redundant with per-call parameters already passed in.

**Past-examples few-shot mechanism**: wired in correctly (route fetches up
to 5 of the brand's own captions rated ≥4 and passes them through), but
**dormant in production** — 0 of 21 rows in `captions` have any
`user_rating` set at all, so this has never actually fired for a real
generation.

## 4. Concrete prompt-design issues

1. **Contradiction on where hashtags belong.** The system prompt's
   numbered structure lists hashtags as step 6 of `caption_text` itself;
   the JSON schema treats `hashtags` as a fully separate array with no
   instruction to also embed them in the text. Real output is
   inconsistent as a direct result — some captions never include hashtags
   in the text, one sampled row embeds one hashtag inline that isn't even
   in the separate array.
2. **The 15-20/5+5+5 hashtag rule is stated three times, followed zero
   times** in the sample. Repetition isn't enforcement — `response_format`
   only guarantees valid JSON syntax, not that an array-length instruction
   in prose was honored, and there's no post-hoc length check.
3. **The "MANDATORY"/"non-negotiable" CTA-ending rule is asserted with the
   heaviest emphasis in the whole prompt and violated 100% of the time**
   in the sample — same root problem: no structural enforcement.
4. **`character_count` is requested from the model, then always discarded**
   and recomputed — wasted generation effort every call.
5. **No brand-specific negative examples.** The GOOD/BAD hook examples are
   hardcoded and skincare-flavored regardless of brand niche — a furniture
   brand gets the same beauty-flavored examples. The one mechanism that
   could supply brand-specific contrast (past examples) has never fired
   (see §3).
6. **No emoji policy for captions**, unlike the hook prompt (which
   explicitly bans emojis). The JSON schema example hardcodes 👇 in the
   CTA line, silently making that the only de facto emoji rule regardless
   of a brand's actual tone.
7. **"Avoid cliché marketing phrases" with zero examples of what counts as
   cliché** — contrast with the hook prompt's much more concrete,
   example-driven style.
8. **Platform character-count rules are asserted but never enforced** —
   `platformRules` states hard caps (e.g. Twitter 280 chars) but
   `captions-generator.ts` never checks the actual output length against
   them.
9. **Stale hardcoded model name in the failure-log path**
   (`app/api/v1/ai/captions/generate/route.ts:90`: `model:
   "meta/llama-3.1-70b-instruct"`) — doesn't match `MODELS.generation` or
   even the pre-migration model. Any failed generation misreports which
   model actually failed.

No changes made. Full methodology available on request.
