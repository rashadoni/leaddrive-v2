"use client"

import { Hint } from "@/components/hint"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { FileText, Download } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { MtmPageHeader } from "@/components/mtm/page-header"
import { ColorStatCard } from "@/components/color-stat-card"
import { Button } from "@/components/ui/button"
import {
  REPORT_GROUPS, REPORT_TYPES, REPORTS, reportEndpoint, reportRowHref, statusClass, statusLabelKey, roleLabelKey, type ReportType,
} from "@/lib/mtm/report-config"
import { previousRangeKeys } from "@/lib/mtm/report-range-keys"
import { formatDate, formatDateTime } from "@/lib/format-date"
import { mtmChipClass } from "@/components/mtm/calm-classes"
import { openRowOnClick } from "@/lib/client/open-row"

type Preset = "today" | "week" | "month" | "lastMonth" | "quarter"
const PRESETS: Preset[] = ["today", "week", "month", "lastMonth", "quarter"]
const PRESET_KEY: Record<Preset, string> = { today: "today", week: "thisWeek", month: "thisMonth", lastMonth: "lastMonth", quarter: "thisQuarter" }
const PAGE_SIZE = 50
/** The report a manager last opened, per browser; a convenience only. */
const LAST_REPORT_KEY = "leaddrive:mtm:reports:type"
function lastReport(): ReportType {
  try {
    const saved = window.localStorage.getItem(LAST_REPORT_KEY)
    if (saved && (REPORT_TYPES as string[]).includes(saved)) return saved as ReportType
  } catch { /* private mode, blocked storage: the first report */ }
  return REPORT_TYPES[0]
}

interface SummaryItem { labelKey: string; value: number | string; kind: string }
interface AgentOption { id: string; name: string; team?: { id: string; name: string; region?: { id: string; name: string } | null } | null }

