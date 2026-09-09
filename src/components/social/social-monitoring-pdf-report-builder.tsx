"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const REPORT_SECTIONS = [
  "summary",
  "kpis",
  "sentiment",
  "platforms",
  "trend",
  "contentTypes",
  "topFindings",
  "comments",
] as const

type ReportSection = (typeof REPORT_SECTIONS)[number]
type ReportLocale = "az" | "ru" | "en"
type PeriodPreset = "7" | "30" | "90" | "custom"
type ReportSentiment = "positive" | "neutral" | "negative" | "unknown"

const REPORT_SENTIMENTS = ["negative", "neutral", "positive", "unknown"] as const
// Клиент просил именно управляемый объём раздела находок: 10 карточек по
// умолчанию мало для месячного отчёта, 50 — потолок схемы запроса.
const FINDINGS_LIMITS = [10, 20, 30, 50] as const

type MonitoringSubject = {
  id: string
  name: string
  status: string
}

type VisualReportItem = {
  id: string
  subjectIds: string[]
  platform: string
  contentType: string
  sentiment: ReportSentiment
  publishedAt: string
  author: string | null
  authorProfile: { name: string | null; handle: string | null; label: string; profileUrl: string | null } | null
  text: string
  url: string | null
  directCommentUrl: string | null
  parentPostUrl: string | null
  linkKind: "direct_comment" | "parent_post" | "publication" | "missing"
  source: { label: string; handle: string | null; url: string | null; kind: string } | null
}

type VisualReportSnapshot = {
  schemaVersion: "1"
  locale: ReportLocale
  generatedAt: string
  range: { from: string; to: string; days: number }
  sections: ReportSection[]
  organization: { name: string; primaryColor: string }
  subjects: Array<{
    id: string
    name: string
    total: number
    positive: number
    neutral: number
    negative: number
    unknown: number
  }>
  totals: {
    findings: number
    positive: number
    neutral: number
    negative: number
    unknown: number
    engagement: number
    reach: number
  }
  summaryText: string
  sentiment: Array<{ sentiment: ReportSentiment; count: number; percentage: number }>
  platforms: Array<{ platform: string; count: number; percentage: number }>
  trend: Array<{
    date: string
    total: number
    positive: number
    neutral: number
    negative: number
    unknown: number
  }>
  contentTypes: Array<{ contentType: string; count: number; percentage: number }>
  topFindings: VisualReportItem[]
  topFindingsFilter: { sentiments: ReportSentiment[]; matched: number; shown: number }
  comments: VisualReportItem[]
  commentsFilter: { matched: number; shown: number }
  methodology: { truncated: boolean }
}

type Props = {
  orgId: string | number | undefined
}

const SENTIMENT_TONES: Record<ReportSentiment, string> = {
  positive: "bg-emerald-500",
  neutral: "bg-slate-400",
  negative: "bg-rose-500",
  unknown: "bg-amber-400",
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function presetRange(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - (days - 1))
  return { from: dateOnly(from), to: dateOnly(to) }
}

function safeLocale(locale: string): ReportLocale {
  return locale === "az" || locale === "ru" ? locale : "en"
}

