"use client"

import { createContext, useContext, type ReactNode } from "react"

// The workspace owns its appearance. Home, public pages and the navigation
// shell keep their existing design; React context also follows portal content.
const CrmAppearanceContext = createContext(false)

export function CrmAppearanceProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <CrmAppearanceContext.Provider value={enabled}>{children}</CrmAppearanceContext.Provider>
}

export function useCrmAppearance() {
  return useContext(CrmAppearanceContext)
}
