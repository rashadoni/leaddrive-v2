"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { CalendarClock, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import type { MtmAttendanceRule } from "@/lib/mtm/attendance-rules"

type RulesData = {
  current: MtmAttendanceRule
  versions: MtmAttendanceRule[]
  today: string
  minEffectiveFrom: string
  canManageRules: boolean
}

type Draft = {
  effectiveFrom: string
  startTime: string
  endTime: string
  /** Lunch from–to (owner, 2026-10-16: the time, not only the length). Both empty: no fixed lunch. */
  lunchStart: string
  lunchEnd: string
  lateGraceMinutes: string
  weekendDays: number[]
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const
const ENDPOINT = "/api/v1/mtm/attendance/rules"

const toMinutes = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return hours * 60 + minutes }
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
/** The rule's lunch as from–to; a rule saved before its time was kept starts at 13:00 if that fits the day. */
export function lunchWindow(rule: Pick<MtmAttendanceRule, "startTime" | "endTime" | "lunchMinutes" | "lunchStart">): { start: string; end: string } | null {
  if (rule.lunchMinutes <= 0) return null
  const start = rule.lunchStart ?? (toMinutes("13:00") >= toMinutes(rule.startTime) && toMinutes("13:00") + rule.lunchMinutes <= toMinutes(rule.endTime) ? "13:00" : null)
  return start ? { start, end: toTime(toMinutes(start) + rule.lunchMinutes) } : null
}
function draftFor(rule: MtmAttendanceRule, effectiveFrom: string): Draft {
  const lunch = lunchWindow(rule)
  return { effectiveFrom, startTime: rule.startTime, endTime: rule.endTime,
    lunchStart: lunch?.start ?? "", lunchEnd: lunch?.end ?? "", lateGraceMinutes: String(rule.lateGraceMinutes),
    weekendDays: [...rule.weekendDays] }
}

