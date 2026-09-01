"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type QueueItem = { displayReference: string; employeeDisplayName: string; type: string; triageSeverity: string; ageSeconds: number; stage: string; evidenceState: string; employeeResponse: string; nextAction: string }

function formatAge(ageSeconds: number, formatter: Intl.RelativeTimeFormat): string {
  const seconds = Math.max(0, Math.floor(ageSeconds))
  if (seconds < 60) return formatter.format(0, "second")
  if (seconds < 3_600) return formatter.format(-Math.floor(seconds / 60), "minute")
  if (seconds < 86_400) return formatter.format(-Math.floor(seconds / 3_600), "hour")
  return formatter.format(-Math.floor(seconds / 86_400), "day")
}

export function WorkforceExceptionQueue() {
  const { data: session } = useSession()
  const locale = useLocale()
  const t = useTranslations("workforceExceptionQueue")
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [accessDeniedRequestKey, setAccessDeniedRequestKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const requestKey = `${organizationId}:${retry}`
  const accessDenied = accessDeniedRequestKey === requestKey
  const ageFormatter = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "long" }), [locale])

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/v1/workforce/exceptions", {
      headers: organizationId ? { "x-organization-id": organizationId } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        // The server is the only authority after the granular-role cutover.
        // A non-admin with an effective TEAM_EXCEPTION_READ grant must be
        // allowed to reach that server check; conversely an old CRM admin
        // must not be presented as authorized after a 403.
        if (response.status === 403) {
          setItems(null)
          setAccessDeniedRequestKey(requestKey)
          return
        }
        if (!response.ok || !body.success) throw new Error("WORKFORCE_EXCEPTION_QUEUE_LOAD_FAILED")
        setItems(body.data.cases)
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name !== "AbortError") {
          setItems(null)
          setError(t("loadFailed"))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [organizationId, requestKey, t])

  if (accessDenied) {
    return <section className="space-y-6"><PageDescription title={t("title")} description={t("subtitle")} /><div className="rounded-lg border border-zinc-200 p-4 text-sm text-muted-foreground dark:border-zinc-700" role="status">{t("adminOnly")}</div></section>
  }

  return <section className="space-y-6">
    <PageDescription title={t("title")} description={t("subtitle")} />
    <section data-testid="workforce-exception-queue-boundary" aria-labelledby="workforce-exception-queue-boundary" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><div><h2 id="workforce-exception-queue-boundary" className="font-semibold">{t("boundaryTitle")}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("boundaryHint")}</p></div></div>
    </section>
    <div className="flex flex-wrap justify-end gap-2"><Button asChild type="button" variant="outline" className="min-h-11"><Link href="/workforce/exceptions/report">{t("viewAggregateReport")}</Link></Button><Button type="button" variant="outline" className="min-h-11" onClick={() => { setLoading(true); setError(null); setRetry((value) => value + 1) }} disabled={loading}>{loading ? <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="mr-2 size-4" />}{t("refresh")}</Button></div>
    {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
    {loading ? <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{t("loading")}</div> : null}
    {items && !loading ? <section aria-labelledby="workforce-exception-queue-cases" className="rounded-lg border border-zinc-200 dark:border-zinc-700">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-700"><h2 id="workforce-exception-queue-cases" className="font-semibold">{t("casesTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("casesHint", { count: items.length })}</p></div>
      <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" role="region" tabIndex={0} aria-label={t("casesTitle")}><table className="min-w-[1200px] text-left text-sm"><thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-muted-foreground dark:border-zinc-700"><tr><th className="px-4 py-3 font-medium">{t("case")}</th><th className="px-4 py-3 font-medium">{t("employee")}</th><th className="px-4 py-3 font-medium">{t("type")}</th><th className="px-4 py-3 font-medium">{t("severity")}</th><th className="px-4 py-3 font-medium">{t("age")}</th><th className="px-4 py-3 font-medium">{t("stage")}</th><th className="px-4 py-3 font-medium">{t("evidence")}</th><th className="px-4 py-3 font-medium">{t("employeeResponse")}</th><th className="px-4 py-3 font-medium">{t("nextAction")}</th></tr></thead><tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">{items.map((item) => <tr key={item.displayReference}><td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{item.displayReference}</td><td className="px-4 py-3 font-medium">{item.employeeDisplayName}</td><td className="px-4 py-3"><Badge variant="outline">{t(`types.${item.type}`)}</Badge></td><td className="px-4 py-3"><Badge variant={item.triageSeverity === "ATTENTION_REVIEW" ? "secondary" : "outline"}>{t(`severities.${item.triageSeverity}`)}</Badge></td><td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">{formatAge(item.ageSeconds, ageFormatter)}</td><td className="px-4 py-3">{t(`stages.${item.stage}`)}</td><td className="px-4 py-3">{t(`evidenceStates.${item.evidenceState}`)}</td><td className="px-4 py-3">{t(`employeeResponses.${item.employeeResponse}`)}</td><td className="px-4 py-3">{t(`nextActions.${item.nextAction}`)}</td></tr>)}{items.length === 0 ? <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">{t("empty")}</td></tr> : null}</tbody></table></div>
    </section> : null}
  </section>
}
