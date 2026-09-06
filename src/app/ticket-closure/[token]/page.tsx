"use client"

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useParams } from "next/navigation"
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/format-date"

type ClosureStatus = "pending" | "confirmed" | "rejected" | "expired" | "canceled"

type ClosureRequestView = {
  id: string
  status: ClosureStatus
  dueAt: string
  ticket: {
    ticketNumber: string | null
    subject: string
    status: string
  }
}

export default function TicketClosurePage() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const t = useTranslations("portal")
  const locale = useLocale()
  const [request, setRequest] = useState<ClosureRequestView | null>(null)
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

  const isPending = request?.status === "pending"
  const statusLabel = request ? t(`closureStatus.${request.status}`) : ""

  return (
    <main data-testid="ticket-closure-workspace" data-state={loading ? "loading" : error && !request ? "error" : "ready"} data-status={request?.status || "unknown"} className="grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground sm:py-12">
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
          <div className="space-y-5">
            <header>
              <p className="text-sm text-muted-foreground">{request.ticket.ticketNumber || t("ticketFallback")}</p>
              <h1 id="closure-title" className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{t("closureTitle")}</h1>
              <p className="mt-2 max-w-[65ch] text-sm leading-6 text-muted-foreground">{request.ticket.subject}</p>
            </header>

            <dl className="divide-y rounded-md border text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <dt className="text-muted-foreground">{t("closureRequestStatus")}</dt>
                <dd className="font-medium">{statusLabel}</dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <dt className="text-muted-foreground">{t("closureAutoClose")}</dt>
                <dd className="font-medium"><time dateTime={request.dueAt}>{formatDate(request.dueAt, locale, { dateStyle: "medium", timeStyle: "short" })}</time></dd>
              </div>
            </dl>

            {message && <p data-testid="ticket-closure-success" className="rounded-md border px-3 py-2.5 text-sm" role="status" aria-live="polite">{message}</p>}
            {error && <p data-testid="ticket-closure-save-error" className="rounded-md border px-3 py-2.5 text-sm" role="alert">{error}</p>}

            {isPending ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button data-testid="ticket-closure-confirm" className="min-h-11 sm:flex-1" onClick={() => void submit("confirm")} disabled={Boolean(submitting)}>
                  {submitting === "confirm" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                  {t("closureConfirm")}
                </Button>
                <Button data-testid="ticket-closure-reject" variant="outline" className="min-h-11 sm:flex-1" onClick={() => void submit("reject")} disabled={Boolean(submitting)}>
                  {submitting === "reject" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                  {t("closureReject")}
                </Button>
              </div>
            ) : (
              <p data-testid="ticket-closure-outcome" className="text-sm leading-6 text-muted-foreground" role="status">{t(`closureOutcome.${request.status}`)}</p>
            )}
          </div>
        ) : null}
      </section>
    </main>
  )
}
