"use client"

import { Hint, HintValue } from "@/components/hint"
import { useState, type ReactNode } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, MapPin, Navigation, Users, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HomeCard, HomeCardFoot, HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { createDateFormatter } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import {
  buildAgentWeek,
  percentOf,
  type HomeAgentState,
  type HomeCellTone,
  type HomeDayCell,
  type HomeTeamEntry,
  type HomeTeamRow,
  type HomeWeekDay,
  type HomeWeekFacts,
  type HomeWeekTotals,
} from "@/lib/mtm/home-dashboard"
import type { HomeRecentVisit } from "@/lib/mtm/home-insights"

/**
 * «Komanda · bu həftə»: every field agent with where they stand now and a
 * strip of the week — visited / planned per day, coloured by how the day
 * went. The strip is built from the facts «Результаты» counts.
 */

/** Rows shown before «N more»: the card grows in the page, it never scrolls inside. */
export const HOME_TEAM_ROWS_SHOWN = 8
/**
 * Up to this many agents, the card also lists the last visits: a team of one
 * is one row, and what that one person did last is the next thing to ask.
 */
export const HOME_TEAM_RECENT_UP_TO = 2

export type HomeTeamCardRow = HomeTeamRow & { agentId: string; name: string }

/*
 * A day is a white cell with its figure; how it went is the dot under the
 * figure, not a cell filled red or green (owner-approved colours, 2026-10-18).
 */
const CELL: Record<HomeCellTone, string> = {
  full: "border border-zinc-200 text-foreground dark:border-zinc-700",
  partial: "border border-zinc-200 text-foreground dark:border-zinc-700",
  missed: "border border-zinc-200 text-foreground dark:border-zinc-700",
  pending: "border border-zinc-300 text-foreground dark:border-zinc-600",
  upcoming: "border border-zinc-200 text-muted-foreground dark:border-zinc-700",
  visited: "border border-zinc-200 text-foreground dark:border-zinc-700",
  off: "border border-dashed border-zinc-300 text-transparent dark:border-zinc-600",
  none: "border border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
}

const DOT: Partial<Record<HomeCellTone, string>> = {
  full: "bg-emerald-500",
  partial: "bg-amber-400",
  missed: "bg-rose-500",
  visited: "bg-sky-500",
}

const LEGEND: ReadonlyArray<{ tone: HomeCellTone; key: "legendFull" | "legendPartial" | "legendMissed" | "legendNone" | "legendOff" }> = [
  { tone: "full", key: "legendFull" },
  { tone: "partial", key: "legendPartial" },
  { tone: "missed", key: "legendMissed" },
  { tone: "none", key: "legendNone" },
  { tone: "off", key: "legendOff" },
]

const STATE_TONE: Record<HomeAgentState["kind"], HomeTone> = {
  "at-customer": "green",
  heading: "blue",
  "plan-done": "green",
  "not-started": "zinc",
  unplanned: "amber",
  "last-visit": "zinc",
  "no-activity": "zinc",
}

const STATE_KEY = {
  "at-customer": "stateAtCustomer",
  heading: "stateHeading",
  "plan-done": "statePlanDone",
  "not-started": "stateNotStarted",
  unplanned: "stateUnplanned",
  "last-visit": "stateLastVisit",
  "no-activity": "stateNoActivity",
} as const satisfies Record<HomeAgentState["kind"], string>

/** What each state means, said under the cursor on its chip. */
const STATE_HINT_KEY = {
  "at-customer": "hint.stateAtCustomer",
  heading: "hint.stateHeading",
  "plan-done": "hint.statePlanDone",
  "not-started": "hint.stateNotStarted",
  unplanned: "hint.stateUnplanned",
  "last-visit": "hint.stateLastVisit",
  "no-activity": "hint.stateNoActivity",
} as const satisfies Record<HomeAgentState["kind"], string>

function stateIcon(kind: HomeAgentState["kind"]): ReactNode {
  if (kind === "at-customer") return <MapPin className="h-3 w-3" aria-hidden="true" />
  if (kind === "heading") return <Navigation className="h-3 w-3" aria-hidden="true" />
  if (kind === "plan-done") return <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
  return null
}

export function cellText(cell: HomeDayCell): string {
  if (cell.tone === "off") return ""
  if (cell.tone === "none") return "–"
  if (cell.tone === "upcoming") return String(cell.planned)
  if (cell.tone === "visited") return String(cell.visits)
  return `${cell.done}/${cell.planned}`
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "—"
}

/** A calendar day: a date key is read at UTC so no timezone moves it. */
function dayLabel(value: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${value}T12:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? value : createDateFormatter(locale, { timeZone: "UTC", ...options }).format(date)
}

function clock(value: string | null, locale: string, timezone: string): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  try {
    return createDateFormatter(locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date)
  } catch {
    return createDateFormatter(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)
  }
}

