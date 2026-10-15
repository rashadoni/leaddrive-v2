"use client"

import { useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { MessageCircle, UserPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const ENDPOINT = "/api/v1/mtm/attendance/employees/new"
const ERRORS: Record<string, string> = {
  MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN: "addEmployeeEmailTaken",
  MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT: "addEmployeeEmailTaken",
  MTM_ATTENDANCE_EMPLOYEE_PHONE_INVALID: "addEmployeePhoneInvalid",
  MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN: "addEmployeePhoneTaken",
  MTM_ATTENDANCE_EMPLOYEE_USER_LIMIT: "addEmployeeUserLimit",
}
type Form = { name: string; phone: string; email: string }
const empty: Form = { name: "", phone: "+994", email: "" }
/** What the server accepts: «+», a country code, at most 15 digits; spaces and dashes are fine. */
const internationalPhone = (value: string) => /^\+[1-9]\d{6,14}$/.test(value.replace(/[\s\-()]/g, ""))

/**
 * Personnel → Employees → "Add employee" (owner, 2026-10-15): office staff are
 * added here, apart from MTM field agents. HR types a name and a WhatsApp
 * number and no password: the person opens the MTM app, gets a code in
 * WhatsApp and sets their own (owner: «чтоб сами назначали, а кадровик не
 * занимался этой рутиной»). In the CRM they see nothing (every module hidden).
 */
export function MtmAttendanceAddEmployee({ disabled, onAdded }: { disabled: boolean; onAdded: (name: string, phone: string) => void }) {
  const p = useTranslations("personnel")
  const [open, setOpen] = useState(false), [form, setForm] = useState<Form>(empty)
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null)
  const set = (key: keyof Form) => (value: string) => { setForm(current => ({ ...current, [key]: value })); setError(null) }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (!internationalPhone(form.phone)) { setError("addEmployeePhoneInvalid"); return }
    setSaving(true); setError(null)
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.name, phone: form.phone.trim(), email: form.email.trim() || null }) })
      const body = await response.json().catch(() => null)
      if (response.status === 201 && body?.success === true) {
        const { name, phone } = form
        setForm(empty); setOpen(false); onAdded(name.trim(), phone.trim())
        return
      }
      setError(ERRORS[body?.code] ?? (response.status === 400 ? "addEmployeeInvalid" : "addEmployeeFailed"))
    } catch { setError("addEmployeeFailed") }
    finally { setSaving(false) }
  }

  if (!open) return <Button type="button" className="min-h-11 rounded-full" disabled={disabled} onClick={() => setOpen(true)} data-testid="attendance-add-employee">
    <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />{p("addEmployee")}</Button>

  return <form onSubmit={submit} className="w-full space-y-4 rounded-2xl border bg-card p-5" aria-label={p("addEmployee")} data-testid="attendance-add-employee-form">
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{p("addEmployee")}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{p("addEmployeeHint")}</p></div>
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={p("close")} onClick={() => { setOpen(false); setError(null) }}><X className="h-4 w-4" aria-hidden="true" /></Button></div>
    <div className="grid gap-4 md:grid-cols-2">
      <label className="space-y-2 text-sm font-medium"><span>{p("addEmployeeName")}</span><Input required maxLength={200} className="min-h-11" autoComplete="off" value={form.name} onChange={event => set("name")(event.target.value)} /></label>
      <label className="space-y-2 text-sm font-medium"><span>{p("addEmployeePhone")}</span><Input required type="tel" inputMode="tel" placeholder="+994501234567" maxLength={24} className="min-h-11" autoComplete="off" value={form.phone} onChange={event => set("phone")(event.target.value)} data-testid="attendance-add-employee-phone" /></label>
      <label className="space-y-2 text-sm font-medium"><span>{p("addEmployeeEmail")}</span><Input type="email" maxLength={320} className="min-h-11" autoComplete="off" value={form.email} onChange={event => set("email")(event.target.value)} /></label>
    </div>
    <p className="flex max-w-prose items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" data-testid="attendance-add-employee-code-note">
      <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{p("addEmployeeCodeNote")}</span></p>
    {error ? <p role="alert" className="text-sm text-destructive">{p(error)}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11 rounded-full" disabled={saving}>{p(saving ? "addEmployeeSaving" : "addEmployeeSubmit")}</Button>
      <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={saving} onClick={() => { setOpen(false); setError(null) }}>{p("cancel")}</Button></div>
  </form>
}
