import { create } from "zustand"
import type { GeneratedHook, GeneratedCaption, GeneratedImage, Platform } from "@/types/app"

type GeneratedHookWithId = GeneratedHook & { id: string | null }
type GeneratedCaptionWithId = GeneratedCaption & { id: string | null }
type GeneratedImageWithId = GeneratedImage & { id: string | null }

interface GenerationStore {
  // Generated content
  hooks: GeneratedHookWithId[]
  captions: GeneratedCaptionWithId[]
  images: GeneratedImageWithId[]
  selectedHook: GeneratedHookWithId | null

  // UI state
  selectedPlatform: Platform
  selectedProductId: string | null

  // Actions
  setHooks: (hooks: GeneratedHookWithId[]) => void
  addCaption: (caption: GeneratedCaptionWithId) => void
  addImage: (image: GeneratedImageWithId) => void
  setSelectedHook: (hook: GeneratedHookWithId | null) => void
  setSelectedPlatform: (platform: Platform) => void
  setSelectedProductId: (id: string | null) => void
  clearGeneration: () => void
}

export const useGenerationStore = create<GenerationStore>((set) => ({
  hooks: [],
  captions: [],
  images: [],
  selectedHook: null,
  selectedPlatform: "instagram",
  selectedProductId: null,

  setHooks: (hooks) => set({ hooks }),
  addCaption: (caption) => set((state) => ({ captions: [caption, ...state.captions] })),
  addImage: (image) => set((state) => ({ images: [image, ...state.images] })),
  setSelectedHook: (hook) => set({ selectedHook: hook }),
  setSelectedPlatform: (platform) => set({ selectedPlatform: platform }),
  setSelectedProductId: (id) => set({ selectedProductId: id }),
  clearGeneration: () => set({ hooks: [], captions: [], images: [], selectedHook: null }),
}))