export default function MtmReportsPage() {
  const t = useTranslations("mtmReports")
  const tActions = useTranslations("mtmVisitPolicies")
  const router = useRouter()
  // What a summary figure counts depends on the report: «Всего» is visits in
  // one and routes in another, so the hint is keyed by both.
  const summaryHint = (labelKey: string) => {
    const key = `hint.${selected}_${labelKey.replace(/^sum\./, "")}`
    return selected && t.has(key) ? t(key) : undefined
  }
  const locale = useLocale()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId

  // Owner, 2026-11-01: «нет от какой даты до какой даты». A preset, or the
  // manager's own two days — whichever was touched last.
  const [preset, setPreset] = useState<Preset | null>("week")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [teamId, setTeamId] = useState("")
  const [regionId, setRegionId] = useState("")
  const [agentId, setAgentId] = useState("")
  const [agents, setAgents] = useState<AgentOption[]>([])
  // The page opens on a report, not on a menu of «0 записей» tiles (owner,
  // 2026-10-16, from a picture): the last one opened, or the first.
  const [selected, setSelected] = useState<ReportType | "">("")
  useEffect(() => { setSelected(lastReport()) }, [])
  const chooseReport = (type: ReportType) => {
    setSelected(type)
    try { window.localStorage.setItem(LAST_REPORT_KEY, type) } catch { /* not remembered */ }
  }
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [summary, setSummary] = useState<SummaryItem[]>([])
  const [previous, setPrevious] = useState<Record<string, number | string>>({})
  const [series, setSeries] = useState<{ date: string; count: number }[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [shownRange, setShownRange] = useState<{ from: string; to: string } | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const headers = useMemo(() => (orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>)), [orgId])
  const customReady = preset === null && from !== "" && to !== "" && from <= to
  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (preset) params.set("period", preset)
    else if (customReady) { params.set("from", from); params.set("to", to) }
    if (teamId) params.set("teamId", teamId)
    if (regionId) params.set("regionId", regionId)
    if (agentId) params.set("agentId", agentId)
    return params.toString()
  }, [preset, customReady, from, to, teamId, regionId, agentId])
  const waiting = preset === null && !customReady

  // Who can be chosen in «Komanda / Rayon / Agent»: the caller's own scope.
  useEffect(() => {
    if (!orgId) return
    void fetch("/api/v1/mtm/agents?limit=500", { headers })
      .then((response) => response.json())
      .then((body) => { if (Array.isArray(body?.data?.agents)) setAgents(body.data.agents as AgentOption[]) })
      .catch(() => undefined)
  }, [orgId, headers])
  const teams = useMemo(() => uniqueBy(agents.flatMap((agent) => agent.team ? [{ id: agent.team.id, name: agent.team.name, regionId: agent.team.region?.id ?? null }] : [])), [agents])
  const regions = useMemo(() => uniqueBy(agents.flatMap((agent) => agent.team?.region ? [agent.team.region] : [])), [agents])
  const agentChoices = useMemo(() => agents
    .filter((agent) => (!teamId || agent.team?.id === teamId) && (!regionId || agent.team?.region?.id === regionId))
    .sort((a, b) => a.name.localeCompare(b.name)), [agents, teamId, regionId])

  // How many records each report holds — the numbers on the report list.
  const loadOverview = useCallback(async () => {
    try {
      const answers = await Promise.all(["reports", "management-reports", "field-reports"].map((endpoint) =>
        fetch(`/api/v1/mtm/${endpoint}?${query}`, { headers }).then((response) => response.json()).catch(() => null)))
      setCounts(Object.assign({}, ...answers.map((answer) => (answer?.success ? answer.data.counts : {}))))
    } catch { /* ignore */ }
  }, [query, headers])

  const endpointOf = reportEndpoint

  const loadReport = useCallback(async (type: ReportType, nextPage: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    try {
      const res = await fetch(`/api/v1/mtm/${endpointOf(type)}?type=${type}&${query}&page=${nextPage}&limit=${PAGE_SIZE}`, { headers })
      const r = await res.json()
      if (!r.success) { toast.error(r.error === "range_too_long" ? t("rangeTooLong") : r.error || t("loadFailed")); return }
      setSummary(r.data.summary || [])
      setSeries(r.data.series || [])
      setTotal(r.data.total || 0)
      setPage(nextPage)
      setRows(prev => append ? [...prev, ...(r.data.reportData || [])] : (r.data.reportData || []))
      if (!append && r.data.from && r.data.to) {
        setShownRange({ from: r.data.from, to: r.data.to })
        // «Compared with the previous period»: the same report for the same
        // number of days right before — its totals only.
        const before = previousRangeKeys(r.data.from, r.data.to)
        const params = new URLSearchParams(query)
        params.delete("period"); params.set("from", before.from); params.set("to", before.to)
        void fetch(`/api/v1/mtm/${endpointOf(type)}?type=${type}&${params.toString()}&page=1&limit=1`, { headers })
          .then((response) => response.json())
          .then((body) => setPrevious(Object.fromEntries(((body?.data?.summary ?? []) as SummaryItem[]).map((item) => [item.labelKey, item.value]))))
          .catch(() => setPrevious({}))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("loadFailed"))
    } finally { setLoading(false); setLoadingMore(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, headers])

  useEffect(() => {
    if (!orgId || waiting) return
    void loadOverview()
  }, [orgId, waiting, loadOverview])
  useEffect(() => {
    if (!orgId || !selected || waiting) return
    setPrevious({})
    void loadReport(selected, 1, false)
  }, [orgId, selected, waiting, loadReport])

  const fmt = (item: SummaryItem): string => {
    if (item.kind === "percent") return `${item.value}%`
    if (item.kind === "minutes") return `${item.value} ${t("minShort")}`
    if (item.kind === "seconds" && typeof item.value === "number") return asMinutesSeconds(item.value)
    return String(item.value)
  }
  /** «+9% keçən dövrə görə»: points for a share, per cent for a count. */
  const deltaOf = (item: SummaryItem): string | undefined => {
    const before = previous[item.labelKey]
    if (typeof item.value !== "number" || typeof before !== "number") return undefined
    if (item.kind === "percent") {
      const diff = item.value - before
      return t("vsPreviousPoints", { diff: diff > 0 ? `+${diff}` : String(diff) })
    }
    if (before === 0) return item.value === 0 ? t("vsPreviousSame") : t("vsPreviousWas", { value: 0 })
    const change = Math.round(((item.value - before) / before) * 100)
    return t("vsPrevious", { change: change > 0 ? `+${change}` : String(change) })
  }

  const cellText = (row: Record<string, unknown>, key: string, kind: string): string => {
    const v = row[key]
    if (kind === "status") return t(statusLabelKey(String(v ?? "")))
    if (kind === "role") return t(roleLabelKey(String(v ?? "")))
    if (kind === "action") return tActions.has(`actions.${String(v)}`) ? tActions(`actions.${String(v)}`) : String(v ?? "—")
    if (kind === "date") return v ? formatDateTime(new Date(String(v)), locale) : "—"
    if (kind === "day") return v ? formatDate(new Date(String(v)), locale, { timeZone: "UTC" }) : "—"
    if (kind === "minutes") return v != null ? `${v} ${t("minShort")}` : "—"
    if (kind === "seconds") return typeof v === "number" ? asMinutesSeconds(v) : "—"
    if (kind === "meters") return typeof v === "number" ? `${v} ${t("metersShort")}` : "—"
    if (kind === "days") return typeof v === "number" ? String(v) : "—"
    if (kind === "lastVisit") return v ? formatDate(new Date(String(v)), locale) : t("neverVisited")
    if (kind === "reasons") return String(v ?? "").split(",").filter(Boolean).map((code) => t(`reason.${code}`)).join(", ")
    if (kind === "percent") return v != null ? `${v}%` : "—"
    if (kind === "number") return String(v ?? 0)
    return v != null && v !== "" ? String(v) : "—"
  }

  // The whole report, every row, in the reader's language (audit 2026-11-01:
  // the file used to be the 50 rows on screen, or the API's field names).
  const exportReport = () => {
    if (!selected || rows.length === 0) { toast.info(t("exportEmpty")); return }
    const anchor = document.createElement("a")
    anchor.href = `/api/v1/mtm/${endpointOf(selected)}?type=${selected}&${query}&format=xlsx&lang=${locale}`
    anchor.download = `mtm-${selected}.xlsx`
    anchor.click()
  }

  const choosePreset = (next: Preset) => { setPreset(next); setFrom(""); setTo("") }
  const chooseDay = (edge: "from" | "to", value: string) => {
    if (preset && shownRange) { setFrom(shownRange.from); setTo(shownRange.to) }
    setPreset(null)
    if (edge === "from") setFrom(value); else setTo(value)
  }
  const showsChart = series.length > 1 && series.some((point) => point.count > 0)

  return (
    <div className="space-y-4">
      <MtmPageHeader
        title={t("title")}
        description={t("description")}
        help="mtm-reports"
        actions={selected ? (
          <Hint text={t("hint.exportFull")}>
            <Button variant="outline" size="sm" onClick={exportReport} className="gap-1.5" data-testid="mtm-report-export">
              <Download className="h-4 w-4" aria-hidden="true" /> {t("exportExcel")}
            </Button>
          </Hint>
        ) : null}
      />

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* The reports by what they are about, each with how many records it
            holds for the period; the chosen one opens on the right. */}
        <nav data-testid="mtm-report-types" role="tablist" aria-orientation="vertical" aria-label={t("title")} className="flex flex-col gap-3">
          {REPORT_GROUPS.map((group) => (
            <div key={group.id} className="space-y-0.5" data-testid={`mtm-report-group-${group.id}`}>
              <p className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`group.${group.id}`)}</p>
              {group.types.map((rt) => {
                const count = counts[rt] ?? 0
                const on = rt === selected
                return (
                  <Hint key={rt} text={t(rt === "agent" ? "hint.recordsAgent" : "hint.recordsOther")}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={on}
                      data-testid={`mtm-report-type-${rt}`}
                      onClick={() => chooseReport(rt)}
                      className={`flex w-full min-h-9 items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm transition-colors ${on
                        ? "crm-choice-selected font-semibold"
                        : count > 0 ? "hover:bg-muted/60" : "text-muted-foreground hover:bg-muted/40"}`}
                    >
                      <span className="min-w-0 truncate">{t(`type_${rt}`)}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
                    </button>
                  </Hint>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          <div className="space-y-2" data-testid="mtm-report-period">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">{t("rangeFrom")}</span>
                <input type="date" value={preset ? shownRange?.from ?? "" : from} max={preset ? undefined : to || undefined}
                  onChange={(event) => chooseDay("from", event.target.value)} data-testid="mtm-report-from"
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">{t("rangeTo")}</span>
                <input type="date" value={preset ? shownRange?.to ?? "" : to} min={preset ? undefined : from || undefined}
                  onChange={(event) => chooseDay("to", event.target.value)} data-testid="mtm-report-to"
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
              </label>
              {PRESETS.map((p) => (
                <Hint key={p} text={t("hint.period")}>
                  <Button variant="outline" size="sm" onClick={() => choosePreset(p)} className={mtmChipClass(preset === p)} data-testid={`mtm-report-preset-${p}`}>
                    {t(PRESET_KEY[p])}
                  </Button>
                </Hint>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect label={t("filterTeam")} value={teamId} onChange={(value) => { setTeamId(value); setAgentId("") }} all={t("filterAll")} options={teams} testId="mtm-report-team" />
              {regions.length > 0 ? <FilterSelect label={t("filterRegion")} value={regionId} onChange={(value) => { setRegionId(value); setAgentId("") }} all={t("filterAll")} options={regions} testId="mtm-report-region" /> : null}
              <FilterSelect label={t("filterAgent")} value={agentId} onChange={setAgentId} all={t("filterAll")} options={agentChoices} testId="mtm-report-agent" />
            </div>
            {waiting ? <p className="text-xs text-muted-foreground">{t("rangePick")}</p> : null}
          </div>

          {selected ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold" data-testid="mtm-report-title">{t(`type_${selected}`)}</h2>
                <p className="text-sm text-muted-foreground">{t(`type_${selected}_desc`)}</p>
              </div>
              {loading ? (
                <div className="animate-pulse space-y-3"><div className="h-24 bg-muted rounded-lg" /><div className="h-56 bg-muted rounded-lg" /></div>
              ) : (
                <>
                  {summary.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 stagger-children">
                      {summary.map((s, i) => (
                        <ColorStatCard key={i} label={t(s.labelKey)} value={fmt(s)} animate={s.kind !== "text"} icon={<FileText className="h-4 w-4" />}
                          hint={summaryHint(s.labelKey)} subValue={deltaOf(s)} />
                      ))}
                    </div>
                  )}

                  {/* A line of one point says nothing: a single day, or a period
                      with nothing in it, is told by the figures above. */}
                  {showsChart ? (
                    <div className="rounded-lg border border-border bg-card p-4" data-testid="mtm-report-chart">
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
                          <XAxis dataKey="date" tickFormatter={(d: unknown) => String(d).slice(5)} tick={{ fontSize: 12 }} stroke="currentColor" className="text-muted-foreground" />
                          <YAxis allowDecimals={false} width={32} tick={{ fontSize: 12 }} stroke="currentColor" className="text-muted-foreground" />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(d: unknown) => formatDate(new Date(`${String(d)}T12:00:00Z`), locale, { timeZone: "UTC" })} />
                          <Area type="monotone" dataKey="count" stroke="hsl(24 95% 53%)" strokeWidth={2} fill="url(#rep-grad)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : null}

                  {rows.length === 0 ? (
                    <div className="h-40 flex items-center justify-center text-muted-foreground border border-border rounded-lg bg-card">{t("noData")}</div>
                  ) : (
                    <div className="rounded-lg border border-border bg-card overflow-hidden">
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
                            {rows.map((row, i) => {
                              const href = reportRowHref(selected, row)
                              return (
                                <tr
                                  key={typeof row.id === "string" || typeof row.id === "number" ? row.id : i}
                                  className={`border-b last:border-0 hover:bg-muted/30 ${href ? "cursor-pointer" : ""}`}
                                  onClick={href ? (event) => openRowOnClick(event, href, (target) => router.push(target)) : undefined}
                                  data-testid="mtm-report-row"
                                >
                                  {REPORTS[selected].columns.map(c => (
                                    <td key={c.key} className="px-4 py-2 whitespace-nowrap">
                                      {c.kind === "status" ? (
                                        <span className={`text-sm font-medium ${statusClass(String(row[c.key] ?? ""))}`}>{cellText(row, c.key, c.kind)}</span>
                                      ) : (
                                        <span className={c.kind === "date" ? "text-muted-foreground" : ""}>{cellText(row, c.key, c.kind)}</span>
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
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
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** 95 → «1:35». */
function asMinutesSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`
}

function uniqueBy<T extends { id: string; name: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()].sort((a, b) => a.name.localeCompare(b.name))
}

function FilterSelect({ label, value, onChange, all, options, testId }: {
  label: string
  value: string
  onChange: (value: string) => void
  all: string
  options: Array<{ id: string; name: string }>
  testId: string
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId}
        className="h-9 min-w-36 rounded-md border border-border bg-background px-2 text-sm">
        <option value="">{all}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  )
}
