"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Sparkles, RefreshCw, Copy, Check, Download, Archive, Loader2, AlertCircle, Heart, MessageCircle, Send } from "lucide-react"
import { ScheduleAction } from "@/components/shared/ScheduleAction"
import { CriticPanel } from "@/components/shared/CriticPanel"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { GeneratingState } from "@/components/shared/GeneratingState"
import { UsageLimitBanner } from "@/components/generate/UsageLimitBanner"
import { DEFAULT_POST_TEMPLATE_ID } from "@/lib/design/post-templates"
import type { PostTemplateId } from "@/lib/design/post-templates"
import { autoPickColorTheme, resolveColorThemes } from "@/lib/design/color-themes"
import { useGenerateFullPost, useGeneratePostImage } from "@/hooks/useGeneration"
import { POST as POST_CREDIT_COST } from "@/lib/usage/credit-costs"
import { useGenerationStore } from "@/stores/generationStore"
import { usePromptWriter } from "@/hooks/usePromptWriter"
import { PromptWriterField } from "@/components/generate/PromptWriterField"
import { useBrand } from "@/hooks/useBrand"
import { flattenOverlayImage, overlayScrimStops, type OverlayLayout } from "@/lib/utils/post-overlay-export"
import type { TextStyle } from "@/lib/design/text-style"
import { resolveFonts, resolveSuggestedFont, DEFAULT_FONT_ID, type FontId } from "@/lib/design/fonts"
import { PREVIEW_FONT_CLASS } from "@/lib/design/preview-fonts"
import type { FullPostResult, ContentResult } from "@/hooks/useGeneration"
import type { ProductRow } from "@/types/database"
import type { GeneratedHook, GeneratedCaption, ReelScript, CarouselContent, BlogPost, AdCopy } from "@/types/app"
import { pickTextLayout, type TextLayoutId } from "@/lib/design/text-layouts"
import { TextLayoutPicker } from "@/components/shared/TextLayoutPicker"
import { defaultBodyFont } from "@/lib/design/fonts"
import { initialPostDesign, postDesignLooks, type PostDesign } from "@/lib/design/post-design-fields"
import { readJsonResponse } from "@/lib/utils/read-json-response"
import { isApiError } from "@/types/api"

type ContentAngle = "auto" | "problem_solution" | "quick_tip" | "myth_contrarian" | "launch_offer"

const ANGLE_OPTIONS: { value: ContentAngle; label: string }[] = [
  { value: "auto", label: "Let SocioPosts decide" },
  { value: "problem_solution", label: "Problem & solution" },
  { value: "quick_tip", label: "Quick tip / how-to" },
  { value: "myth_contrarian", label: "Myth / contrarian" },
  { value: "launch_offer", label: "Launch / offer" },
]

// Aspect-ratio-appropriate example prompts, keyed by a few common niche
// keywords. Falls back to the existing generic placeholder when the
// brand's niche doesn't match any known category.
function topicPlaceholderForNiche(niche: string | null | undefined): string {
  const n = (niche ?? "").toLowerCase()
  if (n.includes("furniture") || n.includes("interior")) {
    return "Why solid teak wood lasts 30 years while engineered boards bend in humidity"
  }
  if (n.includes("skincare") || n.includes("beauty")) {
    return "Why applying hyaluronic acid on completely dry skin causes breakouts"
  }
  if (n.includes("fashion") || n.includes("apparel")) {
    return "How to style pure linen so it doesn't look wrinkled by noon"
  }
  return "A festive Diwali offer post for our candle brand, warm and cozy"
}

interface Props {
  brandId: string
  products: ProductRow[]
}

