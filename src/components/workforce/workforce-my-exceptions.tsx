"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type OwnException = {
  caseId: string
  displayReference: string
  type: string
  createdAt: string
  workdayId: string
  workDate: string
  availableAction: "REQUEST_CORRECTION"
  responseState: "UNAVAILABLE" | "NOT_ACKNOWLEDGED" | "ACKNOWLEDGED"
}

type EmployeeResponseRecording = "MIGRATION_REQUIRED" | "AVAILABLE"

/** Employee-only projection. The server has already removed raw attendance proof. */
export function WorkforceMyExceptions() {
  const { data: session } = useSession()
  const locale = useLocale()
  const t = useTranslations("workforceMyExceptions")
  const tTypes = useTranslations("workforceExceptionQueue")
  const [items, setItems] = useState<OwnException[] | null>(null)
  const [responseRecording, setResponseRecording] = useState<EmployeeResponseRecording | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [acknowledgingCaseId, setAcknowledgingCaseId] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale])

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/v1/workforce/exceptions/mine", {
      headers: organizationId ? { "x-organization-id": organizationId } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (
          !response.ok
          || !body.success
          || !Array.isArray(body.data?.cases)
          || (body.data?.responseRecording !== "MIGRATION_REQUIRED" && body.data?.responseRecording !== "AVAILABLE")
        ) throw new Error("WORKFORCE_MY_EXCEPTIONS_LOAD_FAILED")
        setItems(body.data.cases)
        setResponseRecording(body.data.responseRecording)
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name !== "AbortError") {
          setItems(null)
          setResponseRecording(null)
          setError(t("loadFailed"))
        }
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [organizationId, retry, t])

  async function acknowledgeForReview(item: OwnException) {
    if (responseRecording !== "AVAILABLE" || !globalThis.crypto?.randomUUID) {
      setError(t("acknowledgeFailed"))
      return
    }
    setAcknowledgingCaseId(item.caseId)
    setError(null)
    try {
      const response = await fetch(`/api/v1/workforce/exceptions/${encodeURIComponent(item.caseId)}/response`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(organizationId ? { "x-organization-id": organizationId } : {}),
        },
        body: JSON.stringify({ responseCode: "ACKNOWLEDGED", clientResponseId: globalThis.crypto.randomUUID() }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success || typeof body.data?.responseId !== "string") {
        throw new Error("WORKFORCE_EXCEPTION_ACKNOWLEDGEMENT_FAILED")
      }
      setRetry((value) => value + 1)
    } catch {
      setError(t("acknowledgeFailed"))
    } finally {
      setAcknowledgingCaseId(null)
    }
  }

  return <section className="space-y-6">
    <PageDescription title={t("title")} description={t("subtitle")} />
    <section data-testid="workforce-my-exceptions-boundary" aria-labelledby="workforce-my-exceptions-boundary" className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><div><h2 id="workforce-my-exceptions-boundary" className="font-semibold">{t("boundaryTitle")}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("boundaryHint")}</p></div></div>
    </section>
    {responseRecording === "MIGRATION_REQUIRED" ? <section data-testid="workforce-my-exceptions-response-boundary" aria-labelledby="workforce-my-exceptions-response-boundary" className="rounded-lg border border-zinc-200 bg-muted/30 p-4 dark:border-zinc-700">
      <h2 id="workforce-my-exceptions-response-boundary" className="font-semibold">{t("responseRecordingUnavailableTitle")}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("responseRecordingUnavailableHint")}</p>
    </section> : null}
    <div className="flex justify-end"><Button type="button" variant="outline" className="min-h-11" onClick={() => { setLoading(true); setError(null); setRetry((value) => value + 1) }} disabled={loading}>{loading ? <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="mr-2 size-4" />}{t("refresh")}</Button></div>
    {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
    {loading ? <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{t("loading")}</div> : null}
    {items && !loading ? <section aria-labelledby="workforce-my-exceptions-list" className="rounded-lg border border-zinc-200 dark:border-zinc-700">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-700"><h2 id="workforce-my-exceptions-list" className="font-semibold">{t("casesTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("casesHint", { count: items.length })}</p></div>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">{items.map((item) => <article key={item.caseId} className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-muted-foreground">{item.displayReference}</span><Badge variant="outline">{tTypes(`types.${item.type}`)}</Badge></div><p className="mt-2 text-sm font-medium">{t("workday", { date: dateFormatter.format(new Date(`${item.workDate.slice(0, 10)}T12:00:00`)) })}</p><p className="mt-1 text-xs text-muted-foreground">{t("raised", { date: dateFormatter.format(new Date(item.createdAt)) })}</p></div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row md:flex-col"><Button asChild className="min-h-11"><Link href={`/workforce/requests?correctionWorkdayId=${encodeURIComponent(item.workdayId)}&exceptionCaseId=${encodeURIComponent(item.caseId)}`}>{t("requestCorrection")}</Link></Button><p className="max-w-72 text-xs leading-5 text-muted-foreground">{t("requestCorrectionHint")}</p>{responseRecording === "AVAILABLE" && item.responseState === "NOT_ACKNOWLEDGED" ? <><Button type="button" variant="outline" className="min-h-11" disabled={acknowledgingCaseId !== null} onClick={() => void acknowledgeForReview(item)}>{acknowledgingCaseId === item.caseId ? <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" /> : null}{t("acknowledgeForReview")}</Button><p className="max-w-72 text-xs leading-5 text-muted-foreground">{t("acknowledgeForReviewHint")}</p></> : null}{responseRecording === "AVAILABLE" && item.responseState === "ACKNOWLEDGED" ? <p className="max-w-72 text-xs leading-5 text-muted-foreground" role="status">{t("acknowledgedForReview")}</p> : null}</div>
      </article>)}{items.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">{t("empty")}</p> : null}</div>
    </section> : null}
  </section>
}
