"use client"

import { useCallback, useEffect, useState } from "react"
import { useMessages } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HelpButton } from "@/components/help/help-button"
import { CapabilitiesOverviewContent, type CapabilitiesCopy } from "@/components/marketplace/capabilities-overview"
import type { CapabilityOverview } from "@/lib/capabilities-overview"

export default function MarketplacePage() {
  const copy = (useMessages() as unknown as { capabilitiesPage: CapabilitiesCopy }).capabilitiesPage
  const [overview, setOverview] = useState<CapabilityOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((signal?: AbortSignal) => {
    return fetch("/api/v1/settings/capabilities/overview", { signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "forbidden" : "load")
        const body: { data?: CapabilityOverview } = await response.json()
        if (!body.data || !Array.isArray(body.data.capabilities)) throw new Error("load")
        if (!signal?.aborted) setOverview(body.data)
      })
      .catch((error: Error) => {
        if (!signal?.aborted && error.name !== "AbortError") setError(error.message === "forbidden" ? copy.forbidden : copy.error)
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [copy.error, copy.forbidden])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-7 p-4 sm:p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
          <HelpButton slug="marketplace" variant="label" />
        </div>
        <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>
        <p className="max-w-[75ch] text-xs leading-5 text-muted-foreground">{copy.accessNote}</p>
      </header>
      {loading ? <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{copy.loading}</div> : error ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <p role="alert" className="text-sm leading-6">{error}</p>
          <Button variant="outline" onClick={() => { setLoading(true); setError(null); void load() }}>{copy.retry}</Button>
        </div>
      ) : overview ? <CapabilitiesOverviewContent overview={overview} copy={copy} /> : null}
    </div>
  )
}