export function FullPostGenerator({ brandId, products }: Props) {
  const { mutate: generate, isPending, error } = useGenerateFullPost()
  const { mutate: generatePostImageMutate, isPending: imageGenerating } = useGeneratePostImage()
  const {
    fullPostResult,
    setFullPostResult,
    selectedProductId,
    setSelectedProductId,
    occasionContext,
    pendingTopic,
    setPendingTopic,
  } = useGenerationStore()
  const { data: brand } = useBrand(brandId)

  const brandName = brand?.name ?? "Brand"

  const colorThemes = useMemo(() => resolveColorThemes(brand ?? null), [brand])

  const [additionalContext, setAdditionalContext] = useState("")
  // Content angle / aspect ratio / visual style / headline overlay — new
  // input-panel controls. Angle is sent as its own contentAngle field
  // (see handleGenerate below); the fullpost/generate route folds it into
  // the actual prompt server-side now (ANGLE_HINT there). aspectRatio and
  // visualStyle are both wired into generatePostImageMutate (see
  // runImageGeneration) -- aspectRatio honored fully when there's no text
  // overlay, and silently ignored (stays 4:5) when there is one, since
  // compositePostImage's SVG templates use fixed pixel anchors tuned for
  // the 1080x1350 canvas (see post-image-pipeline.ts's generatePostImage).
  // The headline overlay field remains UI-only pending the
  // overlay-decoupling commit.
  const [contentAngle, setContentAngle] = useState<ContentAngle>("auto")
  const [aspectRatio, setAspectRatio] = useState<"4:5" | "1:1" | "9:16">("4:5")
  const [visualStyle, setVisualStyle] = useState<"studio_scene" | "editorial_graphic">("editorial_graphic")
  const [headlineOverlay, setHeadlineOverlay] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  // Layout / color no longer have their own pickers — the caption Groq call
  // decides layout and color theme (see suggested_template/
  // suggested_color_theme_id on GeneratedCaption). selectedLayout stays as
  // a fixed default, used only as a fallback in runImageGeneration if the
  // model ever omits suggested_template. selectedFontId/textSizeScale were
  // removed in Commit 3 — the headline overlay is no longer sent to (or
  // rendered by) the image route at all, so there's nothing left for a
  // server-side font/size to apply to.
  const selectedLayout: PostTemplateId = DEFAULT_POST_TEMPLATE_ID
  const selectedColorThemeId = ""
  const [postImageUrl, setPostImageUrl] = useState<string | null>(null)
  // From the post-image response: scrim/backing for the overlay headline
  // (preview and flattenOverlayImage use the same values).
  const [postTextStyle, setPostTextStyle] = useState<TextStyle | null>(null)
  // Content-matched layout for the overlay headline (lib/design/text-layouts.ts),
  // from the caption; the user's pick (source "user") wins over the auto-pick.
  const [overlayLayout, setOverlayLayout] = useState<OverlayLayout | null>(null)
  const [imageSource, setImageSource] = useState<"ai" | null>(null)
  // Commit 3 (overlay decoupling): for the "ai" path, postImageUrl is now
  // ALWAYS the clean, text-free background — runImageGeneration below no
  // longer sends captionText to generatePostImageMutate, so
  // compositePostImage's server-side raster compositing never runs for
  // this tool anymore. The headline instead lives here, client-side, as
  // plain editable state: editing it costs no credits and calls no API,
  // it only updates this string. flattenedImageUrl (below) is the
  // client-canvas-composited result of postImageUrl + overlayText,
  // computed on demand for Download/Schedule — see flattenOverlayImage.
  const [overlayText, setOverlayText] = useState("")
  // Headline typeface: the caption call's suggested_font_id (resolved
  // server-side from the brand vibe / color theme / mood), changeable from
  // the chips under the preview. Used by both the live preview and the
  // flattened Download/Schedule image.
  const [overlayFontId, setOverlayFontId] = useState<FontId>(DEFAULT_FONT_ID)
  const [flattenedImageUrl, setFlattenedImageUrl] = useState<string | null>(null)
  // A designed post (lib/image/post-design.ts): the words drawn on the clean
  // base in the frame language, rendered on the server into
  // flattenedImageUrl. Null = the template draws its own text (checklist,
  // annotated product, blank) and the overlay editor is used instead.
  const [postDesign, setPostDesign] = useState<PostDesign | null>(null)
  const [postRenderError, setPostRenderError] = useState<string | null>(null)
  // Canvas vs. in-feed preview toggle (Commit 4) — purely a display mode,
  // doesn't touch postImageUrl/overlayText/flattenedImageUrl at all.
  const [previewMode, setPreviewMode] = useState<"canvas" | "feed">("canvas")
  const [flattening, setFlattening] = useState(false)
  // Full Post's real charge is the bundled POST cost, billed at the image
  // step (see CONTENT_FORMAT_CREDIT_COSTS' comment in
  // lib/usage/credit-costs.ts -- the text-generation step itself always
  // charges 0). null while the image step hasn't resolved yet (imageSource
  // unset), so the confirmation banner doesn't show a cost before it's known.
  const creditsUsedForResult: number | null = imageSource === "ai" ? POST_CREDIT_COST : null
  const [imageError, setImageError] = useState<string | null>(null)
  const [postSessionId, setPostSessionId] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // The SocioPosts-authored (and possibly user-edited) image prompt --
  // shown/editable in PostImagePreview's new "writing" branch below,
  // instead of the image generating automatically the instant captions
  // finish. pendingImageGen holds the FullPostResult/session an authored
  // prompt is FOR, so handleConfirmGenerateImage below knows what to
  // actually generate once the user clicks through.
  const [aiImagePrompt, setAiImagePrompt] = useState("")
  const promptWriter = usePromptWriter(setAiImagePrompt)
  const [pendingImageGen, setPendingImageGen] = useState<{ data: FullPostResult; sessionId: string } | null>(null)
  // Drives the auto-fire effect below: true means the user has either
  // edited the authored prompt themselves, or explicitly asked for a
  // rewrite -- both are a clear "let me review this" signal, so the
  // pipeline falls back to requiring the manual "Generate image" click
  // instead of running end-to-end on its own. Set fresh (false for a
  // brand-new prompt, true for a rewrite) at the start of every
  // beginImagePromptWriting call, and flipped true the moment the user
  // actually types into the field -- see the PromptWriterField onChange
  // below and beginImagePromptWriting's own comment.
  const userEditedPromptRef = useRef(false)

  // colorThemes only resolves once the brand has loaded. "Brand colours"
  // (the brand's 4-role palette) is always first and pre-selected; the
  // curated palettes are "Other options" (group "other") and are never
  // auto-picked while the brand has a palette of its own -- see
  // autoPickColorTheme, which overrides the caption model's suggestion.
  const effectiveColorThemeId = selectedColorThemeId || colorThemes[0]?.id || ""

  const runImageGeneration = useCallback((data: FullPostResult, sessionId: string, imagePromptText: string) => {
    const caption = data.content.content as GeneratedCaption
    // No client-side truncation -- the full Groq-authored prompt (up to a
    // few hundred words) is sent as-is. The server's own zod max and
    // post-image-pipeline.ts's sentence-boundary-aware safety cap are the
    // single source of truth for any length limit, so it's never enforced
    // twice with two different (and previously much shorter) values.
    const imagePrompt = imagePromptText
    // Commit 3: captionText/fontId/textSizeScale are no longer sent here —
    // the image route always returns a clean, text-free background for
    // this tool now (see generatePostImage's own !willCompositeText
    // branch, which this now always takes). The headline the user typed
    // in the left panel (or, failing that, the model's own suggestion)
    // becomes client-side overlayText state instead — see the onSuccess
    // handler below and flattenOverlayImage for how it gets composited
    // back in only when actually needed (Download/Schedule).
    const initialOverlayText = headlineOverlay.trim() || caption.suggested_overlay_text?.trim() || ""
    const initialOverlayFont = resolveSuggestedFont(caption.suggested_font_id)

    setImageError(null)
    setFlattenedImageUrl(null)
    setPostDesign(null)
    // A fresh image generation (first attempt or a regenerate) is starting
    // -- any success banner still showing from a previous image belongs to
    // a now-stale result, not this one.
    setJustSaved(false)
    // The prompt panel's job is done -- reset it to idle so
    // PostImagePreview's writing/ready branch steps aside and the normal
    // imageGenerating/postImageUrl/imageError branches render instead,
    // whether this call succeeds or fails.
    promptWriter.reset()
    generatePostImageMutate(
      {
        brandId,
        productId: selectedProductId ?? undefined,
        imagePrompt,
        template: (caption.suggested_template as PostTemplateId) || selectedLayout,
        colorThemeId: selectedColorThemeId || autoPickColorTheme(colorThemes, caption.suggested_color_theme_id || effectiveColorThemeId).id,
        captionText: undefined,
        postSessionId: sessionId,
        contentProjectId: data.contentProjectId ?? undefined,
        aspectRatio,
        visualStyle,
        // Only actually used server-side when template is
        // "hard_truth_checklist" -- see generatePostImage's own early-exit
        // branch. Harmless to always send; every other template ignores
        // them.
        checklistHeadline: caption.checklist_headline ?? undefined,
        checklistHighlightedPhrase: caption.checklist_highlighted_phrase ?? undefined,
        checklistWrongItems: caption.checklist_wrong_items ?? undefined,
        checklistRightItems: caption.checklist_right_items ?? undefined,
        checklistClosingLine: caption.checklist_closing_line ?? undefined,
        // annotated_product only (a post with a product photo) -- ignored otherwise.
        annotatedHeadline: caption.annotated_headline ?? undefined,
        annotatedKeyword: caption.annotated_keyword ?? undefined,
        annotatedCallouts: caption.annotated_callouts ?? undefined,
        visualBrief: caption.visual ?? undefined,
      },
      {
        onSuccess: (imgData) => {
          setPostImageUrl(imgData.public_url)
          setPostTextStyle(imgData.text_style ?? null)
          // A busy image moves an auto layout to one with its own backing.
          setOverlayLayout(caption.text_layout ? {
            text_layout: caption.text_layout_source === "user" || !imgData.text_style
              ? caption.text_layout
              : pickTextLayout({ format: "post", brand: { vibe: brand?.vibe }, headingFont: initialOverlayFont, visualKind: caption.visual?.kind ?? null, textStyle: imgData.text_style }),
            kicker: caption.kicker ?? null,
            highlight: caption.highlight ?? null,
            text_layout_source: caption.text_layout_source ?? "auto",
            brand_color: caption.accent_color ?? null,
          } : null)
          setImageSource("ai")
          setOverlayText(initialOverlayText)
          setOverlayFontId(initialOverlayFont)
          const design = initialPostDesign((caption.suggested_template as PostTemplateId) || selectedLayout, {
            post_big_words: caption.post_big_words,
            post_script_line: caption.post_script_line,
            fallbackWords: [headlineOverlay, caption.suggested_overlay_text, data.hook.hook_text],
            listicle_title: caption.listicle_title, listicle_count: caption.listicle_count,
            festive_occasion: caption.festive_occasion, festive_greeting: caption.festive_greeting, festive_line: caption.festive_line,
            review_quote: caption.review_quote, review_author: caption.review_author,
          })
          setPostDesign(design ? { ...design, aspect: aspectRatio } : null)
          // The image is the last piece of "the post" to finish -- this is
          // the real "done" point (and the first point creditsUsedForResult
          // is actually knowable), not right after the caption's own text
          // came back in handleGenerate below.
          setJustSaved(true)
          setTimeout(() => setJustSaved(false), 5000)
        },
        onError: (err) => {
          setImageError(err instanceof Error ? err.message : "Couldn't generate the post image. Please try again.")
        },
      }
    )
  }, [brandId, selectedProductId, selectedLayout, effectiveColorThemeId, colorThemes, aspectRatio, visualStyle, headlineOverlay, generatePostImageMutate, promptWriter, brand?.vibe])

  // Kicks off the prompt-writing stage instead of generating the image
  // immediately -- fired both right after a fresh caption generation
  // succeeds and by "Regenerate image"/"Rewrite", so every image
  // generation for this flow goes through SocioPosts' authoring step
  // first, not straight to the image provider.
  //
  // rawInput is the user's OWN typed brief (additionalContext, the "What
  // do you want to post" field) -- not caption.image_prompt, which is a
  // generic side-output of the caption call, not what the user actually
  // described, and (being fixed per generation) fed straight back in as
  // "refine this" on every rewrite used to just pad/reword the same base.
  // additionalContext is stable across rewrites too (it's a separate field
  // the prompt-writing process never touches), so this alone already fixes
  // "same input every time" for the common case; caption.image_prompt is
  // only a fallback for when the user left that field blank, and nothing
  // at all (Groq composes from brand/product context) if even that's
  // empty.
  const beginImagePromptWriting = useCallback((data: FullPostResult, sessionId: string, isRewrite = false) => {
    const caption = data.content.content as GeneratedCaption

    // hard_truth_checklist has no photo at all -- the prompt-authoring
    // stage's whole job is writing a PHOTO scene description, which this
    // template never uses (see generatePostImage's own early-exit branch,
    // which skips the image-provider call entirely for it). Skip straight to
    // compositing instead of running a Groq call to author a prompt that
    // would just be discarded -- one fewer credit-free but still real
    // Groq call per generation, on top of the real image-generation credits
    // runImageGeneration/generatePostImage already saves.
    if (caption.suggested_template === "hard_truth_checklist") {
      runImageGeneration(data, sessionId, "hard_truth_checklist template (no photo)")
      return
    }
    // annotated_product uses the product's real photo -- no scene to write either.
    if (caption.suggested_template === "annotated_product") {
      runImageGeneration(data, sessionId, "annotated_product template (product photo)")
      return
    }

    // A fresh prompt (isRewrite false) starts eligible for the auto-fire
    // effect below; an explicit rewrite is itself an "I want to review
    // this" signal, same as manually editing the text, so it marks the
    // ref as already-engaged and falls back to requiring the manual
    // "Generate image" click once this rewrite's own prompt is ready.
    userEditedPromptRef.current = isRewrite

    setPendingImageGen({ data, sessionId })
    setPostImageUrl(null)
    setPostTextStyle(null)
    setImageSource(null)
    setImageError(null)
    const seed = additionalContext.trim() || caption.image_prompt?.trim() || null
    promptWriter.write({
      flow: "post",
      brandId,
      productId: selectedProductId ?? undefined,
      rawInput: seed,
      isRewrite,
      constraints: {
        aspectRatioLabel: aspectRatio,
        styleLabel: visualStyle,
        hasProductReference: !!selectedProductId,
        // The caption's own visual brief: the subject the image must show,
        // whatever the seed above says about style.
        visualBrief: caption.visual ?? undefined,
      },
    })
  }, [brandId, selectedProductId, aspectRatio, visualStyle, promptWriter, additionalContext, runImageGeneration])

  const handleConfirmGenerateImage = useCallback(() => {
    if (!pendingImageGen || !aiImagePrompt.trim()) return
    runImageGeneration(pendingImageGen.data, pendingImageGen.sessionId, aiImagePrompt.trim())
  }, [pendingImageGen, aiImagePrompt, runImageGeneration])

  // Runs the whole caption -> prompt-authoring -> image pipeline end-to-end
  // from a single "Generate" click: the moment the authored prompt reaches
  // "ready", fire the same confirm logic the manual "Generate image"
  // button already runs -- unless the user touched the prompt first
  // (typed an edit, or asked for a rewrite), which is exactly what
  // userEditedPromptRef tracks. The button stays visible and clickable
  // either way, so a mid-edit user can still confirm manually and there's
  // never dead time waiting on this effect.
  useEffect(() => {
    if (promptWriter.stage !== "ready") return
    if (userEditedPromptRef.current) return
    handleConfirmGenerateImage()
    // Deliberately narrow: only the stage transition itself should trigger
    // this, not every identity change of handleConfirmGenerateImage (which
    // changes on every aiImagePrompt keystroke, including during writing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptWriter.stage])

  // A real regenerate -- always an explicit rewrite, telling Groq to give
  // this a genuinely different creative treatment rather than another pass
  // at the same seed.
  const handleRegenerateImage = useCallback(() => {
    if (!fullPostResult || !postSessionId) return
    beginImagePromptWriting(fullPostResult, postSessionId, true)
  }, [fullPostResult, postSessionId, beginImagePromptWriting])

  // Caption editing — this result is still pre-save local/store state at
  // this point (the captions row this generation already wrote server-side
  // has no id threaded back to the client at all to PUT an edit onto, see
  // app/api/v1/ai/fullpost/generate/route.ts's captions insert), so
  // "saving" an edit here just means updating fullPostResult itself.
  // Confirmed this is enough for the one downstream action that actually
  // reads it before this result is replaced or navigated away from:
  // getScheduleCaption(result) below derives scheduleCaption fresh from
  // this same result on every render, so ScheduleAction's Confirm button
  // sends whatever this holds at click time, edited or not.
  const handleSaveCaption = useCallback((text: string) => {
    if (!fullPostResult || fullPostResult.content.format !== "social_post") return
    setFullPostResult({
      ...fullPostResult,
      content: { ...fullPostResult.content, content: { ...fullPostResult.content.content, caption_text: text } },
    })
  }, [fullPostResult, setFullPostResult])

  useEffect(() => {
    if (occasionContext) setAdditionalContext(occasionContext.angle)
  }, [occasionContext])

  // Consume a topic handed off from another generator, if any
  useEffect(() => {
    if (pendingTopic) {
      setAdditionalContext(pendingTopic)
      setPendingTopic(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Restore from sessionStorage on mount
  useEffect(() => {
    if (!fullPostResult) {
      const saved = sessionStorage.getItem(`fullpost_${brandId}`)
      if (saved) {
        try { setFullPostResult(JSON.parse(saved)) } catch {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist to sessionStorage when result changes
  useEffect(() => {
    if (fullPostResult) {
      sessionStorage.setItem(`fullpost_${brandId}`, JSON.stringify(fullPostResult))
    }
  }, [fullPostResult, brandId])

  // Cleanup on unmount
  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  // Recomputes the flattened (headline-baked-in) PNG whenever the clean
  // background or the edited headline text changes — debounced so typing
  // in the overlay editor doesn't re-render a canvas on every keystroke.
  // Never touches credits or the API — pure canvas work on an image
  // already in the browser.
  useEffect(() => {
    if (imageSource !== "ai" || !postImageUrl || postDesign) return
    if (!overlayText.trim()) {
      setFlattenedImageUrl(null)
      return
    }
    let cancelled = false
    setFlattening(true)
    const timer = setTimeout(() => {
      flattenOverlayImage(postImageUrl, overlayText, undefined, overlayFontId, postTextStyle, overlayLayout ? { ...overlayLayout, body_font_id: defaultBodyFont(overlayFontId) } : null)
        .then((dataUrl) => { if (!cancelled) setFlattenedImageUrl(dataUrl) })
        .catch(() => { if (!cancelled) setFlattenedImageUrl(null) })
        .finally(() => { if (!cancelled) setFlattening(false) })
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [imageSource, postImageUrl, overlayText, overlayFontId, postTextStyle, overlayLayout, postDesign])

  // A designed post is drawn on the server (the same renderer Autopilot and
  // the calendar use), so the preview IS the downloaded / scheduled image.
  // Debounced like the overlay above; drawing costs no credits.
  useEffect(() => {
    if (imageSource !== "ai" || !postImageUrl || !postDesign) return
    if (!postDesign.big_words.trim()) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setFlattening(true)
      setPostRenderError(null)
      fetch("/api/v1/ai/post-image/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, baseImageUrl: postImageUrl, design: postDesign }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const json: unknown = await readJsonResponse(res)
          if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : "Couldn't draw the post.")
          setFlattenedImageUrl((json as { data: { image_url: string } }).data.image_url)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setPostRenderError(err instanceof Error ? err.message : "Couldn't draw the post.")
        })
        .finally(() => { if (!controller.signal.aborted) setFlattening(false) })
    }, 500)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [imageSource, postImageUrl, postDesign, brandId])

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  function handleGenerate() {
    startGeneration()
  }

  // "Make it better": a new generation with the critic's fix folded into the brief.
  function handleImprove(fix: string) {
    startGeneration(fix)
  }

  function startGeneration(improve?: string) {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    setJustSaved(false)
    setFullPostResult(null)
    setPostImageUrl(null)
    setPostTextStyle(null)
    setImageSource(null)
    setImageError(null)
    setPostSessionId(null)
    setOverlayText("")
    setFlattenedImageUrl(null)
    setPostDesign(null)
    // A brand new caption is about to replace whatever the left panel was
    // showing -- back to the plain "What do you want to post" textarea
    // (see the left column below) instead of leaving a stale authored
    // prompt from the PREVIOUS full-post run showing while this new one
    // generates.
    promptWriter.reset()
    setPendingImageGen(null)

    generate(
      {
        brandId,
        productId: selectedProductId ?? undefined,
        format: "social_post",
        platform: "instagram",
        additionalContext: (improve
          ? [additionalContext, `Make it better than the last version: ${improve}`].filter(Boolean).join("\n").slice(0, 500)
          : additionalContext) || undefined,
        contentAngle,
      },
      {
        onSuccess: (data) => {
          setFullPostResult(data)
          setPostSessionId(data.postSessionId)
          if (data.postSessionId) {
            // "✓ Generated successfully" now waits for the image itself to
            // finish -- beginImagePromptWriting only starts the prompt-
            // authoring step here, not the actual image generation. See
            // runImageGeneration's generatePostImageMutate onSuccess for
            // where it actually fires.
            beginImagePromptWriting(data, data.postSessionId)
          } else {
            // No image step to wait for at all -- confirm right away, same
            // as before this fix.
            setJustSaved(true)
            setTimeout(() => setJustSaved(false), 5000)
            setImageError("Couldn't start image generation. Please try again.")
          }
        },
      }
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      {/* Left column — the input form, sticky so it stays visible while the
          right column (results) scrolls. */}
      <div className="space-y-4 lg:sticky lg:top-6">
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <h3 className="text-sm font-semibold">Full Post Settings</h3>

          {/* Product */}
          {products.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Product (optional)</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={selectedProductId ?? ""}
                onChange={(e) => setSelectedProductId(e.target.value || null)}
              >
                <option value="">No specific product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Content angle — single-select pills. "Let SocioPosts decide" is
              first and the default, per confirmed direction. Folded into the
              generation call as a soft prompt hint only (see handleGenerate). */}
          <div className="space-y-1.5">
            <Label className="text-xs">Content angle</Label>
            <div className="flex flex-wrap gap-1.5">
              {ANGLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setContentAngle(opt.value)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    contentAngle === opt.value
                      ? "border-violet-500 bg-violet-50 text-violet-700"
                      : "border-border hover:border-violet-300 text-muted-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* The one input — the same Groq call that writes the hook/caption
              now also picks the image layout, color theme, and whether to
              overlay any text, purely from what's described here.
              Once a caption exists, this same spot transforms into the
              SocioPosts-authored image prompt (streamed live, then
              editable) instead of surfacing later in the results panel —
              the user watches their own brief become the actual image
              prompt in place, before generation. additionalContext itself
              is untouched underneath (see beginImagePromptWriting's own
              comment) — this is a display swap, not a destructive one. */}
          {promptWriter.stage === "idle" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">What do you want to post</Label>
              <textarea
                rows={2}
                placeholder={topicPlaceholderForNiche(brand?.niche)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <PromptWriterField
                label="AI image prompt"
                prompt={aiImagePrompt}
                onChange={(text) => { userEditedPromptRef.current = true; setAiImagePrompt(text) }}
                stage={promptWriter.stage}
                error={promptWriter.error}
                onRewrite={() => pendingImageGen && beginImagePromptWriting(pendingImageGen.data, pendingImageGen.sessionId, true)}
                rows={3}
              />
              <button
                type="button"
                onClick={handleConfirmGenerateImage}
                disabled={promptWriter.stage === "writing" || !aiImagePrompt.trim() || imageGenerating}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-600 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {imageGenerating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating image…</> : "Generate image"}
              </button>
            </div>
          )}

          {/* Aspect ratio and visualStyle (below) are both wired through to
              the image route. */}
          <div className="space-y-1.5">
            <Label className="text-xs">Aspect ratio</Label>
            <div className="flex gap-1.5">
              {([
                { value: "4:5", label: "4:5 Portrait" },
                { value: "1:1", label: "1:1 Square" },
                { value: "9:16", label: "9:16 Story" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAspectRatio(opt.value)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    aspectRatio === opt.value
                      ? "border-violet-500 bg-violet-50 text-violet-700"
                      : "border-border hover:border-violet-300 text-muted-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Only relevant once a headline overlay is set — the templates
                that composite text onto the image are locked to 4:5 for now
                (see generatePostImage's own comment), so a non-4:5 pick here
                silently renders at 4:5 whenever there's overlay text. */}
            {aspectRatio !== "4:5" && headlineOverlay.trim() && (
              <p className="text-[11px] text-amber-700">
                Posts with a headline overlay still render at 4:5 for now — {aspectRatio} only applies once there&apos;s no overlay text.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Visual direction</Label>
            <div className="flex gap-1.5">
              {([
                { value: "studio_scene", label: "Real photo" },
                { value: "editorial_graphic", label: "Editorial graphic" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVisualStyle(opt.value)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    visualStyle === opt.value
                      ? "border-violet-500 bg-violet-50 text-violet-700"
                      : "border-border hover:border-violet-300 text-muted-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Headline overlay — optional, hard 5-word cap. Captured but not
              yet wired to replace caption.suggested_overlay_text; that swap
              is part of the overlay-decoupling commit (moving the headline
              off the server-composited image and onto a client-editable
              HTML layer). */}
          <div className="space-y-1.5">
            <Label className="text-xs">Headline overlay (optional)</Label>
            <input
              type="text"
              placeholder="Brand before prompt."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={headlineOverlay}
              onChange={(e) => {
                const words = e.target.value.split(/\s+/).filter(Boolean)
                if (words.length <= 5) {
                  setHeadlineOverlay(e.target.value)
                } else {
                  setHeadlineOverlay(words.slice(0, 5).join(" ") + (e.target.value.endsWith(" ") ? " " : ""))
                }
              }}
            />
            <p className="text-xs text-muted-foreground text-right">
              {headlineOverlay.trim() ? headlineOverlay.trim().split(/\s+/).length : 0}/5 words
            </p>
          </div>

          <Button className="w-full" onClick={handleGenerate} disabled={isPending}>
            {isPending ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating full post…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" /> Generate full post</>
            )}
          </Button>

          {error && <UsageLimitBanner error={error} onRetry={handleGenerate} />}
        </div>
      </div>

      {/* Right column — results, or an empty-state placeholder before the
          first generation. */}
      <div className="space-y-4">
        {isPending && <GeneratingState message="Writing your full post…" />}

        {justSaved && (
          <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <div className="flex items-center gap-2 text-green-700">
              <Check className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">
                ✓ Generated successfully{creditsUsedForResult !== null ? ` · ${creditsUsedForResult} credit${creditsUsedForResult !== 1 ? "s" : ""} used` : ""}.
              </span>
            </div>
            <Link
              href={`/brands/${brandId}/library`}
              className="text-xs font-medium text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0"
            >
              View →
            </Link>
          </div>
        )}

        {fullPostResult && !isPending ? (
          <FullPostResults
            result={fullPostResult}
            copied={copied}
            onCopy={copy}
            onSaveCaption={handleSaveCaption}
            brandId={brandId}
            brandName={brandName}
            postImageUrl={postImageUrl}
            imageGenerating={imageGenerating}
            imageError={imageError}
            imageSource={imageSource}
            onRegenerateImage={handleRegenerateImage}
            overlayText={overlayText}
            onOverlayTextChange={setOverlayText}
            overlayFontId={overlayFontId}
            onOverlayFontChange={setOverlayFontId}
            overlayTextStyle={postTextStyle}
            overlayLayout={overlayLayout}
            onOverlayLayoutChange={(layout) => setOverlayLayout((prev) => (prev ? { ...prev, text_layout: layout, text_layout_source: "user" } : prev))}
            flattenedImageUrl={flattenedImageUrl}
            flattening={flattening}
            postDesign={postDesign}
            onPostDesignChange={setPostDesign}
            postRenderError={postRenderError}
            postSessionId={postSessionId}
            onImprove={handleImprove}
            improving={isPending}
            previewMode={previewMode}
            onPreviewModeChange={setPreviewMode}
            aspectRatio={aspectRatio}
          />
        ) : (
          <div
            className="mx-auto flex max-w-sm items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 p-6 text-center text-sm text-muted-foreground"
            style={{ aspectRatio: aspectRatio.replace(":", " / ") }}
          >
            Your generated post will appear here
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Result components ───────────────────────────────────────────────────────

function CopyBtn({ text, id, copied, onCopy }: { text: string; id: string; copied: string | null; onCopy: (t: string, k: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(text, id)}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied === id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === id ? "Copied" : "Copy"}
    </button>
  )
}

function HookSection({ hook, copied, onCopy }: { hook: GeneratedHook; copied: string | null; onCopy: (t: string, k: string) => void }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hook</span>
        <CopyBtn text={hook.hook_text} id="hook" copied={copied} onCopy={onCopy} />
      </div>
      <p className="text-sm font-semibold leading-relaxed">{hook.hook_text}</p>
      <p className="text-xs text-muted-foreground italic">{hook.reasoning}</p>
    </div>
  )
}

function ContentDisplay({ content, copied, onCopy, onSaveCaption }: { content: ContentResult; copied: string | null; onCopy: (t: string, k: string) => void; onSaveCaption?: (text: string) => void }) {
  // Caption editing (social_post only) -- mirrors
  // components/calendar/CalendarEntryPanel.tsx's Edit/Cancel/Save caption
  // pattern exactly, just without that component's PUT-to-database step
  // (see onSaveCaption's own call site for why: this content hasn't been
  // saved anywhere with an id to PUT back to yet at this point). Reset
  // whenever `content` itself changes (a fresh generation or Regenerate),
  // same as CalendarEntryPanel resets on a new `entry`.
  const [isEditingCaption, setIsEditingCaption] = useState(false)
  const [editCaptionText, setEditCaptionText] = useState(
    content.format === "social_post" ? (content.content as GeneratedCaption).caption_text : ""
  )
  useEffect(() => {
    if (content.format === "social_post") setEditCaptionText((content.content as GeneratedCaption).caption_text)
    setIsEditingCaption(false)
  }, [content])

  if (content.format === "social_post") {
    const c = content.content as GeneratedCaption
    const full = `${c.caption_text}\n\n${c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}`
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Caption</span>
          <div className="flex items-center gap-1">
            {!isEditingCaption && <CopyBtn text={full} id="caption" copied={copied} onCopy={onCopy} />}
            {onSaveCaption && (
              <button
                type="button"
                onClick={() => setIsEditingCaption((v) => !v)}
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {isEditingCaption ? "Cancel" : "Edit"}
              </button>
            )}
          </div>
        </div>
        {isEditingCaption ? (
          <div className="space-y-2">
            <textarea
              rows={5}
              value={editCaptionText}
              onChange={(e) => setEditCaptionText(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <Button
              size="sm"
              onClick={() => {
                onSaveCaption?.(editCaptionText)
                setIsEditingCaption(false)
              }}
            >
              Save
            </Button>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{c.caption_text}</p>
        )}
        {!isEditingCaption && c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}</p>
        )}
        {!isEditingCaption && c.cta && <p className="text-xs text-muted-foreground">CTA: {c.cta}</p>}
      </div>
    )
  }

  if (content.format === "reel_script") {
    const c = content.content as ReelScript
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reel Script · Storyboard</span>
          <CopyBtn
            text={`HOOK: ${c.hook}\n\n${c.scenes.map((s, i) => `Scene ${i + 1} (${s.duration_seconds}s)\nVisual: ${s.visual_direction}\nVoiceover: ${s.voiceover_or_text_overlay}`).join("\n\n")}\n\nCAPTION:\n${c.caption}\n\n${c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}`}
            id="reel"
            copied={copied}
            onCopy={onCopy}
          />
        </div>
        <div className="rounded-md bg-primary/5 border border-primary/10 p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Opening Hook</p>
          <p className="text-sm font-semibold">{c.hook}</p>
        </div>
        {/* Storyboard scene cards -- used to show a per-scene preview image
            fetched directly from Pollinations client-side (free, keyless,
            no backend involvement). Removed along with Pollinations rather
            than replaced with an equivalent: the image provider has no free,
            keyless, instantly-embeddable preview endpoint -- a real per-scene
            equivalent would mean a real paid API call per scene, per
            render, which nothing here charges for. Text content only now. */}
        <div className="grid gap-3 sm:grid-cols-2">
          {c.scenes.map((scene, i) => (
            <div key={i} className="rounded-md border overflow-hidden">
              <div className="p-2.5 space-y-1 bg-secondary/30">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Scene {i + 1}</p>
                  <span className="text-xs text-muted-foreground">{scene.duration_seconds}s</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{scene.voiceover_or_text_overlay}</p>
                <p className="text-xs text-muted-foreground/70 italic line-clamp-1">{scene.visual_direction}</p>
              </div>
            </div>
          ))}
        </div>
        {c.caption && (
          <div className="rounded-md bg-secondary/50 p-3">
            <p className="text-xs font-semibold text-muted-foreground mb-1">Caption</p>
            <p className="text-xs">{c.caption}</p>
          </div>
        )}
        {c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}</p>
        )}
      </div>
    )
  }

  if (content.format === "carousel") {
    const c = content.content as CarouselContent
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Carousel · {c.slides.length} slides</span>
          <CopyBtn
            text={c.slides.map((s) => `Slide ${s.slide_number}: ${s.headline}\n${s.body}`).join("\n\n")}
            id="carousel"
            copied={copied}
            onCopy={onCopy}
          />
        </div>
        <div className="space-y-2">
          {c.slides.map((slide) => (
            <div key={slide.slide_number} className="rounded-md bg-secondary/50 p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Slide {slide.slide_number}</p>
              <p className="text-sm font-semibold">{slide.headline}</p>
              <p className="text-xs text-muted-foreground">{slide.body}</p>
            </div>
          ))}
        </div>
        {c.hashtags.length > 0 && (
          <p className="text-xs text-primary font-medium">{c.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}</p>
        )}
      </div>
    )
  }

  if (content.format === "blog_post") {
    const c = content.content as BlogPost
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Blog Post</span>
          <CopyBtn text={`${c.title}\n\n${c.body}`} id="blog" copied={copied} onCopy={onCopy} />
        </div>
        <p className="text-base font-bold leading-snug">{c.title}</p>
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{c.body}</p>
        <div className="rounded-md bg-secondary/50 p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Meta description</p>
          <p className="text-xs">{c.meta_description}</p>
        </div>
      </div>
    )
  }

  if (content.format === "ad_copy") {
    const c = content.content as AdCopy
    const full = `Headline: ${c.headline}\n\n${c.primary_text}\n\n${c.description}\n\nCTA: ${c.cta_button}`
    return (
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ad Copy</span>
          <CopyBtn text={full} id="adcopy" copied={copied} onCopy={onCopy} />
        </div>
        {/* Facebook/Instagram-style ad mockup */}
        <div className="mx-auto max-w-xs overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2.5 border-b px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-[10px] font-bold text-white">AD</div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900">Your Brand</p>
              <p className="text-[10px] text-gray-400">Sponsored · 🌐</p>
            </div>
            <span className="text-base text-gray-300 leading-none">···</span>
          </div>
          <div className="px-3 py-2">
            <p className="line-clamp-3 text-xs text-gray-800">{c.primary_text}</p>
          </div>
          <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-violet-50 to-indigo-50">
            <p className="text-[10px] font-medium text-gray-400">Ad creative goes here</p>
          </div>
          <div className="flex items-center justify-between gap-2 border-t bg-gray-50 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9px] uppercase tracking-wide text-gray-400">{c.description}</p>
              <p className="truncate text-xs font-bold text-gray-900">{c.headline}</p>
            </div>
            <span className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white">{c.cta_button}</span>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div><p className="text-xs font-semibold text-muted-foreground mb-0.5">Headline <span className="font-normal">({c.headline.length}/40 chars)</span></p><p className="font-bold">{c.headline}</p></div>
          <div><p className="text-xs font-semibold text-muted-foreground mb-0.5">Primary text</p><p>{c.primary_text}</p></div>
          <div><p className="text-xs font-semibold text-muted-foreground mb-0.5">Description</p><p className="text-muted-foreground">{c.description}</p></div>
          <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1"><p className="text-xs font-semibold text-primary">{c.cta_button}</p></div>
        </div>
      </div>
    )
  }

  return null
}

// ─── Schedule to Instagram/Facebook ──────────────────────────────────────────

function getScheduleCaption(result: FullPostResult): { text: string; hashtags: string[] } | null {
  if (result.content.format === "social_post") {
    const c = result.content.content as GeneratedCaption
    return { text: c.caption_text, hashtags: c.hashtags }
  }
  if (result.content.format === "reel_script") {
    const c = result.content.content as ReelScript
    if (!c.caption) return null
    return { text: c.caption, hashtags: c.hashtags }
  }
  // Carousel/blog/ad copy don't map to a single caption+image Instagram
  // post — scheduling those needs separate client-side rendering work.
  return null
}

function PostImagePreview({
  postImageUrl,
  alt,
  imageGenerating,
  imageError,
  showRegenerate,
  onRegenerateImage,
  showOverlayEditor,
  overlayText,
  onOverlayTextChange,
  overlayFontId,
  onOverlayFontChange,
  overlayTextStyle,
  overlayLayout,
  onOverlayLayoutChange,
  downloadUrl,
  flattening,
  postDesign,
  onPostDesignChange,
  postRenderError,
  previewMode,
  onPreviewModeChange,
  brandName,
  captionPreview,
  aspectRatio,
}: {
  postImageUrl: string | null
  alt: string
  imageGenerating: boolean
  imageError: string | null
  showRegenerate: boolean
  onRegenerateImage: () => void
  /** Only true for the "ai" image source — product_photo and user_upload
   * have no client-editable overlay (see FullPostGenerator's own comment
   * on flattenOverlayImage). */
  showOverlayEditor: boolean
  overlayText: string
  onOverlayTextChange: (text: string) => void
  overlayFontId: FontId
  onOverlayFontChange: (fontId: FontId) => void
  overlayTextStyle: TextStyle | null
  overlayLayout: OverlayLayout | null
  onOverlayLayoutChange: (layout: TextLayoutId) => void
  /** What Download/Schedule should actually use — the flattened (headline
   * baked in) PNG when there's overlay text, otherwise the clean
   * background itself. Never re-generates anything; this is client-canvas
   * output or the plain background URL, so it costs nothing to use. */
  downloadUrl: string
  flattening: boolean
  /** A designed post: downloadUrl is its server render, edited by the fields below. */
  postDesign: PostDesign | null
  onPostDesignChange: (design: PostDesign) => void
  postRenderError: string | null
  /** Canvas (bare graphic) vs. in-feed (wrapped in a static Instagram
   * chrome shell) — display only, never affects downloadUrl/postImageUrl.
   * Only rendered when showOverlayEditor is true (see Commit 4). */
  previewMode: "canvas" | "feed"
  onPreviewModeChange: (mode: "canvas" | "feed") => void
  brandName: string
  captionPreview: string
  /** Sizes the generating-state placeholder below to the actual aspect
   * ratio being generated, so there's no layout jump when the real image
   * arrives. */
  aspectRatio: "4:5" | "1:1" | "9:16"
}) {
  // Whether the scrim+textarea headline editor is showing because the user
  // explicitly clicked "+ Add headline", as opposed to it showing because
  // overlayText already has real content. Declared before the early
  // returns below per the Rules of Hooks.
  const [addingHeadline, setAddingHeadline] = useState(false)

  if (imageGenerating) {
    return (
      <div
        className="mx-auto flex w-full max-w-sm items-center justify-center gap-2 rounded-lg border bg-card"
        style={{ aspectRatio: aspectRatio.replace(":", " / ") }}
      >
        <Loader2 className="h-4 w-4 animate-spin text-violet-500 shrink-0" />
        <p className="text-sm text-muted-foreground">Generating post image…</p>
      </div>
    )
  }

  if (imageError) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="text-sm text-amber-900 font-medium">{imageError}</p>
          <button
            type="button"
            onClick={onRegenerateImage}
            className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900"
          >
            🔄 Try again
          </button>
        </div>
      </div>
    )
  }

  if (!postImageUrl) return null

  // Presentational only -- purely toggles whether the corner button or the
  // scrim+textarea shows. Never lifted to FullPostGenerator, doesn't touch
  // overlayText/flattenedImageUrl/downloadUrl, and resets naturally on
  // every new PostImagePreview mount (a fresh generation) since it's local
  // state.
  const showHeadlineEditor = overlayText.trim().length > 0 || addingHeadline

  // The bare graphic + editable headline layer — identical markup whether
  // shown standalone (canvas mode) or nested inside the IG chrome shell
  // (feed mode) below, so what you edit is always the same element.
  // With a layout, the preview IS the flattened export (flattenOverlayImage
  // draws the shared plan) -- preview = download = scheduled image; the
  // headline is edited in the field below instead of on the image.
  const layoutPreview = !!overlayLayout?.text_layout && showHeadlineEditor
  const graphicWithOverlay = postDesign ? (
    <div className="relative w-full overflow-hidden">
      {downloadUrl && downloadUrl !== postImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={downloadUrl} alt={alt} className={`w-full object-contain ${flattening ? "opacity-80" : ""}`} />
      ) : (
        <div className="flex w-full items-center justify-center gap-2 bg-muted" style={{ aspectRatio: aspectRatio.replace(":", " / ") }}>
          <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
          <span className="text-sm text-muted-foreground">Designing the post…</span>
        </div>
      )}
    </div>
  ) : layoutPreview ? (
    <div className="relative w-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={downloadUrl || postImageUrl} alt={alt} className={`w-full object-contain ${flattening ? "opacity-80" : ""}`} />
    </div>
  ) : (
    <div className="relative w-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={postImageUrl} alt={alt} className="w-full object-contain" />
      {showHeadlineEditor ? (
        <>
          {/* Bottom-third scrim, purely visual (not baked into postImageUrl
              itself) — matches flattenOverlayImage's own gradient so what
              you see here is what Download/Schedule actually produce. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0"
            style={{ height: "38%", background: (({ mid, end }) => `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,${mid}) 35%, rgba(0,0,0,${end}) 100%)`)(overlayScrimStops(overlayTextStyle)) }}
          />
          <textarea
            value={overlayText}
            onChange={(e) => onOverlayTextChange(e.target.value)}
            onBlur={() => {
              if (addingHeadline && !overlayText.trim()) setAddingHeadline(false)
            }}
            placeholder="Click to add a headline over this image…"
            rows={2}
            autoFocus={addingHeadline}
            className={`absolute inset-x-0 bottom-0 w-full resize-none border-0 bg-transparent px-[7%] pb-[6%] pt-2 text-lg leading-tight text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white/40 ${PREVIEW_FONT_CLASS[overlayFontId]}`}
          />
        </>
      ) : (
        <button
          type="button"
          onClick={() => setAddingHeadline(true)}
          className="absolute bottom-3 right-3 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/65"
        >
          + Add headline
        </button>
      )}
    </div>
  )

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Post Image</span>
        <div className="flex items-center gap-3">
          {showOverlayEditor && (
            <div className="flex rounded-md border overflow-hidden text-[11px]">
              <button
                type="button"
                onClick={() => onPreviewModeChange("canvas")}
                className={`px-2 py-1 font-medium transition-colors ${previewMode === "canvas" ? "bg-violet-50 text-violet-700" : "text-muted-foreground hover:bg-muted"}`}
              >
                Canvas
              </button>
              <button
                type="button"
                onClick={() => onPreviewModeChange("feed")}
                className={`px-2 py-1 font-medium transition-colors border-l ${previewMode === "feed" ? "bg-violet-50 text-violet-700" : "text-muted-foreground hover:bg-muted"}`}
              >
                In-feed
              </button>
            </div>
          )}
          {showRegenerate && (
            <button
              type="button"
              onClick={onRegenerateImage}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate image
            </button>
          )}
          <a
            href={downloadUrl}
            download="post-image.png"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> {flattening ? "Preparing…" : "Download"}
          </a>
        </div>
      </div>

      {showOverlayEditor ? (
        previewMode === "feed" ? (
          // Static Instagram chrome shell — a skin around the same
          // editable graphic above, not a live simulation (no real avatar/
          // like-count data). See the visualizer mockup this was based on.
          <div className="mx-auto max-w-sm rounded-lg border bg-background">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-semibold text-violet-700">
                {brandName.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-[13px] font-medium">{brandName.toLowerCase().replace(/\s+/g, "")}</span>
            </div>
            <div className="rounded-none">{graphicWithOverlay}</div>
            <div className="flex items-center gap-3.5 px-3 pt-2.5 text-xl text-foreground">
              <Heart className="h-5 w-5" aria-hidden="true" />
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
              <Send className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="px-3 pb-3 pt-1 text-[13px] leading-snug">
              <span className="font-medium">{brandName.toLowerCase().replace(/\s+/g, "")}</span>{" "}
              <span className="text-muted-foreground">
                {captionPreview.length > 90 ? `${captionPreview.slice(0, 90)}… ` : captionPreview}
                {captionPreview.length > 90 && <span className="text-muted-foreground/70">more</span>}
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg">{graphicWithOverlay}</div>
        )
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={postImageUrl}
          alt={alt}
          className="w-full rounded-lg object-contain"
        />
      )}

      {/* Headline typeface -- starts at the model's pick for this post
          (suggested_font_id); changing it only redraws the canvas, no
          credits. Only shown while there's a headline to apply it to. */}
      {showOverlayEditor && layoutPreview && !postDesign && (
        <div className="space-y-2">
          <textarea
            value={overlayText}
            onChange={(e) => onOverlayTextChange(e.target.value)}
            rows={2}
            placeholder="Headline on the image"
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <TextLayoutPicker value={overlayLayout?.text_layout} onChange={onOverlayLayoutChange} />
        </div>
      )}

      {showOverlayEditor && postDesign && (
        <PostDesignFields design={postDesign} onChange={onPostDesignChange} error={postRenderError} />
      )}

      {showOverlayEditor && showHeadlineEditor && !postDesign && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Font</span>
          {resolveFonts().map((font) => (
            <button
              key={font.id}
              type="button"
              onClick={() => onOverlayFontChange(font.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                overlayFontId === font.id ? "border-violet-500 bg-violet-50 text-violet-700" : "border-border text-muted-foreground hover:border-violet-300"
              }`}
            >
              {font.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const POST_DESIGN_LABEL: Record<PostDesign["template"], string> = {
  bold_statement: "Bold",
  product_focus: "Product",
  quote_card: "Quote",
  minimal: "Quiet",
  listicle_cover: "Listicle",
  festive_poster: "Festive",
  review_card: "Review",
}

/** The designed post's words and look -- every change re-renders on the server, no credits. */
function PostDesignFields({ design, onChange, error }: { design: PostDesign; onChange: (design: PostDesign) => void; error: string | null }) {
  const isReview = design.template === "review_card"
  return (
    <div className="space-y-2">
      {isReview ? (
        // A real customer's words -- shown, never edited into something they didn't say.
        <p className="rounded-md border border-dashed px-3 py-2 text-sm italic text-muted-foreground">&ldquo;{design.quote}&rdquo;</p>
      ) : (
        <input
          value={design.big_words}
          onChange={(e) => onChange({ ...design, big_words: e.target.value })}
          maxLength={80}
          placeholder={design.template === "listicle_cover" ? `The list (the ${design.badge} is the real count)` : "Big words (1-4)"}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
      <input
        value={design.script_line}
        onChange={(e) => onChange({ ...design, script_line: e.target.value })}
        maxLength={120}
        placeholder={isReview ? "Reviewer's name (only if they gave it)" : "Handwritten line under them (optional)"}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Look</span>
        {postDesignLooks(design).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange({ ...design, template: t })}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              design.template === t ? "border-violet-500 bg-violet-50 text-violet-700" : "border-border text-muted-foreground hover:border-violet-300"
            }`}
          >
            {POST_DESIGN_LABEL[t]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...design, seed: Math.floor(Math.random() * 2 ** 30) })}
          className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-violet-300"
        >
          Shuffle
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function FullPostResults({
  result,
  copied,
  onCopy,
  onSaveCaption,
  brandId,
  brandName,
  postImageUrl,
  imageGenerating,
  imageError,
  imageSource,
  onRegenerateImage,
  overlayText,
  onOverlayTextChange,
  overlayFontId,
  onOverlayFontChange,
  overlayTextStyle,
  overlayLayout,
  onOverlayLayoutChange,
  flattenedImageUrl,
  flattening,
  postDesign,
  onPostDesignChange,
  postRenderError,
  postSessionId,
  onImprove,
  improving,
  previewMode,
  onPreviewModeChange,
  aspectRatio,
}: {
  result: FullPostResult
  copied: string | null
  onCopy: (text: string, key: string) => void
  onSaveCaption: (text: string) => void
  brandId: string
  brandName: string
  postImageUrl: string | null
  imageGenerating: boolean
  imageError: string | null
  imageSource: "ai" | null
  onRegenerateImage: () => void
  overlayText: string
  onOverlayTextChange: (text: string) => void
  overlayFontId: FontId
  onOverlayFontChange: (fontId: FontId) => void
  overlayTextStyle: TextStyle | null
  overlayLayout: OverlayLayout | null
  onOverlayLayoutChange: (layout: TextLayoutId) => void
  flattenedImageUrl: string | null
  flattening: boolean
  postDesign: PostDesign | null
  onPostDesignChange: (design: PostDesign) => void
  postRenderError: string | null
  postSessionId: string | null
  onImprove: (fix: string) => void
  improving: boolean
  previewMode: "canvas" | "feed"
  onPreviewModeChange: (mode: "canvas" | "feed") => void
  aspectRatio: "4:5" | "1:1" | "9:16"
}) {
  const scheduleCaption = getScheduleCaption(result)

  // Screen readers otherwise get nothing but "Generated post image" for a
  // composited PNG whose headline/CTA text isn't real, selectable DOM text
  // anywhere else. Reuses the AI's own image_prompt (already generated for
  // the image pipeline, no new LLM call) as the scene description when the
  // AI path produced it — it doesn't describe a user-uploaded product
  // photo, so that path falls back to a plain brand/headline template.
  const caption = result.content.content as GeneratedCaption
  const headline = result.hook.hook_text
  const scene = imageSource === "ai" ? caption.image_prompt?.trim() : null
  const postImageAlt = scene
    ? `${headline}: ${scene}`
    : `${imageSource === "ai" ? "AI-generated" : ""} Instagram post image for ${brandName}: ${headline}`.replace(/\s+/g, " ").trim()

  // For the "ai" path, postImageUrl is the clean background only (Commit
  // 3) — the flattened (headline baked in) version is what Download and
  // Schedule should actually use whenever there's overlay text, so the
  // shared post ends up looking like what's shown in the editor above.
  // Falls back to the plain background when there's no headline typed, or
  // for the product_photo/user_upload paths (which never had this
  // decoupling in the first place — their postImageUrl is already final).
  // A designed post is only shareable once its render is back -- never
  // the bare photo by accident.
  const shareableImageUrl = imageSource === "ai" && postDesign
    ? flattenedImageUrl
    : (imageSource === "ai" && overlayText.trim() && flattenedImageUrl) || postImageUrl

  return (
    <div className="space-y-4">
      {/* Image first — matches the original design intent (visual up top,
          copy workspace below it) and keeps the generating-state indicator
          from appearing far down the page below a wall of caption text. */}
      <PostImagePreview
        postImageUrl={postImageUrl}
        alt={postImageAlt}
        imageGenerating={imageGenerating}
        imageError={imageError}
        showRegenerate={imageSource === "ai"}
        onRegenerateImage={onRegenerateImage}
        showOverlayEditor={imageSource === "ai"}
        overlayText={overlayText}
        onOverlayTextChange={onOverlayTextChange}
        overlayFontId={overlayFontId}
        onOverlayFontChange={onOverlayFontChange}
        overlayTextStyle={overlayTextStyle}
        overlayLayout={overlayLayout}
        onOverlayLayoutChange={onOverlayLayoutChange}
        downloadUrl={shareableImageUrl ?? postImageUrl ?? ""}
        flattening={flattening}
        postDesign={imageSource === "ai" ? postDesign : null}
        onPostDesignChange={onPostDesignChange}
        postRenderError={postRenderError}
        previewMode={previewMode}
        onPreviewModeChange={onPreviewModeChange}
        brandName={brandName}
        captionPreview={scheduleCaption?.text ?? caption.caption_text ?? ""}
        aspectRatio={aspectRatio}
      />

      {/* The critic: scored once the image as posted is ready. */}
      <CriticPanel
        brandId={brandId}
        resultKey={postSessionId}
        imageUrl={!imageGenerating && !flattening ? shareableImageUrl : null}
        caption={scheduleCaption?.text ?? caption.caption_text ?? ""}
        hook={result.hook.hook_text}
        format="post"
        contentType="caption"
        onImprove={onImprove}
        improving={improving}
      />

      <HookSection hook={result.hook} copied={copied} onCopy={onCopy} />
      <ContentDisplay content={result.content} copied={copied} onCopy={onCopy} onSaveCaption={onSaveCaption} />

      {shareableImageUrl && !imageGenerating && !flattening && scheduleCaption && (
        <ScheduleAction
          brandId={brandId}
          imageUrl={shareableImageUrl}
          // The clean AI background + overlay, so the scheduled entry's
          // on-image text stays editable from the calendar later.
          baseImageUrl={imageSource === "ai" ? postImageUrl : null}
          overlayText={overlayText}
          overlayFontId={overlayFontId}
          overlayLayout={postDesign ? null : overlayLayout ? { ...overlayLayout, body_font_id: defaultBodyFont(overlayFontId), text_style: overlayTextStyle } : null}
          postDesign={imageSource === "ai" ? postDesign : null}
          caption={scheduleCaption.text}
          hashtags={scheduleCaption.hashtags}
        />
      )}

      <div className="flex justify-end">
        <Link
          href={`/brands/${brandId}/library`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Archive className="h-3.5 w-3.5" />
          View in library →
        </Link>
      </div>
    </div>
  )
}
