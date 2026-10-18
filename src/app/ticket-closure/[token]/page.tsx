"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useParams } from "next/navigation"
import { CircleAlert, Loader2, RefreshCw } from "lucide-react"
import { ThemeProvider } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { TicketClosureRequestView, type TicketClosureRequest } from "@/components/tickets/ticket-closure-request-view"

export default function TicketClosurePage() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const t = useTranslations("portal")
  const [request, setRequest] = useState<TicketClosureRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<"confirm" | "reject" | null>(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`/api/v1/public/ticket-closure/${encodeURIComponent(token)}`, {
        cache: "no-store",
        signal,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) throw new Error(t("closureLoadFailed"))
      setRequest(body.data)
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return
      setError(loadError instanceof Error ? loadError.message : t("closureLoadFailed"))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [t, token])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function submit(action: "confirm" | "reject") {
    if (submitting || request?.status !== "pending") return
    setSubmitting(action)
    setError("")
    setMessage("")
    try {
      const response = await fetch(`/api/v1/public/ticket-closure/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) throw new Error(t("closureSaveFailed"))
      setRequest((current) => current ? {
        ...current,
        status: body.data.status,
        ticket: body.data.ticket || current.ticket,
      } : current)
      setMessage(action === "confirm" ? t("closureConfirmedMessage") : t("closureRejectedMessage"))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("closureSaveFailed"))
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <ThemeProvider>
      <main data-testid="ticket-closure-workspace" data-state={loading ? "loading" : error && !request ? "error" : "ready"} data-status={request?.status || "unknown"} className="customer-support-surface grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground sm:py-12">
        <section className="w-full max-w-xl rounded-lg border bg-background p-4 sm:p-6" aria-labelledby="closure-title">
        {loading ? (
          <div data-testid="ticket-closure-loading" className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" aria-busy="true" aria-label={t("closureLoading")}>
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {t("closureLoading")}
          </div>
        ) : error && !request ? (
          <div data-testid="ticket-closure-error" className="py-4 text-center" role="alert">
            <CircleAlert className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
            <h1 id="closure-title" className="mt-3 text-xl font-semibold">{t("closureUnavailableTitle")}</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{error}</p>
            <Button data-testid="ticket-closure-retry" variant="outline" className="mt-5 min-h-11" onClick={() => void load()}>
              <RefreshCw aria-hidden="true" />{t("tryAgain")}
            </Button>
          </div>
        ) : request ? (
          <TicketClosureRequestView request={request} submitting={submitting} message={message} error={error} onSubmit={(action) => void submit(action)} />
        ) : null}
        </section>
      </main>
    </ThemeProvider>
  )
}
