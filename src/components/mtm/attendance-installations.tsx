"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { createDateFormatter } from "@/lib/format-date"
import { useLocale, useTranslations } from "next-intl"
import { Smartphone, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HomeCard, HomePill, type HomeTone } from "@/components/mtm/home-parts"
import type { AttendanceInstallationQueue, AttendanceInstallationItem } from "@/lib/mtm/attendance-installation-contract"

const ENDPOINT = "/api/v1/mtm/attendance/installations"
const STATUS = { PENDING: "installationPending", APPROVED: "installationApproved", REJECTED: "installationRejected", REVOKED: "installationRevoked", ALL: "installationAll" } as const
type Status = keyof typeof STATUS
type Action = "APPROVE" | "REJECT" | "REVOKE"
type Pending = { id: string; requestId: string; action: Action; reason: string }
const ACTION = { APPROVE: "installationApprove", REJECT: "installationReject", REVOKE: "installationRevoke" } as const
const TONE: Record<string, HomeTone> = { PENDING: "amber", APPROVED: "green", REJECTED: "zinc", REVOKED: "red" }

export function MtmAttendanceInstallations() {
  const t = useTranslations("mtmAttendance"), locale = useLocale()
  const [queue, setQueue] = useState<AttendanceInstallationQueue | null>(null), [status, setStatus] = useState<Status>("PENDING")
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [denied, setDenied] = useState(false)
  const [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false)
  const [selected, setSelected] = useState<AttendanceInstallationItem | null>(null), [action, setAction] = useState<Action>("APPROVE"), [reason, setReason] = useState("")
  const [pending, setPending] = useState<Pending | null>(null), pendingRef = useRef<Pending | null>(null)
  const mounted = useRef(false), reading = useRef<AbortController | null>(null), writing = useRef<AbortController | null>(null)
  const clear = useCallback(() => { setQueue(null); setSelected(null); setReason(""); setPending(null); pendingRef.current = null; setDenied(true); setSaved(false); setError(null) }, [])
  const load = useCallback(async (filter: Status = "PENDING", cursor?: string) => {
    reading.current?.abort(); const controller = new AbortController(); reading.current = controller
    setLoading(true); setError(null); setSelected(null)
    try {
      const response = await fetch(`${ENDPOINT}?${new URLSearchParams({ status: filter, ...(cursor ? { cursor } : {}) })}`, { cache: "no-store", signal: controller.signal })
      if (controller.signal.aborted || !mounted.current) return
      if ([401, 403, 404].includes(response.status)) { clear(); return }
      const body = await response.json()
      if (controller.signal.aborted || !mounted.current) return
      if (!response.ok || body?.success !== true || !Array.isArray(body.data?.items) || typeof body.data.required !== "boolean" || typeof body.data.timezone !== "string") throw new Error("INVALID_QUEUE")
      setQueue(body.data); setStatus(filter); setDenied(false)
    } catch { if (!controller.signal.aborted && mounted.current) { setQueue(null); setError("installationLoad") } }
    finally { if (!controller.signal.aborted && mounted.current) setLoading(false) }
  }, [clear])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; reading.current?.abort(); writing.current?.abort() } }, [load])
  const locked = loading || saving || Boolean(pending)
  const date = (value: string | null) => value ? createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short", timeZone: queue?.timezone ?? "UTC" }).format(new Date(value)) : "—"
  const select = (item: AttendanceInstallationItem, next: Action = "APPROVE") => { setSelected(item); setAction(next); setReason(""); setSaved(false); setError(null) }
  async function decide(event?: FormEvent) {
    event?.preventDefault()
    if (saving || (!pendingRef.current && (!selected || reason.trim().length < 3))) return
    const payload = pendingRef.current ?? { id: selected!.id, requestId: crypto.randomUUID(), action, reason: reason.trim() }
    pendingRef.current = payload; setPending(payload); setSaving(true); setError(null); setSaved(false)
    const controller = new AbortController(); writing.current = controller
    try {
      const response = await fetch(`${ENDPOINT}/${payload.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ requestId: payload.requestId, action: payload.action, reason: payload.reason }) })
      if (!mounted.current || controller.signal.aborted) return
      if ([401, 403, 404].includes(response.status)) { clear(); return }
      const body = await response.json().catch(() => null)
      if (!mounted.current || controller.signal.aborted) return
      if (response.ok && body?.success === true && typeof body.data?.id === "string") {
        pendingRef.current = null; setPending(null); setReason(""); setSaved(true); await load(status)
      } else if (response.status === 400 || response.status === 413 || (response.status === 409 && body?.code === "MTM_ATTENDANCE_INSTALLATION_ALREADY_DECIDED")) {
        pendingRef.current = null; setPending(null); setSelected(null); await load(status); setError("installationChanged")
      } else setError("installationUnknown")
    } catch { if (mounted.current && !controller.signal.aborted) setError("installationUnknown") }
    finally { if (mounted.current && !controller.signal.aborted) setSaving(false) }
  }
  async function toggle() {
    if (locked || !queue?.canConfigure) return
    const required = !queue.required, controller = new AbortController(); writing.current = controller
    setSaving(true); setError(null); setSaved(false)
    try {
      const response = await fetch("/api/v1/mtm/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ attendanceRequireInstallationApproval: required }) })
      if (!mounted.current || controller.signal.aborted) return
      if ([401, 403, 404].includes(response.status)) { clear(); return }
      // A setting has an idempotent value; reread after any reply before another change.
      await load(status)
      if (!response.ok) setError("installationChanged")
    } catch { if (mounted.current && !controller.signal.aborted) { await load(status); setError("installationChanged") } }
    finally { if (mounted.current && !controller.signal.aborted) setSaving(false) }
  }
  if (denied) return <p role="status">{t("reportAccessUnavailable")}</p>
  return <main className="min-w-0 space-y-5" aria-label={t("installationTitle")} aria-busy={loading}>
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{t("installationTitle")}</h1><p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t("installationSubtitle")}</p></div>
    <HomeCard testId="installation-rule" titleId="installation-rule-title" title={t("installationRule")} tone="green" icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}>
      <div className="flex flex-wrap items-center justify-between gap-4 py-4"><p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t("installationRuleHint")}</p>
        {queue && <button type="button" role="switch" aria-checked={queue?.required === true} aria-label={t("installationRule")} disabled={locked || !queue?.canConfigure} onClick={() => void toggle()}
          className="inline-flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium disabled:opacity-50"><span>{queue?.required ? t("installationOn") : t("installationOff")}</span><span aria-hidden="true" className={`h-6 w-11 rounded-full p-0.5 ${queue?.required ? "bg-emerald-700" : "bg-zinc-300"}`}><span className={`block h-5 w-5 rounded-full bg-white ${queue?.required ? "translate-x-5" : ""}`} /></span></button>}
      </div>
    </HomeCard>
    {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}{saved && <p role="status" className="text-sm text-emerald-700">{t("installationSaved")}</p>}
    <HomeCard testId="installation-queue" titleId="installation-queue-title" title={t("installationTitle")} tone="amber" icon={<Smartphone className="h-5 w-5" aria-hidden="true" />}>
      <div className="space-y-4 py-4"><div className="flex flex-wrap items-end gap-3"><label className="space-y-1 text-sm"><span className="block">{t("installationFilter")}</span>
        <select value={status} disabled={locked} onChange={event => void load(event.target.value as Status)} className="min-h-11 rounded-lg border bg-background px-3">{Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label>
        <Button type="button" variant="outline" disabled={locked} onClick={() => void load(status)} className="min-h-11">{t("installationRefresh")}</Button></div>
        {loading ? <p role="status">{t("reportLoading")}</p> : queue && !queue.items.length ? <p className="py-5 text-sm text-muted-foreground">{t("installationEmpty")}</p> : null}
        {queue && <div className="overflow-x-auto"><table className="block w-full text-sm lg:table"><caption className="sr-only">{t("installationTitle")}</caption>
          <thead className="hidden lg:table-header-group"><tr>{["installationEmployee", "installationLabel", "installationSubmitted", "installationStatus", "installationHistory"].map(key => <th key={key} className="border-b px-3 py-3 text-left font-medium text-muted-foreground" scope="col">{t(key)}</th>)}</tr></thead>
          <tbody className="block lg:table-row-group">{queue.items.map(item => <tr key={item.id} className="block border-b py-4 lg:table-row lg:py-0" data-testid="installation-row">
            <th scope="row" className="block px-1 py-2 text-left font-semibold lg:table-cell lg:px-3 lg:py-4">{item.employeeName}<span className="block text-xs font-normal text-muted-foreground">{item.teamName ?? "—"}</span></th>
            <td className="block px-1 py-2 lg:table-cell lg:px-3 lg:py-4"><span className="mr-2 text-xs text-muted-foreground lg:hidden">{t("installationLabel")}</span>{item.installationLabel}</td>
            <td className="block px-1 py-2 lg:table-cell lg:px-3 lg:py-4">{date(item.submittedAt)}</td>
            <td className="block px-1 py-2 lg:table-cell lg:px-3 lg:py-4"><HomePill tone={TONE[item.state] ?? "zinc"}>{t(STATUS[item.state as Exclude<Status, "ALL">])}</HomePill></td>
            <td className="block px-1 py-2 lg:table-cell lg:px-3 lg:py-4"><div className="flex flex-wrap gap-2">
              {item.canDecide && <><Button type="button" disabled={locked} onClick={() => select(item, "APPROVE")} className="min-h-11">{t("installationApprove")}</Button><Button type="button" disabled={locked} variant="outline" onClick={() => select(item, "REJECT")} className="min-h-11">{t("installationReject")}</Button></>}
              {item.canRevoke && <Button type="button" disabled={locked} variant="outline" onClick={() => select(item, "REVOKE")} className="min-h-11">{t("installationRevoke")}</Button>}
              {item.decision && <Button type="button" disabled={locked} variant="ghost" onClick={() => select(item)} className="min-h-11">{t("installationHistory")}</Button>}
            </div></td></tr>)}</tbody></table></div>}
        {queue?.nextCursor && <Button type="button" variant="outline" disabled={locked} onClick={() => void load(status, queue.nextCursor!)} className="min-h-11">{t("installationMore")}</Button>}
      </div>
    </HomeCard>
    {selected && <HomeCard testId="installation-decision" titleId="installation-decision-title" title={selected.employeeName} tone="blue" icon={<Smartphone className="h-5 w-5" aria-hidden="true" />}>
      <div className="space-y-4 py-4"><p className="text-sm text-muted-foreground">{selected.installationLabel}</p>
        {selected.decision && <p className="whitespace-pre-wrap break-words text-sm">{date(selected.decision.at)} · {t(ACTION[selected.decision.action])}<br />{selected.decision.reason}</p>}
        {selected.revocation && <p className="whitespace-pre-wrap break-words text-sm">{date(selected.revocation.at)} · {t("installationRevoked")}<br />{selected.revocation.reason}</p>}
        {(selected.canDecide || (selected.canRevoke && action === "REVOKE")) && <form onSubmit={decide} className="space-y-3">
          <label className="block space-y-2 text-sm" htmlFor="installation-reason"><span className="font-medium">{t(ACTION[action])} · {t("installationReason")}</span><textarea id="installation-reason" rows={3} maxLength={1000} value={reason} readOnly={Boolean(pending) || saving} onChange={event => setReason(event.target.value)} aria-describedby="installation-reason-hint" className="block w-full rounded-xl border bg-background p-3" /></label>
          <p id="installation-reason-hint" className="text-xs text-muted-foreground">{t("installationReasonHint")}</p>
          <Button type="submit" disabled={saving || (!pending && reason.trim().length < 3)} className="min-h-11">{t(pending ? "installationRetry" : "installationSave")}</Button>
        </form>}
      </div>
    </HomeCard>}
  </main>
}
