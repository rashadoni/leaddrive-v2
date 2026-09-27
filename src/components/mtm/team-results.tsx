"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, MapPin, RefreshCw, Satellite } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { AGENT_PERIOD_PRESETS, agentPeriodPreset } from "@/components/mtm/agent-period-view"
import { formatDate } from "@/lib/format-date"
import { dateInputValueInTimezone } from "@/lib/timezone"
import { mtmPlanTone, mtmTeamResultsByAgent, type MtmTeamResultsRow } from "@/lib/mtm/team-results"

type Preset = (typeof AGENT_PERIOD_PRESETS)[number]

type Fact = { agentId: string; agentName: string; completed: boolean; gpsConfirmed: boolean }
type KpiData = {
  scope?: { from: string; toExclusive: string; timezone: string }
  teams?: Array<{ id: string; name: string }>
  report: {
    plan: { numerator: number; denominator: number; percentage: number }
    gps: { numerator: number; denominator: number; percentage: number }
    trend: Array<{ date: string; planned: number; completed: number; planPercentage: number }>
    drilldown: { planDenominator: Fact[]; gpsDenominator: Fact[] }
  } | null
  contract?: { truncated?: boolean }
}

const TONE_TEXT = {
  good: "text-green-700 dark:text-green-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-red-700 dark:text-red-400",
  none: "text-muted-foreground",
} as const
const TONE_BAR = { good: "bg-green-500", warn: "bg-amber-500", bad: "bg-red-500", none: "bg-muted" } as const

/** A date key is a calendar day: read it at UTC so no timezone moves it. */
function dayLabel(dateKey: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  return formatDate(`${dateKey}T00:00:00.000Z`, locale, { ...options, timeZone: "UTC" })
}

