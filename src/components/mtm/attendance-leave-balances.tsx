"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarDays, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HomeCard } from "@/components/mtm/home-parts"
import { AttendanceLeavePolicyInputSchema, AttendanceLeaveProfileInputSchema, type AttendanceLeaveDirectory } from "@/lib/mtm/attendance-leave-contract"

const ENDPOINT = "/api/v1/mtm/attendance/leave-balances"
const control = "min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm"
type Tier = { category: string; minimumYears: string; days: string }
type Pending = { path: "policy" | "profiles"; body: unknown }
const number = (value: string) => value.trim() ? Number(value) : NaN
export function MtmAttendanceLeaveBalances() {
  const t = useTranslations("mtmAttendance"), locale = useLocale()
  // A list of years, not a number field: each typed digit used to start a load.
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(String(thisYear)), [usedThrough, setUsedThrough] = useState(""), [offset, setOffset] = useState(0)
  const [data, setData] = useState<AttendanceLeaveDirectory | null>(null), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false), [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [basisDate, setBasisDate] = useState(""), [counting, setCounting] = useState(""), [minutes, setMinutes] = useState("")
  const [tiers, setTiers] = useState<Tier[]>([]), [reviewed, setReviewed] = useState(false), [policyReason, setPolicyReason] = useState("")
  const [agentId, setAgentId] = useState(""), [category, setCategory] = useState(""), [serviceStart, setServiceStart] = useState(""), [opening, setOpening] = useState(""), [profileReason, setProfileReason] = useState("")
  const [profileOpen, setProfileOpen] = useState(false)
  const controller = useRef<AbortController | null>(null), alive = useRef(false), writing = useRef(false)
  const clear = useCallback(() => { setData(null); setPending(null); setAgentId(""); setCategory(""); setServiceStart(""); setOpening(""); setTiers([]); setBasisDate(""); setCounting(""); setMinutes(""); setPolicyReason(""); setProfileReason(""); setReviewed(false) }, [])
  const load = useCallback(async () => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request
    setBusy(true); setMessage(null)
    try {
      const query = new URLSearchParams({ year, offset: String(offset), ...(usedThrough ? { usedThrough } : {}) })
      const response = await fetch(`${ENDPOINT}?${query}`, { cache: "no-store", signal: request.signal })
      const body = await response.json().catch(() => null)
      if (request.signal.aborted || !alive.current) return
      if ([401, 403, 404].includes(response.status)) { clear(); setDenied(true); return }
      if (!response.ok || body?.success !== true || !Array.isArray(body.data?.rows) || typeof body.data?.canManage !== "boolean") throw new Error("INVALID_BALANCES")
      const value = body.data as AttendanceLeaveDirectory; setData(value); setDenied(false)
      // No norms yet: start from the Labour Code's basic leave — 21 calendar days,
      // holidays not counted (owner, 2026-10-15). HR checks and saves it; nothing
      // is published until they do. Seniority additions vary by source, so none is assumed.
      const policy = value.policy?.value
      setBasisDate(policy?.basisDate ?? (policy ? "" : `${value.year}-01-01`)); setCounting(policy?.counting ?? (policy ? "" : "CALENDAR_EXCEPT_HOLIDAYS")); setMinutes(policy?.minutesPerDay == null ? "" : String(policy.minutesPerDay))
      setTiers(policy ? policy.tiers.map(tier => ({ category: tier.category, minimumYears: String(tier.minimumYears), days: String(tier.days) })) : [{ category: t("leaveDefaultCategory"), minimumYears: "0", days: "21" }])
      setReviewed(false); setPolicyReason(policy ? "" : t("leaveDefaultReason")); setAgentId(""); setCategory(""); setServiceStart(""); setOpening(""); setProfileReason("")
    } catch { if (!request.signal.aborted && alive.current) { clear(); setMessage("leaveLoadError") } }
    finally { if (!request.signal.aborted && alive.current) setBusy(false) }
  }, [year, usedThrough, offset, clear, t])
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; controller.current?.abort() } }, [load])
  async function send(input: Pending) {
    if (writing.current) return
    writing.current = true; setPending(input); setBusy(true); setMessage(null)
    controller.current?.abort(); const request = new AbortController(); controller.current = request
    try {
      const response = await fetch(`${ENDPOINT}/${input.path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input.body), signal: request.signal })
      const body = await response.json().catch(() => null)
      if (request.signal.aborted || !alive.current) return
      if ([401, 403, 404].includes(response.status)) { clear(); setDenied(true); return }
      if (response.ok && body?.success === true && typeof body.data?.id === "string") { setPending(null); await load(); setMessage("leaveSaved"); return }
      if ([400, 413].includes(response.status) && body?.code === "MTM_ATTENDANCE_LEAVE_INVALID") { setPending(null); setMessage("leaveInvalid"); return }
      if (response.status === 409 && body?.code === "MTM_ATTENDANCE_LEAVE_CHANGED") { setPending(null); await load(); setMessage("leaveChanged"); return }
      setMessage("leaveUnknown")
    } catch { if (!request.signal.aborted && alive.current) setMessage("leaveUnknown") }
    finally { writing.current = false; if (alive.current) setBusy(false) }
  }
  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data?.canManage || busy || pending) return
    const parsed = AttendanceLeavePolicyInputSchema.safeParse({ year: data.year, requestId: crypto.randomUUID(), expectedRevisionId: data.policy?.id ?? null, reason: policyReason,
      policy: { basisDate: basisDate || null, counting: counting || null, minutesPerDay: minutes.trim() ? number(minutes) : null, reviewed,
        tiers: tiers.map(tier => ({ category: tier.category, minimumYears: number(tier.minimumYears), days: number(tier.days) })) } })
    if (!reviewed || !parsed.success) { setMessage("leaveInvalid"); return }
    void send({ path: "policy", body: parsed.data })
  }
  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data?.canManage || busy || pending) return
    const row = data.rows.find(item => item.employeeId === agentId)
    const parsed = AttendanceLeaveProfileInputSchema.safeParse({ year: data.year, requestId: crypto.randomUUID(), expectedRevisionId: row?.profile?.id ?? null, reason: profileReason, agentId,
      profile: { category, serviceStart, openingDays: number(opening) } })
    if (!row || !parsed.success) { setMessage("leaveInvalid"); return }
    void send({ path: "profiles", body: parsed.data })
  }
  function selectEmployee(id: string) {
    const profile = data?.rows.find(item => item.employeeId === id)?.profile?.value
    setAgentId(id); setCategory(profile?.category ?? ""); setServiceStart(profile?.serviceStart ?? ""); setOpening(profile ? String(profile.openingDays) : ""); setProfileReason(""); setProfileOpen(true); requestAnimationFrame(() => document.getElementById("leave-inputs")?.scrollIntoView({ block: "start" }))
  }
  const locked = busy || !!pending, format = (value: number | null) => value === null ? "—" : t("leaveDays", { days: new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value) })
  if (denied) return <p role="status">{t("reportAccessUnavailable")}</p>
  return <main className="min-w-0 space-y-5" data-testid="attendance-leave-balances">
    <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("leaveTitle")}</h1><p className="text-sm text-muted-foreground">{t("leaveIntro")}</p></div>
    <div className="flex flex-wrap items-end gap-4"><label className="space-y-1 text-sm"><span>{t("leaveYear")}</span><select aria-label={t("leaveYear")} className={control} disabled={locked} value={year} onChange={e => { setYear(e.target.value); setOffset(0) }}>{[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>{t("leaveThrough")}</span><input type="date" className={control} max={data?.today} disabled={locked} value={usedThrough || data?.usedThrough || ""} onChange={e => setUsedThrough(e.target.value)} /></label>
      <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={() => void load()}>{t("leaveRefresh")}</Button></div>
    {message && <p role={message === "leaveSaved" ? "status" : "alert"} className="text-sm">{t(message)}</p>}
    {pending && <Button type="button" className="min-h-11" disabled={busy} onClick={() => void send(pending)}>{t("leaveRetry")}</Button>}
    {busy && !data && <p role="status">{t("reportLoading")}</p>}
    {data && <>
      {!data.policy?.value.reviewed && <div className="rounded-xl border border-l-4 border-zinc-200 border-l-orange-500 bg-card text-foreground dark:border-zinc-700 dark:border-l-orange-500 p-5"><h2 className="font-semibold">{t("leaveEmptyPolicy")}</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{t(data.canManage && !data.policy ? "leaveDefaultHint" : "leaveLegalHint")}</p></div>}
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        {!data.rows.length ? <p>{t("leaveNoEmployees")}</p> : <>
          <div className="hidden overflow-x-auto lg:block"><table className="w-full text-left text-sm"><thead><tr>{["leaveEmployee", "leaveCategory", "leaveAllowance", "leaveUsed", "leavePlanned", "leaveRemaining"].map(key => <th key={key} className="border-b px-3 py-4 font-medium text-muted-foreground">{t(key)}</th>)}{data.canManage && <th className="border-b"><span className="sr-only">{t("leaveEdit")}</span></th>}</tr></thead>
            <tbody>{data.rows.map(row => <tr key={row.employeeId} data-testid="leave-row"><td className="border-b px-3 py-4"><strong className="font-medium">{row.name}</strong><p className="text-xs text-muted-foreground">{row.teamName}</p></td><td className="border-b px-3 py-4">{row.profile?.value.category ?? "—"}{row.serviceYears !== null && <p className="text-xs text-muted-foreground">{t("leaveYears", { years: row.serviceYears })}</p>}</td><td className="border-b px-3 py-4 tabular-nums">{format(row.allowanceDays)}{row.profile && <p className="text-xs text-muted-foreground">+ {format(row.profile.value.openingDays)}</p>}</td><td className="border-b px-3 py-4 tabular-nums">{format(row.usedDays)}</td><td className="border-b px-3 py-4 tabular-nums">{format(row.plannedDays)}</td><td className="border-b px-3 py-4"><span className="font-medium tabular-nums">{row.state === "READY" ? format(row.remainingDays) : t(`leaveState${row.state}`)}</span>{row.availableDays !== null && <p className="text-xs text-muted-foreground">{t("leaveAvailable", { days: format(row.availableDays) })}</p>}</td>{data.canManage && <td className="border-b px-2"><Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={() => selectEmployee(row.employeeId)}>{t("leaveEdit")}</Button></td>}</tr>)}</tbody></table></div>
          <div className="divide-y lg:hidden">{data.rows.map(row => <section key={row.employeeId} className="space-y-4 py-5"><h2 className="font-semibold">{row.name}</h2><p className="text-sm text-muted-foreground">{row.teamName} · {row.profile?.value.category ?? "—"}</p><dl className="grid grid-cols-2 gap-4 text-sm">{[["leaveAllowance", row.allowanceDays], ["leaveOpening", row.profile?.value.openingDays ?? null], ["leaveUsed", row.usedDays], ["leavePlanned", row.plannedDays], ["leaveRemaining", row.remainingDays]].map(([key, value]) => <div key={String(key)}><dt className="text-muted-foreground">{t(String(key))}</dt><dd className="mt-1 font-medium tabular-nums">{format(value as number | null)}</dd></div>)}</dl><p className="text-sm">{t(`leaveState${row.state}`)}</p>{row.availableDays !== null && <p className="text-sm text-muted-foreground">{t("leaveAvailable", { days: format(row.availableDays) })}</p>}{data.canManage && <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={() => selectEmployee(row.employeeId)}>{t("leaveEdit")}</Button>}</section>)}</div>
        </>}
        <p className="mt-4 max-w-4xl text-xs leading-relaxed text-muted-foreground">{t("leavePrivacy")}</p>
      </div>
      <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" className="min-h-11" disabled={locked || !offset} onClick={() => setOffset(value => Math.max(0, value - 50))}>{t("leavePrev")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={locked || !data.hasMore} onClick={() => setOffset(value => value + 50)}>{t("leaveNext")}</Button></div>
      {data.canManage && <div className="grid items-start gap-5 xl:grid-cols-2">
        <HomeCard testId="leave-policy" titleId="leave-policy-title" title={t("leaveNorms", { year: data.year })} icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />} tone="orange"><details className="py-4" open={!data.policy?.value.reviewed || undefined}><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">{t("leaveNorms", { year: data.year })}</summary><p className="my-4 text-sm text-muted-foreground">{t("leaveLegalHint")}</p>
          <form className="space-y-4" onSubmit={publish}><fieldset disabled={locked} className="min-w-0 space-y-4">
            <label className="block space-y-1 text-sm"><span>{t("leaveBasisDate")}</span><input required type="date" min={`${data.year}-01-01`} max={`${data.year}-12-31`} className={control} value={basisDate} onChange={e => setBasisDate(e.target.value)} /></label>
            <label className="block space-y-1 text-sm"><span>{t("leaveCounting")}</span><select required className={control} value={counting} onChange={e => setCounting(e.target.value)}><option value="">{t("leaveChoose")}</option><option value="CALENDAR_EXCEPT_HOLIDAYS">{t("leaveCalendarDays")}</option><option value="WORKING_DAYS">{t("leaveWorkingDays")}</option></select></label>
            <label className="block space-y-1 text-sm"><span>{t("leaveMinutesPerDay")}</span><input type="number" min={1} max={1440} className={control} value={minutes} onChange={e => setMinutes(e.target.value)} /><span className="block text-xs text-muted-foreground">{t("leaveConversionHint")}</span></label>
            {tiers.map((tier, index) => <div key={index} className="space-y-3 rounded-lg border p-3">{(["category", "minimumYears", "days"] as const).map((field, fieldIndex) => <label key={field} className="block space-y-1 text-sm"><span>{t(["leaveCategory", "leaveMinYears", "leaveNormDays"][fieldIndex])}</span><input required className={control} type={field === "category" ? "text" : "number"} min={field === "category" ? undefined : 0} max={field === "category" ? undefined : field === "days" ? 366 : 80} step={field === "days" ? 0.5 : undefined} maxLength={field === "category" ? 80 : undefined} value={tier[field]} onChange={e => setTiers(rows => rows.map((item, i) => i === index ? { ...item, [field]: e.target.value } : item))} /></label>)}<Button type="button" variant="outline" className="min-h-11" onClick={() => setTiers(rows => rows.filter((_, i) => i !== index))}>{t("leaveRemoveTier")}</Button></div>)}
            <Button type="button" variant="outline" className="min-h-11" disabled={tiers.length >= 100} onClick={() => setTiers(rows => [...rows, { category: "", minimumYears: "", days: "" }])}>{t("leaveAddTier")}</Button>
            <label className="block space-y-1 text-sm"><span>{t("leaveReason")}</span><textarea required minLength={3} maxLength={1000} className={control} value={policyReason} onChange={e => setPolicyReason(e.target.value)} /></label>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input required type="checkbox" className="h-5 w-5 shrink-0" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /><span>{t("leaveConfirmed")}</span></label>
            <Button className="min-h-11" type="submit">{t("leavePublish")}</Button>
          </fieldset></form></details></HomeCard>
        <div id="leave-inputs"><HomeCard testId="leave-profile" titleId="leave-profile-title" title={t("leaveInputs")} icon={<Users className="h-5 w-5" aria-hidden="true" />} tone="green"><details className="py-4" open={profileOpen} onToggle={e => setProfileOpen(e.currentTarget.open)}><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">{t("leaveInputs")}</summary><p className="my-4 text-sm text-muted-foreground">{t("leaveInputHint")}</p>
          <form className="space-y-4" onSubmit={saveProfile}><fieldset disabled={locked} className="min-w-0 space-y-4"><label className="block space-y-1 text-sm"><span>{t("leaveEmployee")}</span><select required className={control} value={agentId} onChange={e => selectEmployee(e.target.value)}><option value="">{t("leaveChoose")}</option>{data.rows.map(row => <option key={row.employeeId} value={row.employeeId}>{row.name}</option>)}</select></label>
            <label className="block space-y-1 text-sm"><span>{t("leaveCategory")}</span><input required maxLength={80} className={control} value={category} onChange={e => setCategory(e.target.value)} list="leave-categories" /><datalist id="leave-categories">{[...new Set(data.policy?.value.tiers.map(tier => tier.category) ?? [])].map(value => <option key={value} value={value} />)}</datalist></label>
            <label className="block space-y-1 text-sm"><span>{t("leaveServiceStart")}</span><input required type="date" className={control} value={serviceStart} onChange={e => setServiceStart(e.target.value)} /></label>
            <label className="block space-y-1 text-sm"><span>{t("leaveOpening")}</span><input required type="number" min={-3660} max={3660} step={0.5} className={control} value={opening} onChange={e => setOpening(e.target.value)} /><span className="block text-xs text-muted-foreground">{t("leaveOpeningHint")}</span></label>
            <label className="block space-y-1 text-sm"><span>{t("leaveReason")}</span><textarea required minLength={3} maxLength={1000} className={control} value={profileReason} onChange={e => setProfileReason(e.target.value)} /></label>
            <Button type="submit" className="min-h-11">{t("leavePublish")}</Button>
          </fieldset></form></details></HomeCard></div>
      </div>}
    </>}
  </main>
}
