"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { FileText, Download, ArrowRight, ArrowLeft } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { PageDescription } from "@/components/page-description"
import { ColorStatCard } from "@/components/color-stat-card"
import { Button } from "@/components/ui/button"
import { HelpButton } from "@/components/help/help-button"
import {
  MANAGEMENT_REPORT_TYPES, REPORT_TYPES, REPORTS, statusClass, statusLabelKey, roleLabelKey, type ReportType,
} from "@/lib/mtm/report-config"
import { formatDate, formatDateTime } from "@/lib/format-date"

type Period = "today" | "week" | "month"
const PERIODS: Period[] = ["today", "week", "month"]
const PERIOD_KEY: Record<Period, string> = { today: "today", week: "thisWeek", month: "thisMonth" }
const PAGE_SIZE = 50

interface SummaryItem { labelKey: string; value: number | string; kind: string }

export default function MtmReportsPage() {
  const t = useTranslations("mtmReports")
  const locale = useLocale()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId

  const [period, setPeriod] = useState<Period>("week")
  const [selected, setSelected] = useState<ReportType | "">("")
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [summary, setSummary] = useState<SummaryItem[]>([])
  const [series, setSeries] = useState<{ date: string; count: number }[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const headers = orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>)

  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      const [baseResponse, managementResponse] = await Promise.all([
        fetch(`/api/v1/mtm/reports?period=${period}`, { headers }),
        fetch(`/api/v1/mtm/management-reports?period=${period}`, { headers }),
      ])
      const [base, management] = await Promise.all([baseResponse.json(), managementResponse.json()])
      setCounts({ ...(base.success ? base.data.counts : {}), ...(management.success ? management.data.counts : {}) })
    } catch { /* ignore */ } finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, period])

  const loadReport = useCallback(async (type: ReportType, nextPage: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    try {
      const endpoint = MANAGEMENT_REPORT_TYPES.includes(type) ? "management-reports" : "reports"
      const res = await fetch(`/api/v1/mtm/${endpoint}?type=${type}&period=${period}&page=${nextPage}&limit=${PAGE_SIZE}`, { headers })
      const r = await res.json()
      if (!r.success) { toast.error(r.error || "Failed to load report"); return }
      setSummary(r.data.summary || [])
      setSeries(r.data.series || [])
      setTotal(r.data.total || 0)
      setPage(nextPage)
      setRows(prev => append ? [...prev, ...(r.data.reportData || [])] : (r.data.reportData || []))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Network error")
    } finally { setLoading(false); setLoadingMore(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, period])

  useEffect(() => {
    if (!orgId) return
    if (selected) loadReport(selected, 1, false); else loadOverview()
  }, [orgId, period, selected, loadReport, loadOverview])

  const fmt = (item: SummaryItem): string => {
    if (item.kind === "percent") return `${item.value}%`
    if (item.kind === "minutes") return `${item.value} ${t("minShort")}`
    return String(item.value)
  }

  const cellText = (row: Record<string, unknown>, key: string, kind: string): string => {
    const v = row[key]
    if (kind === "status") return t(statusLabelKey(String(v ?? "")))
    if (kind === "role") return t(roleLabelKey(String(v ?? "")))
    if (kind === "date") return v ? formatDateTime(new Date(String(v)), locale) : "—"
    if (kind === "minutes") return v != null ? `${v} ${t("minShort")}` : "—"
    if (kind === "percent") return v != null ? `${v}%` : "—"
    if (kind === "number") return String(v ?? 0)
    return v != null && v !== "" ? String(v) : "—"
  }

  const exportReport = () => {
    if (!selected || rows.length === 0) { toast.info(t("exportEmpty")); return }
    if (MANAGEMENT_REPORT_TYPES.includes(selected)) {
      const anchor = document.createElement("a")
      anchor.href = `/api/v1/mtm/management-reports?type=${selected}&period=${period}&format=xlsx`
      anchor.download = `mtm-${selected}-${period}.xlsx`
      anchor.click()
      return
    }
    const cols = REPORTS[selected].columns
    const head = cols.map(c => t(c.labelKey))
    const body = rows.map(row => cols.map(c => cellText(row, c.key, c.kind)))
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
    const csv = [head, ...body].map(r => r.map(esc).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url; a.download = `mtm-${selected}-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PageDescription icon={FileText} title={t("title")} description={t("description")} />
          <HelpButton slug="mtm-reports" variant="label" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map(p => (
            <Button key={p} variant={period === p ? "default" : "outline"} size="sm" onClick={() => setPeriod(p)}>
              {t(PERIOD_KEY[p])}
            </Button>
          ))}
          {selected && (
            <Button variant="outline" size="sm" onClick={exportReport}>
              <Download className="h-4 w-4 mr-1" /> {t("export")}
            </Button>
          )}
        </div>
      </div>

      {!selected ? (
        loading ? (
          <div className="animate-pulse grid gap-3 md:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <div key={i} className="h-40 bg-muted rounded-lg" />)}</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {REPORT_TYPES.map(rt => {
              const def = REPORTS[rt]
              const Icon = def.icon
              return (
                <div key={rt} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 hover:shadow-md transition-shadow flex flex-col">
                  <div className="flex items-start justify-between">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${def.iconClass}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{t("records", { count: counts[rt] ?? 0 })}</span>
                  </div>
                  <h3 className="font-semibold mt-3">{t(`type_${rt}`)}</h3>
                  <p className="text-sm text-muted-foreground mt-1 flex-1">{t(`type_${rt}_desc`)}</p>
                  <div className="flex items-center justify-end mt-4">
                    <Button variant="link" size="sm" className="text-primary p-0 h-auto" onClick={() => setSelected(rt)}>
                      {t("view")} <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected("")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> {t("backToReports")}
            </Button>
            <h3 className="font-semibold">{t(`type_${selected}`)}</h3>
          </div>

          {loading ? (
            <div className="animate-pulse space-y-3"><div className="h-24 bg-muted rounded-lg" /><div className="h-56 bg-muted rounded-lg" /></div>
          ) : (
            <>
              {/* Summary aggregates */}
              {summary.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 stagger-children">
                  {summary.map((s, i) => (
                    <ColorStatCard key={i} label={t(s.labelKey)} value={fmt(s)} animate={s.kind !== "text"} icon={<FileText className="h-4 w-4" />} />
                  ))}
                </div>
              )}

              {/* Trend chart */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">{t("trend")}</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={series} margin={{ top: 5, right: 12, bottom: 5, left: -12 }}>
                    <defs>
                      <linearGradient id="rep-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(24 95% 53%)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(24 95% 53%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d: unknown) => String(d).slice(5)} tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" />
                    <YAxis allowDecimals={false} width={32} tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(d: unknown) => formatDate(new Date(String(d)), locale)} />
                    <Area type="monotone" dataKey="count" stroke="hsl(24 95% 53%)" strokeWidth={2} fill="url(#rep-grad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Detail table */}
              {rows.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card">{t("noData")}</div>
              ) : (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-left">
                          {REPORTS[selected].columns.map(c => (
                            <th key={c.key} className="px-4 py-2 font-medium whitespace-nowrap">{t(c.labelKey)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={typeof row.id === "string" || typeof row.id === "number" ? row.id : i} className="border-b last:border-0 hover:bg-muted/30">
                            {REPORTS[selected].columns.map(c => (
                              <td key={c.key} className="px-4 py-2 whitespace-nowrap">
                                {c.kind === "status" ? (
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass(String(row[c.key] ?? ""))}`}>{cellText(row, c.key, c.kind)}</span>
                                ) : (
                                  <span className={c.kind === "date" ? "text-muted-foreground text-xs" : ""}>{cellText(row, c.key, c.kind)}</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 text-xs text-muted-foreground">
                    <span>{t("showingOf", { shown: rows.length, total })}</span>
                    {rows.length < total && (
                      <Button size="sm" variant="outline" onClick={() => loadReport(selected, page + 1, true)} disabled={loadingMore}>
                        {t("loadMore")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
