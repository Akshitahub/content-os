# Seedream 5.0 Lite Evaluation

Research task, 2026-08-17. No production code was changed as part of this
work — this is purely a pricing/quality/feasibility writeup to inform a
future decision.

## TL;DR

- Seedream 5.0 Lite **is** available on Replicate (`bytedance/seedream-5-lite`,
  official model) — not Fal-only. Swapping to it is a normal `replicate.run()`
  call site, same shape as the existing Flux integration. No new provider
  integration needed.
- **Pricing is flat and confirmed all-inclusive**: $0.035/image, regardless of
  resolution (2K/3K) or whether the model's "reasoning" kicks in. There is
  **no GPT-OSS-style hidden token cost** — Replicate's own billing config for
  this model has exactly one price line item.
- Flux 2 Pro's real cost is currently **ambiguous** because of a bug I found
  while verifying pricing (see "Important side-finding" below) — it's either
  ~$0.03/image or $0.045–$0.075/image depending on which of two possible
  runtime behaviors is actually happening. This needs to be resolved with
  real Replicate access before any cost comparison can be called final.
- **I could not run real Seedream or Flux generations** — this dev
  environment has no `REPLICATE_API_TOKEN` (confirmed absent from
  `.env.local`) and no Fal or other Seedream-provider key exists either. All
  pricing/schema findings below are verified from Replicate's own site data;
  all quality findings are limited to the current free-tier Pollinations
  path, which I *could* test for real. **The head-to-head visual quality
  comparison this task asked for is blocked** until someone runs it with a
  funded Replicate token — real cost, ~$0.035–$0.075 per test image on
  either model.

---

## Part 1 — Pricing (verified against Replicate directly)

Both model pages are client-rendered, so the pricing widget doesn't show up
in a normal fetch — I pulled the embedded JSON (`billingConfig`) out of the
raw page HTML instead of trusting a summary page.

### Seedream 5.0 Lite — `bytedance/seedream-5-lite`

```json
"billingConfig": {
  "current_tiers": [{
    "prices": [{
      "metric": "image_output_count",
      "metric_display": "output image",
      "price": "$0.035",
      "title": "per output image",
      "type": "per-unit"
    }]
  }]
}
```

One line item. **$0.035 per output image, flat**, regardless of `size`
(2K/3K) or aspect ratio. Official model, confirmed live on Replicate at
<https://replicate.com/bytedance/seedream-5-lite>.

### Flux 2 Pro — `black-forest-labs/flux-2-pro` (what we use today)

```json
"billingConfig": {
  "current_tiers": [{
    "prices": [
      { "metric": "run_count", "price": "$0.015", "title": "per run", "type": "fixed" },
      { "metric": "image_input_megapixel_count", "price": "$0.015", "title": "per input image megapixel", "type": "per-unit" },
      { "metric": "image_output_megapixel_count", "price": "$0.015", "title": "per output image megapixel", "type": "per-unit" }
    ]
  }]
}
```

$0.015 base + $0.015/output megapixel (input-megapixel line doesn't apply —
`fetchBackgroundImage` is text-to-image, no reference image). So cost scales
with resolution, unlike Seedream's flat price.

### Cost comparison — this is where it gets complicated

`lib/ai/post-image-pipeline.ts` calls Flux with a `megapixels` input param,
picking a tier from `[0.25, 0.5, 1, 2, 4]` to avoid undersizing the image
(the code comment explains this was written specifically to fix an earlier
blur/upscale bug). **While verifying this, I found that param no longer
matches Flux 2 Pro's live schema:**

```json
"resolution": {
  "enum": ["match_input_image", "0.5 MP", "1 MP", "2 MP", "4 MP"],
  "default": "1 MP"
}
```

The real input field is called `resolution`, takes values like `"2 MP"` (not
a bare number), and there's no `0.25 MP` tier at all. The code passes
`megapixels: "2"` — a field name and value format that don't exist in the
current schema. (`aspect_ratio` and `output_format`, the other two params
the code sends, are still valid as-is.)

I don't have Replicate access to confirm which of two things happens next:

- **If Replicate silently drops the unrecognized `megapixels` field** (common
  for Cog/pydantic models — unknown keys often get ignored rather than
  rejected): every Flux call actually runs at the schema's default,
  `resolution: "1 MP"`, regardless of what the code intended. Real cost
  becomes **$0.015 + $0.015×1 = $0.03/image** — which happens to match this
  task's original assumption. But it also means the original blur/upscale
  bug this code was written to fix (Flux defaulting to ~1MP, smaller than
  the 1080×1080/1080×1920 compositing targets) **may still be live in
  production today**, silently forcing an upscale on every paid-tier image.
- **If Replicate validates strictly and 422s on the unknown field**: every
  Flux call would be failing outright, and `fetchBackgroundImage`'s
  Flux-fails-twice fallback would be silently routing every paid-tier user
  to Pollinations — meaning Starter+ customers could be getting free-tier
  image quality without anyone knowing, while still being told they're on
  Flux 2 Pro.

