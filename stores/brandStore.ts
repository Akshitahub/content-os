import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { BrandRow } from "@/types/database"

interface BrandStore {
  // The currently selected brand (persisted across page navigations)
  activeBrandId: string | null
  activeBrand: BrandRow | null

  setActiveBrand: (brand: BrandRow) => void
  clearActiveBrand: () => void
}

export const useBrandStore = create<BrandStore>()(
  persist(
    (set) => ({
      activeBrandId: null,
      activeBrand: null,

      setActiveBrand: (brand) =>
        set({ activeBrandId: brand.id, activeBrand: brand }),

      clearActiveBrand: () =>
        set({ activeBrandId: null, activeBrand: null }),
    }),
    {
      name: "content-os-active-brand",
      // Only persist the ID — re-fetch full brand data from server
      partialize: (state) => ({ activeBrandId: state.activeBrandId }),
    }
  )
)
