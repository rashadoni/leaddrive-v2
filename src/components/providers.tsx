"use client"

import type { Session } from "next-auth"
import { SessionProvider } from "next-auth/react"
import { createContext, useContext } from "react"
import { SessionSeedGate } from "@/components/session-seed-gate"

// CSP nonce bridge. The root layout (a server component) reads the per-request
// x-nonce header and passes it down; client components that SSR inline
// <script> tags (next-themes' pre-hydration theme-init in theme-provider.tsx)
// consume it via useCspNonce so their scripts pass the enforced
// script-src 'nonce-…' policy instead of being blocked (→ theme flash).
const NonceContext = createContext<string | undefined>(undefined)

export function useCspNonce(): string | undefined {
  return useContext(NonceContext)
}

export function Providers({ children, nonce, session }: { children: React.ReactNode; nonce?: string; session?: Session | null }) {
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
  //
  // `session` is the one the server read while rendering this document
  // (lib/session-seed.ts). With it the provider makes no request of its own on
  // load, and the page starts its data as soon as it is interactive instead of
  // one round-trip later. Absent — a sign-in page, or the read failed — the
  // provider asks `/api/auth/session` itself, as it always did: `undefined`,
  // never `null`, which next-auth would take for «nobody is signed in».
  const seeded = session ?? undefined
  return (
    <NonceContext.Provider value={nonce}>
      <SessionProvider session={seeded} refetchOnWindowFocus={false} refetchInterval={15 * 60}>
        <SessionSeedGate seeded={!!seeded}>{children}</SessionSeedGate>
      </SessionProvider>
    </NonceContext.Provider>
  )
}