I'm flagging this because it directly undermines the "what do we pay today"
half of this cost comparison, and it needs its own investigation with real
Replicate credentials — separate from the Seedream decision. **I did not
touch this code**, per the task's instructions.

Taking the two scenarios at face value:

| | Seedream 5.0 Lite | Flux 2 Pro (as coded, `resolution` ignored → 1MP default) | Flux 2 Pro (as coded, if intended 2MP/4MP tiers actually applied) |
|---|---|---|---|
| Square (1080×1080) | $0.035 flat | ~$0.03 | $0.045 (2MP tier) |
| Portrait (1080×1920) | $0.035 flat | ~$0.03 | $0.075 (4MP tier) |

Seedream is priced **between** the two possible real Flux costs for square
images, and is **cheaper than the "intended" Flux tier for portrait** (which
is exactly the Stories use case). It is **not** a clear win on cost alone
until the Flux ambiguity above is resolved — but it is never dramatically
more expensive either way, and its flat pricing removes the whole
megapixel-tier guessing game this app currently has to do.

### Chain-of-Thought Visual Reasoning — cost question, answered

No hidden cost. Seedream's `billingConfig` has exactly one price line item
(`per output image`, flat). Its input schema (pulled from the same page,
below) has no `reasoning_effort`, `thinking_budget`, or similar toggle — the
"built-in reasoning" is baked into inference, not a caller-controlled,
separately-billed parameter. This is a real, structural difference from the
GPT-OSS reasoning-token situation, not just "hasn't shown up in testing yet."

---

## Part 2 — Cost-surface test (carousel/story/post backgrounds)

**Blocked on missing Replicate credentials** — could not generate through
either Seedream or Flux 2 Pro. What I *did* verify:

### Aspect ratio / resolution params — Seedream has what we need

Pulled directly from the model's live OpenAPI schema on Replicate:

```json
"aspect_ratio": { "enum": ["match_input_image","1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"], "default": "match_input_image" },
"size": { "enum": ["2K", "3K"], "default": "2K" }
```

`1:1` covers carousel/post's square target exactly; `9:16` covers
Stories' 1080×1920 exactly (1080:1920 reduces to precisely 9:16). `size:
"2K"` (2048px base) already exceeds both targets, so no upscaling risk —
unlike Flux's current 1MP-default situation above. This is a direct
parameter-name match for both of this app's canvas shapes, no math needed.

### Real prompts pulled from production (not invented)

Reconstructed `buildSlidePrompt()`/`buildStorySlidePrompt()` from
`lib/ai/carousel-slide-background.ts` / `lib/ai/story-slide-background.ts`
verbatim, fed with real headline text pulled from the `carousels`/`stories`
tables and real brand `primary_color` values pulled from the `brands` table
(not fabricated):

```
[carousel, vibe=fun_playful, headline="Elevate Your Elegance", brand has no color_palette set → falls back to VIBE_FALLBACK_COLORS]
abstract atmospheric background image for a social media carousel slide, vibrant abstract
gradient background with playful organic blob shapes, bright energetic color transitions,
soft glowing light, evokes the mood of: "Elevate Your Elegance", no text, no words, no
letters, no numbers, no logos anywhere in the image, no literal photos of people, products,
or objects — purely abstract shapes, gradients, and textures, leave calm, uncluttered
negative space so text stays readable when overlaid on top, no watermarks, no illegible
text or symbols, clean high-resolution render, sharp focus

