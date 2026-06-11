import { create } from "zustand"
import type { GeneratedHook, GeneratedCaption, Platform } from "@/types/app"

type GeneratedHookWithId = GeneratedHook & { id: string | null }
type GeneratedCaptionWithId = GeneratedCaption & { id: string | null }

interface GenerationStore {
  // Generated content
  hooks: GeneratedHookWithId[]
  captions: GeneratedCaptionWithId[]
  selectedHook: GeneratedHookWithId | null

  // UI state
  selectedPlatform: Platform
  selectedProductId: string | null

  // Actions
  setHooks: (hooks: GeneratedHookWithId[]) => void
  addCaption: (caption: GeneratedCaptionWithId) => void
  setSelectedHook: (hook: GeneratedHookWithId | null) => void
  setSelectedPlatform: (platform: Platform) => void
  setSelectedProductId: (id: string | null) => void
  clearGeneration: () => void
}

export const useGenerationStore = create<GenerationStore>((set) => ({
  hooks: [],
  captions: [],
  selectedHook: null,
  selectedPlatform: "instagram",
  selectedProductId: null,

  setHooks: (hooks) => set({ hooks }),
  addCaption: (caption) => set((state) => ({ captions: [caption, ...state.captions] })),
  setSelectedHook: (hook) => set({ selectedHook: hook }),
  setSelectedPlatform: (platform) => set({ selectedPlatform: platform }),
  setSelectedProductId: (id) => set({ selectedProductId: id }),
  clearGeneration: () => set({ hooks: [], captions: [], selectedHook: null }),
}))
