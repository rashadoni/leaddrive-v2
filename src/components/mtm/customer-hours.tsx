"use client"

/**
 * «Часы приёма» of an MTM place on screen (owner, 2026-11-02, mockup «MTM:
 * часы приёма клиентов», approved with «Давай, делай»): the week on the
 * place's card, whether it is open right now, and the one dialog that sets
 * them for one place or for many selected in the list.
 *
 * The rules — what a week is, open or not, waiting for the door — are
 * src/lib/mtm/customer-hours.ts; this file only shows and sends them.
 */
import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Clock3, Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Hint } from "@/components/hint"
import { cn } from "@/lib/utils"
import { formatInTimezone } from "@/lib/timezone"
import {
  hoursMinutes,
  MTM_WEEKDAYS,
  openStateAt,
  readWorkingHours,
  type MtmDayHours,
  type MtmOpenState,
  type MtmWeekday,
  type MtmWorkingHours,
} from "@/lib/mtm/customer-hours"

/** Today's weekday and minute in the company's time zone. */
export function companyNow(timezone: string, now: Date = new Date()): { weekday: MtmWeekday; minute: number } {
  const clock = formatInTimezone(now, timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).slice(0, 5)
  const day = formatInTimezone(now, timezone, { weekday: "short" }, "en-US")
  const weekday = (({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, MtmWeekday>)[day] ?? 1)
  return { weekday, minute: hoursMinutes(clock) ?? 0 }
}

/** «09:00–20:00 · обед 13:00–14:00», «не работает», or null when nobody said. */
export function useDayHoursText() {
  const t = useTranslations("mtmCustomers.hours")
  return (day: MtmDayHours | null | undefined): string | null => {
    if (day === undefined) return null
    if (day === null) return t("dayOff")
    const base = `${day.open}–${day.close}`
    return day.breakFrom && day.breakTo ? `${base} · ${t("lunch", { from: day.breakFrom, to: day.breakTo })}` : base
  }
}

function useOpenStateText() {
  const t = useTranslations("mtmCustomers.hours")
  return (state: MtmOpenState): { text: string; tone: "ok" | "wait" | "off" | "none" } => {
    switch (state.kind) {
      case "open":
        return state.breakFrom
          ? { text: t("state.openLunch", { time: state.breakFrom }), tone: "ok" }
          : { text: t("state.open", { time: state.closesAt }), tone: "ok" }
      case "lunch": return { text: t("state.lunch", { time: state.reopensAt }), tone: "wait" }
      case "beforeOpen": return { text: t("state.beforeOpen", { time: state.opensAt }), tone: "wait" }
      case "closed": return { text: t("state.closed"), tone: "off" }
      case "dayOff": return { text: t("state.dayOff"), tone: "off" }
      default: return { text: "", tone: "none" }
    }
  }
}

const TONE_TEXT = { ok: "text-emerald-700 dark:text-emerald-400", wait: "text-amber-700 dark:text-amber-400", off: "text-red-700 dark:text-red-400", none: "text-muted-foreground" }
const TONE_DOT = { ok: "bg-emerald-600", wait: "bg-amber-500", off: "bg-red-600", none: "bg-muted-foreground" }

/** «Сейчас открыто · обед с 13:00» beside the place's name; nothing when no hours. */
export function MtmCustomerOpenBadge({ hours, timezone }: { hours: unknown; timezone: string }) {
  const stateText = useOpenStateText()
  const week = readWorkingHours(hours)
  if (!week) return null
  const now = companyNow(timezone)
  const { text, tone } = stateText(openStateAt(week[now.weekday], now.minute))
  return (
    <span
      data-testid="mtm-customer-open-badge"
      className={cn("inline-flex min-h-8 w-fit items-center gap-2 rounded-full border border-border px-3 text-xs font-semibold", TONE_TEXT[tone])}
    >
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", TONE_DOT[tone])} />
      {text}
    </span>
  )
}

/** The week on the card, with who set it and the button to change it. */
export function MtmCustomerHoursSection({
  hours,
  author,
  updatedAt,
  timezone,
  canManage,
  onEdit,
  formatDate,
}: {
  hours: unknown
  author: string | null
  updatedAt: string | null
  timezone: string
  canManage: boolean
  onEdit: () => void
  formatDate: (value: string) => string
}) {
  const t = useTranslations("mtmCustomers.hours")
  const dayText = useDayHoursText()
  const week = readWorkingHours(hours)
  const today = companyNow(timezone).weekday
  return (
    <section data-testid="mtm-customer-hours" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><Clock3 className="h-4 w-4" />{t("title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage ? (
          <Hint text={t("hint.edit")}>
            <Button variant={week ? "outline" : "default"} className="min-h-11 md:min-h-9" onClick={onEdit} data-testid="mtm-customer-hours-edit">
              <Pencil className="h-4 w-4" />
              {week ? t("edit") : t("set")}
            </Button>
          </Hint>
        ) : null}
      </div>
      {week ? (
        <dl className="mt-3">
          {MTM_WEEKDAYS.map((day) => {
            const value = week[day]
            return (
              <div
                key={day}
                data-testid={`mtm-customer-hours-day-${day}`}
                className={cn("grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[12rem_minmax(0,1fr)] border-b border-border py-2 text-sm last:border-0", day === today && "font-semibold")}
              >
                <dt>{t(`weekdays.${day}`)}{day === today ? ` · ${t("today")}` : ""}</dt>
                <dd className={cn(value === null && "font-semibold text-amber-700 dark:text-amber-400")}>{dayText(value)}</dd>
              </div>
            )
          })}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="mtm-customer-hours-missing">{t("notSetBody")}</p>
      )}
      {week && updatedAt ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {author ? t("author", { name: author, date: formatDate(updatedAt) }) : t("authorNoName", { date: formatDate(updatedAt) })}
        </p>
      ) : null}
    </section>
  )
}

