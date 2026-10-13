"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard } from "@/components/mtm/home-parts"

const ENDPOINT = "/api/v1/mtm/attendance/calendar"
const EDITABLE_KINDS = ["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY", "EXCEPTION_WORKDAY"] as const
const KIND_MESSAGES: Record<string, string> = { PUBLIC_HOLIDAY: "calendarPublicHoliday", COMPANY_HOLIDAY: "calendarCompanyHoliday", EXCEPTION_WORKDAY: "calendarExceptionWorkday",
  WORKING_DAY: "calendarWorkingDay", WEEKEND: "calendarWeekend", MOVED_WORKDAY: "calendarMovedWorkday", MOVED_DAY_OFF: "calendarMovedDayOff" }
type EditableKind = typeof EDITABLE_KINDS[number]
type CalendarDay = { id: string; date: string; kind: string; name: string | null; updatedAt: string; canEdit: boolean }
type CalendarData = { today: string; days: CalendarDay[]; canManage: boolean }
type Draft = { id?: string; version?: string; date: string; kind: EditableKind; name: string }
const SELECT_CLASS = "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"

function tomorrow(today: string) {
  const date = new Date(`${today}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
function blankDraft(today: string): Draft { return { date: tomorrow(today), kind: "PUBLIC_HOLIDAY", name: "" } }
function editableKind(kind: string): kind is EditableKind { return (EDITABLE_KINDS as readonly string[]).includes(kind) }

/** Manually entered organization calendar; a blank list is never a legal holiday source. */
export function MtmAttendanceCalendar() {
  const t = useTranslations("mtmAttendance")
  const format = useFormatter()
  const [data, setData] = useState<CalendarData | null>(null)
  const [year, setYear] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState<"calendarSaved" | "calendarDeleted" | null>(null)
  const [saving, setSaving] = useState(false)
  const [mustReload, setMustReload] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const loadController = useRef<AbortController | null>(null)
  const mutationController = useRef<AbortController | null>(null)
  const interruptedSave = useRef(false)
  const dateInput = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async (selectedYear?: string, acknowledgeInterrupted = false) => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setLoading(true)
    setLoadError(null)
    setSaveError(null)
    setSaved(null)
    setRemovingId(null)
    setData(null)
    setDraft(null)
    if (interruptedSave.current) setSaving(false)
    if (selectedYear) setYear(selectedYear)
    try {
      const range = selectedYear ? `?from=${selectedYear}-01-01&to=${selectedYear}-12-31` : ""
      const response = await fetch(`${ENDPOINT}${range}`, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || !body.data?.today || !Array.isArray(body.data.days)) {
        setLoadError(t([401, 403, 404].includes(response.status) ? "calendarAccessUnavailable" : "calendarLoadError"))
        return
      }
      const loaded = body.data as CalendarData
      setData(loaded)
      setYear(selectedYear ?? loaded.today.slice(0, 4))
      setDraft(blankDraft(loaded.today))
      const unresolved = interruptedSave.current && !acknowledgeInterrupted
      setMustReload(unresolved)
      if (unresolved) setSaveError(t("calendarSaveUnconfirmed"))
      else interruptedSave.current = false
    } catch {
      if (!controller.signal.aborted) setLoadError(t("calendarLoadError"))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    return () => {
      loadController.current?.abort()
      if (mutationController.current) {
        interruptedSave.current = true
        mutationController.current.abort()
        mutationController.current = null
      }
    }
  }, [load])

  const dateLabel = (value: string) => format.dateTime(new Date(`${value}T12:00:00.000Z`), { dateStyle: "medium", timeZone: "UTC" })
  const kindLabel = (kind: string) => t(KIND_MESSAGES[kind] ?? "calendarOtherDay")
  const canEdit = (day: CalendarDay) => Boolean(data?.canManage && day.canEdit && editableKind(day.kind) && day.date > data.today)

  function change(values: Partial<Draft>) {
    setDraft((previous) => previous ? { ...previous, ...values } : previous)
    setSaved(null)
    if (!mustReload) setSaveError(null)
  }
  function edit(day: CalendarDay) {
    if (!canEdit(day) || !editableKind(day.kind) || saving || mustReload) return
    setDraft({ id: day.id, version: day.updatedAt, date: day.date, kind: day.kind, name: day.name ?? "" })
    setSaveError(null)
    setSaved(null)
    setRemovingId(null)
    dateInput.current?.focus()
  }

  async function mutate(remove?: CalendarDay) {
    if (!data?.canManage || !draft || saving || mutationController.current || mustReload) return
    if (remove && (!canEdit(remove) || removingId !== remove.id)) return
    if (!remove && (!draft.name.trim() || draft.name.trim().length > 160 || !draft.date || !editableKind(draft.kind))) {
      setSaveError(t("calendarInvalid"))
      return
    }
    if (!remove && draft.date <= data.today) { setSaveError(t("calendarPast")); return }
    const controller = new AbortController()
    mutationController.current = controller
    setSaving(true)
    setSaveError(null)
    setSaved(null)
    try {
      const response = await fetch(ENDPOINT, { method: remove ? "DELETE" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(remove ? { id: remove.id, version: remove.updatedAt } : { ...draft, name: draft.name.trim() }), signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || (!remove && !body.data?.id)) {
        if ([401, 403, 404].includes(response.status)) {
          setData(null)
          setDraft(null)
          setLoadError(t("calendarAccessUnavailable"))
        } else {
          const keys: Record<string, string> = { MTM_ATTENDANCE_CALENDAR_INVALID: "calendarInvalid", MTM_ATTENDANCE_CALENDAR_CHANGED: "calendarChanged",
            MTM_ATTENDANCE_CALENDAR_PAST: "calendarPast", MTM_ATTENDANCE_CALENDAR_PAIRED: "calendarPaired", MTM_ATTENDANCE_CALENDAR_EXISTS: "calendarExists" }
          setSaveError(t(keys[body?.code] ?? "calendarSaveUnconfirmed"))
          if (body?.code !== "MTM_ATTENDANCE_CALENDAR_INVALID") setMustReload(true)
        }
        return
      }
      const savedDay = remove ? null : body.data as CalendarDay
      const remaining = data.days.filter((day) => day.id !== (remove?.id ?? draft.id))
      if (savedDay && savedDay.date.slice(0, 4) === year) remaining.push(savedDay)
      setData({ ...data, days: remaining.sort((a, b) => a.date.localeCompare(b.date)) })
      setDraft(blankDraft(data.today))
      setRemovingId(null)
      setSaved(remove ? "calendarDeleted" : "calendarSaved")
    } catch {
      if (!controller.signal.aborted) { setSaveError(t("calendarSaveUnconfirmed")); setMustReload(true) }
    } finally {
      if (mutationController.current === controller) mutationController.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void mutate() }
  const days = data ? [...data.days].sort((a, b) => a.date.localeCompare(b.date)) : []
  const currentYear = data ? Number(data.today.slice(0, 4)) : null
  const disabled = saving || mustReload

  return <HomeCard testId="attendance-calendar" titleId="attendance-calendar-title" icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
    tone="blue" title={t("calendarTitle")}>
    <div className="space-y-6 py-4">
      <p className="max-w-prose text-sm text-muted-foreground">{t("calendarIntro")}</p>
      {loading ? <p role="status" className="text-sm text-muted-foreground">{t("calendarLoading")}</p> : null}
      {loadError ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{loadError}</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void load(year ?? undefined, true)}>{t("calendarReload")}</Button></div> : null}
      {data && draft && currentYear !== null ? <>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <p className="max-w-prose text-sm text-muted-foreground">{t(data.canManage ? "calendarFutureOnly" : "calendarReadOnly")}</p>
          <div className="w-full space-y-2 sm:w-40"><label htmlFor="attendance-calendar-year" className="text-sm font-medium">{t("calendarYear")}</label>
            <select id="attendance-calendar-year" className={SELECT_CLASS} value={year ?? String(currentYear)} disabled={saving}
              onChange={(event) => void load(event.target.value)}>{[currentYear, currentYear + 1].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
        </div>
        {days.length ? <table className="block w-full table-fixed text-left text-sm sm:table" aria-label={t("calendarTitle")}>
          <thead className="hidden border-b border-zinc-200 text-xs text-muted-foreground dark:border-zinc-700 sm:table-header-group"><tr>
            <th scope="col" className="w-[18%] py-3 pr-3 font-medium">{t("calendarDate")}</th><th scope="col" className="w-[23%] py-3 pr-3 font-medium">{t("calendarKind")}</th>
            <th scope="col" className="py-3 pr-3 font-medium">{t("calendarName")}</th><th scope="col" className="w-[25%] py-3 font-medium">{t("calendarActions")}</th>
          </tr></thead>
          <tbody className="block sm:table-row-group">{days.map((day) => <tr key={day.id} data-testid="attendance-calendar-day" className="block space-y-2 border-b border-zinc-200 py-4 last:border-b-0 dark:border-zinc-700 sm:table-row sm:space-y-0 sm:py-0">
            <th scope="row" className="block break-words font-medium sm:table-cell sm:py-4 sm:pr-3"><time dateTime={day.date}>{dateLabel(day.date)}</time></th>
            <td className="block break-words sm:table-cell sm:py-4 sm:pr-3">{kindLabel(day.kind)}</td>
            <td className="block break-words text-muted-foreground sm:table-cell sm:py-4 sm:pr-3">{day.name || t("calendarUnnamed")}</td>
            <td className="block sm:table-cell sm:py-4">{canEdit(day) ? removingId === day.id ? <div className="space-y-2">
              <p className="text-sm font-medium">{t("calendarDeleteConfirm", { date: dateLabel(day.date) })}</p>
              <div className="flex flex-wrap gap-2"><Button type="button" variant="destructive" className="min-h-11" disabled={disabled} onClick={() => void mutate(day)}>{t("calendarConfirmDelete")}</Button>
                <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => setRemovingId(null)}>{t("calendarCancel")}</Button></div>
            </div> : <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={disabled} onClick={() => edit(day)} aria-label={t("calendarEditDate", { date: dateLabel(day.date) })}>{t("calendarEdit")}</Button>
              <Button type="button" variant="ghost" className="min-h-11 text-destructive" disabled={disabled} onClick={() => { setRemovingId(day.id); setSaved(null) }} aria-label={t("calendarDeleteDate", { date: dateLabel(day.date) })}>{t("calendarDelete")}</Button></div>
              : <span className="text-xs text-muted-foreground">{t(day.date <= data.today ? "calendarPastReadOnly" : !day.canEdit ? "calendarPairedReadOnly" : "calendarViewOnly")}</span>}</td>
          </tr>)}</tbody>
        </table> : <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-5 text-sm text-muted-foreground dark:border-zinc-700">{t("calendarEmpty", { year: year ?? String(currentYear) })}</p>}
        {data.canManage ? <form className="space-y-4 border-t border-zinc-200 pt-5 dark:border-zinc-700" onSubmit={submit} aria-label={t(draft.id ? "calendarEditForm" : "calendarAddForm")}>
          <fieldset disabled={disabled} className="space-y-4"><legend className="mb-3 text-sm font-semibold">{t(draft.id ? "calendarEditForm" : "calendarAddForm")}</legend>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.3fr)_minmax(14rem,2fr)]">
              <div className="space-y-2"><label htmlFor="attendance-calendar-date" className="text-sm font-medium">{t("calendarDate")}</label>
                <Input ref={dateInput} id="attendance-calendar-date" type="date" className="min-h-11" required min={tomorrow(data.today)} value={draft.date} onChange={(event) => change({ date: event.target.value })} /></div>
              <div className="space-y-2"><label htmlFor="attendance-calendar-kind" className="text-sm font-medium">{t("calendarKind")}</label>
                <select id="attendance-calendar-kind" className={SELECT_CLASS} value={draft.kind} onChange={(event) => change({ kind: event.target.value as EditableKind })}>
                  {EDITABLE_KINDS.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}</select></div>
              <div className="space-y-2 sm:col-span-2 xl:col-span-1"><label htmlFor="attendance-calendar-name" className="text-sm font-medium">{t("calendarName")}</label>
                <Input id="attendance-calendar-name" className="min-h-11" required maxLength={160} value={draft.name} onChange={(event) => change({ name: event.target.value })} /></div>
            </div>
            <div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11" disabled={disabled}>{t(saving ? "calendarSaving" : draft.id ? "calendarSaveChanges" : "calendarAdd")}</Button>
              {draft.id ? <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => { setDraft(blankDraft(data.today)); setSaveError(null) }}>{t("calendarCancelEdit")}</Button> : null}</div>
          </fieldset>
        </form> : null}
        {saveError ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{saveError}</p>
          {mustReload ? <Button type="button" variant="outline" className="min-h-11" onClick={() => void load(year ?? undefined, true)}>{t("calendarReload")}</Button> : null}</div> : null}
        {saved ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{t(saved)}</p> : null}
      </> : null}
    </div>
  </HomeCard>
}
