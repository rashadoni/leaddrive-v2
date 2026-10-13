"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { AttendanceShiftPublishSchema, type AttendanceShiftDirectory, type AttendanceShiftValue } from "@/lib/mtm/attendance-shift-contract"
const ENDPOINT = "/api/v1/mtm/attendance/shifts"
const control = "min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm"
type Slot = AttendanceShiftValue["cycle"][number]
type Pending = ReturnType<typeof AttendanceShiftPublishSchema.parse>
const work = (): Slot => ({ kind: "WORK", startTime: "09:00", endTime: "18:00", nextDay: false, lunchMinutes: 60, lateGraceMinutes: 10 })
export function MtmAttendanceShifts() {
  const t = useTranslations("mtmAttendance")
  const [range, setRange] = useState(() => { const from = new Date().toISOString().slice(0, 10); return { from, to: addDateKeyDays(from, 92) } })
  const [data, setData] = useState<AttendanceShiftDirectory | null>(null), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false)
  const [message, setMessage] = useState<string | null>(null), [pending, setPending] = useState<Pending | null>(null), [open, setOpen] = useState(false), [page, setPage] = useState(0)
  const [teamId, setTeamId] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [attribution, setAttribution] = useState<AttendanceShiftValue["attribution"]>("START_DAY")
  const [cycle, setCycle] = useState<Slot[]>([work()]), [shortening, setShortening] = useState(""), [confirmed, setConfirmed] = useState(false), [threshold, setThreshold] = useState(""), [reason, setReason] = useState("")
  const controller = useRef<AbortController | null>(null), sequence = useRef(0)
  const clearPrivate = useCallback(() => { setData(null); setDenied(true); setPending(null); setReason(""); setOpen(false) }, [])
  const load = useCallback(async (selected: typeof range) => {
    controller.current?.abort()
    const current = new AbortController(); controller.current = current
    const seq = ++sequence.current; setBusy(true); setData(null); setMessage(null)
    try {
      const response = await fetch(`${ENDPOINT}?${new URLSearchParams(selected)}`, { cache: "no-store", signal: current.signal })
      const body = await response.json().catch(() => null)
      if (current.signal.aborted || seq !== sequence.current) return
      if (!response.ok || body?.success !== true) {
        if ([401, 403, 404].includes(response.status)) clearPrivate()
        setMessage(t("shiftLoadError")); return
      }
      const directory = body.data as AttendanceShiftDirectory
      setData(directory); setDenied(false); setPage(0)
      setFrom(value => value || addDateKeyDays(directory.today, 1)); setTo(value => value || addDateKeyDays(directory.today, 28))
    } catch { if (!current.signal.aborted) setMessage(t("shiftLoadError")) }
    finally { if (!current.signal.aborted && seq === sequence.current) setBusy(false) }
  }, [clearPrivate, t])
  useEffect(() => { void load(range); return () => controller.current?.abort() }, [load, range])
  const locked = busy || pending !== null
  const publish = async (body: Pending) => {
    setBusy(true); setPending(body); setMessage(null)
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => null)
      if ([401, 403, 404].includes(response.status)) { clearPrivate(); setMessage(t("shiftAccessError")); return }
      if (response.ok && result?.success === true) {
        setPending(null); setReason(""); setOpen(false); await load(range); setMessage(t("shiftSaved")); return
      }
      // Only a recognized definitive rejection releases the exact retry body.
      if ([400, 409, 413].includes(response.status) && typeof result?.code === "string" && result.code.startsWith("MTM_ATTENDANCE_SHIFT_")) {
        setPending(null)
        const changed = ["MTM_ATTENDANCE_SHIFT_CHANGED", "MTM_ATTENDANCE_SHIFT_ROSTER_CHANGED"].includes(result.code)
        if (changed) await load(range)
        setMessage(t(changed ? "shiftChanged" : "shiftInvalid")); return
      }
      setMessage(t("shiftUnknown"))
    } catch { setMessage(t("shiftUnknown")) }
    finally { setBusy(false) }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!data?.canManage || locked) return
    const roster = data.rosters.find(item => (item.teamId ?? "") === teamId)
    const parsed = AttendanceShiftPublishSchema.safeParse({ requestId: crypto.randomUUID(), expectedRevisionId: data.revisionId, expectedRosterHash: roster?.hash, teamId: teamId || null, reason,
      value: { from, to, timezone: data.timezone, attribution, cycle, preHolidayMinutes: shortening.trim() ? Number(shortening) : null, preHolidayConfirmed: confirmed, overtimeThresholdMinutes: threshold.trim() ? Number(threshold) : null } })
    if (!parsed.success) { setMessage(t("shiftInvalid")); return }
    void publish(parsed.data)
  }
  const updateSlot = (index: number, value: Slot) => setCycle(previous => previous.map((item, at) => at === index ? value : item))
  return <div className="space-y-6" data-testid="attendance-shifts">
    <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t("shiftTitle")}</h1><p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t("shiftIntro")}</p></div>
    <HomeCard testId="shift-published" titleId="shift-published-title" tone="blue" title={t("shiftPublished")} icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}>
      <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm"><span>{t("shiftFrom")}</span><input type="date" className={control} value={range.from} disabled={locked} onChange={e => e.target.value && setRange(previous => ({ ...previous, from: e.target.value }))} /></label><label className="space-y-1 text-sm"><span>{t("shiftTo")}</span><input type="date" className={control} value={range.to} disabled={locked} onChange={e => e.target.value && setRange(previous => ({ ...previous, to: e.target.value }))} /></label></div>
      {message && <p role="status" className="mt-4 text-sm">{message}</p>}
      {busy && <p className="mt-4 text-sm text-muted-foreground">{t("shiftLoading")}</p>}
      {!busy && !data && !denied && <Button className="mt-4 min-h-11" variant="outline" onClick={() => void load(range)}>{t("shiftRefresh")}</Button>}
      {data && <div className="my-5 space-y-4">{!data.plans.length && <p className="text-sm text-muted-foreground">{t("shiftEmpty")}</p>}
        {data.plans.slice(page * 20, page * 20 + 20).map(plan => <article key={plan.id} className="space-y-3 border-t pt-4" data-testid="attendance-shift-plan">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">{plan.teamName ?? t("shiftAll")}</h2><HomePill tone="blue">{t("shiftVersion", { version: plan.version })}</HomePill></div>
          <p className="text-sm tabular-nums">{plan.value.from} — {plan.value.to} · {plan.value.timezone} · {t("shiftMembers", { count: plan.memberCount })}</p>
          <ol className="flex flex-wrap gap-2">{plan.value.cycle.map((slot, index) => <li key={index} className="rounded-lg bg-muted px-3 py-2 text-sm"><span className="text-muted-foreground">{index + 1}. </span>{slot.kind === "OFF" ? t("shiftOff") : `${slot.startTime}–${slot.endTime}${slot.nextDay ? ` · ${t("shiftNextDay")}` : ""}`}</li>)}</ol>
          <p className="text-xs leading-relaxed text-muted-foreground">{t(plan.value.attribution === "END_DAY" ? "shiftEndDay" : "shiftStartDay")} · {t("shiftShorteningValue", { minutes: plan.value.preHolidayMinutes ?? "—" })} · {t("shiftThresholdValue", { minutes: plan.value.overtimeThresholdMinutes ?? "—" })}</p>
        </article>)}
        {data.plans.length > 20 && <div className="flex flex-wrap gap-3"><Button className="min-h-11" variant="outline" disabled={locked || page === 0} onClick={() => setPage(value => value - 1)}>{t("reportPrevious")}</Button><Button className="min-h-11" variant="outline" disabled={locked || (page + 1) * 20 >= data.plans.length} onClick={() => setPage(value => value + 1)}>{t("reportNext")}</Button></div>}
        {data.canManage && !open && <Button className="min-h-11" disabled={locked} onClick={() => setOpen(true)}>{t("shiftCreate")}</Button>}
      </div>}
    </HomeCard>
    {open && data?.canManage && <HomeCard testId="shift-create" titleId="shift-create-title" tone="orange" title={t("shiftCreate")} icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}><form onSubmit={save} className="space-y-5 py-4"><fieldset disabled={locked} className="min-w-0 space-y-5">
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t("shiftFutureHint")}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><label className="space-y-1 text-sm"><span>{t("shiftTeam")}</span><select className={control} value={teamId} onChange={e => setTeamId(e.target.value)}><option value="" disabled={!data.rosters.some(row => row.teamId === null)}>{t("shiftAll")}</option>{data.rosters.filter(row => row.teamId).map(row => <option key={row.teamId} value={row.teamId!}>{row.name} · {row.count}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>{t("shiftFrom")}</span><input required type="date" className={control} min={addDateKeyDays(data.today, 1)} value={from} onChange={e => setFrom(e.target.value)} /></label><label className="space-y-1 text-sm"><span>{t("shiftTo")}</span><input required type="date" className={control} min={from} max={from ? addDateKeyDays(from, 92) : undefined} value={to} onChange={e => setTo(e.target.value)} /></label></div>
      <div className="space-y-3"><h2 className="font-semibold">{t("shiftCycle")}</h2><p className="text-sm text-muted-foreground">{t("shiftCycleHint")}</p>
        {cycle.map((slot, index) => <div key={index} className="space-y-3 rounded-xl bg-muted/40 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">{t("shiftSlot", { day: index + 1 })}</h3><Button type="button" variant="outline" className="min-h-11" disabled={cycle.length === 1} onClick={() => setCycle(previous => previous.filter((_, at) => at !== index))}>{t("shiftRemove")}</Button></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="space-y-1 text-sm"><span>{t("shiftDayKind")}</span><select className={control} value={slot.kind} onChange={e => updateSlot(index, e.target.value === "OFF" ? { kind: "OFF" } : work())}><option value="WORK">{t("shiftWork")}</option><option value="OFF">{t("shiftOff")}</option></select></label>
            {slot.kind === "WORK" && <><label className="space-y-1 text-sm"><span>{t("shiftStart")}</span><input required type="time" className={control} value={slot.startTime} onChange={e => updateSlot(index, { ...slot, startTime: e.target.value })} /></label><label className="space-y-1 text-sm"><span>{t("shiftEnd")}</span><input required type="time" className={control} value={slot.endTime} onChange={e => updateSlot(index, { ...slot, endTime: e.target.value })} /></label><label className="space-y-1 text-sm"><span>{t("shiftLunch")}</span><input required type="number" min={0} max={1439} className={control} value={Number.isFinite(slot.lunchMinutes) ? slot.lunchMinutes : ""} onChange={e => updateSlot(index, { ...slot, lunchMinutes: e.target.value === "" ? NaN : Number(e.target.value) })} /></label><label className="space-y-1 text-sm"><span>{t("shiftGrace")}</span><input required type="number" min={0} max={120} className={control} value={Number.isFinite(slot.lateGraceMinutes) ? slot.lateGraceMinutes : ""} onChange={e => updateSlot(index, { ...slot, lateGraceMinutes: e.target.value === "" ? NaN : Number(e.target.value) })} /></label></>}
          </div>{slot.kind === "WORK" && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={slot.nextDay} onChange={e => updateSlot(index, { ...slot, nextDay: e.target.checked })} />{t("shiftNextDay")}</label>}
        </div>)}<Button type="button" variant="outline" className="min-h-11" disabled={cycle.length >= 28} onClick={() => setCycle(previous => [...previous, { kind: "OFF" }])}>{t("shiftAdd")}</Button></div>
      <div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-sm"><span>{t("shiftAttribution")}</span><select className={control} value={attribution} onChange={e => setAttribution(e.target.value as AttendanceShiftValue["attribution"])}><option value="START_DAY">{t("shiftStartDay")}</option><option value="END_DAY">{t("shiftEndDay")}</option></select><span className="block text-xs leading-relaxed text-muted-foreground">{t("shiftAttributionHint")}</span></label>
        <label className="space-y-1 text-sm"><span>{t("shiftThreshold")}</span><input type="number" min={0} max={1440} className={control} value={threshold} onChange={e => setThreshold(e.target.value)} /><span className="block text-xs text-muted-foreground">{t("shiftThresholdHint")}</span></label>
        <div className="space-y-2"><label className="block space-y-1 text-sm"><span>{t("shiftShortening")}</span><input type="number" min={0} max={240} className={control} value={shortening} onChange={e => setShortening(e.target.value)} /><span className="block text-xs leading-relaxed text-muted-foreground">{t("shiftShorteningHint")}</span></label><label className="flex min-h-11 items-center gap-3 text-sm"><input className="h-5 w-5" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t("shiftConfirmed")}</label></div>
        <label className="space-y-1 text-sm"><span>{t("shiftReason")}</span><textarea required minLength={3} maxLength={1000} className={control} value={reason} onChange={e => setReason(e.target.value)} /></label></div>
      <div className="flex flex-wrap gap-3"><Button type="submit" className="min-h-11">{t("shiftPublish")}</Button><Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>{t("shiftCancel")}</Button></div>
    </fieldset>{pending && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void publish(pending)}>{t("shiftRetry")}</Button>}</form></HomeCard>}
  </div>
}
