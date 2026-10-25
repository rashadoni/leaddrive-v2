"use client"

import { useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { MessageCircle, UserPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MtmAttendanceDepartmentField, departmentPayload, emptyDepartmentValue, type DepartmentValue } from "@/components/mtm/attendance-department-field"
import { ATTENDANCE_EMPLOYEE_POSITION_MAX, type AttendanceDepartment, type AttendanceSection } from "@/lib/mtm/attendance-employee-contract"
import { AttendancePhoneMatchResult, type AttendancePhoneMatch } from "@/lib/mtm/attendance-phone-match-contract"

import { IdentityTimePersonResult, type IdentityTimePerson } from "@/lib/identity/time-enrollment-contract"

const ENDPOINT = "/api/v1/mtm/attendance/employees/new"
const ERRORS: Record<string, string> = {
  MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN: "addEmployeeEmailTaken",
  MTM_ATTENDANCE_EMPLOYEE_IDENTITY_CONFLICT: "addEmployeeEmailTaken",
  MTM_ATTENDANCE_EMPLOYEE_PHONE_INVALID: "addEmployeePhoneInvalid",
  MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN: "addEmployeePhoneTaken",
  IDENTITY_CANONICAL_PHONE_RESERVED: "addEmployeePhoneTaken",
  MTM_ATTENDANCE_EMPLOYEE_USER_LIMIT: "addEmployeeUserLimit",
  MTM_ATTENDANCE_EMPLOYEE_SECTION_ELSEWHERE: "employeeSectionElsewhere",
}
type Form = { name: string; phone: string; email: string; position: string; department: DepartmentValue; hireDate: string }
const empty: Form = { name: "", phone: "+994", email: "", position: "", department: emptyDepartmentValue(), hireDate: "" }
/** What the server accepts: «+», a country code, at most 15 digits; spaces and dashes are fine. */
const internationalPhone = (value: string) => /^\+[1-9]\d{6,14}$/.test(value.replace(/[\s\-()]/g, ""))

/**
 * Personnel → Employees → "Add employee" (owner, 2026-10-15): office staff are
 * added here, apart from MTM field agents. HR types a name and a WhatsApp
 * number and no password: the person opens the MTM app, gets a code in
 * WhatsApp and sets their own (owner: «чтоб сами назначали, а кадровик не
 * занимался этой рутиной»). In the CRM they see nothing (every module hidden).
 */
export function MtmAttendanceAddEmployee({ disabled, teams, departments, onAdded }: { disabled: boolean; teams: ReadonlyArray<AttendanceSection>; departments: ReadonlyArray<AttendanceDepartment>; onAdded: (name: string, phone: string) => void }) {
  const p = useTranslations("personnel")
  const [open, setOpen] = useState(false), [form, setForm] = useState<Form>(empty)
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null)
  const [match, setMatch] = useState<AttendancePhoneMatch | null>(null)
  const [canonicalPerson, setCanonicalPerson] = useState<Extract<IdentityTimePerson, { kind: "canonical" }> | null>(null)
  const enrollmentRequest = useRef<string | null>(null)
  const revision = useRef(0)
  const clearResult = () => { revision.current++; setError(null); setMatch(null); setCanonicalPerson(null); enrollmentRequest.current = null }
  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => { setForm(current => ({ ...current, [key]: value })); clearResult() }
  const close = () => { clearResult(); setOpen(false) }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || canonicalPerson) return
    if (!internationalPhone(form.phone)) { setError("addEmployeePhoneInvalid"); return }
    const submittedRevision = revision.current
    setSaving(true); setError(null); setMatch(null)
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.name, phone: form.phone.trim(), email: form.email.trim() || null,
          position: form.position.trim() || null, ...departmentPayload(form.department), hireDate: form.hireDate || null }) })
      const body = await response.json().catch(() => null)
      if (response.status === 201 && body?.success === true) {
        const { name, phone } = form
        setForm(empty); setOpen(false); onAdded(name.trim(), phone.trim())
        return
      }
      if (submittedRevision !== revision.current) return
      if ((response.status === 409 && ["MTM_ATTENDANCE_EMPLOYEE_PHONE_TAKEN", "IDENTITY_CANONICAL_PHONE_RESERVED"].includes(body?.code))
        || (response.status === 403 && body?.code === "MTM_ATTENDANCE_EMPLOYEE_USER_LIMIT")) {
        // A full plan can refuse creation before the phone check. Neither
        // refusal is permission to adopt that person's account. Offer
        // their existing card for an explicit review using its normal controls.
        try {
          const canonicalLookup = await fetch("/api/v1/identity/time/lookup", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: form.phone.trim() }), cache: "no-store",
          })
          const canonicalBody = await canonicalLookup.json().catch(() => null)
          if (submittedRevision !== revision.current) return
          const candidate = IdentityTimePersonResult.safeParse(canonicalBody?.data)
          if (canonicalLookup.ok && canonicalBody?.success && candidate.success && candidate.data.kind === "canonical") {
            setCanonicalPerson(candidate.data); enrollmentRequest.current = null
            return
          }
          const lookup = await fetch("/api/v1/mtm/attendance/employees/phone-match", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: form.phone.trim() }), cache: "no-store",
          })
          const result = await lookup.json().catch(() => null)
          if (submittedRevision !== revision.current) return
          const parsed = AttendancePhoneMatchResult.safeParse(result?.data)
          if (lookup.ok && result?.success === true && parsed.success && parsed.data.kind !== "none") {
            setMatch(parsed.data)
            return
          }
        } catch { /* Keep the original conflict if its explanation is unavailable. */ }
      }
      if (submittedRevision !== revision.current) return
      setError(ERRORS[body?.code] ?? (response.status === 400 ? "addEmployeeInvalid" : "addEmployeeFailed"))
    } catch { if (submittedRevision === revision.current) setError("addEmployeeFailed") }
    finally { setSaving(false) }
  }

  async function enrollExistingPerson() {
    if (saving || !canonicalPerson || canonicalPerson.timeActorId) return
    const submittedRevision = revision.current
    const person = canonicalPerson
    enrollmentRequest.current ??= crypto.randomUUID()
    setSaving(true); setError(null)
    try {
      const response = await fetch("/api/v1/identity/time/enroll", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: person.userId, expectedClaimId: person.claimId, expectedAccountVersion: person.accountVersion,
          requestId: enrollmentRequest.current, position: form.position.trim() || null, ...departmentPayload(form.department), hireDate: form.hireDate || null }) })
      const body = await response.json().catch(() => null)
      if (submittedRevision !== revision.current) return
      if (response.status === 201 && body?.success) {
        onAdded(person.name, form.phone.trim()); setForm(empty); setOpen(false); clearResult()
      } else {
        const stale = ["IDENTITY_ACCOUNT_STALE", "IDENTITY_EXISTING_ACTOR_REVIEW_REQUIRED", "IDENTITY_MEMBERSHIP_ACTOR_REVIEW_REQUIRED"].includes(body?.error)
        if (stale) { setCanonicalPerson(null); enrollmentRequest.current = null }
        setError(stale ? "addEmployeeIdentityChanged" : "addEmployeeFailed")
      }
    } catch { if (submittedRevision === revision.current) setError("addEmployeeFailed") }
    finally { setSaving(false) }
  }

  if (!open) return <Button type="button" className="min-h-11 rounded-full" disabled={disabled} onClick={() => setOpen(true)} data-testid="attendance-add-employee">
    <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />{p("addEmployee")}</Button>

  return <form onSubmit={submit} className="w-full space-y-4 rounded-2xl border bg-card p-5" aria-label={p("addEmployee")} data-testid="attendance-add-employee-form">
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{p("addEmployee")}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{p("addEmployeeHint")}</p></div>
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={p("close")} onClick={close}><X className="h-4 w-4" aria-hidden="true" /></Button></div>
    <div className="grid gap-4 md:grid-cols-2">
      <label className="space-y-2 text-sm font-medium"><span>{p("addEmployeeName")}</span><Input required maxLength={200} className="min-h-11" autoComplete="off" value={form.name} onChange={event => set("name")(event.target.value)} /></label>
      <label className="space-y-2 text-sm font-medium"><span>{p("addEmployeePhone")}</span><Input required type="tel" inputMode="tel" placeholder="+994501234567" maxLength={24} className="min-h-11" autoComplete="off" value={form.phone} onChange={event => set("phone")(event.target.value)} data-testid="attendance-add-employee-phone" /></label>
      <MtmAttendanceDepartmentField id="add-employee-department" teams={teams} departments={departments} value={form.department} onChange={set("department")} />
      <label className="space-y-2 text-sm font-medium"><span>{p("employeeCardPosition")}</span><Input maxLength={ATTENDANCE_EMPLOYEE_POSITION_MAX} className="min-h-11" autoComplete="off" placeholder={p("employeeCardPositionPlaceholder")} value={form.position} onChange={event => set("position")(event.target.value)} /></label>
      <label className="space-y-2 text-sm font-medium"><span>{p("employeeCardHired")}</span><Input type="date" className="min-h-11" value={form.hireDate} onChange={event => set("hireDate")(event.target.value)} />
        <span className="block text-xs font-normal text-muted-foreground">{p("addEmployeeHireHint")}</span></label>
      <label className="space-y-2 text-sm font-medium"><span>{p("addEmployeeEmail")}</span><Input type="email" maxLength={320} className="min-h-11" autoComplete="off" value={form.email} onChange={event => set("email")(event.target.value)} /></label>
    </div>
    <p className="flex max-w-prose items-start gap-3 rounded-xl border border-l-4 border-zinc-200 border-l-emerald-500 bg-card text-foreground dark:border-zinc-700 dark:border-l-emerald-500 p-3 text-sm" data-testid="attendance-add-employee-code-note">
      <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{p("addEmployeeCodeNote")}</span></p>
    {error ? <p role="alert" className="text-sm text-destructive">{p(error)}</p> : null}
    {canonicalPerson ? <div role="status" className="max-w-prose space-y-2 rounded-xl border p-4 text-sm" data-testid="attendance-canonical-person">
      <p>{p("addEmployeePhoneProfile", { name: canonicalPerson.name })}</p>
      {canonicalPerson.timeActorId ? <>
        <p className="text-muted-foreground">{p("addEmployeePhoneAlreadyEnrolled")}</p>
        <Button asChild type="button" variant="outline" className="min-h-11 rounded-full"><Link href={`/mtm/attendance/people/${encodeURIComponent(canonicalPerson.timeActorId)}`} prefetch={false}>{p("addEmployeePhoneOpenProfile")}</Link></Button>
      </> : <>
        <p className="text-muted-foreground">{p("addEmployeeIdentityTimeHint", { name: canonicalPerson.name })}</p>
        <Button type="button" className="min-h-11 rounded-full" disabled={saving} onClick={enrollExistingPerson} data-testid="attendance-canonical-enroll">{p(saving ? "addEmployeeSaving" : "addEmployeeIdentityTimeSubmit")}</Button>
      </>}
    </div> : null}
    {match && match.kind !== "none" ? <div role="status" className="max-w-prose space-y-2 rounded-xl border p-4 text-sm" data-testid="attendance-phone-match">
      <p>{match.kind === "ambiguous" ? p("addEmployeePhoneAmbiguous") : p("addEmployeePhoneProfile", { name: match.name })}</p>
      {match.kind === "attendance" ? <>
        <p className="text-muted-foreground">{p(match.enrolled ? "addEmployeePhoneAlreadyEnrolled" : "addEmployeePhoneExistingHire")}</p>
        <Button asChild type="button" variant="outline" className="min-h-11 rounded-full">
          <Link href={`/mtm/attendance/people/${encodeURIComponent(match.agentId)}?back=${encodeURIComponent("/mtm/attendance/people?tab=employees")}`} prefetch={false}>{p("addEmployeePhoneOpenProfile")}</Link>
        </Button>
      </> : match.kind === "other" ? <p className="text-muted-foreground">{p("addEmployeePhoneOtherProfile")}</p> : null}
    </div> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11 rounded-full" disabled={saving || !!canonicalPerson}>{p(saving ? "addEmployeeSaving" : "addEmployeeSubmit")}</Button>
      <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={saving} onClick={close}>{p("cancel")}</Button></div>
  </form>
}
