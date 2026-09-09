"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { MtmRouteRecord } from "@/components/mtm/route-types"
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import { formatDate } from "@/lib/format-date"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { isPastMtmCalendarDay } from "@/lib/mtm/calendar-day-tone"

interface RouteCalendarProps {
  routes: MtmRouteRecord[]
  month: Date | null
  /** Overrides for the visible grid; empty when the tenant has none or the request failed. */
  workCalendarOverrides?: readonly WorkCalendarOverride[]
  /** `enforceWorkCalendarForRoutes`. Off means a weekend blocks nothing, so shading it would be a lie. */
  workCalendarEnforced?: boolean
  selectedDate?: string | null
  locale: string
  loading: boolean
  error: boolean
  onMonthChange: (month: Date) => void
  onSelectedDateChange?: (date: string) => void
  onRetry: () => void
  onSelectRoute: (route: MtmRouteRecord) => void
  canCreateRoutes: boolean
  onCreateRoute: (date: string) => void
}

const weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const

function dateKey(value: Date | string) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function buildMonthDays(month: Date, routes: MtmRouteRecord[]) {
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const routesByDate = new Map<string, MtmRouteRecord[]>()

  for (const route of routes) {
    const key = dateKey(route.date)
    routesByDate.set(key, [...(routesByDate.get(key) ?? []), route])
  }

  const days: Array<{ date: Date; routes: MtmRouteRecord[] }> = []
  for (let index = 0; index < firstWeekday; index += 1) {
    const date = new Date(year, monthIndex, index - firstWeekday + 1)
    days.push({ date, routes: routesByDate.get(dateKey(date)) ?? [] })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, monthIndex, day)
    days.push({ date, routes: routesByDate.get(dateKey(date)) ?? [] })
  }
  while (days.length % 7 !== 0) {
    const date = new Date(year, monthIndex + 1, days.length - firstWeekday - daysInMonth + 1)
    days.push({ date, routes: routesByDate.get(dateKey(date)) ?? [] })
  }
  return days
}

function routeTone(status: MtmRouteRecord["status"]) {
  if (status === "COMPLETED") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
  if (status === "IN_PROGRESS") return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
  if (status === "CANCELLED") return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
  if (status === "DRAFT") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
  return "border-zinc-200 bg-muted/60 text-foreground dark:border-zinc-700"
}


