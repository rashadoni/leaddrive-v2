"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import { CalendarPlus, ChevronLeft, Users } from "lucide-react"
import { z } from "zod"
import { createDateFormatter } from "@/lib/format-date"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { ATTENDANCE_DAY_GROUPS, AttendanceDayKindSchema, attendanceDayKindLabel, type AttendanceDayKind } from "@/lib/mtm/attendance-day-kinds"
import { ATTENDANCE_HR_BATCH_LIMIT, AttendanceHrRecordingInputSchema, canRecordAttendanceDayKind, type AttendanceHrDirectory, type AttendanceHrRecordingInput } from "@/lib/mtm/attendance-hr-recording-contract"

const GROUP_KEYS: Record<(typeof ATTENDANCE_DAY_GROUPS)[number], string> = { WORK: "kindsGroupWork", PAID_LEAVE: "kindsGroupPaidLeave", UNPAID_LEAVE: "kindsGroupUnpaidLeave", VIOLATION: "kindsGroupViolation", CALENDAR: "kindsGroupCalendar", EMPLOYER: "kindsGroupEmployer" }
const ENDPOINT = "/api/v1/mtm/attendance/recordings"
const DirectorySchema = z.object({
  employees: z.array(z.object({ id: z.string().min(1), name: z.string(), teamId: z.string().nullable(), teamName: z.string().nullable() })).max(2000),
  catalogue: z.object({ items: z.array(AttendanceDayKindSchema).max(64), version: z.string().datetime().nullable() }), timezone: z.string().min(1),
})
const selectClass = "min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-sm disabled:opacity-60"
const ERRORS: Record<string, string> = {
  MTM_ATTENDANCE_HR_RECORD_INVALID: "hrRecordingInvalid",
  MTM_ATTENDANCE_REQUEST_KIND_UNAVAILABLE: "hrRecordingKindChanged",
  MTM_ATTENDANCE_REQUEST_LOCAL_TIME_INVALID: "hrRecordingLocalTime",
  MTM_ATTENDANCE_REQUEST_OVERLAP: "hrRecordingOverlap",
  MTM_ATTENDANCE_DAY_KINDS_CHANGED: "hrRecordingCatalogueChanged",
  MTM_ATTENDANCE_HR_DIRECTORY_TOO_LARGE: "hrRecordingDirectoryLarge",
}

