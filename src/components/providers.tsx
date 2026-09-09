"use client"

import { SessionProvider } from "next-auth/react"
import { createContext, useContext } from "react"

// CSP nonce bridge. The root layout (a server component) reads the per-request
// x-nonce header and passes it down; client components that SSR inline
// <script> tags (next-themes' pre-hydration theme-init in theme-provider.tsx)
// consume it via useCspNonce so their scripts pass the enforced
// script-src 'nonce-…' policy instead of being blocked (→ theme flash).
const NonceContext = createContext<string | undefined>(undefined)

export function useCspNonce(): string | undefined {
  return useContext(NonceContext)
}

export function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  // A 15-min interval keeps `session.user.modules` fresh so a superadmin's
  // per-tenant module toggle propagates to affected users without a re-login
  // (the JWT callback re-materialises `features`→`modules` on each session read).
  // The interval only fires while the tab is visible.
  //
  // refetchOnWindowFocus is DISABLED on purpose: with many app tabs open, every
  // tab-switch fired a `/api/auth/session` fetch in each tab, and that burst was
  // the main amplifier for the intermittent Cloudflare-edge 503s on that endpoint
  // (which left the client with no session → KPI Arena stuck loading). Disabling
  // focus-refetch + widening the interval cuts session-endpoint pressure sharply.
  // Session invalidation ("logout everywhere" / password change) is unaffected:
  // every API call re-checks staleness server-side (requireAuth → 401), and the
  // interval + next navigation still catch it within minutes.
  return (
    <NonceContext.Provider value={nonce}>
      <SessionProvider refetchOnWindowFocus={false} refetchInterval={15 * 60}>
        {children}
      </SessionProvider>
    </NonceContext.Provider>
  )
}
