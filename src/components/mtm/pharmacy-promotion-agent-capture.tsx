"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, FilePlus2, Loader2, RefreshCw, WifiOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { normalizePharmacyPromotionHumanDecimal18_4 } from "@/lib/mtm/pharmacy-promotion-decimal"
import {
  createPharmacyPromotionDraftOperation,
  flushPharmacyPromotionOutbox,
  listPharmacyPromotionOutboxEntries,
  persistPharmacyPromotionOperation,
  pharmacyPromotionOutboxPayload,
  putPharmacyPromotionOutboxEntries,
  readPharmacyPromotionTargetCache,
  removePharmacyPromotionOutboxEntries,
  retryPharmacyPromotionOperationNow,
  sendPharmacyPromotionOutboxRequests,
  writePharmacyPromotionTargetCache,
  type PharmacyPromotionOutboxEntry,
} from "@/lib/mtm/pharmacy-promotion-outbox"
import { createDateFormatter } from "@/lib/format-date"

type CaptureTarget = {
  id: string
  assignedAgentId: string
  status: string
  planQuantity: string
  unit: string
  eligibilityStatus: string
  customer: {
    id: string
    name: string
    code: string | null
    locality: string | null
    visits: Array<{
      id: string
      agentId: string
      status: "CHECKED_OUT"
      checkInAt: string | null
      checkOutAt: string
      updatedAt: string
    }>
  }
  promotionVersion: {
    id: string
    nameRu: string
    nameAz: string
    nameEn: string
    eligibilityDefinition: { requireCompletedVisit: boolean }
    promotion: { id: string; code: string }
    type: { code: string }
  }
  executions: Array<{ id: string; status: "RETURNED" | "REJECTED"; actualQuantity: string; updatedAt: string }>
  _count: { executions: number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function targetsFromValues(values: unknown): CaptureTarget[] | null {
  if (!Array.isArray(values)) return null
  const targets: CaptureTarget[] = []
  for (const value of values) {
    if (!isRecord(value) || !isRecord(value.customer) || !Array.isArray(value.customer.visits) || !isRecord(value.promotionVersion) || !isRecord(value.promotionVersion.eligibilityDefinition) || !isRecord(value._count) || !Array.isArray(value.executions)) return null
    if (
      typeof value.id !== "string"
      || typeof value.assignedAgentId !== "string"
      || typeof value.status !== "string"
      || (typeof value.planQuantity !== "string" && typeof value.planQuantity !== "number")
      || typeof value.unit !== "string"
      || typeof value.eligibilityStatus !== "string"
      || typeof value.customer.name !== "string"
      || typeof value.promotionVersion.nameRu !== "string"
      || typeof value.promotionVersion.nameAz !== "string"
      || typeof value.promotionVersion.nameEn !== "string"
      || typeof value.promotionVersion.eligibilityDefinition.requireCompletedVisit !== "boolean"
      || !isRecord(value.promotionVersion.promotion)
      || typeof value.promotionVersion.promotion.code !== "string"
      || !isRecord(value.promotionVersion.type)
      || typeof value.promotionVersion.type.code !== "string"
      || typeof value._count.executions !== "number"
    ) return null
    for (const visit of value.customer.visits) {
      if (
        !isRecord(visit)
        || typeof visit.id !== "string"
        || typeof visit.agentId !== "string"
        || visit.status !== "CHECKED_OUT"
        || (visit.checkInAt !== null && typeof visit.checkInAt !== "string")
        || typeof visit.checkOutAt !== "string"
        || typeof visit.updatedAt !== "string"
      ) return null
    }
    for (const execution of value.executions) {
      if (
        !isRecord(execution)
        || typeof execution.id !== "string"
        || (execution.status !== "RETURNED" && execution.status !== "REJECTED")
        || (typeof execution.actualQuantity !== "string" && typeof execution.actualQuantity !== "number")
        || typeof execution.updatedAt !== "string"
      ) return null
    }
    targets.push({
      ...value,
      planQuantity: String(value.planQuantity),
      executions: value.executions.map((execution) => ({
        ...execution,
        actualQuantity: String(execution.actualQuantity),
      })),
    } as unknown as CaptureTarget)
  }
  return targets
}

function targetsFromPayload(payload: unknown): CaptureTarget[] | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null
  return targetsFromValues(payload.data.targets)
}

function targetIdFor(entry: PharmacyPromotionOutboxEntry): string | null {
  if (entry.kind !== "DRAFT") return null
  const payload = pharmacyPromotionOutboxPayload(entry)
  return "targetId" in payload && typeof payload.targetId === "string" ? payload.targetId : null
}

function localizedName(target: CaptureTarget, locale: string) {
  return locale === "az"
    ? target.promotionVersion.nameAz
    : locale === "en"
      ? target.promotionVersion.nameEn
      : target.promotionVersion.nameRu
}

function targetOptionLabel(target: CaptureTarget, correctionLabel: string) {
  return [
    target.customer.name,
    target.customer.code,
    target.customer.locality,
    target.promotionVersion.promotion.code,
    target.executions[0] ? correctionLabel : null,
  ].filter((value): value is string => Boolean(value)).join(" · ")
}

export function PharmacyPromotionAgentCapture({ scopeKey }: { scopeKey: string }) {
  const t = useTranslations("mtmPharmacyPromotions.agentCapture")
  const promotionT = useTranslations("mtmPharmacyPromotions")
  const commonT = useTranslations("common")
  const locale = useLocale()
  const [targets, setTargets] = useState<CaptureTarget[]>([])
  const [entries, setEntries] = useState<PharmacyPromotionOutboxEntry[]>([])
  const [targetId, setTargetId] = useState("")
  const [visitId, setVisitId] = useState("")
  const [factQuantity, setFactQuantity] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [online, setOnline] = useState(true)
  const [cachedAssignmentsAt, setCachedAssignmentsAt] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const lifecycleRef = useRef(new AbortController())
  const syncingRef = useRef(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError("")
    let cacheAvailable = false
    try {
      const [queued, cached] = await Promise.all([
        listPharmacyPromotionOutboxEntries(scopeKey),
        readPharmacyPromotionTargetCache(scopeKey),
      ])
      if (signal?.aborted) return
      setEntries(queued.filter((entry) => entry.kind === "DRAFT"))
      const cachedTargets = targetsFromValues(cached?.targets)
      if (cachedTargets) {
        cacheAvailable = true
        setTargets(cachedTargets)
        setCachedAssignmentsAt(cached?.updatedAt ?? "")
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) return

      const response = await fetch("/api/v1/mtm/pharmacy-promotion-targets", { cache: "no-store", signal })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(t("loadFailed"))
      const nextTargets = targetsFromPayload(payload)
      if (!nextTargets) throw new Error(t("loadFailed"))
      if (signal?.aborted) return
      setTargets(nextTargets)
      setCachedAssignmentsAt("")
      void writePharmacyPromotionTargetCache(scopeKey, nextTargets).catch(() => undefined)
    } catch (nextError) {
      if (!signal?.aborted) {
        setError(cacheAvailable ? t("loadFailedCached") : nextError instanceof Error ? nextError.message : t("loadFailed"))
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [scopeKey, t])

  const queuedTargetIds = useMemo(() => new Set(entries.map(targetIdFor).filter((value): value is string => Boolean(value))), [entries])
  const availableTargets = useMemo(() => targets.filter((target) => {
    const correction = target.executions[0]
    return (target.status === "PLANNED" || target.status === "CONNECTED")
      && (target._count.executions === 0 || Boolean(correction))
      && !queuedTargetIds.has(target.id)
  }), [queuedTargetIds, targets])
  const selectedTarget = availableTargets.find((target) => target.id === targetId) ?? null
  const selectedCorrection = selectedTarget?.executions[0] ?? null
  const completedVisits = useMemo(() => selectedTarget?.customer.visits.filter((visit) => (
    visit.agentId === selectedTarget.assignedAgentId
  )) ?? [], [selectedTarget])
  const selectedVisit = completedVisits.find((visit) => visit.id === visitId) ?? null
  const visitRequired = Boolean(
    selectedTarget?.promotionVersion.eligibilityDefinition.requireCompletedVisit
    && selectedTarget.eligibilityStatus !== "OVERRIDDEN",
  )

  useEffect(() => {
    const controller = new AbortController()
    lifecycleRef.current.abort()
    lifecycleRef.current = controller
    setTargets([])
    setEntries([])
    setTargetId("")
    setVisitId("")
    setFactQuantity("")
    setConfirmationOpen(false)
    setCachedAssignmentsAt("")
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    if (!targetId || availableTargets.some((target) => target.id === targetId)) return
    setTargetId("")
    setVisitId("")
    setFactQuantity("")
    setConfirmationOpen(false)
  }, [availableTargets, targetId])

  useEffect(() => {
    if (!visitId || completedVisits.some((visit) => visit.id === visitId)) return
    setVisitId("")
    setFactQuantity("")
    setConfirmationOpen(false)
  }, [completedVisits, visitId])

  const sync = useCallback(async () => {
    if (syncingRef.current || typeof navigator === "undefined" || !navigator.onLine) return
    syncingRef.current = true
    setSyncing(true)
    setMessage("")
    setError("")
    try {
      const signal = lifecycleRef.current.signal
      const summary = await flushPharmacyPromotionOutbox({
        scopeKey,
        send: (requests) => sendPharmacyPromotionOutboxRequests(
          requests,
          globalThis.fetch.bind(globalThis),
          { signal },
        ),
      })
      if (!signal.aborted) {
        await load(signal)
        if (summary.errors > 0 || summary.conflicts > 0) setError(t("syncAttention"))
        else setMessage(summary.accepted > 0 ? t("synced", { count: summary.accepted }) : t("queueRetained"))
      }
    } catch (nextError) {
      if (!lifecycleRef.current.signal.aborted) {
        setError(nextError instanceof Error ? nextError.message : t("syncFailed"))
        await load(lifecycleRef.current.signal)
      }
    } finally {
      syncingRef.current = false
      if (!lifecycleRef.current.signal.aborted) setSyncing(false)
    }
  }, [load, scopeKey, t])

  useEffect(() => {
    const connected = () => { setOnline(true); void sync() }
    const disconnected = () => setOnline(false)
    setOnline(navigator.onLine)
    window.addEventListener("online", connected)
    window.addEventListener("offline", disconnected)
    return () => {
      window.removeEventListener("online", connected)
      window.removeEventListener("offline", disconnected)
    }
  }, [sync])

  const queueFact = useCallback(async () => {
    if (!selectedTarget || saving || syncingRef.current || (visitRequired && !selectedVisit)) return
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const normalizedFactQuantity = normalizePharmacyPromotionHumanDecimal18_4(factQuantity)
      if (normalizedFactQuantity === null) throw new Error("factQuantity is invalid")
      const entry = createPharmacyPromotionDraftOperation({
        targetId: selectedTarget.id,
        ...(selectedCorrection ? { supersedesExecutionId: selectedCorrection.id } : {}),
        ...(selectedVisit ? { visitId: selectedVisit.id } : {}),
        factQuantity: normalizedFactQuantity,
        unit: selectedTarget.unit,
        expectedVersion: 0,
      }, { scopeKey })
      await persistPharmacyPromotionOperation(entry)
      setConfirmationOpen(false)
      setFactQuantity("")
      setMessage(t("queued"))
      await load(lifecycleRef.current.signal)
      if (online) await sync()
    } catch (nextError) {
      setError(nextError instanceof Error && nextError.message.includes("factQuantity")
        ? t("quantityInvalid")
        : t("queueFailed"))
    } finally {
      setSaving(false)
    }
  }, [factQuantity, load, online, saving, scopeKey, selectedCorrection, selectedTarget, selectedVisit, sync, t, visitRequired])

  const requestConfirmation = useCallback(() => {
    if (!selectedTarget || saving || syncing || (visitRequired && !selectedVisit)) return
    if (normalizePharmacyPromotionHumanDecimal18_4(factQuantity) === null) {
      setError(t("quantityInvalid"))
      return
    }
    setError("")
    setMessage("")
    setConfirmationOpen(true)
  }, [factQuantity, saving, selectedTarget, selectedVisit, syncing, t, visitRequired])

  const retry = useCallback(async (entry: PharmacyPromotionOutboxEntry) => {
    try {
      await putPharmacyPromotionOutboxEntries([retryPharmacyPromotionOperationNow(entry)])
      await load(lifecycleRef.current.signal)
      await sync()
    } catch {
      setError(t("syncFailed"))
    }
  }, [load, sync, t])

  const discard = useCallback(async (entry: PharmacyPromotionOutboxEntry) => {
    try {
      await removePharmacyPromotionOutboxEntries(scopeKey, [entry.operationId])
      await load(lifecycleRef.current.signal)
    } catch {
      setError(t("queueFailed"))
    }
  }, [load, scopeKey, t])

  return (
    <>
    <section className="border border-sky-200/80 bg-gradient-to-br from-sky-50/80 via-background to-background dark:border-sky-900/70 dark:from-sky-950/25" aria-labelledby="promotion-agent-capture-title">
      <div className="grid gap-4 p-4 lg:p-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,.72fr)]">
        <div>
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-600 text-white"><FilePlus2 className="h-5 w-5" /></span>
            <div className="min-w-0"><h2 id="promotion-agent-capture-title" className="font-semibold tracking-tight">{t("title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p></div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(190px,.75fr)_180px_auto]">
            <label className="space-y-1 text-sm font-medium sm:col-span-2 2xl:col-span-1"><span>{t("target")}</span><Select data-testid="mtm-pharmacy-agent-target-select" value={targetId} onChange={(event) => { setTargetId(event.target.value); setVisitId(""); setFactQuantity(""); setConfirmationOpen(false) }} disabled={loading || availableTargets.length === 0} className="min-h-11"><option value="" disabled={availableTargets.length > 0}>{loading ? commonT("loading") : availableTargets.length === 0 ? t("noTargets") : `— ${t("target")} —`}</option>{availableTargets.map((target) => <option key={target.id} value={target.id}>{targetOptionLabel(target, t("correctionShort"))}</option>)}</Select></label>
            <label className="space-y-1 text-sm font-medium"><span>{t("controlledVisit")}</span><Select data-testid="mtm-pharmacy-agent-visit-select" value={visitId} onChange={(event) => { setVisitId(event.target.value); setFactQuantity(""); setConfirmationOpen(false) }} disabled={!selectedTarget || completedVisits.length === 0 || saving} className="min-h-11"><option value="">{visitRequired ? completedVisits.length > 0 ? `— ${t("controlledVisit")} —` : t("noCompletedVisit") : t("visitOptional")}</option>{completedVisits.map((visit) => <option key={visit.id} value={visit.id}>{t("visitOption", { date: createDateFormatter(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(visit.checkOutAt)) })}</option>)}</Select></label>
            <label className="space-y-1 text-sm font-medium"><span>{t("factQuantity")}</span><Input value={factQuantity} onChange={(event) => setFactQuantity(event.target.value)} inputMode="decimal" placeholder={selectedTarget ? t("planHint", { value: selectedTarget.planQuantity, unit: selectedTarget.unit }) : "—"} disabled={!selectedTarget || saving} className="min-h-11" /></label>
            <div className="flex items-end"><Button type="button" className="min-h-11 w-full 2xl:w-auto" onClick={requestConfirmation} disabled={!selectedTarget || !factQuantity.trim() || (visitRequired && !selectedVisit) || saving || syncing}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FilePlus2 className="mr-2 h-4 w-4" />}{t("save")}</Button></div>
          </div>
          {selectedTarget ? <div data-testid="mtm-pharmacy-agent-selected-target" className="mt-3 rounded-lg border border-sky-200/80 bg-background/85 p-3 dark:border-sky-900/70"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("target")}</p><p className="mt-1 font-semibold">{selectedTarget.customer.name}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{selectedTarget.customer.code ? <span>{promotionT("customerCodeValue", { value: selectedTarget.customer.code })}</span> : null}{selectedTarget.customer.locality ? <span>{promotionT("locality")}: {selectedTarget.customer.locality}</span> : null}<span>{promotionT("campaignCode")}: {selectedTarget.promotionVersion.promotion.code}</span></div><p className="mt-2 text-xs text-muted-foreground">{localizedName(selectedTarget, locale)} · {selectedTarget.promotionVersion.type.code} · {t("planHint", { value: selectedTarget.planQuantity, unit: selectedTarget.unit })} · {t("eligibility", { status: promotionT.has(`eligibilityStatus.${selectedTarget.eligibilityStatus}`) ? promotionT(`eligibilityStatus.${selectedTarget.eligibilityStatus}`) : promotionT("unknownStatus") })}{selectedCorrection ? ` · ${t("correctionFor", { status: promotionT.has(`status.${selectedCorrection.status}`) ? promotionT(`status.${selectedCorrection.status}`) : promotionT("unknownStatus") })}` : ""}</p></div> : null}
          {selectedTarget && visitRequired && !selectedVisit ? <p className="mt-2 flex gap-1.5 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" />{t("completedVisitRequired")}</p> : null}
          {cachedAssignmentsAt ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t("cachedAssignments", { date: createDateFormatter(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(cachedAssignmentsAt)) })}</p> : null}
          {!loading && availableTargets.length === 0 ? <div className="mt-3 flex gap-2 text-sm text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{t("noTargetsHint")}</span></div> : null}
        </div>
        <div className="border-t pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{t("deviceQueue")}</p><p className="text-xs text-muted-foreground">{t("queueCount", { count: entries.length })}</p></div><Button variant="outline" size="sm" className="min-h-11" onClick={() => void sync()} disabled={syncing || entries.length === 0 || !online}><RefreshCw className={syncing ? "mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" : "mr-2 h-4 w-4"} />{t("sync")}</Button></div>
          {entries.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{t("queueEmpty")}</p> : <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">{entries.map((entry) => { const entryTarget = targets.find((target) => target.id === targetIdFor(entry)); return <div key={entry.operationId} className="border bg-background/80 p-2.5 text-xs"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-medium">{entryTarget?.customer.name ?? t("unknownTarget")}</p><p className="mt-0.5 text-muted-foreground">{createDateFormatter(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(entry.queuedAt))}</p></div><Badge variant={entry.status === "conflict" ? "destructive" : entry.status === "error" ? "warning" : "outline"}>{t(`status.${entry.status}`)}</Badge></div>{entry.lastError ? <code className="mt-1 block break-all text-[10px] text-destructive">{entry.lastError}</code> : null}{entry.status === "error" || entry.status === "conflict" ? <div className="mt-2 flex flex-wrap gap-2">{entry.status === "error" ? <Button size="sm" variant="outline" className="min-h-11" onClick={() => void retry(entry)}>{t("retry")}</Button> : null}<Button size="sm" variant="ghost" className="min-h-11" onClick={() => void discard(entry)}>{t("discard")}</Button></div> : null}</div> })}</div>}
          <div className="mt-3 min-h-5 text-xs" aria-live="polite">{error ? <p className="flex gap-1.5 text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</p> : message ? <p className="text-emerald-700 dark:text-emerald-300">{message}</p> : !online ? <p className="flex gap-1.5 text-muted-foreground"><WifiOff className="h-4 w-4 shrink-0" />{t("offline")}</p> : null}</div>
        </div>
      </div>
    </section>
    <Dialog open={confirmationOpen} onOpenChange={(open) => { if (!saving) setConfirmationOpen(open) }} widthClassName="max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("save")}</DialogTitle>
        <DialogDescription>{t("subtitle")}</DialogDescription>
      </DialogHeader>
      <DialogContent className="space-y-4">
        {selectedTarget ? <div data-testid="mtm-pharmacy-agent-confirmation" className="rounded-lg border bg-muted/35 p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden="true" /><div className="min-w-0"><p className="font-semibold">{selectedTarget.customer.name}</p><p className="mt-1 text-sm text-muted-foreground">{targetOptionLabel(selectedTarget, t("correctionShort"))}</p></div></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">{promotionT("promotion")}</dt><dd className="mt-0.5 font-medium">{localizedName(selectedTarget, locale)}</dd></div><div><dt className="text-xs text-muted-foreground">{t("factQuantity")}</dt><dd className="mt-0.5 font-medium">{factQuantity} {selectedTarget.unit}</dd></div><div><dt className="text-xs text-muted-foreground">{promotionT("planQuantity")}</dt><dd className="mt-0.5 font-medium">{selectedTarget.planQuantity} {selectedTarget.unit}</dd></div><div><dt className="text-xs text-muted-foreground">{t("controlledVisit")}</dt><dd className="mt-0.5 font-medium">{selectedVisit ? t("visitOption", { date: createDateFormatter(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(selectedVisit.checkOutAt)) }) : t("visitOptional")}</dd></div></dl></div> : null}
        {error ? <p className="flex gap-1.5 text-sm text-destructive" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</p> : null}
      </DialogContent>
      <DialogFooter className="flex-col-reverse sm:flex-row">
        <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" data-dialog-initial-focus onClick={() => setConfirmationOpen(false)} disabled={saving}>{commonT("cancel")}</Button>
        <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => void queueFact()} disabled={!selectedTarget || saving || syncing}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{commonT("confirm")}</Button>
      </DialogFooter>
    </Dialog>
    </>
  )
}
