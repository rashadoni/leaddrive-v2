"use client"

import { useEffect } from "react"
import { CheckCircle2, CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DEMO_JOURNEY_STRINGS as S } from "./journey/strings"

const RESULTS: Record<string, { text: string; ok: boolean }> = {
  connected: { text: S.socialResultConnected, ok: true },
  choose: { text: S.socialResultChoose, ok: true },
  refused: { text: S.socialResultRefused, ok: false },
  denied: { text: S.socialResultDenied, ok: false },
  expired: { text: S.socialResultExpired, ok: false },
  failed: { text: S.socialResultFailed, ok: false },
}

/**
 * The tab Meta sent back: one sentence on what happened, a button to close it,
 * and — when the Page connected or is waiting for the choice — an attempt to
 * close itself, since the demo tab already shows the rest.
 */
export function DemoSocialResult({ result }: { result: string }) {
  const shown = RESULTS[result] ?? RESULTS.failed
  useEffect(() => {
    if (!shown.ok) return
    const timer = setTimeout(() => window.close(), 2_500)
    return () => clearTimeout(timer)
  }, [shown.ok])
  const Icon = shown.ok ? CheckCircle2 : CircleAlert
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div data-testid="demo-social-result" data-result={result} className="w-full max-w-md rounded-xl border border-zinc-200 bg-card p-5 text-center dark:border-zinc-700">
        <Icon className={shown.ok ? "mx-auto h-8 w-8 text-emerald-600" : "mx-auto h-8 w-8 text-amber-600"} aria-hidden="true" />
        <p className="mt-3 break-words text-sm leading-relaxed">{shown.text}</p>
        <Button className="mt-4" variant="outline" onClick={() => window.close()}>
          {S.socialResultClose}
        </Button>
      </div>
    </main>
  )
}