export function MtmAttendanceHrRecordingForm() {
  const t = useTranslations("mtmAttendance"), p = useTranslations("personnel"), locale = useLocale()
  const [directory, setDirectory] = useState<AttendanceHrDirectory | null>(null)
  const [mode, setMode] = useState<"EMPLOYEE" | "TEAM">("EMPLOYEE")
  const [target, setTarget] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [kindKey, setKindKey] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [startTime, setStartTime] = useState("09:00")
  const [endTime, setEndTime] = useState("18:00")
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mustReload, setMustReload] = useState(false)
  const [pending, setPending] = useState<AttendanceHrRecordingInput | null>(null)
  const [savedCount, setSavedCount] = useState<number | null>(null)
  const [recordKind, setRecordKind] = useState<AttendanceDayKind | null>(null)
  const readRequest = useRef<AbortController | null>(null)
  const writeRequest = useRef<AbortController | null>(null)
  const frozen = useRef<AttendanceHrRecordingInput | null>(null)
  const prefilled = useRef(false)
  const clearPrivate = useCallback(() => {
    frozen.current = null; setPending(null); setDirectory(null); setTarget(""); setSelectedIds([])
    setKindKey(""); setFrom(""); setTo(""); setReason(""); setStartTime("09:00"); setEndTime("18:00"); setSavedCount(null); setRecordKind(null)
  }, [])
  const load = useCallback(async () => {
    readRequest.current?.abort()
    const controller = new AbortController(); readRequest.current = controller
    setLoading(true); setError(null); setSaving(false)
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      const parsed = DirectorySchema.safeParse(body?.data)
      if (!response.ok || body?.success !== true || !parsed.success) {
        if ([401, 403, 404].includes(response.status)) { clearPrivate(); setDenied(true); setError("hrRecordingForbidden") }
        else setError(ERRORS[body?.code] ?? "hrRecordingLoadError")
        return
      }
      setDirectory({ ...parsed.data, catalogue: { ...parsed.data.catalogue, items: parsed.data.catalogue.items.filter(canRecordAttendanceDayKind) } })
      setDenied(false); setMustReload(false)
      // Opened from a timesheet cell or Today's "add reason": start with that
      // person and day. Only an employee in this reviewer's directory is taken.
      if (!prefilled.current) {
        prefilled.current = true
        const query = new URLSearchParams(window.location.search)
        const employeeId = query.get("employeeId"), date = query.get("date")
        // A link from Today names the person: choose them, not only show the name (it read «0 employees»).
        if (employeeId && parsed.data.employees.some(employee => employee.id === employeeId)) { setMode("EMPLOYEE"); setTarget(employeeId); setSelectedIds([employeeId]) }
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { setFrom(date); setTo(date) }
      }
      // A directory read cannot establish whether a write committed. Its exact
      // UUID/body remains frozen until an authoritative POST acknowledgement.
      if (frozen.current) setError("hrRecordingUnknown")
    } catch { if (!controller.signal.aborted) setError("hrRecordingLoadError") }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [clearPrivate])
  useEffect(() => {
    void load()
    return () => {
      readRequest.current?.abort()
      if (writeRequest.current) { writeRequest.current.abort(); writeRequest.current = null }
    }
  }, [load, locale])
  useEffect(() => {
    if (!pending) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [pending])

  const kind = directory?.catalogue.items.find(item => item.key === kindKey)
  const previewKind = recordKind ?? kind
  const unit = pending?.unit ?? previewKind?.unit
  const employees = new Map(directory?.employees.map(employee => [employee.id, employee]) ?? [])
  const teams = Array.from(new Map(directory?.employees.filter(employee => employee.teamId).map(employee => [employee.teamId!, employee.teamName ?? "—"]) ?? []))
  const unavailable = selectedIds.some(id => !employees.has(id))
  const busy = loading || saving
  const locked = busy || Boolean(pending) || savedCount !== null || denied || mustReload || !directory
  const edit = () => { setError(null) }
  function chooseTarget(value: string) {
    setTarget(value); edit()
    const ids = mode === "EMPLOYEE" ? value ? [value] : [] : directory?.employees.filter(employee => employee.teamId === value).map(employee => employee.id) ?? []
    // Capture exactly this membership, never silently select newly added people.
    setSelectedIds(ids.sort())
    if (ids.length > ATTENDANCE_HR_BATCH_LIMIT) setError("hrRecordingTooMany")
  }
  async function send(input: AttendanceHrRecordingInput) {
    if (writeRequest.current || busy || denied) return
    const controller = new AbortController(); writeRequest.current = controller
    readRequest.current?.abort()
    if (!frozen.current && kind) setRecordKind(kind)
    frozen.current = input; setPending(input); setSaving(true); setError(null)
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (response.ok && body?.success === true && Array.isArray(body.data?.items) && body.data.items.length === input.agentIds.length
        && body.data.items.every((item: { id?: string; agentId?: string; clientRequestId?: string; status?: string }) => typeof item.id === "string" && item.clientRequestId === input.clientRequestId && input.agentIds.includes(item.agentId ?? "") && item.status === "APPROVED")
        && new Set(body.data.items.map((item: { agentId: string }) => item.agentId)).size === input.agentIds.length) {
        frozen.current = null; setPending(null); setSavedCount(body.data.items.length); return
      }
      if ([401, 403, 404].includes(response.status)) { clearPrivate(); setDenied(true); setError("hrRecordingForbidden"); return }
      const known = ERRORS[body?.code]
      if (known && (response.status === 400 || response.status === 409)) {
        frozen.current = null; setPending(null); setRecordKind(null); setError(known)
        if (["MTM_ATTENDANCE_DAY_KINDS_CHANGED", "MTM_ATTENDANCE_REQUEST_KIND_UNAVAILABLE"].includes(body?.code)) setMustReload(true)
      } else setError("hrRecordingUnknown")
    } catch { if (!controller.signal.aborted) setError("hrRecordingUnknown") }
    finally {
      if (writeRequest.current === controller) writeRequest.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked || !kind || !directory || unavailable) return
    const parsed = AttendanceHrRecordingInputSchema.safeParse({ clientRequestId: crypto.randomUUID(), agentIds: [...selectedIds].sort(), dayKindKey: kind.key,
      catalogueVersion: directory.catalogue.version, unit: kind.unit, startDate: from, endDate: kind.unit === "HOURS" ? from : to,
      ...(kind.unit === "HOURS" ? { startTime, endTime } : {}), reason: reason.trim() })
    if (!parsed.success) { setError(selectedIds.length > ATTENDANCE_HR_BATCH_LIMIT ? "hrRecordingTooMany" : "hrRecordingInvalid"); return }
    await send(parsed.data)
  }
  const dateLabel = (value: string) => {
    const date = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(date.getTime()) ? createDateFormatter(locale, { timeZone: "UTC", dateStyle: "medium" }).format(date) : value
  }
  const period = from ? `${dateLabel(from)}${unit === "HOURS" ? ` · ${startTime}–${endTime}` : to && to !== from ? ` — ${dateLabel(to)}` : ""}` : t("hrRecordingPeriodEmpty")
  const dayCount = from && to && unit === "DAYS" ? (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1 : null
  return <section className="space-y-5" data-testid="attendance-hr-recording" aria-busy={busy}>
    {/* The form is reached from Today and from Requests; it had no way back (owner critique, 2026-10-15). */}
    <Link href="/mtm/attendance" prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="attendance-recording-back">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />{p("todayTitle")}</Link>
    <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("hrRecordingTitle")}</h1><p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("hrRecordingIntro")}</p>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground" data-testid="hr-recording-not-self">{t("hrRecordingNotSelf")}</p></div>
    <HomeCard testId="attendance-hr-recording-card" titleId="attendance-hr-recording-title" title={t("hrRecordingCard")} tone="orange" icon={<CalendarPlus className="h-5 w-5" aria-hidden="true" />}>
      <div className="space-y-5 py-5">
        {loading && <p role="status" className="text-sm text-muted-foreground">{t("hrRecordingLoading")}</p>}
        {error && <p role="alert" className="max-w-prose text-sm text-destructive">{t(error)}</p>}
        {pending && !saving && <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><p>{t("hrRecordingRecovery")}</p><Button className="min-h-11" disabled={busy || denied} onClick={() => void send(pending)}>{t("hrRecordingCheck")}</Button></div>}
        {savedCount !== null && <div role="status" className="space-y-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"><p>{t("hrRecordingSaved", { count: savedCount })}</p><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => { setSavedCount(null); setRecordKind(null); setTarget(""); setSelectedIds([]); setReason(""); setError(null) }}>{t("hrRecordingNew")}</Button></div>}
        {directory && !denied ? <form onSubmit={submit} noValidate aria-label={t("hrRecordingCard")} className="space-y-5">
          <fieldset disabled={locked} className="grid min-w-0 gap-5 sm:grid-cols-2">
            <div className="min-w-0 space-y-2"><label htmlFor="hr-recording-mode" className="text-sm font-medium">{t("hrRecordingFor")}</label><select id="hr-recording-mode" className={selectClass} value={mode} onChange={event => { setMode(event.target.value as typeof mode); setTarget(""); setSelectedIds([]); edit() }}><option value="EMPLOYEE">{t("hrRecordingEmployee")}</option><option value="TEAM">{t("hrRecordingTeam")}</option></select></div>
            <div className="min-w-0 space-y-2"><label htmlFor="hr-recording-target" className="text-sm font-medium">{t(mode === "EMPLOYEE" ? "hrRecordingEmployee" : "hrRecordingTeam")}</label><select id="hr-recording-target" className={selectClass} value={target} onChange={event => chooseTarget(event.target.value)}><option value="">{t("hrRecordingChoose")}</option>{mode === "EMPLOYEE" ? directory.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.teamName ? ` · ${employee.teamName}` : ""}</option>) : teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
            <div className="min-w-0 space-y-2 sm:col-span-2"><label htmlFor="hr-recording-kind" className="text-sm font-medium">{t("hrRecordingKind")}</label><select id="hr-recording-kind" className={selectClass} value={kindKey} onChange={event => { setKindKey(event.target.value); edit() }}><option value="">{t("hrRecordingChoose")}</option>
              {/* Grouped like the day types screen: two dozen kinds in one list were hard to scan. */}
              {ATTENDANCE_DAY_GROUPS.map(group => { const items = directory.catalogue.items.filter(item => item.group === group)
                return items.length ? <optgroup key={group} label={t(GROUP_KEYS[group])}>{items.map(item => <option key={item.key} value={item.key}>{item.code} · {attendanceDayKindLabel(item, locale)}</option>)}</optgroup> : null })}</select></div>
            <div className="min-w-0 space-y-2"><label htmlFor="hr-recording-from" className="text-sm font-medium">{t("hrRecordingFrom")}</label><Input className="min-h-11 min-w-0" id="hr-recording-from" type="date" required value={from} onChange={event => { setFrom(event.target.value); edit() }} /></div>
            {unit !== "HOURS" && <div className="min-w-0 space-y-2"><label htmlFor="hr-recording-to" className="text-sm font-medium">{t("hrRecordingTo")}</label><Input className="min-h-11 min-w-0" id="hr-recording-to" type="date" required value={to} min={from || undefined} onChange={event => { setTo(event.target.value); edit() }} /></div>}
            {unit === "HOURS" && <><div className="self-end pb-2 text-sm text-muted-foreground">{t("hrRecordingTimezone", { timezone: directory.timezone })}</div><div className="min-w-0 space-y-2"><label htmlFor="hr-recording-start" className="text-sm font-medium">{t("hrRecordingStartTime")}</label><Input className="min-h-11 min-w-0" id="hr-recording-start" type="time" required value={startTime} onChange={event => { setStartTime(event.target.value); edit() }} /></div><div className="min-w-0 space-y-2"><label htmlFor="hr-recording-end" className="text-sm font-medium">{t("hrRecordingEndTime")}</label><Input className="min-h-11 min-w-0" id="hr-recording-end" type="time" required value={endTime} onChange={event => { setEndTime(event.target.value); edit() }} /></div></>}
            <div className="space-y-2 sm:col-span-2"><label htmlFor="hr-recording-reason" className="text-sm font-medium">{t("hrRecordingReason")}</label><textarea id="hr-recording-reason" className="min-h-24 w-full rounded-lg border bg-background p-3 text-sm" value={reason} required minLength={3} maxLength={1000} aria-describedby="hr-recording-audit-hint" onChange={event => { setReason(event.target.value); edit() }} /><p id="hr-recording-audit-hint" className="text-xs leading-5 text-muted-foreground">{t("hrRecordingAudit")}</p></div>
          </fieldset>
          {directory.employees.length === 0 && <p className="text-sm text-muted-foreground">{t("hrRecordingNoEmployees")}</p>}
          {directory.catalogue.items.length === 0 && <p className="text-sm text-muted-foreground">{t("hrRecordingNoKinds")}</p>}
          {unavailable && <p role="alert" className="text-sm text-destructive">{t("hrRecordingScopeChanged")}</p>}
          <p className="rounded-xl bg-muted/60 p-4 text-sm leading-6">{t("hrRecordingValidation")}</p>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{t("hrRecordingCount", { count: selectedIds.length })}{dayCount !== null && dayCount > 0 && Number.isInteger(dayCount) ? ` · ${t("hrRecordingDays", { count: dayCount })}` : ""}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void load()}>{t("hrRecordingRefresh")}</Button><Button type="submit" className="min-h-11" disabled={locked || unavailable || !kind || selectedIds.length === 0 || selectedIds.length > ATTENDANCE_HR_BATCH_LIMIT}>{t(saving ? "hrRecordingSaving" : "hrRecordingSave")}</Button></div></div>
        </form> : <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void load()}>{t("hrRecordingRefresh")}</Button>}
      </div>
    </HomeCard>
    {directory && selectedIds.length > 0 && !denied && <HomeCard testId="attendance-hr-preview-card" titleId="attendance-hr-preview-title" title={t("hrRecordingPreview")} tone="zinc" icon={<Users className="h-5 w-5" aria-hidden="true" />}>
      <p className="pt-4 text-xs leading-5 text-muted-foreground">{t("hrRecordingSnapshot")}</p>
      <ul className="divide-y divide-border" data-testid="hr-recording-preview">{selectedIds.map(id => { const employee = employees.get(id); return <li key={id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0 space-y-1"><p className="break-words text-sm font-semibold">{employee?.name ?? t("hrRecordingUnavailableEmployee")}</p><p className="text-xs text-muted-foreground">{period}</p></div>{previewKind && <HomePill tone="green" className="max-w-full whitespace-normal">{previewKind.code} · {attendanceDayKindLabel(previewKind, locale)}</HomePill>}</li> })}</ul>
    </HomeCard>}
  </section>
}
