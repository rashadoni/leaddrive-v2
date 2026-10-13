"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { AttendanceDeliveryInputSchema, type AttendanceDeliveryInput, type AttendanceDeliveryReceipt, type AttendanceDeliverySchedule } from "@/lib/mtm/attendance-delivery-contract"
import type { AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

const ENDPOINT = "/api/v1/mtm/attendance/deliveries"
const SELECT = "min-h-11 w-full rounded-lg border border-zinc-200 bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700"
const FREQUENCY = { DAILY: "deliveryDaily", WEEKLY: "deliveryWeekly", MONTHLY: "deliveryMonthly" } as const
const MODE = { DAY: "viewsModeDay", MONTH: "viewsModeMonth", JOURNAL: "viewsModeJournal", BRANCH: "branchReportTitle", OVERTIME: "overtimeTitle" } as const
const STATUS: Record<AttendanceDeliveryReceipt["status"], { key: string; tone: HomeTone }> = {
  PENDING: { key: "deliveryPending", tone: "zinc" }, SENDING: { key: "deliverySending", tone: "blue" },
  SENT: { key: "deliverySent", tone: "green" }, UNKNOWN: { key: "deliveryUnknown", tone: "amber" },
  CANCELLED: { key: "deliveryCancelled", tone: "zinc" }, FAILED: { key: "deliveryFailed", tone: "red" },
}
type DeliveryData = { timezone: string; schedules: AttendanceDeliverySchedule[]; receipts: AttendanceDeliveryReceipt[] }
type Props = { currentConfig: AttendanceViewConfig | null; onAccessLost: () => void; accessUnavailable?: boolean }

function scheduleInput(schedule: AttendanceDeliverySchedule): AttendanceDeliveryInput {
  const { name, config, frequency, format, locale, recipients, enabled } = schedule
  return { name, config, frequency, format, locale, recipients, enabled }
}

/** Disclosed on demand; only the owner API provides schedules and recipient history. */
export function MtmAttendanceDeliveries({ currentConfig, onAccessLost, accessUnavailable = false }: Props) {
  const t = useTranslations("mtmAttendance")
  const locale = useLocale()
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<DeliveryData | null>(null)
  const [draft, setDraft] = useState<AttendanceDeliveryInput | null>(null)
  const [recipients, setRecipients] = useState("")
  const [editing, setEditing] = useState<AttendanceDeliverySchedule | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [mustReload, setMustReload] = useState(false)
  const [receiptCount, setReceiptCount] = useState(10)
  const readRequest = useRef<AbortController | null>(null)
  const writeRequest = useRef<AbortController | null>(null)
  const interrupted = useRef(false)
  const pendingCreate = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const accessLost = useRef(onAccessLost)
  accessLost.current = onAccessLost

  const clearPrivate = useCallback(() => {
    setData(null); setDraft(null); setEditing(null); setRecipients(""); setRemoving(null); setSaved(false); setSaveError(null)
    pendingCreate.current = null
  }, [])

  const load = useCallback(async (acknowledgeInterrupted = false) => {
    readRequest.current?.abort()
    const controller = new AbortController()
    readRequest.current = controller
    setLoading(true); setLoadError(null); setSaveError(null); setData(null); setRemoving(null)
    if (interrupted.current) setSaving(false)
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || !Array.isArray(body.data?.schedules) || !Array.isArray(body.data?.receipts) || typeof body.data?.timezone !== "string") {
        const denied = [401, 403, 404].includes(response.status)
        setLoadError(t(denied ? "deliveryAccessUnavailable" : "deliveryLoadError"))
        if (denied) { clearPrivate(); accessLost.current() }
        return
      }
      const loaded = body.data as DeliveryData
      setData(loaded)
      const unresolved = interrupted.current && !acknowledgeInterrupted
      setMustReload(unresolved)
      if (unresolved) setSaveError(t("deliveryUnconfirmed"))
      else interrupted.current = false
      if (editingRef.current) {
        const latest = loaded.schedules.find(item => item.id === editingRef.current!.id) ?? null
        setEditing(latest); setDraft(latest ? scheduleInput(latest) : null); setRecipients(latest?.recipients.join("\n") ?? "")
      }
    } catch {
      if (!controller.signal.aborted) setLoadError(t("deliveryLoadError"))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [t, clearPrivate])

  useEffect(() => {
    if (open && !accessUnavailable) void load()
    return () => {
      readRequest.current?.abort()
      if (writeRequest.current) {
        interrupted.current = true
        writeRequest.current.abort()
        writeRequest.current = null
      }
    }
  }, [open, accessUnavailable, load])
  useEffect(() => {
    if (!accessUnavailable) return
    clearPrivate(); setLoading(false); setSaving(false); setLoadError(t("deliveryAccessUnavailable"))
  }, [accessUnavailable, clearPrivate, t])

  function newDraft() {
    if (!currentConfig) return
    setEditing(null); setRemoving(null); setRecipients(""); setSaved(false); setSaveError(null)
    pendingCreate.current = null
    setDraft({ name: "", config: currentConfig, frequency: currentConfig.mode === "MONTH" ? "MONTHLY" : "DAILY", format: "xlsx",
      locale: locale === "az" || locale === "ru" ? locale : "en", recipients: [], enabled: false })
  }
  function edit(schedule: AttendanceDeliverySchedule) {
    setEditing(schedule); setDraft(scheduleInput(schedule)); setRecipients(schedule.recipients.join("\n")); setRemoving(null); setSaved(false); setSaveError(null)
  }
  function change(value: Partial<AttendanceDeliveryInput>) {
    setDraft(previous => previous ? { ...previous, ...value } : null)
    setSaved(false)
    if (!mustReload) setSaveError(null)
  }
  function unconfirmed(key = "deliveryUnconfirmed") {
    interrupted.current = true
    setMustReload(true); setSaveError(t(key))
  }

  async function mutate(target: AttendanceDeliverySchedule | null, input?: AttendanceDeliveryInput, remove = false) {
    if (saving || writeRequest.current || loading || mustReload || accessUnavailable || (remove && removing !== target?.id)) return
    const parsed = input ? AttendanceDeliveryInputSchema.safeParse(input) : null
    const validatedInput = parsed?.success ? parsed.data : null
    if (!remove && !validatedInput) { setSaveError(t("deliveryInvalid")); return }
    const controller = new AbortController()
    writeRequest.current = controller
    setSaving(true); setSaveError(null); setSaved(false)
    let body: object
    if (remove) body = { version: target!.version }
    else if (target) body = { version: target.version, input: validatedInput }
    else {
      const fingerprint = JSON.stringify(validatedInput)
      if (pendingCreate.current?.fingerprint !== fingerprint) pendingCreate.current = { fingerprint, requestId: crypto.randomUUID() }
      body = { requestId: pendingCreate.current.requestId, input: validatedInput }
    }
    try {
      const response = await fetch(target ? `${ENDPOINT}/${encodeURIComponent(target.id)}` : ENDPOINT, {
        method: remove ? "DELETE" : target ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
      })
      const result = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || result?.success !== true || (!remove && !result.data?.id)) {
        if ([401, 403, 404].includes(response.status)) { clearPrivate(); setLoadError(t("deliveryAccessUnavailable")); accessLost.current() }
        else if (result?.code === "MTM_ATTENDANCE_DELIVERY_INVALID") setSaveError(t("deliveryInvalid"))
        else unconfirmed(result?.code === "MTM_ATTENDANCE_DELIVERY_CHANGED" ? "deliveryChanged" : result?.code === "MTM_ATTENDANCE_DELIVERY_LIMIT" ? "deliveryLimit" : "deliveryUnconfirmed")
        return
      }
      // Re-read receipts as edits cancel pending attempts atomically on the server.
      if (remove) { setDraft(null); setEditing(null); editingRef.current = null; setRecipients("") }
      else { const schedule = result.data as AttendanceDeliverySchedule; setEditing(schedule); editingRef.current = schedule; pendingCreate.current = null }
      setRemoving(null)
      await load()
      if (!controller.signal.aborted) setSaved(true)
    } catch {
      if (!controller.signal.aborted) unconfirmed()
    } finally {
      if (writeRequest.current === controller) writeRequest.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft) void mutate(editing, { ...draft, recipients: recipients.split(/[,;\n]+/).map(value => value.trim()).filter(Boolean) })
  }
  function dateTime(value: string, timezone: string) {
    return format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short", timeZone: timezone })
  }
  function date(value: string) { return format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) }
  const disabled = saving || loading || mustReload || Boolean(loadError) || accessUnavailable

  return <section data-testid="attendance-deliveries" className="space-y-3">
    <Button type="button" variant="outline" className="min-h-11" disabled={saving} aria-expanded={open} aria-controls="attendance-deliveries-panel" onClick={() => setOpen(previous => !previous)}>
      <Mail className="mr-2 h-4 w-4" aria-hidden="true" />{t(open ? "deliveryClose" : "deliveryOpen")}
    </Button>
    {open ? <div id="attendance-deliveries-panel"><HomeCard testId="attendance-deliveries-card" titleId="attendance-deliveries-title" title={t("deliveryTitle")} tone="orange" icon={<Mail className="h-4 w-4" aria-hidden="true" />}>
      <div className="space-y-6 py-4">
        <p className="max-w-prose text-sm text-muted-foreground">{t("deliveryIntro")}</p>
        {loading ? <p role="status" className="text-sm text-muted-foreground">{t("deliveryLoading")}</p> : null}
        {loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : null}
        {(loadError || mustReload) && !accessUnavailable ? <Button type="button" variant="outline" className="min-h-11" disabled={loading || saving} onClick={() => void load(true)}>{t("deliveryReload")}</Button> : null}
        {saveError ? <p role="alert" className="max-w-prose text-sm text-destructive">{saveError}</p> : null}
        {saved ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{t("deliverySaved")}</p> : null}
        {data && !accessUnavailable ? <>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{t("deliveryTiming", { timezone: data.timezone })}</p>
            <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={disabled || !currentConfig || data.schedules.length >= 10} onClick={newDraft}>{t("deliveryNew")}</Button>
              <Button type="button" variant="ghost" className="min-h-11" disabled={saving || loading} onClick={() => void load(true)}>{t("deliveryReload")}</Button></div></div>
          {data.schedules.length >= 10 ? <p className="text-sm text-muted-foreground">{t("deliveryLimit")}</p> : null}
          {data.schedules.length ? <ul aria-label={t("deliverySchedules")} className="divide-y divide-zinc-100 dark:divide-zinc-800">{data.schedules.map(schedule => <li key={schedule.id} className="space-y-3 py-4" data-testid="attendance-delivery-schedule">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-semibold">{schedule.name}</h3><HomePill tone={schedule.enabled ? "green" : "zinc"}>{t(schedule.enabled ? "deliveryEnabled" : "deliveryDisabled")}</HomePill></div>
              <p className="text-sm text-muted-foreground">{t(FREQUENCY[schedule.frequency])} · {schedule.format.toUpperCase()} · {schedule.locale.toUpperCase()}</p>
              <p className="break-all text-sm">{schedule.recipients.join(", ")}</p>
              <p className="text-xs text-muted-foreground">{schedule.enabled ? t("deliveryNext", { date: dateTime(schedule.nextRunAt, schedule.timezone), timezone: schedule.timezone }) : t("deliveryDisabledHint")}</p></div>
              <div className="flex flex-wrap gap-1"><Button type="button" variant="outline" className="min-h-11" disabled={disabled} onClick={() => edit(schedule)} aria-label={t("deliveryEditNamed", { name: schedule.name })}>{t("deliveryEdit")}</Button>
                <Button type="button" variant="ghost" className="min-h-11" disabled={disabled} onClick={() => void mutate(schedule, { ...scheduleInput(schedule), enabled: !schedule.enabled })} aria-label={t(schedule.enabled ? "deliveryDisableNamed" : "deliveryEnableNamed", { name: schedule.name })}>{t(schedule.enabled ? "deliveryDisable" : "deliveryEnable")}</Button>
                <Button type="button" variant="ghost" className="min-h-11 text-destructive" disabled={disabled} onClick={() => setRemoving(schedule.id)} aria-label={t("deliveryDeleteNamed", { name: schedule.name })}>{t("deliveryDelete")}</Button></div></div>
            {removing === schedule.id ? <div className="space-y-2 rounded-lg bg-muted/50 p-3"><p className="text-sm">{t("deliveryDeleteConfirm", { name: schedule.name })}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="destructive" className="min-h-11" disabled={disabled} onClick={() => void mutate(schedule, undefined, true)}>{t("deliveryConfirmDelete")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => setRemoving(null)}>{t("deliveryCancel")}</Button></div></div> : null}
          </li>)}</ul> : <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">{t("deliveryEmpty")}</p>}
          {draft ? <form aria-label={t("deliveryEditor")} onSubmit={submit} className="border-t border-zinc-200 pt-5 dark:border-zinc-700"><fieldset disabled={disabled} className="space-y-4">
            <legend className="mb-3 text-sm font-semibold">{t(editing ? "deliveryEdit" : "deliveryNew")}</legend>
            <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><label htmlFor="attendance-delivery-name" className="text-sm font-medium">{t("deliveryName")}</label><Input id="attendance-delivery-name" className="min-h-11" required maxLength={80} value={draft.name} onChange={event => change({ name: event.target.value })} /></div>
              <div className="space-y-2"><label htmlFor="attendance-delivery-frequency" className="text-sm font-medium">{t("deliveryFrequency")}</label><select id="attendance-delivery-frequency" className={SELECT} value={draft.frequency} onChange={event => change({ frequency: event.target.value as AttendanceDeliveryInput["frequency"] })}>{(Object.keys(FREQUENCY) as AttendanceDeliveryInput["frequency"][]).filter(frequency => draft.config.mode !== "MONTH" || frequency === "MONTHLY").map(frequency => <option key={frequency} value={frequency}>{t(FREQUENCY[frequency])}</option>)}</select></div>
              <div className="space-y-2"><label htmlFor="attendance-delivery-recipients" className="text-sm font-medium">{t("deliveryRecipients")}</label><textarea id="attendance-delivery-recipients" className={`${SELECT} resize-y`} rows={3} required value={recipients} aria-describedby="attendance-delivery-recipients-hint" onChange={event => { setRecipients(event.target.value); setSaved(false) }} /><p id="attendance-delivery-recipients-hint" className="text-xs text-muted-foreground">{t("deliveryRecipientsHint")}</p></div>
              <div className="grid content-start gap-4 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="attendance-delivery-format" className="text-sm font-medium">{t("deliveryFormat")}</label><select id="attendance-delivery-format" className={SELECT} value={draft.format} onChange={event => change({ format: event.target.value as AttendanceDeliveryInput["format"] })}><option value="xlsx">Excel</option><option value="pdf">PDF</option></select></div>
                <div className="space-y-2"><label htmlFor="attendance-delivery-locale" className="text-sm font-medium">{t("deliveryLocale")}</label><select id="attendance-delivery-locale" className={SELECT} value={draft.locale} onChange={event => change({ locale: event.target.value as AttendanceDeliveryInput["locale"] })}><option value="az">Azərbaycan dili</option><option value="ru">Русский</option><option value="en">English</option></select></div></div></div>
            <div className="space-y-2 rounded-xl bg-muted/50 px-4 py-3"><p className="text-sm font-medium">{t("deliveryReport", { mode: t(MODE[draft.config.mode]), count: draft.config.columns.length })}</p><p className="max-w-prose text-xs text-muted-foreground">{t(draft.config.filters.teamId || draft.config.filters.employeeId ? "deliveryScoped" : "deliveryAllScope")} {t("deliveryRolling")}</p>
              <Button type="button" variant="outline" className="min-h-11" disabled={disabled || !currentConfig} onClick={() => currentConfig && change({ config: currentConfig, frequency: currentConfig.mode === "MONTH" ? "MONTHLY" : draft.frequency })}>{t("deliveryUseCurrent")}</Button></div>
            <p className="max-w-prose text-sm text-muted-foreground">{t("deliveryPeriodHint", { timezone: editing?.timezone ?? data.timezone })}</p>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={draft.enabled} onChange={event => change({ enabled: event.target.checked })} />{t("deliveryEnableOnSave")}</label>
            <div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11">{t(saving ? "deliverySaving" : "deliverySave")}</Button><Button type="button" variant="outline" className="min-h-11" onClick={() => { setDraft(null); setEditing(null); setRecipients("") }}>{t("deliveryCancel")}</Button></div>
          </fieldset></form> : null}
          <section aria-label={t("deliveryHistory")} className="space-y-3 border-t border-zinc-200 pt-5 dark:border-zinc-700"><h3 className="text-sm font-semibold">{t("deliveryHistory")}</h3><p className="max-w-prose text-xs text-muted-foreground">{t("deliveryHistoryHint")}</p>
            {data.receipts.length ? <><ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{data.receipts.slice(0, receiptCount).map(receipt => { const schedule = data.schedules.find(item => item.id === receipt.scheduleId); return <li key={receipt.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="attendance-delivery-receipt">
              <div className="min-w-0 space-y-1"><p className="break-all font-medium">{receipt.recipient}</p><p className="break-words text-xs text-muted-foreground">{schedule?.name ?? t("deliveryArchived")}</p><p className="text-xs text-muted-foreground">{date(receipt.from)} — {date(receipt.to)}</p></div>
              <div className="space-y-2 sm:text-right"><HomePill tone={STATUS[receipt.status].tone}>{t(STATUS[receipt.status].key)}</HomePill><p className="text-xs text-muted-foreground">{dateTime(receipt.completedAt ?? receipt.createdAt, schedule?.timezone ?? data.timezone)}</p>{receipt.status === "UNKNOWN" ? <p className="text-xs text-amber-800 dark:text-amber-300">{t("deliveryUnknownHint")}</p> : null}</div>
            </li> })}</ul><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t("deliveryHistoryCount", { shown: Math.min(receiptCount, data.receipts.length), total: data.receipts.length })}</p>{receiptCount < data.receipts.length ? <Button type="button" variant="outline" className="min-h-11" onClick={() => setReceiptCount(previous => previous + 10)}>{t("deliveryMore")}</Button> : null}</div></> : <p className="text-sm text-muted-foreground">{t("deliveryHistoryEmpty")}</p>}
          </section>
        </> : null}
      </div>
    </HomeCard></div> : null}
  </section>
}