export function HomeTeamCard<Row extends HomeTeamCardRow>({
  team,
  hasCards,
  loading,
  failed,
  today,
  timezone,
  week,
  facts,
  weekFailed,
  totals,
  recentVisits = [],
  onRetry,
  onRetryWeek,
  onOpenAgent,
}: {
  team: ReadonlyArray<HomeTeamEntry<Row>>
  /** Whether the scope holds any card at all: an office-only team is not «no employees». */
  hasCards: boolean
  loading: boolean
  failed: boolean
  today: string | null
  timezone: string
  week: readonly HomeWeekDay[]
  /** Null while the week is loading, refused or failed: the strip is then not drawn. */
  facts: HomeWeekFacts | null
  weekFailed: boolean
  totals: HomeWeekTotals | null
  /** The last visits in scope, newest first; drawn for a small team only. */
  recentVisits?: readonly HomeRecentVisit[]
  onRetry: () => void
  onRetryWeek: () => void
  onOpenAgent: (agentId: string, day?: string) => void
}) {
  const t = useTranslations("mtmDashboardPage.home")
  const tw = useTranslations("mtmDashboardPage.operationalWeek")
  const locale = useLocale()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? team : team.slice(0, HOME_TEAM_ROWS_SHOWN)
  const hidden = team.length - shown.length
  const customer = (value: string | null) => value || tw("teamWhereUnknownCustomer")

  function detail(entry: HomeTeamEntry<Row>): string {
    const { state, row } = entry
    if (state.kind === "at-customer") return t("detailAtCustomer", { customer: customer(state.customerName), time: clock(state.since, locale, timezone) })
    if (state.kind === "heading") {
      return state.plannedAt
        ? t("detailHeading", { customer: customer(state.customerName), time: clock(state.plannedAt, locale, timezone) })
        : t("detailHeadingNoTime", { customer: customer(state.customerName) })
    }
    if (state.kind === "last-visit") return t("detailLastVisit", { customer: customer(state.customerName), time: clock(state.until, locale, timezone) })
    // Always a last known time, never «live» (the same rule as the map).
    return row.lastGpsAt ? tw("teamRowLastGps", { time: clock(row.lastGpsAt, locale, timezone) }) : ""
  }

  function cellTitle(cell: HomeDayCell): string {
    const date = dayLabel(cell.date, locale, { weekday: "long", day: "numeric", month: "long" })
    if (cell.tone === "off") return t("cellOff", { date })
    if (cell.tone === "none") return t("cellNone", { date })
    if (cell.tone === "upcoming") return t("cellUpcoming", { date, planned: cell.planned })
    if (cell.tone === "visited") return t("cellVisited", { date, visits: cell.visits })
    return t("cellPlan", { date, done: cell.done, planned: cell.planned })
  }

  function duration(minutes: number | null): string {
    if (minutes === null) return t("durationOpen")
    return minutes < 60 ? t("durationMinutes", { minutes }) : t("durationHours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  }

  function visitMoment(value: string): string {
    const date = new Date(value)
    const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }
    try {
      return createDateFormatter(locale, { timeZone: timezone, ...options }).format(date)
    } catch {
      return createDateFormatter(locale, options).format(date)
    }
  }

  const recent = team.length > 0 && team.length <= HOME_TEAM_RECENT_UP_TO ? recentVisits : []
  const gpsPercent = totals ? percentOf(totals.gpsConfirmed, totals.visits) : null
  const footText = totals
    ? [t("footVisits", { count: totals.visits }), gpsPercent !== null ? t("footGps", { percent: gpsPercent }) : null].filter(Boolean).join(" · ")
    : null

  return (
    <HomeCard
      testId="mtm-home-team"
      titleId="mtm-home-team-title"
      icon={<Users className="h-4 w-4" aria-hidden="true" />}
      tone="orange"
      title={t("teamTitle")}
      action={{ href: "/mtm/map", label: t("openMap"), hint: t("hint.openMap") }}
    >
      {failed && team.length === 0 ? (
        <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4 text-sm">
          <WifiOff className="h-4 w-4 text-red-600" aria-hidden="true" />
          <span className="font-semibold">{tw("teamLoadFailed")}</span>
          <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-9" onClick={onRetry}>{t("retry")}</Button>
        </p>
      ) : loading && team.length === 0 ? (
        <p role="status" className="py-4 text-sm text-muted-foreground">{tw("teamLoading")}</p>
      ) : team.length === 0 ? (
        <p className="py-4 text-sm font-semibold">{hasCards ? tw("noFieldStaff") : tw("noEmployeesTitle")}</p>
      ) : (
        <>
          <div className="hidden items-center gap-3 border-b border-zinc-100 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground dark:border-zinc-800 sm:flex">
            <span className="min-w-0 flex-1 truncate">{t("colAgent")}</span>
            {facts ? (
              <>
                <div className="flex gap-1" aria-hidden="true">
                  {week.map((day) => <span key={day.date} className="w-8 text-center">{dayLabel(day.date, locale, { weekday: "short" })}</span>)}
                </div>
                <span className="w-11 text-right">{t("colWeek")}</span>
              </>
            ) : null}
          </div>
          <ul>
            {shown.map((entry) => {
              const { row, state } = entry
              const agentWeek = facts && today ? buildAgentWeek(row.agentId, today, week, facts) : null
              const text = detail(entry)
              return (
                <li key={row.agentId} data-testid="mtm-home-team-row" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-100 py-2 dark:border-zinc-800">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary" aria-hidden="true">{initials(row.name)}</span>
                  <div className="min-w-[9rem] flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Hint text={t("hint.openAgentWeek")}>
                        <button
                          type="button"
                          aria-label={t("openAgentWeek", { name: row.name })}
                          className="min-w-0 truncate text-left text-sm font-semibold hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          onClick={() => onOpenAgent(row.agentId)}
                        >
                          {row.name}
                        </button>
                      </Hint>
                      {row.openAlerts > 0 ? (
                        <Hint text={`${tw("teamRowOpenAlerts", { count: row.openAlerts })}. ${t("hint.openAlerts")}`}>
                          <Link
                            href={`/mtm/alerts?agentId=${encodeURIComponent(row.agentId)}`}
                            prefetch={false}
                            aria-label={tw("teamRowOpenAlerts", { count: row.openAlerts })}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full px-1 py-0.5 text-[11px] font-semibold text-amber-700 hover:underline dark:text-amber-300"
                          >
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />{row.openAlerts}
                          </Link>
                        </Hint>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                      <Hint text={t(STATE_HINT_KEY[state.kind])}><span tabIndex={0} className="inline-flex shrink-0 cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"><HomePill tone={STATE_TONE[state.kind]} className="text-[11px]">{stateIcon(state.kind)}{t(STATE_KEY[state.kind])}</HomePill></span></Hint>
                      {text ? <span className="min-w-0 truncate text-xs text-muted-foreground" title={text}>{text}</span> : null}
                    </div>
                  </div>
                  {agentWeek ? (
                    <>
                      <div className="flex gap-1" data-testid="mtm-home-team-week">
                        {agentWeek.cells.map((cell) => (
                          <Hint key={cell.date} text={cellTitle(cell)}>
                            <button
                              type="button"
                              data-tone={cell.tone}
                              aria-label={cellTitle(cell)}
                              className={cn(
                                "relative flex h-8 w-8 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                                CELL[cell.tone],
                                cell.isToday && "ring-2 ring-primary/70 ring-offset-1 ring-offset-card",
                              )}
                              onClick={() => onOpenAgent(row.agentId, cell.date)}
                            >
                              {cellText(cell)}
                              {DOT[cell.tone] ? <span className={cn("absolute bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full", DOT[cell.tone])} aria-hidden="true" /> : null}
                            </button>
                          </Hint>
                        ))}
                      </div>
                      <HintValue text={t("hint.weekTotal")} className="w-11 shrink-0 text-right text-sm font-bold tabular-nums">
                        <span data-testid="mtm-home-team-total">{agentWeek.planned > 0 ? `${agentWeek.done}/${agentWeek.planned}` : "–"}</span>
                      </HintValue>
                    </>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {hidden > 0 || expanded ? (
            <button type="button" data-testid="mtm-home-team-more" aria-expanded={expanded} className="min-h-11 self-start py-2 text-sm font-medium text-primary hover:underline md:min-h-0" onClick={() => setExpanded((value) => !value)}>
              {expanded ? t("showLess") : t("showMore", { count: hidden })}
            </button>
          ) : null}
          {recent.length > 0 ? (
            <div data-testid="mtm-home-team-recent">
              <p className="pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("recentTitle")}</p>
              <ul>
                {recent.map((visit) => (
                  <li key={visit.id} className="flex items-center gap-3 border-b border-zinc-100 py-2 text-sm last:border-b-0 dark:border-zinc-800">
                    <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{visitMoment(visit.at)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{customer(visit.customerName)}</span>
                    <Hint text={t("hint.recentDuration", { quality: t("qualityTitle") })}><span tabIndex={0} className="inline-flex cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"><HomePill tone={visit.flag ? "amber" : "zinc"}>{duration(visit.durationMinutes)}</HomePill></span></Hint>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-auto">
            {facts ? (
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 pt-3 text-[11px] text-muted-foreground" data-testid="mtm-home-team-legend">
                {LEGEND.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", DOT[item.tone] ?? CELL[item.tone])} aria-hidden="true" />{t(item.key)}</span>
                ))}
              </div>
            ) : weekFailed ? (
              <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3 text-xs text-muted-foreground">
                {t("weekLoadFailed")}
                <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={onRetryWeek}>{t("retry")}</Button>
              </p>
            ) : null}
            {footText ? <HomeCardFoot text={footText} textHint={t("hint.footGps")} href="/mtm/analytics?period=thisWeek" link={t("openResults")} linkHint={t("hint.openResults")} /> : <div className="h-3" />}
          </div>
        </>
      )}
    </HomeCard>
  )
}
