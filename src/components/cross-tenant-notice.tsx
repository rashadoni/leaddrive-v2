"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { readCrossTenantSignal, type CrossTenantSignal } from "@/lib/cross-tenant-signal"

/**
 * Says out loud what a cross-tenant tab was doing silently.
 *
 * The session cookie holds one organisation; a tab of any other gets 401 on every API call
 * (src/proxy.ts). Before this, exactly one screen in the product reacted to that answer, so
 * everywhere else the tab just went quiet — and a refusal nobody can see is indistinguishable from
 * a broken workspace.
 *
 * `window.fetch` is wrapped once rather than each of the hundreds of call sites changed: the wrapper
 * OBSERVES and never alters, the caller gets the very response the server sent, and the body is read
 * from a clone so nobody's `await res.json()` finds it consumed.
 */

type Listener = (signal: CrossTenantSignal) => void

const listeners = new Set<Listener>()
let patched = false

function install() {
  if (patched || typeof window === "undefined" || typeof window.fetch !== "function") return
  patched = true
  const original = window.fetch.bind(window)
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await original(...args)
    // Only 401, only while somebody is listening, and never on the response the caller receives.
    if (response.status === 401 && listeners.size > 0) {
      try {
        const copy = response.clone()
        void copy
          .json()
          .then((body: unknown) => {
            const signal = readCrossTenantSignal(401, body)
            if (signal) listeners.forEach((listener) => listener(signal))
          })
          .catch(() => {
            // Not JSON, or the body never arrived. Not our case; stay quiet.
          })
      } catch {
        // A response whose body is already being read cannot be cloned. Nothing to report.
      }
    }
    return response
  }
}

/** Exported for the test: the wrapper is installed once per page, not once per mount. */
export function subscribeToCrossTenantRefusals(listener: Listener): () => void {
  install()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function CrossTenantNotice() {
  const t = useTranslations("auth")
  const [signal, setSignal] = useState<CrossTenantSignal | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => subscribeToCrossTenantRefusals((next) => {
    // The first refusal explains the tab; the ones behind it say the same thing. And a person who
    // closed this once is not told again — they chose to stay and read what is on screen.
    setSignal((current) => current ?? next)
  }), [])

  if (!signal || dismissed) return null

  const host = signal.hostSlug
  const session = signal.sessionSlug

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cross-tenant-title"
      data-testid="cross-tenant-notice"
    >
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-background p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          <div className="space-y-2">
            <h2 id="cross-tenant-title" className="text-base font-semibold">{t("crossTenantTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {host && session ? t("crossTenantBody", { host, session }) : t("crossTenantBodyUnknown")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setDismissed(true)}>{t("crossTenantDismiss")}</Button>
          <Button onClick={() => window.location.assign("/login")}>
            {host ? t("crossTenantSignInNamed", { host }) : t("crossTenantSignIn")}
          </Button>
        </div>
      </div>
    </div>
  )
}