function reportDays(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`)
  const toTime = Date.parse(`${to}T00:00:00.000Z`)
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime > toTime) return 0
  return Math.round((toTime - fromTime) / 86_400_000) + 1
}

function MiniDistribution({
  rows,
  colorClassName = "bg-primary",
}: {
  rows: Array<{ label: string; count: number }>
  colorClassName?: string
}) {
  const max = Math.max(1, ...rows.map(row => row.count))
  return (
    <div className="space-y-2">
      {rows.slice(0, 6).map(row => (
        <div key={row.label} className="grid grid-cols-[minmax(0,5.5rem)_1fr_auto] items-center gap-2 text-[8px] sm:text-[9px]">
          <span className="truncate text-zinc-600" title={row.label}>{row.label}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <span
              className={cn("block h-full rounded-full", colorClassName)}
              style={{ width: `${row.count > 0 ? Math.max(4, (row.count / max) * 100) : 0}%` }}
            />
          </span>
          <span className="font-semibold tabular-nums text-zinc-800">{row.count}</span>
        </div>
      ))}
    </div>
  )
}

function TrendPreview({ rows }: { rows: VisualReportSnapshot["trend"] }) {
  const sampled = rows.length > 24
    ? rows.filter((_, index) => index % Math.ceil(rows.length / 24) === 0)
    : rows
  const pointsSource = sampled.length > 1 ? sampled : rows
  const max = Math.max(1, ...pointsSource.map(row => row.total))
  const points = pointsSource.map((row, index) => {
    const x = pointsSource.length === 1 ? 200 : (index / (pointsSource.length - 1)) * 400
    const y = 104 - (row.total / max) * 88
    return `${x},${y}`
  }).join(" ")
  return (
    <svg viewBox="0 0 400 116" role="img" aria-label="Trend" className="h-20 w-full overflow-visible">
      {[16, 38, 60, 82, 104].map(y => (
        <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="currentColor" className="text-zinc-100" strokeWidth="1" />
      ))}
      {points && <polyline points={points} fill="none" stroke="currentColor" className="text-primary" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

export function SocialMonitoringPdfReportBuilder({ orgId }: Props) {
  const t = useTranslations("socialMonitoring.pdfReport")
  const locale = safeLocale(useLocale())
  const [subjects, setSubjects] = useState<MonitoringSubject[]>([])
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([])
  const [subjectsLoading, setSubjectsLoading] = useState(true)
  const [subjectQuery, setSubjectQuery] = useState("")
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("30")
  const [range, setRange] = useState(() => presetRange(30))
  const [sections, setSections] = useState<ReportSection[]>([...REPORT_SECTIONS])
  const [preview, setPreview] = useState<VisualReportSnapshot | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const [findingsLimit, setFindingsLimit] = useState<number>(10)
  const [commentsLimit, setCommentsLimit] = useState<number>(20)
  const [findingsSentiments, setFindingsSentiments] = useState<ReportSentiment[]>([...REPORT_SENTIMENTS])
  const [previewRevision, setPreviewRevision] = useState(0)
  const [downloading, setDownloading] = useState(false)

  const headers = useMemo(
    () => ({ "content-type": "application/json", "x-organization-id": String(orgId ?? "") }),
    [orgId],
  )
  const eligibleSubjects = useMemo(
    () => subjects.filter(subject => !["archived", "deleted"].includes(subject.status)),
    [subjects],
  )
  const filteredSubjects = useMemo(() => {
    const query = subjectQuery.trim().toLocaleLowerCase(locale)
    return query
      ? eligibleSubjects.filter(subject => subject.name.toLocaleLowerCase(locale).includes(query))
      : eligibleSubjects
  }, [eligibleSubjects, locale, subjectQuery])
  const selectedNames = eligibleSubjects.filter(subject => selectedSubjectIds.includes(subject.id))
  const days = reportDays(range.from, range.to)
  const validSelection = Boolean(orgId)
    && selectedSubjectIds.length > 0
    && selectedSubjectIds.length <= 20
    && sections.length > 0
    && findingsSentiments.length > 0
    && days > 0
    && days <= 366

  useEffect(() => {
    setSubjects([])
    setSelectedSubjectIds([])
    setPreview(null)
    setPreviewError(false)
    setPreviewLoading(false)
    if (!orgId) {
      setSubjectsLoading(false)
      return
    }
    const controller = new AbortController()
    setSubjectsLoading(true)
    fetch("/api/v1/social/monitoring-subjects", {
      headers: { "x-organization-id": String(orgId) },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok || !payload.success) throw new Error(payload.error ?? "subjects_failed")
        const nextSubjects = (Array.isArray(payload.data?.subjects) ? payload.data.subjects : []) as MonitoringSubject[]
        const eligible = nextSubjects.filter(subject => !["archived", "deleted"].includes(subject.status))
        setSubjects(nextSubjects)
        setSelectedSubjectIds(eligible.slice(0, 20).map(subject => subject.id))
      })
      .catch(error => {
        if (error instanceof Error && error.name === "AbortError") return
        toast.error(t("loadSubjectsFailed"))
      })
      .finally(() => {
        if (!controller.signal.aborted) setSubjectsLoading(false)
      })
    return () => controller.abort()
  }, [orgId, t])

  // Лимит и тональности — это ДАННЫЕ, а не оформление: они обязаны попасть в
  // общий для превью и PDF запрос, иначе скачанный файл разойдётся с тем, что
  // человек видел на экране.
  const dataRequestBody = useMemo(() => ({
    locale,
    subjectIds: selectedSubjectIds,
    range,
    topFindingsLimit: findingsLimit,
    commentsLimit,
    topFindingsSentiments: findingsSentiments,
  }), [commentsLimit, findingsLimit, findingsSentiments, locale, range, selectedSubjectIds])
  const pdfRequestBody = useMemo(() => ({
    ...dataRequestBody,
    sections,
  }), [dataRequestBody, sections])

  useEffect(() => {
    if (!validSelection) {
      setPreview(null)
      setPreviewError(false)
      setPreviewLoading(false)
      return
    }
    // Never present a snapshot for the previous client/period as if it matched
    // the current controls. Report sections are applied locally, so toggling a
    // section does not repeat the expensive data query.
    setPreview(null)
    setPreviewError(false)
    setPreviewLoading(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch("/api/v1/social/reports/visual", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...dataRequestBody,
          sections: REPORT_SECTIONS,
          format: "json",
        }),
        signal: controller.signal,
      })
        .then(async response => {
          const payload = await response.json().catch(() => null)
          if (!response.ok || !payload?.success) throw new Error(payload?.error ?? "preview_failed")
          setPreview(payload.data as VisualReportSnapshot)
        })
        .catch(error => {
          if (error instanceof Error && error.name === "AbortError") return
          setPreview(null)
          setPreviewError(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewLoading(false)
        })
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [dataRequestBody, headers, previewRevision, validSelection])

  const selectPreset = (preset: Exclude<PeriodPreset, "custom">) => {
    setPeriodPreset(preset)
    setRange(presetRange(Number(preset)))
  }

  const toggleSubject = (subjectId: string) => {
    setSelectedSubjectIds(current => {
      if (current.includes(subjectId)) return current.filter(id => id !== subjectId)
      if (current.length >= 20) {
        toast.error(t("maxClients"))
        return current
      }
      return [...current, subjectId]
    })
  }

  const toggleSection = (section: ReportSection) => {
    setSections(current => current.includes(section)
      ? current.filter(value => value !== section)
      : [...current, section])
  }

  const downloadPdf = async () => {
    if (!validSelection || downloading) return
    setDownloading(true)
    try {
      const response = await fetch("/api/v1/social/reports/visual", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...pdfRequestBody, format: "pdf" }),
      })
      if (!response.ok) throw new Error("download_failed")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      const disposition = response.headers.get("content-disposition") ?? ""
      anchor.href = url
      anchor.download = disposition.match(/filename="([^"]+)"/)?.[1] ?? `social-monitoring-${range.from}-${range.to}.pdf`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success(t("downloadReady"))
    } catch {
      toast.error(t("downloadFailed"))
    } finally {
      setDownloading(false)
    }
  }

  const sentimentTotal = preview?.sentiment.reduce((sum, item) => sum + item.count, 0) ?? 0
  const sectionSelected = (section: ReportSection) => sections.includes(section)

  const toggleFindingSentiment = (sentiment: ReportSentiment) => {
    setFindingsSentiments(current => {
      if (!current.includes(sentiment)) return [...current, sentiment]
      // Пустой набор дал бы пустой раздел находок без объяснения причины.
      if (current.length === 1) {
        toast.error(t("findingsSentimentsRequired"))
        return current
      }
      return current.filter(value => value !== sentiment)
    })
  }

  const previewItem = (item: VisualReportItem) => {
    const contentLinks = item.linkKind === "direct_comment" && item.directCommentUrl
      ? [
          { url: item.directCommentUrl, label: t("directComment") },
          ...(item.parentPostUrl && item.parentPostUrl !== item.directCommentUrl
            ? [{ url: item.parentPostUrl, label: t("parentPublication") }]
            : []),
        ]
      : item.url
        ? [{
            url: item.url,
            label: item.linkKind === "publication" ? t("publication") : t("parentPublication"),
          }]
        : []
    return (
      <div key={item.id} className="rounded-md bg-zinc-50 p-1.5 text-[6px] text-zinc-600">
        <div className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", SENTIMENT_TONES[item.sentiment])} aria-hidden="true" />
          <b className="min-w-0 flex-1 truncate text-zinc-800">{item.platform} · {item.contentType}</b>
        </div>
        {item.source && (
          <p className="mt-0.5 truncate text-zinc-500">
            {t("sourcePage")}: {item.source.url
              ? <a href={item.source.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{item.source.label}</a>
              : item.source.label}
          </p>
        )}
        {item.authorProfile && (
          <p className="truncate text-zinc-500">
            {t("authorProfile")}: {item.authorProfile.profileUrl
              ? <a href={item.authorProfile.profileUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{item.authorProfile.label}</a>
              : item.authorProfile.label}
          </p>
        )}
        <p className="mt-0.5 line-clamp-2 leading-relaxed">{item.text}</p>
        {contentLinks.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
            {contentLinks.map(link => (
              <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                {link.label}
                <ExternalLink className="h-2 w-2" aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-800" aria-labelledby="social-pdf-report-title">
      <div className="flex flex-col gap-4 border-b border-zinc-200 bg-gradient-to-r from-primary/[0.09] via-primary/[0.025] to-transparent px-5 py-5 dark:border-zinc-800 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="social-pdf-report-title" className="text-lg font-semibold">{t("title")}</h2>
              <span className="rounded-full border border-primary/20 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">PDF</span>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <Button className="h-11 shrink-0 gap-2" onClick={() => void downloadPdf()} disabled={!validSelection || downloading}>
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {downloading ? t("downloading") : t("download")}
        </Button>
      </div>

      <div className="grid min-w-0 gap-0 xl:grid-cols-[minmax(19rem,0.8fr)_minmax(0,1.35fr)]">
        <div className="space-y-6 border-b border-zinc-200 p-5 dark:border-zinc-800 xl:border-b-0 xl:border-r">
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("clientsLabel")}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="h-11 w-full justify-start gap-2 px-3 text-left font-normal">
                  <span className="min-w-0 flex-1 truncate">
                    {subjectsLoading
                      ? t("loadingClients")
                      : selectedNames.length === 0
                        ? t("chooseClients")
                        : selectedNames.length <= 2
                          ? selectedNames.map(subject => subject.name).join(" + ")
                          : t("clientsSelected", { count: selectedNames.length })}
                  </span>
                  {selectedNames.length > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{selectedNames.length}</span>}
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[min(25rem,calc(100vw-2rem))] space-y-3 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input value={subjectQuery} onChange={event => setSubjectQuery(event.target.value)} placeholder={t("searchClients")} aria-label={t("searchClients")} className="h-11 pl-9" />
                  {subjectQuery && (
                    <button type="button" onClick={() => setSubjectQuery("")} aria-label={t("clearSearch")} className="absolute right-0 top-0 grid h-11 w-11 place-items-center text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => setSelectedSubjectIds(eligibleSubjects.slice(0, 20).map(subject => subject.id))} className="min-h-11 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/5">{eligibleSubjects.length > 20 ? t("selectFirst", { count: 20 }) : t("selectAll")}</button>
                  <button type="button" onClick={() => setSelectedSubjectIds([])} className="min-h-11 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted">{t("clearAll")}</button>
                </div>
                <div className="max-h-72 space-y-1 overflow-y-auto" role="group" aria-label={t("clientsLabel")}>
                  {filteredSubjects.map(subject => {
                    const selected = selectedSubjectIds.includes(subject.id)
                    return (
                      <button key={subject.id} type="button" aria-pressed={selected} onClick={() => toggleSubject(subject.id)} className={cn("flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors", selected ? "bg-primary/[0.08] font-medium" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>
                        <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border", selected ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600")}>
                          {selected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{subject.name}</span>
                      </button>
                    )
                  })}
                  {!subjectsLoading && filteredSubjects.length === 0 && <p className="px-2 py-8 text-center text-xs text-muted-foreground">{t("noClients")}</p>}
                </div>
                <p className="text-[11px] text-muted-foreground">{t("maxClients")}</p>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("periodLabel")}
            </Label>
            <div className="grid grid-cols-4 gap-1 rounded-xl border bg-muted/35 p-1" role="group" aria-label={t("periodLabel")}>
              {(["7", "30", "90", "custom"] as const).map(preset => (
                <button key={preset} type="button" aria-pressed={periodPreset === preset} onClick={() => preset === "custom" ? setPeriodPreset("custom") : selectPreset(preset)} className={cn("min-h-11 rounded-lg px-2 text-xs font-medium transition-colors", periodPreset === preset ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {preset === "custom" ? t("customPeriod") : t("daysPreset", { days: Number(preset) })}
                </button>
              ))}
            </div>
            {periodPreset === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label htmlFor="social-report-from" className="text-xs">{t("from")}</Label><Input id="social-report-from" type="date" value={range.from} onChange={event => setRange(current => ({ ...current, from: event.target.value }))} className="h-11" /></div>
                <div className="space-y-1"><Label htmlFor="social-report-to" className="text-xs">{t("to")}</Label><Input id="social-report-to" type="date" value={range.to} onChange={event => setRange(current => ({ ...current, to: event.target.value }))} className="h-11" /></div>
              </div>
            )}
            <p className={cn("text-[11px]", days > 0 && days <= 366 ? "text-muted-foreground" : "text-destructive")}>
              {days > 0 && days <= 366 ? t("periodSummary", { from: range.from, to: range.to, days }) : t("invalidPeriod")}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="flex items-center gap-2 text-sm font-semibold">
                <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
                {t("sectionsLabel")}
              </Label>
              <p className="mt-1 text-[11px] text-muted-foreground">{t("sectionsHint")}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2" role="group" aria-label={t("sectionsLabel")}>
              {REPORT_SECTIONS.map(section => {
                const selected = sectionSelected(section)
                return (
                  <button key={section} type="button" aria-pressed={selected} onClick={() => toggleSection(section)} className={cn("flex min-h-11 items-center gap-2 rounded-lg border px-3 text-left text-xs transition-colors", selected ? "border-primary/30 bg-primary/[0.055] font-medium text-foreground" : "border-zinc-200 text-muted-foreground hover:bg-muted/60 dark:border-zinc-700")}>
                    <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border", selected ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600")}>
                      {selected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                    </span>
                    {t(`sections.${section}`)}
                  </button>
                )
              })}
            </div>
          </div>

          {sectionSelected("topFindings") && (
            <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <Label className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
                {t("findingsLabel")}
              </Label>
              <p className="mt-1 text-[11px] text-muted-foreground">{t("findingsHint")}</p>

              <div className="mt-3 text-[11px] font-medium text-muted-foreground">{t("findingsLimitLabel")}</div>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5 rounded-xl bg-muted/60 p-1" role="group" aria-label={t("findingsLimitLabel")}>
                {FINDINGS_LIMITS.map(limit => (
                  <button
                    key={limit}
                    type="button"
                    aria-pressed={findingsLimit === limit}
                    onClick={() => setFindingsLimit(limit)}
                    className={cn(
                      "min-h-11 rounded-lg px-2 text-xs font-medium transition-colors",
                      findingsLimit === limit ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {limit}
                  </button>
                ))}
              </div>

              <div className="mt-3 text-[11px] font-medium text-muted-foreground">{t("findingsSentimentsLabel")}</div>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2" role="group" aria-label={t("findingsSentimentsLabel")}>
                {REPORT_SENTIMENTS.map(sentiment => {
                  const selected = findingsSentiments.includes(sentiment)
                  return (
                    <button
                      key={sentiment}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleFindingSentiment(sentiment)}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-lg border px-3 text-left text-xs transition-colors",
                        selected ? "border-primary/30 bg-primary/[0.055] font-medium text-foreground" : "border-zinc-200 text-muted-foreground hover:bg-muted/60 dark:border-zinc-700",
                      )}
                    >
                      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border", selected ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600")}>
                        {selected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                      </span>
                      <i className={cn("h-1.5 w-1.5 shrink-0 rounded-full", SENTIMENT_TONES[sentiment])} aria-hidden="true" />
                      {t(`sentiments.${sentiment}`)}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{t("findingsSentimentsHint")}</p>
            </div>
          )}

          {sectionSelected("comments") && (
            <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <Label className="flex items-center gap-2 text-sm font-semibold">
                <MessageCircle className="h-4 w-4 text-primary" aria-hidden="true" />
                {t("commentsLabel")}
              </Label>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("commentsHint")}</p>
              <div className="mt-3 text-[11px] font-medium text-muted-foreground">{t("commentsLimitLabel")}</div>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5 rounded-xl bg-muted/60 p-1" role="group" aria-label={t("commentsLimitLabel")}>
                {FINDINGS_LIMITS.map(limit => (
                  <button
                    key={limit}
                    type="button"
                    aria-pressed={commentsLimit === limit}
                    onClick={() => setCommentsLimit(limit)}
                    className={cn(
                      "min-h-11 rounded-lg px-2 text-xs font-medium transition-colors",
                      commentsLimit === limit ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {limit}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 bg-muted/25 p-4 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4 text-primary" />{t("previewTitle")}</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t("previewHint")}</p>
            </div>
            <span className="rounded-full border bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground">A4 · {t("firstPage")}</span>
          </div>

          <div className="relative mx-auto aspect-[210/297] w-full max-w-[48rem] overflow-hidden rounded-[4px] border border-zinc-200 bg-white p-[4.5%] text-zinc-950 shadow-xl shadow-zinc-950/10" aria-busy={previewLoading}>
            {previewLoading && (
              <div className="absolute inset-x-0 top-0 z-10 h-1 overflow-hidden bg-primary/10"><span className="block h-full w-1/2 animate-pulse rounded-full bg-primary" /></div>
            )}
            {!validSelection ? (
              <div className="grid h-full place-items-center text-center"><div><FileText className="mx-auto h-10 w-10 text-zinc-300" /><p className="mt-3 text-sm font-semibold">{t("previewEmptyTitle")}</p><p className="mt-1 max-w-xs text-xs text-zinc-500">{t("previewEmptyHint")}</p></div></div>
            ) : previewError ? (
              <div className="grid h-full place-items-center text-center" role="alert"><div><p className="text-sm font-semibold">{t("previewFailed")}</p><p className="mt-1 text-xs text-zinc-500">{t("previewFailedHint")}</p></div></div>
            ) : preview ? (
              <div className="space-y-[3.2%]">
                <div className="h-1.5 rounded-full bg-primary" style={{ backgroundColor: preview.organization.primaryColor }} />
                <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-[2.5%]">
                  <div><p className="text-[7px] font-semibold uppercase tracking-[0.16em] text-primary">LeadDrive</p><h4 className="mt-1 text-sm font-bold sm:text-base">{t("reportTitle")}</h4></div>
                  <div className="text-right text-[7px] leading-4 text-zinc-500"><p>{preview.organization.name}</p><p>{preview.range.from} — {preview.range.to}</p><p>{t("clientsSelected", { count: preview.subjects.length })}</p></div>
                </div>

                {sectionSelected("summary") && <p className="line-clamp-3 text-[8px] leading-relaxed text-zinc-600 sm:text-[9px]">{preview.summaryText}</p>}

                {sectionSelected("kpis") && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        [t("metrics.findings"), preview.totals.findings, "text-zinc-900"],
                        [t("metrics.negative"), preview.totals.negative, "text-rose-600"],
                        [t("metrics.neutral"), preview.totals.neutral, "text-slate-600"],
                        [t("metrics.positive"), preview.totals.positive, "text-emerald-600"],
                      ].map(([label, value, tone]) => <div key={String(label)} className="rounded-md border border-zinc-100 bg-zinc-50 p-1.5"><p className="truncate text-[6px] text-zinc-500">{label}</p><p className={cn("mt-0.5 text-xs font-bold tabular-nums", tone)}>{value}</p></div>)}
                    </div>
                    <MiniDistribution rows={preview.subjects.map(subject => ({ label: subject.name, count: subject.total }))} />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-[3%]">
                  {sectionSelected("sentiment") && (
                    <div className="rounded-md border border-zinc-100 p-2">
                      <p className="mb-2 text-[8px] font-semibold">{t("sections.sentiment")}</p>
                      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100">{preview.sentiment.map(item => <span key={item.sentiment} className={SENTIMENT_TONES[item.sentiment]} style={{ width: `${sentimentTotal ? (item.count / sentimentTotal) * 100 : 0}%` }} />)}</div>
                      <div className="mt-2 grid grid-cols-2 gap-1">{preview.sentiment.map(item => <span key={item.sentiment} className="flex items-center gap-1 text-[6px] text-zinc-500"><i className={cn("h-1.5 w-1.5 rounded-full", SENTIMENT_TONES[item.sentiment])} />{t(`sentiments.${item.sentiment}`)} {item.count}</span>)}</div>
                    </div>
                  )}
                  {sectionSelected("platforms") && <div className="rounded-md border border-zinc-100 p-2"><p className="mb-2 text-[8px] font-semibold">{t("sections.platforms")}</p><MiniDistribution rows={preview.platforms.map(item => ({ label: item.platform, count: item.count }))} /></div>}
                  {sectionSelected("trend") && <div className="rounded-md border border-zinc-100 p-2"><p className="text-[8px] font-semibold">{t("sections.trend")}</p><TrendPreview rows={preview.trend} /></div>}
                  {sectionSelected("contentTypes") && <div className="rounded-md border border-zinc-100 p-2"><p className="mb-2 text-[8px] font-semibold">{t("sections.contentTypes")}</p><MiniDistribution rows={preview.contentTypes.map(item => ({ label: item.contentType, count: item.count }))} colorClassName="bg-blue-500" /></div>}
                </div>

                {(sectionSelected("topFindings") || sectionSelected("comments")) && (
                  <div className={cn(
                    "grid gap-[3%]",
                    sectionSelected("topFindings") && sectionSelected("comments") && "grid-cols-2",
                  )}>
                    {sectionSelected("topFindings") && preview.topFindings.length > 0 && (
                      <div className="min-w-0">
                        <p className="mb-1.5 text-[8px] font-semibold">{t("sections.topFindings")}</p>
                        {preview.topFindings.slice(0, 1).map(previewItem)}
                        {preview.topFindingsFilter.shown < preview.topFindingsFilter.matched && (
                          <p className="mt-1 text-[6px] text-zinc-500">
                            {t("findingsPreviewCount", {
                              shown: preview.topFindingsFilter.shown,
                              matched: preview.topFindingsFilter.matched,
                            })}
                          </p>
                        )}
                      </div>
                    )}
                    {sectionSelected("comments") && (
                      <div className="min-w-0">
                        <p className="mb-1.5 text-[8px] font-semibold">{t("sections.comments")}</p>
                        {preview.comments.length > 0
                          ? preview.comments.slice(0, 1).map(previewItem)
                          : <p className="rounded-md bg-zinc-50 p-2 text-[6px] text-zinc-500">{t("noComments")}</p>}
                        {preview.commentsFilter.shown < preview.commentsFilter.matched && (
                          <p className="mt-1 text-[6px] text-zinc-500">
                            {t("commentsPreviewCount", {
                              shown: preview.commentsFilter.shown,
                              matched: preview.commentsFilter.matched,
                            })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {preview.methodology.truncated && <p className="rounded bg-amber-50 px-2 py-1 text-[6px] text-amber-800">{t("truncated")}</p>}
              </div>
            ) : (
              <div className="grid h-full place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-muted-foreground">{validSelection ? t("readySummary", { clients: selectedSubjectIds.length, days, sections: sections.length }) : t("selectionRequired")}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="h-11 gap-1.5" disabled={!validSelection || previewLoading} onClick={() => setPreviewRevision(current => current + 1)}>
                <RefreshCw className={cn("h-3.5 w-3.5", previewLoading && "animate-spin")} />{t("refreshPreview")}
              </Button>
              <Button type="button" size="sm" className="h-11 gap-1.5 xl:hidden" disabled={!validSelection || downloading} onClick={() => void downloadPdf()}>
                {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{t("download")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