export function MtmRouteCalendar({
  routes,
  month,
  workCalendarOverrides,
  workCalendarEnforced,
  selectedDate: selectedDateProp,
  locale,
  loading,
  error,
  onMonthChange,
  onSelectedDateChange,
  onRetry,
  onSelectRoute,
  canCreateRoutes,
  onCreateRoute,
}: RouteCalendarProps) {
  const t = useTranslations("mtmRoutesPage")
  const statusT = useTranslations("mtmStatus")
  const [selectedDate, setSelectedDate] = useState("")
  const days = useMemo(() => month ? buildMonthDays(month, routes) : [], [month, routes])
  const fallbackSelectedDate = useMemo(() => {
    if (!month) return ""
    const now = new Date()
    const initialDate = now.getFullYear() === month.getFullYear() && now.getMonth() === month.getMonth()
      ? now
      : new Date(month.getFullYear(), month.getMonth(), 1)
    return dateKey(initialDate)
  }, [month])

  if (!month) return null

  const selectedDateValue = selectedDateProp ?? selectedDate
  const activeSelectedDate = days.some((day) => dateKey(day.date) === selectedDateValue)
    ? selectedDateValue
    : fallbackSelectedDate
  const selectedDay = days.find((day) => dateKey(day.date) === activeSelectedDate)
    ?? days.find((day) => day.date.getMonth() === month.getMonth())
  const todayKey = dateKey(new Date())

  function moveMonth(direction: -1 | 1) {
    onMonthChange(new Date(month!.getFullYear(), month!.getMonth() + direction, 1))
  }

  function returnToCurrentMonth() {
    const now = new Date()
    onMonthChange(new Date(now.getFullYear(), now.getMonth(), 1))
    selectDate(dateKey(now))
  }

  function selectDate(date: string) {
    setSelectedDate(date)
    onSelectedDateChange?.(date)
  }

  return (
    <section data-testid="mtm-route-calendar" className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
      <header className="flex flex-col gap-3 border-b border-zinc-200 px-3 py-3 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold">{t("calendarTitle")}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("calendarHint")}</p>
        </div>
        <div className="flex items-center justify-between gap-1 sm:justify-end">
          <Button data-testid="mtm-route-calendar-previous-month" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("previousMonth")} onClick={() => moveMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-32 px-2 text-center text-sm font-semibold capitalize sm:min-w-40">
            {formatDate(month, locale, { month: "long", year: "numeric" })}
          </div>
          <Button data-testid="mtm-route-calendar-next-month" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("nextMonth")} onClick={() => moveMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" className="min-h-11 px-3" onClick={returnToCurrentMonth}>{t("todayAction")}</Button>
        </div>
      </header>

      {loading ? (
        <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" />{t("calendarLoading")}
        </div>
      ) : error ? (
        <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
          <div>
            <h3 className="font-semibold">{t("calendarLoadFailed")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("calendarLoadFailedHint")}</p>
          </div>
          <Button variant="outline" className="min-h-11" onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" />{t("retry")}</Button>
        </div>
      ) : (
      <>
      <div data-testid="mtm-mobile-calendar-agenda" className="p-3 xl:hidden">
        <div className="grid grid-cols-7" aria-label={t("calendarTitle")}>
          {weekdayKeys.map((weekday) => (
            <div key={weekday} className="py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(`weekday.${weekday}`)}
            </div>
          ))}
          {days.map((day) => {
            const key = dateKey(day.date)
            const isCurrentMonth = day.date.getMonth() === month.getMonth()
            const isSelected = key === activeSelectedDate
            const isToday = key === todayKey
            return (
              <button
                type="button"
                key={key}
                data-route-calendar-date={key}
                data-current-month={isCurrentMonth ? "true" : "false"}
                disabled={!isCurrentMonth}
                aria-pressed={isSelected}
                aria-label={formatDate(day.date, locale, { weekday: "long", day: "numeric", month: "long" })}
                className={`relative min-h-11 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-25 ${isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted"} ${isToday && !isSelected ? "text-primary" : ""}`}
                onClick={() => selectDate(key)}
              >
                {day.date.getDate()}
                {day.routes.length > 0 ? (
                  <span className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${isSelected ? "bg-primary-foreground" : "bg-primary"}`} />
                ) : null}
              </button>
            )
          })}
        </div>

        {selectedDay ? (
          <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-700">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold capitalize">{formatDate(selectedDay.date, locale, { weekday: "long", day: "numeric", month: "long" })}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{selectedDay.routes.length > 0 ? t("routesOnDate", { count: selectedDay.routes.length }) : t("noRoutesOnDate")}</p>
              </div>
              <Button data-testid="mtm-route-calendar-plan-selected" className="min-h-11 sm:self-start" onClick={() => onCreateRoute(dateKey(selectedDay.date))} disabled={!canCreateRoutes} title={canCreateRoutes ? t("planRouteOnDate", { date: formatDate(selectedDay.date, locale) }) : t("selfPlanningDisabled")}>
                <Plus className="mr-2 h-4 w-4" />{t("planRouteForDate")}
              </Button>
            </div>
            {selectedDay.routes.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {selectedDay.routes.map((route) => (
                  <button
                    type="button"
                    key={route.id}
                    className={`flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${routeTone(route.status)}`}
                    onClick={() => onSelectRoute(route)}
                    aria-label={t("openRouteDetails", { employee: route.agent?.name ?? "—", date: formatDate(new Date(route.date), locale) })}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{route.agent?.name ?? route.name ?? "—"}</span>
                      {route.points?.[0]?.customer?.name ? <span className="mt-0.5 block truncate text-xs opacity-75">{route.points[0].customer.name}</span> : null}
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className="block font-medium">{mtmStatusLabel(statusT, "route", route.status)}</span>
                      <span className="mt-0.5 flex items-center justify-end gap-1 opacity-75"><MapPin className="h-3.5 w-3.5" />{route.totalPoints}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="hidden grid-cols-7 xl:grid">
        {weekdayKeys.map((weekday) => (
          <div key={weekday} className="border-b border-r border-zinc-200 px-2 py-2 text-center text-xs font-medium text-muted-foreground last:border-r-0 dark:border-zinc-700">
            {t(`weekday.${weekday}`)}
          </div>
        ))}
        {days.map((day) => {
          const key = dateKey(day.date)
          const isCurrentMonth = day.date.getMonth() === month.getMonth()
          const isToday = key === todayKey
          const isPastDay = isCurrentMonth && isPastMtmCalendarDay(day.date)
          // A weekend blocks nothing while `enforceWorkCalendarForRoutes` is
          // off, so shading it would invent a rule the server does not apply
          // (C6/RUX-404). The reason is shown, never just the grey: "closed"
          // without a why is the complaint this task exists to fix.
          const calendarDay = workCalendarEnforced
            ? resolveWorkCalendarDay({ date: key, overrides: workCalendarOverrides ?? [] })
            : null
          const closedReason = calendarDay && !calendarDay.routePlanningAllowed
            ? calendarDay.source === "WEEKEND_DEFAULT"
              ? t("calendarWeekend")
              : calendarDay.name || t("calendarClosedDay")
            : null
          return (
            <div
              key={key}
              data-route-calendar-date={key}
              data-current-month={isCurrentMonth ? "true" : "false"}
              data-past-day={isPastDay ? "true" : "false"}
              // C6: день, который уже прошёл, — не поверхность для планирования.
              // Приглушить его дешевле, чем заставлять читать даты.
              data-closed-day={closedReason ? "true" : "false"}
              title={closedReason ?? undefined}
              className={`group min-h-32 border-b border-r border-zinc-200 p-1.5 last:border-r-0 dark:border-zinc-700 xl:min-h-28 ${isCurrentMonth ? (closedReason ? "bg-muted/40" : isPastDay ? "bg-card opacity-60" : "bg-card") : "bg-muted/30 text-muted-foreground/50"}`}
            >
              <div className="mb-1 flex min-h-9 items-center justify-between gap-1">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${isToday ? "bg-primary text-primary-foreground" : ""}`}>{day.date.getDate()}</span>
                {isCurrentMonth && day.routes.length > 0 ? (
                  <Button data-testid="mtm-route-calendar-plan" variant="ghost" size="icon" className="min-h-11 min-w-11 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100" aria-label={t("planRouteOnDate", { date: formatDate(day.date, locale) })} onClick={() => onCreateRoute(key)} disabled={!canCreateRoutes} title={canCreateRoutes ? t("planRouteOnDate", { date: formatDate(day.date, locale) }) : t("selfPlanningDisabled")}>
                    <Plus className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              {closedReason && isCurrentMonth ? (
                // The reason is visible, not only in `title`: a tooltip does
                // not exist on a tablet, and this task is about the manager
                // knowing WHY a day is grey.
                <div className="mb-1 truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground" data-testid="mtm-calendar-closed-reason">
                  {closedReason}
                </div>
              ) : null}
              <div className="space-y-1.5">
                {day.routes.slice(0, 3).map((route) => (
                  <button
                    type="button"
                    key={route.id}
                    className={`block min-h-11 w-full rounded-lg border px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:min-h-10 ${routeTone(route.status)}`}
                    onClick={() => onSelectRoute(route)}
                    aria-label={t("openRouteDetails", { employee: route.agent?.name ?? "—", date: formatDate(new Date(route.date), locale) })}
                  >
                    <span className="block truncate text-xs font-medium">{route.agent?.name ?? route.name ?? "—"}</span>
                    <span className="mt-0.5 block truncate text-[11px] opacity-75">
                      {route.points?.[0]?.customer?.name ? `${route.points[0].customer.name} · ` : ""}{route.totalPoints} {t("points")} · {mtmStatusLabel(statusT, "route", route.status)}
                    </span>
                  </button>
                ))}
                {day.routes.length > 3 ? <div className="px-1 text-[11px] text-muted-foreground">{t("calendarMore", { n: day.routes.length - 3 })}</div> : null}
                {isCurrentMonth && day.routes.length === 0 ? (
                  <button
                    type="button"
                    data-testid="mtm-route-calendar-plan"
                    className="flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-zinc-300 disabled:hover:bg-transparent disabled:hover:text-muted-foreground dark:border-zinc-700 xl:min-h-9"
                    onClick={() => onCreateRoute(key)}
                    disabled={!canCreateRoutes}
                    title={canCreateRoutes ? t("planRouteOnDate", { date: formatDate(day.date, locale) }) : t("selfPlanningDisabled")}
                  >
                    <Plus className="h-3.5 w-3.5" />{t("planRoute")}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      </>
      )}
    </section>
  )
}