function nextDate(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

/** A single organization rule, with changes scheduled explicitly for a future day. */
export function MtmAttendanceRulesForm() {
  const t = useTranslations("mtmAttendance")
  const locale = useLocale()
  const [data, setData] = useState<RulesData | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedDate, setSavedDate] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mustReload, setMustReload] = useState(false)
  const loadController = useRef<AbortController | null>(null)
  const saveController = useRef<AbortController | null>(null)
  const interruptedSave = useRef(false)

  const load = useCallback(async (acknowledgeInterrupted = false) => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setLoading(true)
    setLoadError(null)
    setSaveError(null)
    setSavedDate(null)
    setData(null)
    setDraft(null)
    if (interruptedSave.current) setSaving(false)
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || !body.data?.current || !Array.isArray(body.data.versions)) {
        setLoadError(t([401, 403, 404].includes(response.status) ? "rulesAccessUnavailable" : "rulesLoadError"))
        return
      }
      const loaded = body.data as RulesData
      const latest = [...loaded.versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? loaded.current
      setData(loaded)
      setDraft(draftFor(loaded.canManageRules ? latest : loaded.current, loaded.minEffectiveFrom))
      const unresolved = interruptedSave.current && !acknowledgeInterrupted
      setMustReload(unresolved)
      if (unresolved) setSaveError(t("rulesSaveUnconfirmed"))
      else interruptedSave.current = false
    } catch {
      if (!controller.signal.aborted) setLoadError(t("rulesLoadError"))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    return () => {
      loadController.current?.abort()
      if (saveController.current) {
        interruptedSave.current = true
        saveController.current.abort()
        saveController.current = null
      }
    }
  }, [load])

  const dateLabel = (date: string) => formatDate(`${date}T12:00:00.000Z`, locale, { dateStyle: "medium", timeZone: "UTC" })
  const currentLunch = data ? lunchWindow(data.current) : null
  const weekendLabel = (days: readonly number[]) => {
    const names = WEEKDAYS.filter((day) => days.includes(day)).map((day) => t(DAY_KEYS[day]))
    // Commas, not Intl's list: browsers without Azerbaijani data printed «Şənbə and Bazar».
    return names.length ? names.join(", ") : t("noWeekendDays")
  }

  function change(values: Partial<Draft>) {
    setDraft((previous) => previous ? { ...previous, ...values } : previous)
    setSavedDate(null)
    if (!mustReload) setSaveError(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data?.canManageRules || !draft || saving || saveController.current || mustReload) return
    const lateGraceMinutes = Number(draft.lateGraceMinutes)
    // Lunch is both times or neither, and lies inside the working day.
    const hasLunch = Boolean(draft.lunchStart || draft.lunchEnd)
    const lunchMinutes = hasLunch && draft.lunchStart && draft.lunchEnd ? toMinutes(draft.lunchEnd) - toMinutes(draft.lunchStart) : 0
    if (!draft.lateGraceMinutes.trim()
      || !Number.isInteger(lateGraceMinutes) || lateGraceMinutes < 0 || lateGraceMinutes > 120
      || !draft.startTime || !draft.endTime || draft.endTime <= draft.startTime
      || draft.weekendDays.length > 6) {
      setSaveError(t("rulesInvalid"))
      return
    }
    if (hasLunch && (!draft.lunchStart || !draft.lunchEnd || lunchMinutes <= 0 || draft.lunchStart < draft.startTime || draft.lunchEnd > draft.endTime
      || toMinutes(draft.endTime) - toMinutes(draft.startTime) <= lunchMinutes)) {
      setSaveError(t("rulesLunchInvalid"))
      return
    }
    if (!draft.effectiveFrom || draft.effectiveFrom < data.minEffectiveFrom) {
      setSaveError(t("rulesFutureRequired"))
      setMustReload(true)
      return
    }
    const controller = new AbortController()
    saveController.current = controller
    setSaving(true)
    setSaveError(null)
    setSavedDate(null)
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ effectiveFrom: draft.effectiveFrom, startTime: draft.startTime, endTime: draft.endTime, weekendDays: draft.weekendDays,
          lunchMinutes, lunchStart: hasLunch ? draft.lunchStart : null, lateGraceMinutes }), signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || !body.data?.effectiveFrom) {
        if ([401, 403, 404].includes(response.status)) {
          setData(null)
          setDraft(null)
          setLoadError(t("rulesAccessUnavailable"))
        } else if (body?.code === "MTM_ATTENDANCE_RULE_INVALID") {
          setSaveError(t("rulesInvalid"))
        } else if (body?.code === "MTM_ATTENDANCE_RULE_FUTURE_REQUIRED") {
          setSaveError(t("rulesFutureRequired"))
          setMustReload(true)
        } else {
          setSaveError(t(body?.code === "MTM_ATTENDANCE_RULE_CONFLICT" ? "rulesConflict" : "rulesSaveUnconfirmed"))
          setMustReload(true)
        }
        return
      }
      const saved = body.data as MtmAttendanceRule
      // The server returned a new future version. Today's rule stays visible;
      // the next edit cannot silently overwrite this just-published version.
      const minEffectiveFrom = nextDate(saved.effectiveFrom)
      setData({ ...data, versions: [...data.versions.filter((rule) => rule.id !== saved.id), saved], minEffectiveFrom })
      setDraft(draftFor(saved, minEffectiveFrom))
      setSavedDate(saved.effectiveFrom)
    } catch {
      if (!controller.signal.aborted) {
        setSaveError(t("rulesSaveUnconfirmed"))
        setMustReload(true)
      }
    } finally {
      if (saveController.current === controller) saveController.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }

  const versions = data ? [...new Map([data.current, ...data.versions].map((rule) => [rule.id, rule])).values()]
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)) : []

  return <HomeCard testId="attendance-rules" titleId="attendance-rules-title" icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
    tone="orange" title={t("rulesTitle")}>
    <div className="space-y-6 py-4">
      {loading ? <p role="status" className="text-sm text-muted-foreground">{t("rulesLoading")}</p> : null}
      {loadError ? <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">{loadError}</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void load(true)}>{t("rulesReload")}</Button>
      </div> : null}
      {data && draft ? <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("rulesCurrentHours", { start: data.current.startTime, end: data.current.endTime })}{currentLunch ? ` · ${t("rulesCurrentLunch", currentLunch)}` : ""}</p>
            <p className="max-w-prose text-sm text-muted-foreground">{t("rulesHistoryPreserved")}</p>
          </div>
          <span className="text-xs text-muted-foreground">{t("rulesTimezone", { timezone: data.current.timezone })}</span>
        </div>
        {!data.canManageRules ? <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm">{t("rulesReadOnly")}</p> : null}
        <form onSubmit={(event) => void save(event)} className="space-y-5" aria-label={t("rulesTitle")}>
          <fieldset disabled={!data.canManageRules || saving || mustReload} className="space-y-5">
            <legend className="mb-3 text-sm font-semibold">{t(data.canManageRules ? "rulesNextVersion" : "rulesCurrentVersion")}</legend>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <label htmlFor="attendance-start" className="text-sm font-medium">{t("rulesStart")}</label>
                <Input id="attendance-start" type="time" required value={draft.startTime} className="min-h-11 tabular-nums" onChange={(event) => change({ startTime: event.target.value })} />
              </div>
              <div className="space-y-2">
                <label htmlFor="attendance-end" className="text-sm font-medium">{t("rulesEnd")}</label>
                <Input id="attendance-end" type="time" required value={draft.endTime} className="min-h-11 tabular-nums" onChange={(event) => change({ endTime: event.target.value })} />
              </div>
              <div className="space-y-2">
                <label htmlFor="attendance-lunch" className="text-sm font-medium">{t("rulesLunchWindow")}</label>
                <div className="flex items-center gap-1.5">
                  <Input id="attendance-lunch" type="time" aria-label={t("rulesLunchFrom")} value={draft.lunchStart} className="min-h-11 min-w-0 tabular-nums" onChange={(event) => change({ lunchStart: event.target.value })} />
                  <span className="text-muted-foreground" aria-hidden="true">–</span>
                  <Input id="attendance-lunch-end" type="time" aria-label={t("rulesLunchTo")} value={draft.lunchEnd} className="min-h-11 min-w-0 tabular-nums" onChange={(event) => change({ lunchEnd: event.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="attendance-grace" className="text-sm font-medium">{t("rulesLateGrace")}</label>
                <Input id="attendance-grace" type="number" required min={0} max={120} step={1} value={draft.lateGraceMinutes} className="min-h-11 tabular-nums" onChange={(event) => change({ lateGraceMinutes: event.target.value })} />
              </div>
            </div>
            <p className="max-w-prose text-xs text-muted-foreground">{t("rulesLunchHint")}</p>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("rulesWeekends")}</legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => <label key={day} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm has-[:checked]:border-foreground has-[:checked]:font-semibold has-[:disabled]:cursor-default dark:border-zinc-700">
                  <input type="checkbox" value={day} checked={draft.weekendDays.includes(day)} className="h-4 w-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onChange={(event) => change({ weekendDays: event.target.checked ? [...draft.weekendDays, day].sort((a, b) => a - b) : draft.weekendDays.filter((value) => value !== day) })} />
                  {t(DAY_KEYS[day])}
                </label>)}
              </div>
            </fieldset>
            {data.canManageRules ? <div className="grid items-start gap-3 sm:grid-cols-[minmax(12rem,16rem)_1fr]">
              <div className="space-y-2">
                <label htmlFor="attendance-effective-from" className="text-sm font-medium">{t("rulesEffectiveFrom")}</label>
                <Input id="attendance-effective-from" type="date" required min={data.minEffectiveFrom} value={draft.effectiveFrom} aria-describedby="attendance-effective-hint" className="min-h-11" onChange={(event) => change({ effectiveFrom: event.target.value })} />
              </div>
              <p id="attendance-effective-hint" className="max-w-prose text-xs leading-relaxed text-muted-foreground sm:pt-8">{t("rulesEarliestDate", { date: dateLabel(data.minEffectiveFrom) })}</p>
            </div> : null}
          </fieldset>
          {saveError ? <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">{saveError}</p>
            {mustReload ? <Button type="button" variant="outline" className="min-h-11" onClick={() => void load(true)}>{t("rulesReload")}</Button> : null}
          </div> : null}
          {savedDate ? <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{t("rulesSaved", { date: dateLabel(savedDate) })}</p> : null}
          {data.canManageRules ? <Button type="submit" disabled={saving || mustReload} className="min-h-11 w-full sm:w-auto">{t(saving ? "rulesSaving" : "rulesSave")}</Button> : null}
        </form>
        <section aria-labelledby="attendance-rules-history-title" className="border-t border-zinc-100 pt-5 dark:border-zinc-800">
          <h4 id="attendance-rules-history-title" className="mb-3 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("rulesHistory")}</h4>
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {versions.map((rule) => <li key={rule.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(12rem,1fr)_2fr]" data-testid="attendance-rule-version">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span>{rule.createdAt === null ? t("rulesDefaultVersion") : t("rulesVersionFrom", { date: dateLabel(rule.effectiveFrom) })}</span>
                <HomePill tone={rule.id === data.current.id ? "green" : rule.effectiveFrom > data.today ? "blue" : "zinc"}>
                  {t(rule.id === data.current.id ? "rulesActive" : rule.effectiveFrom > data.today ? "rulesScheduled" : "rulesPrevious")}
                </HomePill>
              </div>
              <div className="space-y-1 text-sm">
                <p className="tabular-nums">{rule.lunchStart ? t("rulesVersionSummaryWindow", { start: rule.startTime, end: rule.endTime, lunchStart: lunchWindow(rule)!.start, lunchEnd: lunchWindow(rule)!.end, grace: rule.lateGraceMinutes })
                  : t("rulesVersionSummary", { start: rule.startTime, end: rule.endTime, lunch: rule.lunchMinutes, grace: rule.lateGraceMinutes })}</p>
                <p className="text-xs text-muted-foreground">{t("rulesWeekendSummary", { days: weekendLabel(rule.weekendDays) })}</p>
              </div>
            </li>)}
          </ol>
        </section>
      </> : null}
    </div>
  </HomeCard>
}
