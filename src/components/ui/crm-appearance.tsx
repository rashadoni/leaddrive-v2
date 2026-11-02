"use client"

import { createContext, useContext, type ReactNode } from "react"

// One appearance for the authenticated CRM, including home and portal content.
// Public pages and exported document/email content do not opt into this scope.
const CrmAppearanceContext = createContext(false)

export function CrmAppearanceProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <CrmAppearanceContext.Provider value={enabled}>{children}</CrmAppearanceContext.Provider>
}

export function useCrmAppearance() {
  return useContext(CrmAppearanceContext)
}
