"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarDays, Repeat } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  MTM_ROUTE_REPEAT_MAX_ROUTES,
  isoWeekday,
  mtmRouteRepeatDates,
  runMtmRouteRepeat,
  type MtmRouteRepeatOutcome,
  type MtmRouteRepeatSource,
} from "@/lib/mtm/route-repeat"

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function dayLabel(dateKey: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(`${dateKey}T00:00:00.000Z`))
}

/**
 * «Повторить маршрут» (Zeytun 2026-11-13, owner's mockup «Давай»): the same
 * route on the chosen weekday, every week or every other week, up to a date.
 * Ordinary routes are made; the dates the agent is busy on are named and left.
 */
export function MtmRouteRepeatDialog({ open, source, today, publish, orgId, onClose, onCreated }: {
  open: boolean
  source: MtmRouteRepeatSource | null
  today: string
  /** Publish each copy, as the source was: only when the reader may publish. */
  publish: boolean
  orgId?: string
  onClose: () => void
  onCreated: () => void
}) {
  const t = useTranslations("mtmRoutesPage.repeat")
  const locale = useLocale()
  const sourceDay = source?.date.slice(0, 10) ?? today
  const [weekday, setWeekday] = useState(() => isoWeekday(sourceDay))
  const [everyWeeks, setEveryWeeks] = useState<1 | 2>(1)
  const [until, setUntil] = useState(() => addDays(sourceDay > today ? sourceDay : today, 7 * 6))
  const [busyDates, setBusyDates] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [outcomes, setOutcomes] = useState<MtmRouteRepeatOutcome[] | null>(null)

  useEffect(() => {
    if (!open) return
    setWeekday(isoWeekday(sourceDay))
    setEveryWeeks(1)
    setUntil(addDays(sourceDay > today ? sourceDay : today, 7 * 6))
    setOutcomes(null)
  }, [open, sourceDay, today])

  const dates = useMemo(
    () => mtmRouteRepeatDates({ sourceDate: sourceDay, today, weekday, everyWeeks, until }),
    [sourceDay, today, weekday, everyWeeks, until],
  )
  const headers = useMemo(() => (orgId ? { "x-organization-id": orgId } : undefined), [orgId])

  // The agent's routes over the same days: a date already taken is named and left.
  useEffect(() => {
    if (!open || !source?.agentId || dates.length === 0) {
      setBusyDates(new Set())
      return
    }
    const controller = new AbortController()
    const query = new URLSearchParams({
      agentId: source.agentId,
      start: dates[0],
      endExclusive: addDays(dates[dates.length - 1], 1),
      limit: "200",
    })
    fetch(`/api/v1/mtm/routes?${query}`, { headers, signal: controller.signal })
      .then((response) => response.json())
      .then((body) => {
        const taken = new Set<string>()
        for (const route of body?.data?.routes ?? []) {
          if (route?.status !== "CANCELLED" && typeof route?.date === "string") taken.add(route.date.slice(0, 10))
        }
        setBusyDates(taken)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [open, source?.agentId, dates, headers])

  const freeCount = dates.filter((date) => !busyDates.has(date)).length

  const create = async () => {
    if (!source || running || freeCount === 0) return
    setRunning(true)
    try {
      const result = await runMtmRouteRepeat({ source, dates, busyDates, publish, fetch, headers })
      setOutcomes(result)
      if (result.some((outcome) => outcome.result === "created")) onCreated()
    } finally {
      setRunning(false)
    }
  }

  const created = outcomes?.filter((outcome) => outcome.result === "created").length ?? 0
  const skipped = (outcomes?.length ?? 0) - created

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !running) onClose() }} widthClassName="max-w-lg">
      <DialogTitle className="px-5 pt-5 text-base font-semibold">{t("title")}</DialogTitle>
      <div data-testid="mtm-route-repeat-dialog" className="space-y-4 px-5 pb-5 pt-3 text-sm">
        {outcomes ? (
          <>
            <p data-testid="mtm-route-repeat-summary" role="status" className="font-medium">{t("done", { created, skipped })}</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {outcomes.map((outcome) => (
                <li key={outcome.date} data-testid="mtm-route-repeat-outcome" className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{dayLabel(outcome.date, locale, { weekday: "short", day: "numeric", month: "long" })}</span>
                  <span className={outcome.result === "created" ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>
                    {outcome.result === "created"
                      ? (outcome.published || !publish ? t("created") : t("createdDraft"))
                      : t(`reason.${outcome.reason}`)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button onClick={onClose}>{t("close")}</Button>
            </div>
          </>
        ) : (
          <>
            <fieldset className="space-y-2">
              <legend className="font-medium">{t("weekday")}</legend>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("weekday")}>
                {WEEKDAYS.map((day) => {
                  // 2026-11-09 was a Monday: day 1 of that week is that date.
                  const name = dayLabel(addDays("2026-11-09", day - 1), locale, { weekday: "short" })
                  return (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={weekday === day ? "default" : "outline"}
                      aria-pressed={weekday === day}
                      data-testid={`mtm-route-repeat-weekday-${day}`}
                      className="min-h-10 min-w-12"
                      onClick={() => setWeekday(day)}
                    >
                      {name}
                    </Button>
                  )
                })}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-medium">{t("every")}</legend>
              <div className="flex flex-wrap gap-1.5">
                {([1, 2] as const).map((weeks) => (
                  <Button
                    key={weeks}
                    type="button"
                    size="sm"
                    variant={everyWeeks === weeks ? "default" : "outline"}
                    aria-pressed={everyWeeks === weeks}
                    data-testid={`mtm-route-repeat-every-${weeks}`}
                    className="min-h-10"
                    onClick={() => setEveryWeeks(weeks)}
                  >
                    {t(weeks === 1 ? "everyWeek" : "everyTwoWeeks")}
                  </Button>
                ))}
              </div>
            </fieldset>
            <label className="block space-y-1.5">
              <span className="font-medium">{t("until")}</span>
              <Input
                id="mtm-route-repeat-until"
                data-testid="mtm-route-repeat-until"
                type="date"
                value={until}
                min={addDays(sourceDay > today ? sourceDay : today, 1)}
                onChange={(event) => setUntil(event.target.value)}
                className="min-h-11 max-w-[12rem]"
              />
            </label>
            <div className="space-y-1.5">
              <p data-testid="mtm-route-repeat-count" className="font-medium">
                <CalendarDays className="mr-1 inline h-4 w-4 align-[-2px]" aria-hidden="true" />
                {t("willCreate", { count: freeCount })}
              </p>
              {dates.length === MTM_ROUTE_REPEAT_MAX_ROUTES ? <p className="text-xs text-muted-foreground">{t("limit", { max: MTM_ROUTE_REPEAT_MAX_ROUTES })}</p> : null}
              {dates.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {dates.map((date) => (
                    <li
                      key={date}
                      data-testid="mtm-route-repeat-date"
                      className={`rounded-full border px-2.5 py-1 text-xs ${busyDates.has(date) ? "border-dashed border-border text-muted-foreground line-through" : "border-border"}`}
                      title={busyDates.has(date) ? t("reason.busy") : undefined}
                    >
                      {dayLabel(date, locale, { day: "numeric", month: "short" })}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("none")}</p>
              )}
              {dates.some((date) => busyDates.has(date)) ? <p className="text-xs text-muted-foreground">{t("busyNote")}</p> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={running}>{t("cancel")}</Button>
              <Button data-testid="mtm-route-repeat-create" onClick={create} disabled={running || freeCount === 0}>
                <Repeat className="mr-1 h-4 w-4" />
                {running ? t("creating") : t("create", { count: freeCount })}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
