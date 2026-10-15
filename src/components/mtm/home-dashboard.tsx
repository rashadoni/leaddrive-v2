"use client"

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { BellRing, CheckCircle2, MapPin, Route as RouteIcon, TrendingUp } from "lucide-react"
import { HomeAttentionCard, attentionRowCount } from "@/components/mtm/home-attention-card"
import { useHomeAttention, useHomeInsights, useHomeWeek } from "@/components/mtm/home-data"
import { HomeBaseCard, HomeQualityCard, HomeSetupStrip } from "@/components/mtm/home-insight-cards"
import { HomeKpi, type HomeTone } from "@/components/mtm/home-parts"
import { HomeTeamCard, type HomeTeamCardRow } from "@/components/mtm/home-team-card"
import { createDateFormatter } from "@/lib/format-date"
import {
  defaultWeek,
  fieldNow,
  finishedDaysPercent,
  homeTeam,
  percentOf,
  planCard,
  todayPlan,
  weekComparison,
  weekTotals,
} from "@/lib/mtm/home-dashboard"
import { mtmPlanTone } from "@/lib/mtm/team-results"

/**
 * The MTM home screen («Bu gün») for a manager, as the owner accepted it on
 * 2026-10-11: the day in four figures, what waits for a decision, and the
 * team with a strip of the week per agent.
 *
 * The component draws; the numbers come from `src/lib/mtm/home-dashboard.ts`
 * over three answers the product already gave before this screen existed.
 */

export interface HomeTeamToday<Row extends HomeTeamCardRow = HomeTeamCardRow> {
  timezone: string
  today: string
  generatedAt: string | null
  rows: Row[]
  lastVisitAt: string | null
  workdayEnabled: boolean
  /** The scope holds more employees than one answer carries: the figures are of the first ones only. */
  partial?: boolean
}

const PLAN_TONE: Record<ReturnType<typeof mtmPlanTone>, HomeTone> = { good: "green", warn: "amber", bad: "red", none: "zinc" }

/** A calendar day: a date key is read at UTC so no timezone moves it. */
function dayLabel(value: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${value}T12:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? value : createDateFormatter(locale, { timeZone: "UTC", ...options }).format(date)
}

function instantLabel(value: string | null, locale: string, timezone: string, options: Intl.DateTimeFormatOptions): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  try {
    return createDateFormatter(locale, { timeZone: timezone, ...options }).format(date)
  } catch {
    return createDateFormatter(locale, options).format(date)
  }
}

