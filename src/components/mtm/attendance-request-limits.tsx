"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { AttendanceRequestLimitsUpdateSchema, type AttendanceRequestLimits } from "@/lib/mtm/attendance-request-limits"

const ENDPOINT = "/api/v1/mtm/attendance/request-limits"
type Props = { canManage: boolean; onAccessLost: () => void; accessUnavailable?: boolean }
function parseLimits(value: unknown) {
  if (!value || typeof value !== "object") return null
  const data = value as Record<string, unknown>
  const parsed = AttendanceRequestLimitsUpdateSchema.safeParse({ monthlyMinutes: data.monthlyMinutes, monthlyRequests: data.monthlyRequests, version: data.version })
  return parsed.success ? parsed.data : null
}

export function MtmAttendanceRequestLimits({ canManage, onAccessLost, accessUnavailable = false }: Props) {
  const t = useTranslations("mtmAttendance")
  const [open, setOpen] = useState(false)
  const [limits, setLimits] = useState<AttendanceRequestLimits | null>(null)
  const [hours, setHours] = useState("")
  const [requests, setRequests] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [mustReload, setMustReload] = useState(false)
  const readRequest = useRef<AbortController | null>(null)
  const writeRequest = useRef<AbortController | null>(null)
  const interrupted = useRef(false)
  const accessLost = useRef(onAccessLost)
  accessLost.current = onAccessLost
  const clearPrivate = useCallback(() => { setLimits(null); setHours(""); setRequests(""); setSaved(false); setSaveError(null) }, [])
  const load = useCallback(async (acknowledge = false) => {
    readRequest.current?.abort()
    const controller = new AbortController()
    readRequest.current = controller
    setLoading(true); clearPrivate(); setError(null)
    if (interrupted.current) setSaving(false)
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      const next = parseLimits(body?.data)
      if (!response.ok || body?.success !== true || !next || body.data.canManage !== true) {
        const denied = [401, 403, 404].includes(response.status) || (response.ok && body?.data?.canManage !== true)
        setError(t(denied ? "limitsAccessUnavailable" : body?.code === "MTM_ATTENDANCE_REQUEST_LIMITS_INVALID_STORED" ? "limitsInvalidStored" : "limitsLoadError"))
        if (denied) accessLost.current()
        return
      }
      setLimits(next); setHours(String(next.monthlyMinutes / 60)); setRequests(String(next.monthlyRequests))
      const unresolved = interrupted.current && !acknowledge
      setMustReload(unresolved)
      if (unresolved) setSaveError(t("limitsUnconfirmed"))
      else interrupted.current = false
    } catch {
      if (!controller.signal.aborted) setError(t("limitsLoadError"))
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [t, clearPrivate])
  useEffect(() => {
    if (open && canManage === true && !accessUnavailable) void load()
    return () => {
      readRequest.current?.abort()
      if (writeRequest.current) { interrupted.current = true; writeRequest.current.abort(); writeRequest.current = null }
    }
  }, [open, canManage, accessUnavailable, load])
  useEffect(() => {
    if (canManage === true && !accessUnavailable) return
    clearPrivate(); setOpen(false); setLoading(false); setSaving(false)
  }, [canManage, accessUnavailable, clearPrivate])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!limits || canManage !== true || accessUnavailable || loading || saving || mustReload || writeRequest.current) return
    const parsed = AttendanceRequestLimitsUpdateSchema.safeParse({ version: limits.version, monthlyMinutes: hours.trim() ? Number(hours) * 60 : NaN, monthlyRequests: requests.trim() ? Number(requests) : NaN })
    if (!parsed.success) { setSaveError(t("limitsInvalid")); return }
    const controller = new AbortController()
    writeRequest.current = controller
    setSaving(true); setSaveError(null); setSaved(false)
    try {
      const response = await fetch(ENDPOINT, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data), signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      const next = parseLimits(body?.data)
      if (!response.ok || body?.success !== true || !next) {
        if ([401, 403, 404].includes(response.status)) { clearPrivate(); setError(t("limitsAccessUnavailable")); accessLost.current() }
        else if (response.status === 400 && body?.code === "MTM_ATTENDANCE_REQUEST_LIMITS_INVALID") setSaveError(t("limitsInvalid"))
        else { interrupted.current = true; setMustReload(true); setSaveError(t(body?.code === "MTM_ATTENDANCE_REQUEST_LIMITS_CHANGED" ? "limitsChanged" : "limitsUnconfirmed")) }
        return
      }
      setLimits(next); setHours(String(next.monthlyMinutes / 60)); setRequests(String(next.monthlyRequests)); setSaved(true)
    } catch {
      if (!controller.signal.aborted) { interrupted.current = true; setMustReload(true); setSaveError(t("limitsUnconfirmed")) }
    } finally {
      if (writeRequest.current === controller) writeRequest.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  if (canManage !== true || accessUnavailable) return null
  const busy = loading || saving || mustReload || !limits || Boolean(error)
  const blocked = hours.trim() !== "" && requests.trim() !== "" && (Number(hours) === 0 || Number(requests) === 0)
  return <section data-testid="attendance-request-limits" className="space-y-3">
    <Button type="button" variant="outline" className="min-h-11" disabled={saving} aria-expanded={open} aria-controls="attendance-request-limits-panel" onClick={() => setOpen(value => !value)}>
      <SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />{t(open ? "limitsClose" : "limitsOpen")}
    </Button>
    {open ? <div id="attendance-request-limits-panel"><HomeCard testId="attendance-request-limits-card" titleId="attendance-request-limits-title" title={t("limitsTitle")} tone="orange" icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}>
      <div className="space-y-5 py-4">
        <div className="max-w-prose space-y-2"><p className="text-sm font-medium">{t("limitsIntro")}</p><p className="text-sm text-muted-foreground">{t("limitsScope")}</p><p className="text-xs text-muted-foreground">{t("limitsReservations")}</p></div>
        {loading ? <p role="status" className="text-sm text-muted-foreground">{t("limitsLoading")}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {saveError ? <p role="alert" className="max-w-prose text-sm text-destructive">{saveError}</p> : null}
        {saved ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{t("limitsSaved")}</p> : null}
        {limits ? <form onSubmit={save} className="space-y-4" aria-label={t("limitsTitle")}>
          {limits.version === null ? <HomePill tone="zinc">{t("limitsDefault")}</HomePill> : null}
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <div className="space-y-2"><label htmlFor="attendance-limits-hours" className="text-sm font-medium">{t("limitsHours")}</label><Input id="attendance-limits-hours" type="number" inputMode="decimal" min={0} max={744} step={0.5} value={hours} required disabled={busy} className="min-h-11" aria-describedby="attendance-limits-hours-hint" onChange={event => { setHours(event.target.value); setSaved(false) }} /><p id="attendance-limits-hours-hint" className="text-xs text-muted-foreground">{t("limitsHoursHint")}</p></div>
            <div className="space-y-2"><label htmlFor="attendance-limits-count" className="text-sm font-medium">{t("limitsRequests")}</label><Input id="attendance-limits-count" type="number" inputMode="numeric" min={0} max={100} step={1} value={requests} required disabled={busy} className="min-h-11" aria-describedby="attendance-limits-count-hint" onChange={event => { setRequests(event.target.value); setSaved(false) }} /><p id="attendance-limits-count-hint" className="text-xs text-muted-foreground">{t("limitsRequestsHint")}</p></div>
          </div>
          {blocked ? <p className="max-w-prose rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t("limitsZero")}</p> : null}
          <p className="max-w-prose text-xs text-muted-foreground">{t("limitsForward")}</p>
          <div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11" disabled={busy}>{t(saving ? "limitsSaving" : "limitsSave")}</Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={saving || loading} onClick={() => void load(true)}>{t("limitsReload")}</Button></div>
        </form> : <Button type="button" variant="outline" className="min-h-11" disabled={saving || loading} onClick={() => void load(true)}>{t("limitsReload")}</Button>}
      </div>
    </HomeCard></div> : null}
  </section>
}