[carousel, vibe=clean_minimal, headline="30 AI-Generated Hooks to Skyrocket Your IG Engagement", real primary_color #FF5733]
...color palette centered around #FF5733, evokes the mood of: "30 AI-Generated Hooks..."...

[story, vibe=fun_playful, text="Make it Yours Tonight!", real primary_color #FF5A5F]
abstract atmospheric vertical background image for a full-screen phone story slide, vibrant
abstract gradient background with playful organic blob shapes..., color palette centered
around #FF5A5F, evokes the mood of: "Make it Yours Tonight!"...
```

I ran these through the **current** free-tier path (Pollinations) since
that requires no credentials, to at least document today's baseline. Real
observations from the output (not benchmark claims):

- **Composition is genuinely good for this use case** — soft radial
  gradients with real negative space, nothing fighting with where text would
  sit on top. The abstract-only instruction is being followed well.
  However, the fun_playful carousel example shows a **visible mirror-symmetry
  artifact** — a hard vertical seam where the left half of the image is a
  near-mirror of the right (different colors, same blob shape) — a real
  diffusion-tiling artifact that would look like an obvious rendering bug
  behind live text, not stylistic.
- **Brand color instructions are being ignored.** Both test images asked for
  a specific hex (`#FF5733` orange-red, `#FF5A5F` coral) in the prompt, and
  neither output contains that color anywhere — one rendered blue/pink/white,
  the other purple/teal. This isn't a one-off; it happened on both of the two
  color-specified tests I ran. If Seedream's "deep domain knowledge"/
  reasoning is genuinely better at following explicit color instructions,
  that's the single most valuable thing to verify first, since it's a
  repeated, concrete failure of the current path — not a vague quality gap.
- Portrait output was correctly 1080×1920 with no distortion or letterboxing.

I cannot say whether Seedream does better or worse on any of this — that
comparison needs a real API call I don't have credentials for.

---

## Part 3 — Quality-surface test (memes and Ad Maker)

### Confirmed: both are unconditionally free today, no plan check

- **`app/api/v1/ai/meme/generate/route.ts`** — calls
  `image.pollinations.ai/prompt/...&model=flux` directly (line ~145). No
  branch on `plan` or `isInternalUnlimitedUser` anywhere in the file — every
  user, every tier, gets Pollinations. Confirmed by re-reading the full
  route. (The file also has a code comment from a prior investigation
  confirming Pollinations' own `nanobanana`/`seedream` model aliases 500 with
  "only available on enter.pollinations.ai" — that's Pollinations' *own*
  Seedream alias, a dead end. It says nothing about Seedream via Replicate,
  which is a completely separate, working path — not the same blocker.)
- **`components/generate/AdMaker.tsx`** — `getBackgroundUrl()` (line ~87)
  builds a Pollinations URL client-side directly, no server route in the
  loop for the background at all. Also always free, every tier.

So switching either to Seedream is a **free → paid** change for 100% of
current users, not a tier-gated one. That tradeoff is real regardless of how
the quality comparison turns out — flagging it explicitly, not folding it
into a "just use the better model" recommendation.

### Real prompts pulled from production (not invented)

**Meme**: took a real `idea` from the `memes` table —
`"When your friend says 'I'll just buy a plain mug', but you order a custom
'I'm the boss' mug from TheYaYaCafe"` — and ran it through the actual Groq
concept-generation call (`buildMemeConceptSystemPrompt`/
`buildMemeConceptUserPrompt`, same model/params as production:
`openai/gpt-oss-120b`, `reasoning_effort: "low"`) to get a real
`image_prompt`, then built the exact Pollinations URL the route builds.
Real generated `image_prompt`:

> A bright kitchen table with two friends sitting across from each other.
> One friend holds a plain white mug, looking confused, while the other
> friend triumphantly holds a colorful mug with a bold "I'M THE BOSS"
> design... Warm natural lighting, cozy home décor background.

Real observations from the output:
- Facial expressions actually came out well — natural, readable smiles, not
  distorted. The "exaggerated expression" instruction is working.
- **The named trouble spot is confirmed live**: at the point where the two
  figures' hands meet near the mug, fingers are visibly fused/malformed —
  the classic diffusion hand artifact the prompt's own defensive language
  ("anatomically correct features, correct number of fingers and limbs") is
  trying and failing to prevent.
- **A separate, arguably worse failure**: the "colorful mug with a bold
  design" the prompt explicitly asked for isn't a mug at all in the output —
  it rendered as a small pink handheld object with no legible design. Prompt
  instructions around specific held objects aren't being followed reliably,
  independent of the hands issue.

**Ad Maker**: took two real `SCENE_PROMPTS` entries (`marble_surface`,
`cozy_cafe`) with real brand niches (`"Jewellery"`, `"Personalised gift &
home decor"`), built the exact prompt `getBackgroundUrl()` builds:

> white marble surface, soft window light, minimal aesthetic, luxury
> lifestyle photography, elegant, Jewellery brand, no people, no text, no
> watermarks, no logos, photorealistic, 8K

Real observations: both came out **notably better than the abstract
carousel/story backgrounds** — coherent room geometry, correct perspective,
believable materials (marble veining, wood grain), no people (as
instructed) so no hand/anatomy risk on this surface at all. Ad Maker's use
case is closer to what Pollinations' underlying model is already good at
(literal photographic scenes) than the abstract gradients carousel/story
need.

### What I can't tell you

Whether Seedream handles the meme hand/object-fidelity problem or Ad Maker's
photorealism better, worse, or the same — that requires the actual
head-to-head generation this task asked for, and I don't have a way to run
it here.

---

## What's needed to finish this evaluation

1. A funded `REPLICATE_API_TOKEN` in an environment with real billing (even
   a small pre-paid balance covers this — at $0.035–$0.075/image, 20 test
   images across both models is under $3).
2. With that token: re-run the exact prompts logged above (all pulled
   verbatim from real production data) through both
   `bytedance/seedream-5-lite` and `black-forest-labs/flux-2-pro`, and do
   the visual side-by-side this task actually asked for — brand-color
   fidelity, the mirror-symmetry artifact, meme hands/object fidelity, and
   Ad Maker photorealism are the four concrete things to check first, since
   they're the four repeatable failure modes I found in the current
   baseline.
3. Separately (not a Seedream question at all): confirm whether Flux 2
   Pro's `megapixels` param is being silently ignored or causing silent
   Pollinations fallback for paid users — this affects both the real cost
   number and whether paid customers are currently getting what they're
   paying for.

No production code was changed in this investigation.
