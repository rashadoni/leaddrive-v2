"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"
import { useCspNonce } from "@/components/providers"

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // next-themes SSRs an inline theme-init script; without the request nonce the
  // enforced CSP blocks it (pre-hydration theme flash for dark-theme users).
  const nonce = useCspNonce()
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange nonce={nonce}>
      {children}
    </NextThemesProvider>
  )
}
