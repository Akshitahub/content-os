# Create Post AI Imagery — Diagnosis

Diagnosis-only, 2026-08-18. No code changes made.

**Important context found during this diagnosis**: two prior fix commits
already target these exact three symptoms — `b23519a` ("Fix post-image
text cropping, Flux blur, silent photo failures, timeouts") and `44f6d3c`
("Fix Flux 2 Pro resolution param and brand-color prompt fidelity"). This
diagnosis is against the **post-fix** state of the code — it reports what
those fixes left unaddressed, not the original bugs they already closed.

**Production context**: queried the live DB directly — all 13 users in
production are on the `free` plan, zero paid accounts exist.
`resolveImageProvider()` only ever routes Flux to paid plans or the
internal-unlimited bypass, so **every real post_image ever logged in
production was actually generated via Pollinations, never Flux** (the
internal-unlimited bypass account's actual usage couldn't be confirmed —
its env var value isn't readable from this environment). This matters a
lot for issue 2 below.

## Issue 1: Text cropping

**Root cause (HIGH confidence): the auto-fit loop only bounds text-block
*height*, never the rendered *width* of a wrapped line — and CTA text is
never run through fit/wrap logic at all in any of the 4 templates.**

The originally-suspected cause (compositor assuming a fixed canvas that
mismatches what Flux/Pollinations actually returned) is **ruled out** —
`compositePostImage` force-normalizes the base image via
`sharp(buffer).resize(1080, 1080, {fit:"cover"})` before compositing, and
the SVG overlay is always built at a fixed `1080×1080` viewport, so canvas
and text-layout math are always in agreement regardless of what resolution
the provider actually delivered.

What IS still live: `fitText`'s only exit condition is total block height.
`wrapTextByWidth` wraps by real glyph width per word, but a single word
that alone exceeds the max width is never split or shrunk — it becomes its
own (overflowing) line. If that line's *height* still fits the budget,
`fitText` returns immediately without ever checking that line's rendered
*width* against the box — anything painted outside the SVG's 0-1080 range
is simply not rendered by resvg, i.e. cropped. Reproduces for a headline
typed as one long word/hashtag/URL, or non-whitespace-delimited scripts
(CJK, Thai) — headlines allow up to 120 chars with no minimum word count.

More consistently reproducible: **CTA text has no width-fitting logic in
any template.** `bold_statement`'s pill background width is a
character-count heuristic (`120 + ctaText.length * 20`, capped at 700px,
not real measurement); the other three templates (`product_focus`,
`quote_card`, `minimal`) render CTA text at a fixed 32-34px with no width
bound at all, anchored to grow left or right off a fixed point. CTA text
is validated up to 60 characters — anywhere near that length will readily
overflow the canvas edge or its own background pill.

## Issue 2: Blurry/fake-looking images

**Root cause: structurally, the posts prompt has no negative/anti-artifact
language anywhere — and the resolution/blur theory doesn't fit the actual
production data, since no paying customer's request has ever gone through
Flux.**

The built prompt (`PHOTOGRAPHY_STYLE` + niche setting + audience +
`IMAGE_QUALITY_SAFETY_BOILERPLATE`) has real structural weaknesses:
1. **No negative-artifact language at all** — nothing instructs against
   the standard AI-photo tells (not a 3D render, not CGI, not
   illustration, avoid airbrushed/over-smoothed skin, avoid plastic
   texture). This is the clearest, most fixable gap for a "looks fake"
   complaint, and it's absent from every prompt this pipeline builds.
2. **No dedicated negative-prompt API field is used** — all "avoid"
   language, such as it exists, is folded into the same positive-prompt
   string rather than a separate channel (a weaker signal for diffusion
   models generally).
3. **Redundancy and generic superlatives** — "professional photography"
   appears twice; boilerplate like "8K ultra HD, sharp focus" has no
   concrete photography-technical grounding (lens/aperture/lighting
   direction) that would push toward a specific look rather than a
   generic stock-photo default.
4. **Prompt length is currently safe** (~889 raw chars / ~1210 URL-encoded
   in a representative case, under typical URL limits) but uncapped as a
   combined total, so an unusually long LLM-generated `imagePrompt` plus a
   long `targetAudience` string could push closer to that ceiling.

**On resolution specifically**: the earlier `resolution` param fix is
correct (`"2 MP"` for the 1080×1080 target) but is **very unlikely to
explain any blurriness reported so far**, since every logged production
image used Pollinations (requested at native 1080×1080, no upscale
needed), not Flux. This is a Pollinations/prompt-content issue, not a
resolution issue, for every user who has actually used this feature to
date. **Confidence: MEDIUM** on the negative-prompt gap being the primary
driver (can't rule in/out magnitude without a real generation to compare,
out of scope for diagnosis); **HIGH** confidence that the Flux-resolution
angle doesn't explain production blurriness to date.

## Issue 3: Flat-color fallback triggering too often

**Root cause: cannot be pinned to threshold miscalibration with the
evidence available.** `checkImageQuality`'s near-black (`≤8`) / near-blank
(`≥247`) thresholds are **fully shared, byte-identical code** across
posts, carousel, and story — both other pipelines import
`fetchBackgroundImage` from the same file with no override. So per the
task's own framing, any surface-specific difference isn't in the check
itself.

Retry budget: first attempt, one retry with a fallback prompt + new seed,
and — only if the original provider was `flux` — a third, last-resort
Pollinations attempt. **Since production is 100% free-plan, the effective
retry budget for every current real user is 2 attempts, not 3** — the
Flux-to-Pollinations safety net literally cannot fire for anyone in
production right now.

Structurally, posts' prompts skew toward bright/minimal settings (e.g.
"clean minimalist beauty studio setting, soft diffused lighting..." plus
the pipeline's own "leave the lower third simpler for text overlay")
that push toward large plain light-colored regions — the side that risks
tripping the *near-blank* (247) threshold, not the near-black (8) side the
issue's framing suggested. Carousel/story's varied abstract vibes aren't
obviously safer, but posts' consistent "minimalist/clean/less busy"
language is a more consistent push toward one extreme than carousel/story.
That said, 247/8 are extreme values on a 0-255 scale — genuinely tripping
this requires a frame that's almost uniformly near-white or near-black,
closer to an actual blank/refusal image than a stylistically light photo,
so the threshold itself can't be confidently called miscalibrated from
code alone.

**Direct DB evidence**: `ai_generation_logs` for `feature = "post_image"`
shows 5/5 success, 0 failures in available data (small sample — the
feature's entire history). No evidence of the check tripping at the
top-level outcome for posts specifically; the one real failure found in
this feature family was an unrelated Pollinations 429 rate-limit on a
story background. **This data doesn't support "triggers too often" as
currently observed** — but the logging is too coarse to be conclusive:
`ai_generation_logs`/`generated_images` only record the outcome of the
whole call, not each internal sub-attempt, so a moderate silent-retry rate
inside `fetchBackgroundImage` would be invisible in the DB entirely.

**Related observability gap**: `generatePostImage`'s return type drops the
`provider` field that `fetchBackgroundImage` actually returns —
`generated_images.model_used` is hardcoded to a constant
(`"flux+resvg-composite"`) regardless of which provider actually produced
the image. **It's currently impossible to answer "how often does the
Flux→Pollinations fallback fire" from the data at all**, for any future
paid customer — worth fixing as its own small change regardless of what
else gets done here, since it blocks measuring this exact question going
forward.

**Confidence: LOW-MEDIUM overall.** Can rule out per-surface threshold
differences (there are none) and rule out "Flux failing is dragging paid
users onto a worse fallback" (no paid traffic has ever existed). Can't
currently distinguish between: the near-blank check over-triggering on
legitimate bright product photography, the 2-attempt retry budget being
thin, or Pollinations' own rate-limiting being the dominant cause. Raising
confidence further needs either real server-log access (the relevant
`console.error` lines exist but weren't accessible here) or persisting
per-attempt outcome data going forward.

No changes made. Full methodology available on request.
