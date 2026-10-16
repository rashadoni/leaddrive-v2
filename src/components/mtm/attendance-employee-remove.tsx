"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OFFICE_EMPLOYEE_CRM_ROLE, type AttendanceEmployeeDetail } from "@/lib/mtm/attendance-employee-contract"

const ERRORS: Record<string, string> = {
  MTM_ATTENDANCE_EMPLOYEE_CRM_USER: "removeCrmUser", MTM_ATTENDANCE_EMPLOYEE_HIRE_REQUIRED: "removeHireRequired",
  MTM_ATTENDANCE_EMPLOYEE_DATE_INVALID: "removeDateInvalid",
}

/**
 * Personnel → employee page → remove (owner, 2026-10-16: «где удаление
 * сотрудников»), by his rule for MTM agents: delete only someone with no work
 * history; with history the server says so and HR dismisses instead — last
 * working day, reason, the app login closed, the marks kept for the timesheet.
 */
export function MtmAttendanceEmployeeRemove({ detail, back, onDismissed }: { detail: AttendanceEmployeeDetail; back: string; onDismissed: () => void }) {
  const p = useTranslations("personnel"), router = useRouter()
  const employee = detail.employee
  const [step, setStep] = useState<"idle" | "confirm" | "dismiss">("idle")
  const [lastDay, setLastDay] = useState(detail.today), [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  // Someone Personnel did not add (an administrator, a sales manager) leaves through Settings → Users.
  const crmUser = Boolean(employee.crmRole) && employee.crmRole !== OFFICE_EMPLOYEE_CRM_ROLE
  const dismissed = employee.status !== "ACTIVE"

  async function send(body: unknown) {
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/v1/mtm/attendance/employees/${encodeURIComponent(employee.id)}/remove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => null)
      if (response.ok && result?.success === true) return true
      if (result?.code === "MTM_ATTENDANCE_EMPLOYEE_HAS_HISTORY") { setStep("dismiss"); return false }
      setError(ERRORS[result?.code] ?? "removeFailed"); return false
    } catch { setError("removeFailed"); return false }
    finally { setBusy(false) }
  }
  async function remove() { if (await send({ mode: "DELETE" })) router.push(back) }
  async function dismiss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim().length < 3) { setError("removeReasonShort"); return }
    if (await send({ mode: "DISMISS", lastDay, reason: reason.trim() })) { setStep("idle"); onDismissed() }
  }

  return <section className="space-y-3 rounded-2xl border border-rose-200 bg-card p-5 dark:border-rose-900" data-testid="attendance-employee-remove" aria-labelledby="attendance-employee-remove-title">
    <h2 id="attendance-employee-remove-title" className="flex items-center gap-2 text-base font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" aria-hidden="true"><Trash2 className="h-4 w-4" /></span>{p("removeTitle")}</h2>
    {crmUser ? <p className="max-w-3xl text-sm text-muted-foreground" data-testid="attendance-employee-remove-crm">{p("removeCrmUser")}</p>
      : dismissed ? <p className="max-w-3xl text-sm text-muted-foreground">{p("removeDismissedAlready")}</p>
      : step === "idle" ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-3xl text-sm text-muted-foreground">{p("removeHint")}</p>
        <Button type="button" variant="outline" className="min-h-11 rounded-full text-rose-700 dark:text-rose-300" onClick={() => { setStep("confirm"); setError(null) }}>{p("removeButton")}</Button></div>
      : step === "confirm" ? <div className="space-y-3 rounded-xl bg-rose-50 p-4 dark:bg-rose-950/30" role="alertdialog" aria-label={p("removeConfirm", { name: employee.name })}>
        <p className="text-sm font-medium">{p("removeConfirm", { name: employee.name })}</p>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="destructive" className="min-h-11 rounded-full" disabled={busy} onClick={() => void remove()}>{p(busy ? "removeBusy" : "removeConfirmButton")}</Button>
          <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={busy} onClick={() => setStep("idle")}>{p("cancel")}</Button></div></div>
      : <form className="space-y-3 rounded-xl bg-amber-50 p-4 dark:bg-amber-950/30" onSubmit={dismiss} aria-label={p("dismissTitle")} data-testid="attendance-employee-dismiss">
        <p className="text-sm">{p("dismissHint", { name: employee.name })}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium"><span className="block">{p("dismissLastDay")}</span><Input type="date" className="min-h-11" max={detail.today} value={lastDay} onChange={event => setLastDay(event.target.value)} /></label>
          <label className="space-y-1.5 text-sm font-medium"><span className="block">{p("dismissReason")}</span><Input maxLength={1000} className="min-h-11" value={reason} onChange={event => setReason(event.target.value)} /></label>
        </div>
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="destructive" className="min-h-11 rounded-full" disabled={busy}>{p(busy ? "removeBusy" : "dismissButton")}</Button>
          <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={busy} onClick={() => setStep("idle")}>{p("cancel")}</Button></div>
      </form>}
    {error ? <p role="alert" className="text-sm text-destructive">{p(error)}</p> : null}
  </section>
}
