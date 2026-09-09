/**
 * /offline — served by the service worker as a navigation fallback when the
 * browser is offline and the requested page is not in the precache.
 *
 * Kept intentionally static (no auth, no server data) so serwist can
 * precache it and serve it without a network round-trip.
 *
 * This is a Server Component so it can export metadata. The interactive
 * "Try again" button is extracted into try-again-button.tsx (Client Component).
 */

import type { Metadata } from "next"
import { WifiOff } from "lucide-react"
import { TryAgainButton } from "./try-again-button"

// Force static prerender at build time so serwist can reliably precache this
// URL. Without this, a future accidental dynamic import would silently
// downgrade to SSR and break the offline fallback.
export const dynamic = "force-static"

export const metadata: Metadata = {
  title: "You're offline — LeadDrive",
}

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
        <WifiOff className="h-10 w-10 text-muted-foreground" />
      </div>

      <div className="max-w-sm space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          No internet connection. Pages you&apos;ve already visited are still available below.
          New data will sync automatically when you reconnect.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <a
          href="/dashboard"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Go to Dashboard
        </a>
        <TryAgainButton />
      </div>

      <p className="text-xs text-muted-foreground">
        LeadDrive CRM &mdash; cached for offline use
      </p>
    </div>
  )
}
