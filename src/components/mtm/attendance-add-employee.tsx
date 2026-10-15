"use client"

import { useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { Eye, EyeOff, UserPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MtmAttendanceDepartmentField, departmentPayload, type DepartmentValue } from "@/components/mtm/attendance-department-field"
import { ATTENDANCE_EMPLOYEE_POSITION_MAX } from "@/lib/mtm/attendance-employee-contract"

const ENDPOINT = "/api/v1/mtm/attendance/employees/new"
const ERRORS: Record<string, string> = {
  MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN: "addEmployeeEmailTaken",
  MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT: "addEmployeeEmailTaken",
  MTM_ATTENDANCE_EMPLOYEE_PASSWORD_WEAK: "addEmployeePasswordWeak",
  MTM_ATTENDANCE_EMPLOYEE_PHONE_INVALID: "addEmployeePhoneInvalid",
  MTM_ATTENDANCE_EMPLOYEE_USER_LIMIT: "addEmployeeUserLimit",
}
type Form = { name: string; email: string; phone: string; password: string; position: string; department: DepartmentValue; hireDate: string }
/** Same classes as the server policy (scripts/password-policy.mjs); the server stays the judge. */
const strongEnough = (password: string) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(password)).length >= 12
  && /\p{Lu}/u.test(password) && /\p{Ll}/u.test(password) && /\p{Nd}/u.test(password) && /[\p{P}\p{S}]/u.test(password) && !/[\p{C}\p{Z}]/u.test(password)
/** Easy to type on a phone and read aloud: "Kaxebomu-4821!" (14 characters, every class). */
function suggestPassword(): string {
  const random = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n
  const consonants = "bdfgkmnprstvz", vowels = "aeiou"
  let word = ""
  for (let index = 0; index < 8; index++) word += index % 2 ? vowels[random(vowels.length)] : consonants[random(consonants.length)]
  return `${word[0].toUpperCase()}${word.slice(1)}-${String(1000 + random(9000))}!`
}
const empty: Form = { name: "", email: "", phone: "", password: "", position: "", department: { teamId: "", newTeamName: "" }, hireDate: "" }

/**
 * Personnel → Employees → "Add employee" (owner, 2026-10-15): office staff are
 * added here, apart from MTM field agents. The person signs in to the MTM app
 * with this email and password; in the CRM they see nothing (every module hidden).
 */
export function MtmAttendanceAddEmployee({ disabled, teams, onAdded }: { disabled: boolean; teams: ReadonlyArray<{ id: string; name: string }>; onAdded: (name: string, email: string) => void }) {
  const p = useTranslations("personnel")
  const [open, setOpen] = useState(false), [form, setForm] = useState<Form>(empty), [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => { setForm(current => ({ ...current, [key]: value })); setError(null) }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (!strongEnough(form.password)) { setError("addEmployeePasswordWeak"); return }
    setSaving(true); setError(null)
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email, phone: form.phone.trim() || null, password: form.password,
          position: form.position.trim() || null, ...departmentPayload(form.department), hireDate: form.hireDate || null }) })
      const body = await response.json().catch(() => null)
      if (response.status === 201 && body?.success === true) {
        const { name, email } = form
        setForm(empty); setOpen(false); setShow(false); onAdded(name.trim(), email.trim().toLowerCase())
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
      <label className="space-y-2 text-sm font-medium"><span>{p("employeeCardPosition")}</span><Input maxLength={ATTENDANCE_EMPLOYEE_POSITION_MAX} className="min-h-11" autoComplete="off" placeholder={p("employeeCardPositionPlaceholder")} value={form.position} onChange={event => set("position")(event.target.value)} /></label>
      <MtmAttendanceDepartmentField id="add-employee-department" teams={teams} value={form.department} onChange={set("department")} />
      <label className="space-y-2 text-sm font-medium"><span>{p("employeeCardHired")}</span><Input type="date" className="min-h-11" value={form.hireDate} onChange={event => set("hireDate")(event.target.value)} />
        <span className="block text-xs font-normal text-muted-foreground">{p("addEmployeeHireHint")}</span></label>
      <label className="space-y-2 text-sm font-medium"><span>{p("addEmployeeEmail")}</span><Input required type="email" maxLength={320} className="min-h-11" autoComplete="off" value={form.email} onChange={event => set("email")(event.target.value)} /></label>
      <label className="space-y-2 text-sm font-medium"><span>{p("addEmployeePhone")}</span><Input type="tel" inputMode="tel" placeholder="+994501234567" className="min-h-11" autoComplete="off" value={form.phone} onChange={event => set("phone")(event.target.value)} /></label>
      {/* Seventh field: spans the row, its hint beside it rather than leaving a hole. */}
      <label className="space-y-2 text-sm font-medium md:col-span-2"><span>{p("addEmployeePassword")}</span>
        <span className="grid gap-2 md:grid-cols-2 md:items-center md:gap-4"><span className="relative block"><Input required type={show ? "text" : "password"} maxLength={72} className="min-h-11 pr-11" autoComplete="new-password" value={form.password} onChange={event => set("password")(event.target.value)} />
          <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label={p(show ? "addEmployeeHidePassword" : "addEmployeeShowPassword")} onClick={() => setShow(value => !value)}>
            {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}</button></span>
        <span className="flex flex-wrap items-center justify-between gap-2 text-xs font-normal text-muted-foreground"><span>{p("addEmployeePasswordHint")}</span>
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => { set("password")(suggestPassword()); setShow(true) }}>{p("addEmployeeSuggestPassword")}</button></span></span></label>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{p(error)}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11 rounded-full" disabled={saving}>{p(saving ? "addEmployeeSaving" : "addEmployeeSubmit")}</Button>
      <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={saving} onClick={() => { setOpen(false); setError(null) }}>{p("cancel")}</Button></div>
  </form>
}
