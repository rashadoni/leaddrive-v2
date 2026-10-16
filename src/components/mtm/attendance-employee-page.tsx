"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { BriefcaseBusiness, CalendarDays, ChevronLeft, History, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { MtmAttendanceEmployeeRemove } from "@/components/mtm/attendance-employee-remove"
import { MtmAttendanceDepartmentField, departmentPayload, type DepartmentValue } from "@/components/mtm/attendance-department-field"
import { createDateFormatter, formatTime } from "@/lib/format-date"
import { formatAttendanceDuration } from "@/lib/mtm/attendance-presentation"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { ATTENDANCE_EMPLOYEE_POSITION_MAX, AttendanceEmploymentInputSchema, AttendanceParticipationInputSchema, type AttendanceEmployeeDetail } from "@/lib/mtm/attendance-employee-contract"

const ENDPOINT = "/api/v1/mtm/attendance/employees"
const SELECT = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
const SAVE_ERRORS: Record<string, string> = {
  MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN: "addEmployeeEmailTaken", MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN: "addEmployeePhoneTaken",
  MTM_ATTENDANCE_EMPLOYEE_PHONE_INVALID: "addEmployeePhoneInvalid", MTM_ATTENDANCE_EMPLOYEE_LOGIN_LOCKED: "employeeLoginLocked",
  MTM_ATTENDANCE_EMPLOYEE_MANAGER_INVALID: "employeeManagerInvalid",
}
type Employee = AttendanceEmployeeDetail["employee"]
type Form = { name: string; phone: string; email: string; position: string; department: DepartmentValue; managerId: string; hireDate: string }
type Change = { kind: "HIRE" | "TERMINATION" | "REHIRE"; date: string; reason: string }
const formOf = (employee: Employee): Form => ({ name: employee.name, phone: employee.phone ?? "", email: employee.email ?? "", position: employee.position ?? "",
  department: { teamId: employee.teamId ?? "", newTeamName: "" }, managerId: employee.managerId ?? "", hireDate: "" })
const nextKind = (history: Employee["history"]): Change["kind"] => !history.length ? "HIRE" : history.at(-1)!.kind === "TERMINATION" ? "REHIRE" : "TERMINATION"