type DraftDay = { works: boolean; open: string; close: string; breakFrom: string; breakTo: string }
type Draft = Record<MtmWeekday, DraftDay>

/** Every quarter of an hour, 24-hour clock: the same on every phone and browser. */
const QUARTERS = Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`)

function TimeSelect({ value, onChange, label, optional = false }: { value: string; onChange: (value: string) => void; label: string; optional?: boolean }) {
  // A time typed before (e.g. 08:50) stays offered, so opening the form never changes it.
  const options = value && !QUARTERS.includes(value) ? [...QUARTERS, value].sort() : QUARTERS
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-[5.5rem] rounded-md border border-input bg-background px-2 text-sm tabular-nums"
    >
      {optional ? <option value="">—</option> : null}
      {options.map((time) => <option key={time} value={time}>{time}</option>)}
    </select>
  )
}

const EMPTY_DAY: DraftDay = { works: true, open: "09:00", close: "18:00", breakFrom: "", breakTo: "" }

function draftFrom(week: MtmWorkingHours | null): Draft {
  const draft = {} as Draft
  for (const day of MTM_WEEKDAYS) {
    const value = week ? week[day] : undefined
    draft[day] = value
      ? { works: true, open: value.open, close: value.close, breakFrom: value.breakFrom ?? "", breakTo: value.breakTo ?? "" }
      : week ? { ...EMPTY_DAY, works: false } : { ...EMPTY_DAY, works: day <= 5 }
  }
  return draft
}

function weekFrom(draft: Draft): Record<MtmWeekday, MtmDayHours | null> {
  const week = {} as Record<MtmWeekday, MtmDayHours | null>
  for (const day of MTM_WEEKDAYS) {
    const value = draft[day]
    week[day] = value.works
      ? { open: value.open, close: value.close, ...(value.breakFrom && value.breakTo ? { breakFrom: value.breakFrom, breakTo: value.breakTo } : {}) }
      : null
  }
  return week
}

/** A place another place's hours can be copied from: its name and week. */
interface CopySource { id: string; name: string; hours: MtmWorkingHours }

/**
 * Sets the hours of one place or of all the selected ones. «Взять часы у
 * другого места» and «Понедельник → на все будни» only fill the form; nothing
 * is saved until «Сохранить часы».
 */
export function MtmCustomerHoursDialog({
  open,
  onOpenChange,
  organizationIds,
  name,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationIds: string[]
  /** The place's name; null when several places are set at once. */
  name: string | null
  initial: unknown
  onSaved: () => void
}) {
  const t = useTranslations("mtmCustomers.hours")
  const dayText = useDayHoursText()
  const initialWeek = useMemo(() => readWorkingHours(initial), [initial])
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initialWeek))
  const [sources, setSources] = useState<CopySource[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The list hands a new array on every render; the form resets only when the places change.
  const idsKey = organizationIds.join(",")

  useEffect(() => {
    if (!open) return
    setDraft(draftFrom(initialWeek))
    setError(null)
    let alive = true
    fetch("/api/v1/mtm/organizations?limit=200", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { data?: { organizations?: Array<{ id: string; name: string; workingHours?: unknown }> } } | null) => {
        if (!alive) return
        const rows = json?.data?.organizations ?? []
        setSources(rows.flatMap((row) => {
          const hours = readWorkingHours(row.workingHours)
          return hours && !idsKey.split(",").includes(row.id) ? [{ id: row.id, name: row.name, hours }] : []
        }))
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [open, initialWeek, idsKey])

  const setDay = (day: MtmWeekday, patch: Partial<DraftDay>) => setDraft((current) => ({ ...current, [day]: { ...current[day], ...patch } }))

  const save = async (clear = false) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch("/api/v1/mtm/organizations/working-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationIds, workingHours: clear ? null : weekFrom(draft) }),
      })
      if (!response.ok) {
        setError(response.status === 400 ? t("dialog.invalid") : t("dialog.failed"))
        return
      }
      toast.success(organizationIds.length > 1 ? t("dialog.savedMany", { count: organizationIds.length }) : t("dialog.saved"))
      onOpenChange(false)
      onSaved()
    } catch {
      setError(t("dialog.failed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{name ? t("dialog.title", { name }) : t("dialog.titleMany", { count: organizationIds.length })}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="grid gap-4" data-testid="mtm-customer-hours-dialog">
          <p className="text-sm text-muted-foreground">{t("dialog.body")}</p>
          {sources.length ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{t("dialog.copyFrom")}</span>
              <Select
                value=""
                data-testid="mtm-customer-hours-copy"
                onChange={(event) => {
                  const source = sources.find((item) => item.id === event.target.value)
                  if (source) setDraft(draftFrom(source.hours))
                }}
              >
                <option value="">{t("dialog.copyNone")}</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>{`${source.name} · ${dayText(source.hours[1]) ?? ""}`}</option>
                ))}
              </Select>
            </label>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-semibold">{t("dialog.day")}</th>
                  <th className="py-1 pr-2 font-semibold">{t("dialog.from")}</th>
                  <th className="py-1 pr-2 font-semibold">{t("dialog.to")}</th>
                  <th className="py-1 font-semibold">{t("dialog.lunch")}</th>
                </tr>
              </thead>
              <tbody>
                {MTM_WEEKDAYS.map((day) => {
                  const value = draft[day]
                  return (
                    <tr key={day} className="border-t border-border" data-testid={`mtm-customer-hours-row-${day}`}>
                      <td className="py-1.5 pr-2">
                        <label className="flex min-h-10 items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-orange-600"
                            checked={value.works}
                            onChange={(event) => setDay(day, { works: event.target.checked })}
                            aria-label={t("dialog.works", { day: t(`weekdays.${day}`) })}
                          />
                          {t(`weekdaysShort.${day}`)}
                        </label>
                      </td>
                      {value.works ? (
                        <>
                          <td className="py-1.5 pr-2"><TimeSelect value={value.open} onChange={(open) => setDay(day, { open })} label={`${t(`weekdays.${day}`)} · ${t("dialog.from")}`} /></td>
                          <td className="py-1.5 pr-2"><TimeSelect value={value.close} onChange={(close) => setDay(day, { close })} label={`${t(`weekdays.${day}`)} · ${t("dialog.to")}`} /></td>
                          <td className="py-1.5">
                            <span className="flex items-center gap-1">
                              <TimeSelect optional value={value.breakFrom} onChange={(breakFrom) => setDay(day, { breakFrom })} label={`${t(`weekdays.${day}`)} · ${t("dialog.lunchFrom")}`} />
                              <span aria-hidden="true">–</span>
                              <TimeSelect optional value={value.breakTo} onChange={(breakTo) => setDay(day, { breakTo })} label={`${t(`weekdays.${day}`)} · ${t("dialog.lunchTo")}`} />
                            </span>
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="py-1.5 font-semibold text-amber-700 dark:text-amber-400">{t("dayOff")}</td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              className="min-h-10"
              data-testid="mtm-customer-hours-monday-to-weekdays"
              onClick={() => setDraft((current) => ({ ...current, 2: { ...current[1] }, 3: { ...current[1] }, 4: { ...current[1] }, 5: { ...current[1] } }))}
            >
              {t("dialog.mondayToWeekdays")}
            </Button>
          </div>
          <p className="rounded-md border border-l-4 border-border border-l-sky-500 bg-card p-2 text-sm">{t("dialog.after")}</p>
          {error ? <p role="alert" className="rounded-md border border-l-4 border-border border-l-red-500 bg-card p-2 text-sm">{error}</p> : null}
        </div>
      </DialogContent>
      <DialogFooter>
        {initialWeek ? (
          <Button type="button" variant="ghost" className="mr-auto" disabled={saving} onClick={() => void save(true)}>{t("dialog.clear")}</Button>
        ) : null}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("dialog.cancel")}</Button>
        <Button type="button" disabled={saving} onClick={() => void save()} data-testid="mtm-customer-hours-save">{t("dialog.save")}</Button>
      </DialogFooter>
    </Dialog>
  )
}
