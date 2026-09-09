"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  CheckCircle2,
  Clipboard,
  Download,
  FileClock,
  Loader2,
  RefreshCw,
  SearchCheck,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import type { IncrementalMonitoringReport } from "@/lib/social/incremental-monitoring-report"

type Subject = {
  id: string
  name: string
  status: string
}

type Props = {
  orgId: string | number | undefined
}

const platformColor: Record<string, string> = {
  tiktok: "border-zinc-300 bg-zinc-950 text-white dark:border-zinc-700",
  instagram: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-900 dark:bg-fuchsia-950/30 dark:text-fuchsia-300",
  facebook: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300",
  youtube: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
}

export function IncrementalMonitoringReportCard({ orgId }: Props) {
  const t = useTranslations("socialMonitoring.incrementalReport")
  const locale = useLocale()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [subjectId, setSubjectId] = useState("")
  const [report, setReport] = useState<IncrementalMonitoringReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const headers = useMemo(
    () => ({ "x-organization-id": String(orgId ?? "") }),
    [orgId],
  )

  const query = useMemo(() => {
    const params = new URLSearchParams({ locale, days: "7" })
    if (subjectId) params.set("subjectId", subjectId)
    return params.toString()
  }, [locale, subjectId])

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/v1/social/reports/incremental?${query}`, {
        headers,
        cache: "no-store",
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "report_load_failed")
      setReport(payload.data)
    } catch {
      toast.error(t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [headers, orgId, query, t])

  useEffect(() => {
    if (!orgId) return
    fetch("/api/v1/social/monitoring-subjects", { headers, cache: "no-store" })
      .then(response => response.json())
      .then(payload => {
        if (payload.success) {
          setSubjects((payload.data.subjects ?? []).filter((subject: Subject) => subject.status === "active"))
        }
      })
      .catch(() => undefined)
  }, [headers, orgId])

  useEffect(() => {
    if (!orgId) return
    const controller = new AbortController()
    fetch(`/api/v1/social/reports/incremental?${query}`, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok || !payload.success) throw new Error(payload.error ?? "report_load_failed")
        setReport(payload.data)
      })
      .catch(error => {
        if (error instanceof Error && error.name === "AbortError") return
        toast.error(t("loadFailed"))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [headers, orgId, query, t])

  const copySummary = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(report.summaryText)
      toast.success(t("copied"))
    } catch {
      toast.error(t("copyFailed"))
    }
  }

  const download = async () => {
    if (!orgId || exporting) return
    setExporting(true)
    try {
      const response = await fetch(`/api/v1/social/reports/incremental?${query}&format=xlsx`, { headers })
      if (!response.ok) throw new Error("export_failed")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const disposition = response.headers.get("content-disposition") ?? ""
      anchor.href = url
      anchor.download = disposition.match(/filename="([^"]+)"/)?.[1] ?? "social-monitoring-weekly.xlsx"
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t("exportFailed"))
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-800">
      <div className="flex flex-col gap-4 border-b border-zinc-200 bg-gradient-to-r from-primary/[0.07] via-transparent to-transparent px-5 py-4 dark:border-zinc-800 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-primary/15 bg-primary/10 p-2.5 text-primary">
            <FileClock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{t("title")}</h3>
              <span className="rounded-full border border-zinc-200 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground dark:border-zinc-700">
                {t("weekly")}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            aria-label={t("subject")}
            value={subjectId}
            onChange={event => setSubjectId(event.target.value)}
            className="h-9 min-w-52 text-xs"
          >
            <option value="">{t("allSubjects")}</option>
            {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("refresh")}
          </Button>
        </div>
      </div>

      {loading && !report ? (
        <div className="grid animate-pulse grid-cols-2 gap-3 p-5 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 rounded-xl bg-muted" />)}
        </div>
      ) : report ? (
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              { label: t("newFindings"), value: report.totals.newFindings, icon: SearchCheck, tone: "text-primary" },
              { label: t("accepted"), value: report.totals.accepted, icon: CheckCircle2, tone: "text-emerald-600" },
              { label: t("review"), value: report.totals.review, icon: FileClock, tone: "text-amber-600" },
              {
                label: t("excluded"),
                value: report.totals.archiveExcluded + report.totals.unknownDateExcluded + report.totals.duplicatesExcluded,
                icon: RefreshCw,
                tone: "text-muted-foreground",
              },
            ].map(metric => (
              <div key={metric.label} className="rounded-xl border border-zinc-200 bg-background p-3 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">{metric.label}</span>
                  <metric.icon className={`h-3.5 w-3.5 ${metric.tone}`} />
                </div>
                <p className="mt-1 text-xl font-semibold tabular-nums">{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {report.platforms.length > 0 ? report.platforms.map(platform => (
              <span
                key={platform.platform}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${platformColor[platform.platform] ?? "border-zinc-200 bg-muted/40 dark:border-zinc-700"}`}
              >
                <span className="capitalize">{platform.platform}</span>
                <span className="font-semibold tabular-nums">{platform.total}</span>
              </span>
            )) : <p className="text-xs text-muted-foreground">{t("empty")}</p>}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-muted/25 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("clientSummary")}</p>
              <p className="mt-1 text-sm leading-relaxed">{report.summaryText}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void copySummary()}>
                <Clipboard className="h-3.5 w-3.5" />
                {t("copy")}
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => void download()} disabled={exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {t("export")}
              </Button>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("method", {
              archive: report.totals.archiveExcluded,
              unknown: report.totals.unknownDateExcluded,
              duplicates: report.totals.duplicatesExcluded,
            })}
          </p>
        </div>
      ) : null}
    </section>
  )
}