function Section({ title, icon, children, testId }: { title: string; icon: ReactNode; children: ReactNode; testId: string }) {
  return <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5" data-testid={testId}>
    <h2 className="flex items-center gap-2 text-base font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" aria-hidden="true">{icon}</span>{title}</h2>
    {children}
  </section>
}
function Field({ id, label, hint, children, missing }: { id: string; label: string; hint?: ReactNode; children: ReactNode; missing?: boolean }) {
  const p = useTranslations("personnel")
  // An empty field HR is expected to fill says so beside its label.
  return <div className="space-y-1.5"><label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-medium">{label}{missing ? <span className="text-xs font-normal text-amber-700 dark:text-amber-400" data-testid="employee-field-missing">{p("employeeNotFilled")}</span> : null}</label>{children}
    {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</div>
}

/**
 * Personnel → Employees → one employee (owner, 2026-10-16: «просил редактируемыми
 * сделать сотрудников»; the card under a 200-row list meant scrolling down and
 * back). Everything about the person on one page: who they are and how they sign
 * in, their job, this month so far, and the employment history.
 */
export function MtmAttendanceEmployeePage({ agentId, back }: { agentId: string; back: string }) {
  const p = useTranslations("personnel"), t = useTranslations("mtmAttendance"), statusText = useTranslations("mtmStatus"), locale = useLocale()
  const [detail, setDetail] = useState<AttendanceEmployeeDetail | null>(null)
  const [form, setForm] = useState<Form | null>(null), [change, setChange] = useState<Change>({ kind: "HIRE", date: "", reason: "" })
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null), [saved, setSaved] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setLoading(true)
    try {
      const response = await fetch(`${ENDPOINT}/${encodeURIComponent(agentId)}`, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || !body.data?.employee) { setDetail(null); setError(response.status === 404 ? "employeeNotFound" : "employeeLoadFailed"); return }
      const next = body.data as AttendanceEmployeeDetail
      setDetail(next); setForm(formOf(next.employee)); setChange({ kind: nextKind(next.employee.history), date: "", reason: "" })
    } catch { if (!controller.signal.aborted) setError("employeeLoadFailed") }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [agentId])
  useEffect(() => { void load(); return () => request.current?.abort() }, [load])

  async function post(url: string, body: unknown, done: string) {
    setBusy(true); setError(null); setSaved(null)
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.success !== true) { setError(SAVE_ERRORS[result?.code] ?? (result?.code === "MTM_ATTENDANCE_EMPLOYEE_DATE_INVALID" ? "employeeDateInvalid" : "employeeSaveFailed")); return }
      await load(); setSaved(done)
    } catch { setError("employeeSaveFailed") }
    finally { setBusy(false) }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail || !form || busy) return
    const login = detail.employee.loginEditable
    void post(`${ENDPOINT}/${encodeURIComponent(agentId)}`, { name: form.name, position: form.position.trim() || null, ...departmentPayload(form.department), managerId: form.managerId || null,
      // No number yet stays no number: an empty field is not sent (the number is the sign-in).
      ...(login ? { ...(form.phone.trim() ? { phone: form.phone } : {}), email: form.email.trim() || null } : {}), ...(form.hireDate ? { hireDate: form.hireDate } : {}) }, "employeeSaved")
  }
  function recordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail || busy) return
    const parsed = AttendanceEmploymentInputSchema.safeParse({ ...change, agentId, previousEventId: detail.employee.history.at(-1)?.id ?? null, clientRequestId: crypto.randomUUID() })
    if (!parsed.success) { setError("employeeChangeInvalid"); return }
    void post(`${ENDPOINT}/history`, parsed.data, "employeeChangeSaved")
  }
  function toggleParticipation() {
    if (!detail || busy) return
    const parsed = AttendanceParticipationInputSchema.safeParse({ clientRequestId: crypto.randomUUID(), agentId, included: !detail.employee.included, previousEventId: detail.employee.participationVersion })
    if (parsed.success) void post(`${ENDPOINT}/participation`, parsed.data, "employeeSaved")
  }

  const date = (value: string) => createDateFormatter(locale, { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${value}T00:00:00Z`))
  const backLink = <Link href={back} prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="attendance-employee-back">
    <ChevronLeft className="h-4 w-4" aria-hidden="true" />{p("employeeBack")}</Link>
  if (!detail || !form) return <div className="space-y-4">{backLink}
    {loading ? <p role="status" className="text-sm text-muted-foreground">{t("employeesLoading")}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{p(error)}</p> : null}</div>

  const employee = detail.employee, set = <K extends keyof Form>(key: K) => (value: Form[K]) => { setForm(current => current ? { ...current, [key]: value } : current); setSaved(null) }
  const hire = [...employee.history].reverse().find(event => event.kind !== "TERMINATION") ?? null
  const terminated = employee.history.at(-1)?.kind === "TERMINATION" ? employee.history.at(-1)! : null
  const initials = employee.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join("")
  const mark = employee.todayMark, time = (value: string | null) => value ? formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: detail.timezone }) : ""
  // The same words and colours as the list's «Today» column.
  const [today, todayTone]: [string, HomeTone] = !employee.included ? [p("todayExcluded"), "zinc"] : !mark ? [p("todayNone"), "zinc"] : mark.status === "PAUSED" ? [p("todayPaused"), "amber"]
    : mark.status === "COMPLETED" ? [p("todayLeft", { time: time(mark.completedAt) }), "blue"] : [p("todayAt", { time: time(mark.startedAt) }), "green"]
  const month = detail.month
  const tiles = month ? [[p("monthWorked"), p("monthWorkedValue", { days: month.workedDays, hours: formatAttendanceDuration(month.workedSeconds) })], [p("monthLate"), String(month.lateCount)],
    [p("monthAbsent"), String(month.absentCount)], [p("monthLeave"), p("monthLeaveValue", { leave: month.leaveDays, sick: month.sickDays })]] : []

  return <div className="space-y-5" data-testid="attendance-employee-page">
    {backLink}
    <form onSubmit={save} className="space-y-5" aria-label={p("employeeTitle", { name: employee.name })}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-orange-100 text-lg font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200" aria-hidden="true">{initials}</span>
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{p("employeeCardHeading")}</p><h1 className="break-words text-2xl font-semibold tracking-tight">{employee.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{[employee.position, employee.teamName].filter(Boolean).join(" · ") || mtmStatusLabel(statusText, "role", employee.role)}
              <HomePill tone={todayTone}>{today}</HomePill></p></div></div>
        <div className="flex flex-wrap items-center gap-3">{saved ? <span role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{p(saved)}</span> : null}
          <Button type="submit" className="min-h-11 rounded-full px-6" disabled={busy}>{p(busy ? "employeeCardSaving" : "employeeSave")}</Button></div>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{p(error)}</p> : null}
      <div className="grid items-stretch gap-5 lg:grid-cols-2">
        <Section title={p("sectionPersonal")} icon={<UserRound className="h-4 w-4" />} testId="employee-section-personal">
          <Field id="employee-name" label={p("addEmployeeName")}><Input id="employee-name" required maxLength={200} className="min-h-11" value={form.name} onChange={event => set("name")(event.target.value)} /></Field>
          <Field id="employee-phone" label={p("employeePhone")} hint={employee.loginEditable ? p("employeePhoneHint") : p("employeeLoginLocked")} missing={!form.phone}>
            <Input id="employee-phone" type="tel" inputMode="tel" placeholder="+994501234567" maxLength={24} className="min-h-11" disabled={!employee.loginEditable} value={form.phone} onChange={event => set("phone")(event.target.value)} /></Field>
          <Field id="employee-email" label={p("addEmployeeEmail")}>
            <Input id="employee-email" type="email" maxLength={320} className="min-h-11" disabled={!employee.loginEditable} value={form.email} onChange={event => set("email")(event.target.value)} /></Field>
        </Section>
        <Section title={p("sectionWork")} icon={<BriefcaseBusiness className="h-4 w-4" />} testId="employee-section-work">
          <Field id="employee-position" label={p("employeeCardPosition")} missing={!form.position.trim()}>
            <Input id="employee-position" maxLength={ATTENDANCE_EMPLOYEE_POSITION_MAX} className="min-h-11" placeholder={p("employeeCardPositionPlaceholder")} value={form.position} onChange={event => set("position")(event.target.value)} /></Field>
          <MtmAttendanceDepartmentField id="employee-department" teams={detail.teams} value={form.department} onChange={set("department")} />
          <Field id="employee-manager" label={p("employeeCardManager")} hint={p("employeeCardManagerHint")}>
            <select id="employee-manager" className={SELECT} value={form.managerId} onChange={event => set("managerId")(event.target.value)}>
              <option value="">{p("employeeCardNoManager")}</option>
              {form.managerId && !detail.managers.some(manager => manager.id === form.managerId) ? <option value={form.managerId}>{p("employeeCardManagerUnavailable")}</option> : null}
              {detail.managers.map(manager => <option key={manager.id} value={manager.id}>{manager.position ? `${manager.name} · ${manager.position}` : manager.name}</option>)}</select></Field>
          {hire ? <div className="space-y-1.5" data-testid="employee-hire"><span className="block text-sm font-medium">{p("employeeCardHired")}</span>
            <p className="flex min-h-11 items-center rounded-md bg-muted/50 px-3 text-sm">{date(hire.date)}</p>
            <p className={`text-xs ${terminated ? "font-medium text-destructive" : "text-muted-foreground"}`}>{terminated ? p("employeeCardTerminated", { date: date(terminated.date) }) : p("employeeHireInHistory")}</p></div>
            : <Field id="employee-hire-date" label={p("employeeCardHired")} hint={p("employeeHireFirst")} missing={!form.hireDate}>
              <Input id="employee-hire-date" type="date" className="min-h-11" value={form.hireDate} onChange={event => set("hireDate")(event.target.value)} /></Field>}
        </Section>
      </div>
    </form>
    <div className="grid items-stretch gap-5 lg:grid-cols-2">
      <Section title={p("sectionMonth")} icon={<CalendarDays className="h-4 w-4" />} testId="employee-section-month">
        {month ? <>
          <p className="text-xs text-muted-foreground">{p("monthPeriod", { from: date(month.from), to: date(month.to) })}</p>
          <dl className="grid grid-cols-2 gap-3">{tiles.map(([label, value]) => <div key={label} className="rounded-xl bg-muted/50 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl>
          <Link href={`/mtm/attendance/timesheet?date=${month.to}&employeeId=${encodeURIComponent(agentId)}`} prefetch={false} className="text-sm font-semibold text-primary hover:underline">{p("monthOpenTimesheet")} →</Link>
        </> : <p className="text-sm text-muted-foreground">{p("monthUnavailable")}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <span className="text-sm"><span className="block font-medium">{t("employeesParticipation")}</span><span className="text-xs text-muted-foreground">{p("employeeParticipationHint")}</span></span>
          <Button type="button" variant="ghost" role="switch" aria-checked={employee.included} aria-label={t("employeesParticipationNamed", { name: employee.name })} disabled={busy} className="min-h-11 gap-2 px-0 hover:bg-transparent" onClick={toggleParticipation}>
            <span aria-hidden="true" className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 ${employee.included ? "justify-end bg-primary" : "justify-start bg-zinc-400 dark:bg-zinc-600"}`}><span className="h-5 w-5 rounded-full bg-white" /></span>{t(employee.included ? "employeesIncluded" : "employeesExcluded")}
          </Button></div>
      </Section>
      <Section title={p("employeeCardHistory")} icon={<History className="h-4 w-4" />} testId="employees-history">
        {employee.history.length ? <ol className="divide-y" aria-label={t("employeesHistoryList")}>{[...employee.history].reverse().map(event => <li key={event.id} className="py-2.5 text-sm" data-testid="employment-event">
          <strong>{t(`employees${event.kind === "HIRE" ? "Hire" : event.kind === "TERMINATION" ? "Termination" : "Rehire"}`)} · {date(event.date)}</strong>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("employeesAuthor", { name: event.byName ?? t("employeesAuthorUnknown") })}</p></li>)}</ol>
          : <p className="text-sm text-muted-foreground">{t("employeesNoHistory")}</p>}
        <form aria-label={t("employeesRecordChange")} className="mt-auto space-y-3 border-t pt-4" onSubmit={recordChange}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><label htmlFor="employment-kind" className="text-sm font-medium">{t("employeesChange")}</label>
              <select id="employment-kind" className={SELECT} value={change.kind} disabled={busy} onChange={event => setChange(current => ({ ...current, kind: event.target.value as Change["kind"] }))}>
                <option value={nextKind(employee.history)}>{t(`employees${nextKind(employee.history) === "HIRE" ? "Hire" : nextKind(employee.history) === "TERMINATION" ? "Termination" : "Rehire"}`)}</option></select></div>
            <div className="space-y-1.5"><label htmlFor="employment-date" className="text-sm font-medium">{t(change.kind === "TERMINATION" ? "employeesLastWorkingDate" : "employeesHireDate")}</label>
              <Input id="employment-date" type="date" className="min-h-11" value={change.date} disabled={busy} onChange={event => setChange(current => ({ ...current, date: event.target.value }))} /></div>
            <div className="space-y-1.5 sm:col-span-2"><label htmlFor="employment-reason" className="text-sm font-medium">{t("employeesReason")}</label>
              <Input id="employment-reason" maxLength={1000} className="min-h-11" value={change.reason} disabled={busy} onChange={event => setChange(current => ({ ...current, reason: event.target.value }))} /></div>
          </div>
          <Button type="submit" variant="outline" className="min-h-11 rounded-full" disabled={busy}>{t("employeesSaveChange")}</Button>
        </form>
      </Section>
    </div>
    <MtmAttendanceEmployeeRemove detail={detail} back={back} onDismissed={() => { void load(); setSaved("removeDismissed") }} />
  </div>
}
