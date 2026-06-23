import { create } from "zustand"
import type { GeneratedHook, GeneratedCaption, GeneratedImage, Platform, ContentFormat, ImageStyle, AspectRatio } from "@/types/app"
import type { ContentResult } from "@/hooks/useGeneration"

type GeneratedHookWithId = GeneratedHook & { id: string | null }
type GeneratedCaptionWithId = GeneratedCaption & { id: string | null }
type GeneratedImageWithId = GeneratedImage & { id: string | null }

type OccasionContext = { id: string; name: string; angle: string }

interface GenerationStore {
  // Generated content
  hooks: GeneratedHookWithId[]
  captions: GeneratedCaptionWithId[]
  images: GeneratedImageWithId[]
  selectedHook: GeneratedHookWithId | null

  // Shared UI state
  selectedPlatform: Platform
  selectedProductId: string | null

  // Active occasion (set when navigating from occasion calendar)
  occasionContext: OccasionContext | null

  // Hook tab state
  hookAdditionalContext: string

  // Content tab state
  contentFormat: ContentFormat
  contentAdditionalContext: string
  contentResult: ContentResult | null

  // Image tab state
  imagePrompt: string
  imageStyle: ImageStyle
  imageAspectRatio: AspectRatio

  // Actions
  setHooks: (hooks: GeneratedHookWithId[]) => void
  addCaption: (caption: GeneratedCaptionWithId) => void
  addImage: (image: GeneratedImageWithId) => void
  setSelectedHook: (hook: GeneratedHookWithId | null) => void
  setSelectedPlatform: (platform: Platform) => void
  setSelectedProductId: (id: string | null) => void
  setOccasionContext: (ctx: OccasionContext | null) => void
  setHookAdditionalContext: (ctx: string) => void
  setContentFormat: (format: ContentFormat) => void
  setContentAdditionalContext: (ctx: string) => void
  setContentResult: (result: ContentResult | null) => void
  setImagePrompt: (prompt: string) => void
  setImageStyle: (style: ImageStyle) => void
  setImageAspectRatio: (ratio: AspectRatio) => void
  clearGeneration: () => void
}

export const useGenerationStore = create<GenerationStore>((set) => ({
  hooks: [],
  captions: [],
  images: [],
  selectedHook: null,
  selectedPlatform: "instagram",
  selectedProductId: null,
  occasionContext: null,
  hookAdditionalContext: "",
  contentFormat: "social_post",
  contentAdditionalContext: "",
  contentResult: null,
  imagePrompt: "",
  imageStyle: "product_photography",
  imageAspectRatio: "1:1",

  setHooks: (hooks) => set({ hooks }),
  addCaption: (caption) => set((state) => ({ captions: [caption, ...state.captions] })),
  addImage: (image) => set((state) => ({ images: [image, ...state.images] })),
  setSelectedHook: (hook) => set({ selectedHook: hook }),
  setSelectedPlatform: (platform) => set({ selectedPlatform: platform }),
  setSelectedProductId: (id) => set({ selectedProductId: id }),
  setOccasionContext: (ctx) => set({ occasionContext: ctx }),
  setHookAdditionalContext: (ctx) => set({ hookAdditionalContext: ctx }),
  setContentFormat: (format) => set({ contentFormat: format }),
  setContentAdditionalContext: (ctx) => set({ contentAdditionalContext: ctx }),
  setContentResult: (result) => set({ contentResult: result }),
  setImagePrompt: (prompt) => set({ imagePrompt: prompt }),
  setImageStyle: (style) => set({ imageStyle: style }),
  setImageAspectRatio: (ratio) => set({ imageAspectRatio: ratio }),
  clearGeneration: () => set({
    hooks: [], captions: [], images: [], selectedHook: null, contentResult: null,
  }),
}))