export function MtmHomeDashboard<Row extends HomeTeamCardRow>({
  organizationId,
  viewerId,
  regionId,
  teamId,
  team,
  teamLoading,
  teamFailed,
  refreshToken,
  controls,
  onRetry,
  onOpenAgent,
}: {
  organizationId?: string | null
  viewerId?: string | null
  regionId: string
  teamId: string
  /** Today's list for the filters on screen; null until it has loaded for them. */
  team: HomeTeamToday<Row> | null
  teamLoading: boolean
  teamFailed: boolean
  refreshToken: number
  /** The screen's filters and its refresh button. */
  controls: ReactNode
  onRetry: () => void
  onOpenAgent: (agentId: string, day?: string) => void
}) {
  const t = useTranslations("mtmDashboardPage.home")
  const tw = useTranslations("mtmDashboardPage.operationalWeek")
  const locale = useLocale()
  const attention = useHomeAttention({ organizationId, viewerId, regionId, teamId, refreshToken })

  const entries = team ? homeTeam(team.rows, team.workdayEnabled) : []
  const now = fieldNow(entries)
  const plan = todayPlan(entries)
  const today = team?.today ?? null
  const timezone = team?.timezone || "UTC"
  // Read again when today's live numbers move, so the strip follows the figures.
  const week = useHomeWeek({ organizationId, today, teamId, liveKey: `${plan.planned}:${plan.done}:${plan.visits}` })
  const weekDays = attention.data?.week.length === 7 ? attention.data.week : today ? defaultWeek(today) : []
  // «Результаты» filters by team, not by region: under a region alone the
  // week is narrowed to the people on screen and not compared with last week.
  const regionOnly = Boolean(regionId && !teamId)
  const onScreen = regionOnly && team ? new Set(team.rows.map((row) => row.agentId)) : undefined
  const totals = week.facts && today && weekDays.length ? weekTotals(week.facts, { from: weekDays[0].date, to: today }, onScreen) : null
  const comparison = totals && !regionOnly ? weekComparison(totals, week.previous) : { kind: "unknown" as const }
  const card = today ? planCard({ today, plan, nextWorkday: attention.data?.nextWorkday ?? null }) : { kind: "none" as const }
  const waiting = attentionRowCount(attention.data)
  // The lower row: read once a day per filters, never polled.
  const insights = useHomeInsights({ organizationId, viewerId, regionId, teamId, today })

  const dateTitle = today ? dayLabel(today, locale, { weekday: "long", day: "numeric", month: "long" }) : null
  const asOf = instantLabel(team?.generatedAt ?? null, locale, timezone, { hour: "2-digit", minute: "2-digit", hour12: false })
  const note = [
    attention.data ? t(attention.data.todayIsWorkingDay ? "workingDay" : "dayOff") : null,
    asOf ? tw("summaryAsOf", { time: asOf }) : null,
    // Figures of a cut-off list say so: a total must not pass for the whole team.
    team?.partial ? tw("summaryScopeTruncated", { count: team.rows.length }) : null,
  ].filter(Boolean).join(" · ")

  // — who is in the field —
  const lastVisit = instantLabel(team?.lastVisitAt ?? null, locale, timezone, { weekday: "long", day: "numeric", month: "long" })
  const fieldParts = [
    now.heading > 0 ? t("partHeading", { count: now.heading }) : null,
    now.notStarted > 0 ? t("partNotStarted", { count: now.notStarted }) : null,
    now.planDone > 0 ? t("partPlanDone", { count: now.planDone }) : null,
    now.idle > 0 ? t("partIdle", { count: now.idle }) : null,
  ].filter(Boolean).join(" · ")
  const fieldSub = !team ? null : lastVisit ? t("lastVisit", { date: lastVisit }) : fieldParts || null

  // — today's plan, or the next working day's —
  const planPercent = card.kind === "today" ? percentOf(card.done, card.planned) : card.kind === "next" ? percentOf(card.withRoute, card.agents) : null
  const planKpi = card.kind === "today"
    ? {
        label: t("kpiTodayPlan"),
        hint: t("hint.kpiTodayPlan"),
        icon: <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden="true" />,
        // A plan in progress is never red: at noon a third done is the day, not a failure.
        tone: (planPercent !== null && planPercent >= 95 ? "green" : "amber") as HomeTone,
        value: String(card.done),
        unit: t("kpiPointsUnit", { total: card.planned }),
        pill: planPercent !== null ? `${planPercent}%` : null,
        progress: planPercent,
        sub: t("todayVisits", { count: card.visits }),
      }
    : card.kind === "next"
      ? {
          label: card.isTomorrow ? t("kpiTomorrowPlan") : t("kpiNextDayPlan", { date: dayLabel(card.date, locale, { day: "numeric", month: "short" }) }),
          hint: t("hint.kpiNextDayPlan"),
          icon: <RouteIcon className="h-[18px] w-[18px]" aria-hidden="true" />,
          tone: (card.withRoute === 0 ? "red" : card.withRoute >= card.agents ? "green" : "amber") as HomeTone,
          value: String(card.withRoute),
          unit: t("kpiInFieldUnit", { total: card.agents }),
          pill: card.withRoute === 0 ? t("pillNoPlan") : card.withRoute >= card.agents ? t("pillAllPlanned") : planPercent !== null ? `${planPercent}%` : null,
          progress: null,
          sub: [
            dayLabel(card.date, locale, { weekday: "long", day: "numeric", month: "long" }),
            attention.data?.todayIsWorkingDay ? t("todayNoPlan") : null,
          ].filter(Boolean).join(" · "),
        }
      : {
          label: t("kpiTodayPlan"),
          hint: t("hint.kpiTodayPlan"),
          icon: <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden="true" />,
          tone: "zinc" as HomeTone,
          value: null,
          unit: null,
          pill: null,
          progress: null,
          sub: team && attention.data ? t("todayNoPlan") : null,
        }

  // — the week so far —
  const weekPercent = totals ? percentOf(totals.done, totals.planned) : null
  // Coloured by the days already over; a week that has only today is «in progress».
  const finishedPercent = week.facts && today && weekDays.length ? finishedDaysPercent(week.facts, { from: weekDays[0].date, today }, onScreen) : null
  const weekTone: HomeTone = weekPercent === null ? "zinc" : finishedPercent === null ? (weekPercent >= 95 ? "green" : "amber") : PLAN_TONE[mtmPlanTone(finishedPercent)]
  const weekSub = !totals
    ? week.failed ? t("weekLoadFailed") : null
    : totals.planned === 0
      ? t("weekNoPlan")
      : comparison.kind === "delta"
        ? comparison.delta > 0
          ? t("weekDeltaUp", { percent: comparison.previousPercent, delta: comparison.delta })
          : comparison.delta < 0
            ? t("weekDeltaDown", { percent: comparison.previousPercent, delta: Math.abs(comparison.delta) })
            : t("weekDeltaSame", { percent: comparison.previousPercent })
        : comparison.kind === "no-plan"
          ? t("weekNoPlanLastWeek")
          : totals.planned > totals.done
            ? t("weekRemaining", { count: totals.planned - totals.done })
            : t("weekAllDone")

  // — what waits —
  const items = attention.data?.items ?? []
  const countOf = (...kinds: string[]) => items.filter((item) => kinds.includes(item.kind)).reduce((sum, item) => sum + item.count, 0)
  const requests = countOf("customerLocationRequests", "contactCreateRequests", "customerCreateRequests", "routeChangeRequests")
  const waitingParts = [
    requests > 0 ? t("shortRequests", { count: requests }) : null,
    countOf("routesAwaitingPublish") > 0 ? t("shortDrafts", { count: countOf("routesAwaitingPublish") }) : null,
    countOf("olderAlerts") > 0 ? t("shortAlerts", { count: countOf("olderAlerts") }) : null,
    countOf("photosPendingReview") > 0 ? t("shortPhotos", { count: countOf("photosPendingReview") }) : null,
    attention.data?.nextWorkday && attention.data.nextWorkday.withoutRoute > 0 ? t("shortNextDay") : null,
  ].filter(Boolean).join(" · ")

  return (
    <div data-testid="mtm-home" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="mtm-home-title" data-testid="mtm-home-title" className="text-2xl font-bold tracking-tight first-letter:uppercase">{dateTitle ?? tw("title")}</h2>
          <p data-testid="mtm-home-note" className="min-h-5 text-sm text-muted-foreground">{note}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{controls}</div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HomeKpi
          testId="mtm-home-kpi-field"
          label={t("kpiInField")}
          hint={t("hint.kpiInField")}
          icon={<MapPin className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone={now.inField > 0 ? "green" : "zinc"}
          value={team ? String(now.inField) : null}
          unit={team ? t("kpiInFieldUnit", { total: now.total }) : null}
          pill={now.atCustomer > 0 ? t("pillAtCustomer", { count: now.atCustomer }) : null}
          sub={fieldSub}
        />
        <HomeKpi testId="mtm-home-kpi-plan" {...planKpi} />
        <HomeKpi
          testId="mtm-home-kpi-week"
          label={t("kpiWeekPlan")}
          hint={t("hint.kpiWeekPlan")}
          icon={<TrendingUp className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone={weekTone}
          value={totals && totals.planned > 0 ? String(totals.done) : null}
          unit={totals && totals.planned > 0 ? t("kpiPointsUnit", { total: totals.planned }) : null}
          pill={weekPercent !== null ? `${weekPercent}%` : null}
          progress={weekPercent}
          sub={weekSub}
        />
        <HomeKpi
          testId="mtm-home-kpi-attention"
          label={t("kpiAttention")}
          hint={t("hint.kpiAttention")}
          icon={<BellRing className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone={waiting === null ? "zinc" : waiting > 0 ? "amber" : "green"}
          value={waiting === null ? null : String(waiting)}
          unit={waiting ? t("issuesUnit", { count: waiting }) : null}
          sub={waiting === null ? (attention.failed ? t("attentionLoadFailed") : null) : waiting === 0 ? t("attentionClear") : waitingParts}
        />
      </div>

      <HomeSetupStrip steps={insights?.setup ?? []} />

      {/* Side by side from 1400 px: narrower, a row of the team (name, seven
          days, total) would wrap under itself, so the cards stack instead. */}
      <div className="grid gap-4 min-[1400px]:grid-cols-2">
        <HomeAttentionCard state={attention} />
        <HomeTeamCard
          team={entries}
          hasCards={Boolean(team && team.rows.length > 0)}
          loading={teamLoading}
          failed={teamFailed}
          today={today}
          timezone={timezone}
          week={weekDays}
          facts={week.facts}
          weekFailed={week.failed}
          totals={totals}
          recentVisits={insights?.recentVisits ?? []}
          onRetry={onRetry}
          onRetryWeek={week.retry}
          onOpenAgent={onOpenAgent}
        />
      </div>

      {/* Below the first screen: the base this month and this week's visits
          judged. Both or neither — a lone half-width card would leave a hole. */}
      {insights && (insights.base || insights.quality) ? (
        <div className="grid gap-4 min-[1400px]:grid-cols-2">
          <HomeBaseCard base={insights.base} monthStart={insights.monthStart} />
          <HomeQualityCard quality={insights.quality} />
        </div>
      ) : null}
    </div>
  )
}