function nextDay(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * «Аналитика» for a manager (owner 2026-09-26). Three numbers in plain words,
 * then every agent with who is behind first, then the days. The numbers are
 * the formula registry's own facts (see src/lib/mtm/team-results.ts); the
 * registry itself sits folded below the page as «Как считаются цифры».
 */
export function MtmTeamResults({ orgId }: { orgId?: string }) {
  const t = useTranslations("mtmTeamResults")
  const locale = useLocale()
  const [preset, setPreset] = useState<Preset>("thisMonth")
  const [teamId, setTeamId] = useState("")
  const [timezone, setTimezone] = useState<string | null>(null)
  const [data, setData] = useState<KpiData | null>(null)
  const [loadedKey, setLoadedKey] = useState("")
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)

  // The first call leaves the range to the server (this month, in the
  // organization's timezone) and learns that timezone for the presets.
  const range = timezone ? agentPeriodPreset(preset, dateInputValueInTimezone(new Date(), timezone)) : null
  const requestKey = `${range?.from ?? ""}|${range?.to ?? ""}|${teamId}|${retry}`

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ visitType: "ALL" })
    if (range) {
      params.set("from", range.from)
      params.set("to", nextDay(range.to))
    }
    if (teamId) params.set("teamId", teamId)
    fetch(`/api/v1/mtm/kpi?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: orgId ? { "x-organization-id": orgId } : {},
    })
      .then((response) => response.json().then((result) => ({ ok: response.ok, result })))
      .then(({ ok, result }) => {
        if (!ok || !result?.success || !result.data) throw new Error("load")
        const next = result.data as KpiData
        setData(next)
        setFailed(false)
        setLoadedKey(requestKey)
        if (!timezone && next.scope?.timezone) setTimezone(next.scope.timezone)
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === "AbortError") return
        setFailed(true)
        setLoadedKey(requestKey)
      })
    return () => controller.abort()
    // `range` is derived from preset and timezone, both in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, requestKey])

  const loading = loadedKey !== requestKey
  const report = data?.report ?? null
  const rows: MtmTeamResultsRow[] = report ? mtmTeamResultsByAgent(report.drilldown) : []
  const shownFrom = range?.from ?? data?.scope?.from ?? null
  const shownTo = range?.to ?? null
  const state = failed ? "error" : loading && !report ? "loading" : "ready"

  return (
    <section data-testid="mtm-team-results" data-state={state} aria-busy={loading} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("period")}>
          {AGENT_PERIOD_PRESETS.map((key) => (
            <Button key={key} type="button" size="sm" variant={preset === key ? "default" : "outline"} className="min-h-10" aria-pressed={preset === key} onClick={() => setPreset(key)}>
              {t(`preset.${key}`)}
            </Button>
          ))}
        </div>
        {data?.teams && data.teams.length > 0 ? (
          <Select value={teamId} onChange={(event) => setTeamId(event.target.value)} className="min-h-10 w-[200px]" aria-label={t("team")}>
            <option value="">{t("allTeams")}</option>
            {data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </Select>
        ) : null}
        {shownFrom && shownTo ? (
          <span className="text-sm text-muted-foreground">{t("range", { from: dayLabel(shownFrom, locale, { day: "numeric", month: "long" }), to: dayLabel(shownTo, locale, { day: "numeric", month: "long" }) })}</span>
        ) : null}
        {loading && report ? <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" /> : null}
      </div>

      {failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-card px-4 py-4 text-sm dark:border-zinc-700">
          {t("loadFailed")}
          <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => setRetry((value) => value + 1)}><RefreshCw className="mr-1.5 h-4 w-4" />{t("retry")}</Button>
        </div>
      ) : !report ? (
        <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((key) => <div key={key} className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />)}
        </div>
      ) : (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {data?.contract?.truncated ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{t("truncated")}</p> : null}

          <div data-testid="mtm-team-results-cards" className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t("cardPlan")}</div>
              <div className={`mt-1 text-3xl font-semibold tabular-nums ${TONE_TEXT[mtmPlanTone(report.plan.denominator > 0 ? report.plan.percentage : null)]}`}>{report.plan.denominator > 0 ? `${report.plan.percentage}%` : "—"}</div>
              <div className="mt-1 text-sm text-muted-foreground">{t("cardPlanDetail", { done: report.plan.numerator, planned: report.plan.denominator })}</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="h-4 w-4" aria-hidden="true" />{t("cardVisits")}</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{report.gps.denominator}</div>
              <div className="mt-1 text-sm text-muted-foreground">{t("cardVisitsDetail")}</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Satellite className="h-4 w-4" aria-hidden="true" />{t("cardGps")}</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{report.gps.denominator > 0 ? `${report.gps.percentage}%` : "—"}</div>
              <div className="mt-1 text-sm text-muted-foreground">{t("cardGpsDetail", { withGps: report.gps.numerator, visits: report.gps.denominator })}</div>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="rounded-xl border border-zinc-200 bg-card px-4 py-6 text-center text-sm text-muted-foreground dark:border-zinc-700">{t("empty")}</p>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
              <h3 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-zinc-700">{t("tableTitle")}</h3>
              <div className="overflow-x-auto">
                <table data-testid="mtm-team-results-agents" className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-muted-foreground dark:border-zinc-700">
                      <th className="px-4 py-2 font-medium">{t("colAgent")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("colPlan")}</th>
                      <th className="px-3 py-2 font-medium">{t("colPercent")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("colVisits")}</th>
                      <th className="px-4 py-2 text-right font-medium">{t("colGps")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const tone = mtmPlanTone(row.planPercent)
                      return (
                        <tr key={row.agentId} className="border-b border-zinc-200 last:border-0 hover:bg-muted/40 dark:border-zinc-700">
                          <td className="px-4 py-2">
                            <Link href={`/mtm/calendar?view=agent&agentId=${encodeURIComponent(row.agentId)}`} className="font-medium text-foreground hover:underline" aria-label={t("openAgent", { name: row.agentName })}>{row.agentName}</Link>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.planned > 0 ? t("doneOfPlanned", { done: row.done, planned: row.planned }) : "—"}</td>
                          <td className="px-3 py-2">
                            {row.planPercent === null ? (
                              <span className="text-xs text-muted-foreground">{t("noPlan")}</span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className={`block h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${row.planPercent}%` }} /></span>
                                <span className={`font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{row.planPercent}%</span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.visits}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{row.visits > 0 ? t("doneOfPlanned", { done: row.withGps, planned: row.visits }) : "—"}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {report.trend.some((day) => day.planned > 0) ? (
            <div className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
              <h3 className="mb-3 text-sm font-semibold">{t("byDay")}</h3>
              <div data-testid="mtm-team-results-days" className="flex h-28 items-end gap-1">
                {report.trend.map((day) => {
                  const tone = mtmPlanTone(day.planned > 0 ? day.planPercentage : null)
                  const label = t("dayTitle", { date: dayLabel(day.date, locale, { weekday: "short", day: "numeric", month: "short" }), done: day.completed, planned: day.planned })
                  return (
                    <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={label}>
                      <span className="sr-only">{label}</span>
                      <span className={`w-full max-w-8 rounded-t ${TONE_BAR[tone]}`} style={{ height: day.planned > 0 ? `${Math.max(4, day.planPercentage)}%` : "2px" }} aria-hidden="true" />
                      <span className="text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">{Number(day.date.slice(8))}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
