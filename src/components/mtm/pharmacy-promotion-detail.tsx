"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calculator,
  ClipboardCheck,
  CheckCircle2,
  Clock3,
  Download,
  FileCheck2,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createPharmacyPromotionEvidenceOperation,
  createPharmacyPromotionSubmitOperation,
  flushPharmacyPromotionOutbox,
  listPharmacyPromotionOutboxEntries,
  persistPharmacyPromotionOperation,
  putPharmacyPromotionOutboxEntries,
  removePharmacyPromotionOutboxEntries,
  retryPharmacyPromotionOperationNow,
  sendPharmacyPromotionOutboxRequests,
  type PharmacyPromotionOutboxEntry,
} from "@/lib/mtm/pharmacy-promotion-outbox"
import { cn } from "@/lib/utils"
import { createDateFormatter } from "@/lib/format-date"

type LocalizedName = { nameRu: string; nameAz: string; nameEn: string }

type DetailEvidence = {
  id: string
  kind: string
  contentHash: string
  capturedAt: string
  submittedByAgent: { id: string; name: string } | null
  document: { id: string; title: string | null; fileName: string; mimeType: string; sizeBytes: number } | null
  downloadUrl: string | null
}

type DetailReview = {
  id: string
  level: "L1" | "L2"
  decision: string
  reason: string | null
  reviewerNameSnapshot: string
  factPointsPreview: string | null
  rewardPointsPreview: string | null
  differencePointsPreview: string | null
  decidedAt: string
}

type DetailLedgerEntry = {
  id: string
  bucket: string
  entryType: string
  delta: string | null
  reason: string | null
  occurredAt: string
}

type DetailEvent = {
  id: string
  eventType: string
  fromState: string | null
  toState: string | null
  occurredAt: string
}

type Detail = {
  id: string
  version: number
  status: string
  l1State: string
  l2State: string
  permissions?: { canSubmit: boolean; canReview: boolean }
  syncScopeKey: string
  employee: { id: string; name: string }
  target: {
    id: string
    status: string
    customer: {
      id: string
      name: string
      code: string | null
      address: string | null
      locality: string | null
      territoryCode: string | null
    }
    contact: { id: string; displayName: string } | null
    team: { id: string; name: string; region: { id: string; name: string } | null } | null
    manager: { id: string; name: string } | null
    planQuantity: string | null
    unit: string
  }
  promotion: LocalizedName & {
    id: string
    revision: number
    promotion: { id: string; code: string }
    type: LocalizedName & { id: string; code: string }
  }
  visit: { id: string; status: string } | null
  factQuantity: string | null
  preview: { factPoints: string | null; rewardPoints: string | null; difference: string | null }
  ledgerTotals: { factPoints: string | null; rewardPoints: string | null; difference: string | null }
  formula: { id: string; code: string; version: number; definitionHash: string }
  approvalPolicy: { id: string; code: string; version: number; definitionHash: string }
  eligibility: { status: string; overridden: boolean; overrideReason: string | null; evaluatedStatus: string; reasons: string[] }
  source: {
    system: string
    reference: string | null
    observedAt: string
    receivedAt: string
    freshness?: { state: string; ageMinutes: number | null }
  }
  policy?: { ready: boolean; blockers: string[]; postingEnabled?: boolean }
  evidence: DetailEvidence[]
  reviews: DetailReview[]
  ledger: DetailLedgerEntry[]
  events: DetailEvent[]
  submittedAt: string | null
  closedAt: string | null
  createdAt: string
}

type OutboxState = "idle" | "queued" | "syncing" | "synced" | "conflict" | "error"

type EvidenceUploadIdentity = {
  fingerprint: string
  clientEvidenceId: string
  clientDocumentId: string
  operationId: string
  capturedAt: string
  title: string
}

type DetailGuidanceInput = Pick<Detail, "status" | "l1State" | "l2State" | "permissions" | "policy">

export function pharmacyPromotionDetailGuidance(detail: DetailGuidanceInput) {
  const nextResponsible = detail.l1State === "READY"
    ? "L1_REVIEWER"
    : detail.l2State === "READY"
      ? "L2_REVIEWER"
      : "NONE"
  const canSubmit = Boolean(detail.permissions?.canSubmit && detail.status === "DRAFT")
  const canReview = Boolean(detail.permissions?.canReview && nextResponsible !== "NONE")

  return {
    canSubmit,
    canReview,
    nextResponsible,
    ready: detail.policy?.ready === true,
    blockers: detail.policy?.ready === false ? detail.policy.blockers : [],
  } as const
}

function safeReturn(value: string | null) {
  if (!value || (value !== "/mtm/promotions" && !value.startsWith("/mtm/promotions?"))) return "/mtm/promotions"
  return value
}

function apiErrorCode(payload: unknown) {
  if (!payload || typeof payload !== "object") return null
  const code = (payload as { code?: unknown }).code
  return typeof code === "string" && code.length > 0 ? code : null
}

function detailFromPayload(payload: unknown): Detail | null {
  if (!payload || typeof payload !== "object") return null
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const candidate = data as Record<string, unknown>
  if (
    typeof candidate.id !== "string"
    || typeof candidate.status !== "string"
    || typeof candidate.syncScopeKey !== "string"
    || candidate.syncScopeKey.length < 16
    || candidate.syncScopeKey.length > 128
    || !candidate.target
    || !candidate.promotion
    || !candidate.eligibility
    || typeof candidate.eligibility !== "object"
    || Array.isArray(candidate.eligibility)
    || !Array.isArray(candidate.evidence)
    || !Array.isArray(candidate.reviews)
    || !Array.isArray(candidate.ledger)
    || !Array.isArray(candidate.events)
  ) return null
  return data as unknown as Detail
}

function localName(value: LocalizedName, locale: string) {
  return locale === "az" ? value?.nameAz : locale === "en" ? value?.nameEn : value?.nameRu
}

function date(value: string | null | undefined, locale: string, withTime = true) {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  return createDateFormatter(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(parsed)
}

function points(value: string | null | undefined, locale: string) {
  if (value == null) return "—"
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (!match) return "—"
  const fraction = (match[3] ?? "").slice(0, 4).replace(/0+$/, "")
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const grouped = formatter.format(BigInt(match[2]))
  const minus = formatter.formatToParts(BigInt(-1)).find((part) => part.type === "minusSign")?.value ?? "-"
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 })
    .formatToParts(1.1)
    .find((part) => part.type === "decimal")?.value ?? "."
  return `${match[1] === "-" ? minus : ""}${grouped}${fraction ? `${decimal}${fraction}` : ""}`
}

function decimalSign(value: string | null) {
  if (!value) return 0
  const normalized = value.trim()
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return 0
  if (/^-0*(?:\.0*)?$/.test(normalized) || /^\+?0*(?:\.0*)?$/.test(normalized)) return 0
  return normalized.startsWith("-") ? -1 : 1
}

function quantity(value: string | null, unit: string, locale: string) {
  const formatted = points(value, locale)
  return formatted === "—" ? formatted : `${formatted} ${unit}`
}

function sha256Hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function variant(status: string) {
  if (status === "APPROVED" || status === "PUBLISHED" || status === "FRESH") return "success" as const
  if (status === "READY" || status === "IN_REVIEW") return "info" as const
  if (status === "RETURNED" || status === "DRAFT" || status === "NOT_READY") return "warning" as const
  if (status === "REJECTED" || status === "REVERSED" || status === "STALE") return "destructive" as const
  return "outline" as const
}

function DetailStatusBadge({ status, label }: { status: string; label: string }) {
  const badgeVariant = variant(status)
  const Icon = badgeVariant === "success"
    ? CheckCircle2
    : badgeVariant === "warning"
      ? AlertTriangle
      : badgeVariant === "destructive"
        ? XCircle
        : badgeVariant === "info"
          ? Clock3
          : ShieldCheck
  return <Badge variant={badgeVariant}><Icon className="mr-1 h-3 w-3" aria-hidden="true" />{label}</Badge>
}

function Metric({ label, value, note, accent }: { label: string; value: string; note?: string; accent?: boolean }) {
  return <div className={cn("min-w-0 border p-3 sm:p-4", accent ? "border-primary/30 bg-primary/5" : "border-zinc-200/70 bg-card dark:border-zinc-800")}><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 break-words text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>{note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}</div>
}

export function PharmacyPromotionDetail({ executionId }: { executionId: string }) {
  const t = useTranslations("mtmPharmacyPromotions")
  const locale = useLocale()
  const params = useSearchParams()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const [outboxState, setOutboxState] = useState<OutboxState>("idle")
  const [outboxEntries, setOutboxEntries] = useState<PharmacyPromotionOutboxEntry[]>([])
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [evidenceTitle, setEvidenceTitle] = useState("")
  const [evidenceUploading, setEvidenceUploading] = useState(false)
  const [evidenceMessage, setEvidenceMessage] = useState("")
  const [evidenceError, setEvidenceError] = useState("")
  const [evidenceInputKey, setEvidenceInputKey] = useState(0)
  const evidenceIdentityRef = useRef<EvidenceUploadIdentity | null>(null)
  const workflowMutationRef = useRef<{ kind: "submit" | "evidence" } | null>(null)
  const transportControllerRef = useRef(new AbortController())
  const returnTo = safeReturn(params.get("returnTo"))

  const projectOutbox = useCallback(async (signal?: AbortSignal) => {
    if (!detail?.syncScopeKey) return []
    const entries = await listPharmacyPromotionOutboxEntries(detail.syncScopeKey, detail.id)
    if (signal?.aborted) return []
    setOutboxEntries(entries)
    if (entries.some((entry) => entry.status === "conflict")) setOutboxState("conflict")
    else if (entries.some((entry) => entry.status === "error")) setOutboxState("error")
    else if (entries.some((entry) => entry.status === "syncing")) setOutboxState("syncing")
    else if (entries.length > 0) setOutboxState("queued")
    else setOutboxState("idle")
    return entries
  }, [detail])

  const flushPendingOperations = useCallback(async () => {
    if (!detail?.syncScopeKey) return
    const signal = transportControllerRef.current.signal
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await projectOutbox(signal)
      return
    }
    setOutboxState("syncing")
    try {
      const summary = await flushPharmacyPromotionOutbox({
        scopeKey: detail.syncScopeKey,
        send: (requests) => sendPharmacyPromotionOutboxRequests(
          requests,
          globalThis.fetch.bind(globalThis),
          { signal },
        ),
      })
      if (signal.aborted) return
      const remaining = await projectOutbox(signal)
      if (summary.accepted > 0) {
        // A successful operation must refresh the server projection even when
        // another queued operation needs explicit recovery.
        setRefresh((value) => value + 1)
      }
      if (remaining.length === 0 && summary.accepted > 0) {
        setOutboxState("synced")
      }
    } catch {
      if (!signal.aborted) setOutboxState("error")
    }
  }, [detail, projectOutbox])

  const submitForReview = useCallback(async () => {
    if (
      !detail?.permissions?.canSubmit
      || detail.status !== "DRAFT"
      || detail.policy?.ready !== true
      || loading
      || Boolean(error)
      || evidenceUploading
      || outboxEntries.length > 0
      || outboxState === "synced"
      || workflowMutationRef.current
    ) return
    const mutation = { kind: "submit" as const }
    const signal = transportControllerRef.current.signal
    workflowMutationRef.current = mutation
    try {
      const entry = createPharmacyPromotionSubmitOperation({
        clientExecutionId: detail.id,
        expectedVersion: detail.version,
      }, {
        scopeKey: detail.syncScopeKey,
      })
      await persistPharmacyPromotionOperation(entry)
      if (signal.aborted || workflowMutationRef.current !== mutation) return
      await projectOutbox(signal)
      if (signal.aborted || workflowMutationRef.current !== mutation) return
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setOutboxState("queued")
        return
      }
      await flushPendingOperations()
    } catch {
      if (!signal.aborted && workflowMutationRef.current === mutation) setOutboxState("error")
    } finally {
      if (workflowMutationRef.current === mutation) workflowMutationRef.current = null
    }
  }, [detail, error, evidenceUploading, flushPendingOperations, loading, outboxEntries.length, outboxState, projectOutbox])

  const retryOutbox = useCallback(async () => {
    const signal = transportControllerRef.current.signal
    try {
      const retryable = outboxEntries
        .filter((entry) => entry.status === "error")
        .map((entry) => retryPharmacyPromotionOperationNow(entry))
      if (retryable.length === 0) return
      await putPharmacyPromotionOutboxEntries(retryable)
      if (signal.aborted) return
      await projectOutbox(signal)
      if (signal.aborted) return
      await flushPendingOperations()
    } catch {
      if (!signal.aborted) setOutboxState("error")
    }
  }, [flushPendingOperations, outboxEntries, projectOutbox])

  const resolveOutboxConflict = useCallback(async () => {
    if (!detail?.syncScopeKey) return
    const signal = transportControllerRef.current.signal
    try {
      const conflicts = outboxEntries
        .filter((entry) => entry.status === "conflict")
        .map((entry) => entry.operationId)
      if (conflicts.length === 0) return
      await removePharmacyPromotionOutboxEntries(detail.syncScopeKey, conflicts)
      if (signal.aborted) return
      await projectOutbox(signal)
      if (signal.aborted) return
      setRefresh((value) => value + 1)
    } catch {
      if (!signal.aborted) setOutboxState("error")
    }
  }, [detail?.syncScopeKey, outboxEntries, projectOutbox])

  const uploadEvidence = useCallback(async () => {
    if (
      !detail?.permissions?.canSubmit
      || detail.status !== "DRAFT"
      || !evidenceFile
      || evidenceUploading
      || loading
      || Boolean(error)
      || outboxEntries.length > 0
      || outboxState === "syncing"
      || outboxState === "synced"
      || workflowMutationRef.current
    ) return
    const mutation = { kind: "evidence" as const }
    const signal = transportControllerRef.current.signal
    workflowMutationRef.current = mutation
    setEvidenceUploading(true)
    setEvidenceError("")
    setEvidenceMessage("")
    try {
      if (evidenceFile.size < 1 || evidenceFile.size > 25 * 1024 * 1024) {
        throw new Error(t("evidenceFileInvalid"))
      }
      const fileBuffer = await evidenceFile.arrayBuffer()
      if (signal.aborted || workflowMutationRef.current !== mutation) return
      const checksumSha256 = sha256Hex(await crypto.subtle.digest("SHA-256", fileBuffer))
      if (signal.aborted || workflowMutationRef.current !== mutation) return
      const fingerprint = `${evidenceFile.name}:${evidenceFile.size}:${evidenceFile.lastModified}:${checksumSha256}`
      let identity = evidenceIdentityRef.current
      if (!identity || identity.fingerprint !== fingerprint) {
        const capturedAt = new Date(evidenceFile.lastModified)
        identity = {
          fingerprint,
          clientEvidenceId: `ppe_${crypto.randomUUID()}`,
          clientDocumentId: `ppd_${crypto.randomUUID()}`,
          operationId: `ppo_${crypto.randomUUID()}`,
          capturedAt: Number.isNaN(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 5 * 60_000
            ? new Date().toISOString()
            : capturedAt.toISOString(),
          title: evidenceTitle.trim(),
        }
        evidenceIdentityRef.current = identity
      }
      const entry = createPharmacyPromotionEvidenceOperation({
        clientExecutionId: detail.id,
        clientEvidenceId: identity.clientEvidenceId,
        clientDocumentId: identity.clientDocumentId,
        capturedAt: identity.capturedAt,
        checksumSha256,
        fileName: evidenceFile.name,
        title: identity.title,
        file: evidenceFile,
      }, {
        scopeKey: detail.syncScopeKey,
        operationId: identity.operationId,
      })
      await persistPharmacyPromotionOperation(entry)
      if (signal.aborted || workflowMutationRef.current !== mutation) return
      evidenceIdentityRef.current = null
      setEvidenceFile(null)
      setEvidenceTitle("")
      setEvidenceInputKey((value) => value + 1)
      setEvidenceMessage(t("evidenceQueued"))
      await projectOutbox(signal)
      if (signal.aborted || workflowMutationRef.current !== mutation) return
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setOutboxState("queued")
        return
      }
      await flushPendingOperations()
    } catch (nextError) {
      if (!signal.aborted && workflowMutationRef.current === mutation) {
        if (evidenceIdentityRef.current) setEvidenceTitle(evidenceIdentityRef.current.title)
        setEvidenceError(nextError instanceof Error ? nextError.message : t("evidenceUploadFailed"))
      }
    } finally {
      if (workflowMutationRef.current === mutation) {
        workflowMutationRef.current = null
        if (!signal.aborted) setEvidenceUploading(false)
      }
    }
  }, [detail, error, evidenceFile, evidenceTitle, evidenceUploading, flushPendingOperations, loading, outboxEntries.length, outboxState, projectOutbox, t])

  const stateLabel = (status: string | null) => status && t.has(`status.${status}`)
    ? t(`status.${status}`)
    : status
      ? t("unknownStatus")
      : t("noState")
  const blockerLabel = (code: string) => t.has(`blocker.${code}`)
    ? t(`blocker.${code}`)
    : t("unknownBlocker")

  useEffect(() => {
    const controller = new AbortController()
    transportControllerRef.current.abort()
    transportControllerRef.current = controller
    workflowMutationRef.current = null
    setDetail(null)
    setLoading(true)
    setOutboxState("idle")
    setOutboxEntries([])
    evidenceIdentityRef.current = null
    setEvidenceFile(null)
    setEvidenceTitle("")
    setEvidenceUploading(false)
    setEvidenceError("")
    setEvidenceMessage("")
    setEvidenceInputKey((value) => value + 1)
    return () => controller.abort()
  }, [executionId])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(`/api/v1/mtm/pharmacy-promotion-executions/${encodeURIComponent(executionId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          const code = apiErrorCode(payload)
          throw new Error(code && t.has(`error.${code}`) ? t(`error.${code}`) : t("detailLoadFailed"))
        }
        const nextDetail = detailFromPayload(payload)
        if (!nextDetail) throw new Error(t("detailLoadFailed"))
        setDetail(nextDetail)
        setOutboxState((current) => current === "synced" ? "idle" : current)
      })
      .catch((nextError) => { if (!controller.signal.aborted) setError(nextError instanceof Error ? nextError.message : t("detailLoadFailed")) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [executionId, refresh, t])

  useEffect(() => {
    if (!detail?.syncScopeKey) return
    const flushIfOnline = () => {
      if (navigator.onLine) void flushPendingOperations()
      else void projectOutbox(transportControllerRef.current.signal)
    }
    flushIfOnline()
    window.addEventListener("online", flushIfOnline)
    const interval = window.setInterval(flushIfOnline, 30_000)
    return () => {
      window.removeEventListener("online", flushIfOnline)
      window.clearInterval(interval)
    }
  }, [detail?.syncScopeKey, flushPendingOperations, projectOutbox])

  if (loading && !detail) return <div className="grid min-h-[60vh] place-items-center"><div className="text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary motion-reduce:animate-none" /><p className="mt-3 text-sm text-muted-foreground">{t("loading")}</p></div></div>
  if (error && !detail) return <div className="mx-auto grid min-h-[60vh] max-w-xl place-items-center p-6 text-center"><div><XCircle className="mx-auto h-9 w-9 text-red-500" /><h1 className="mt-3 text-xl font-semibold">{t("detailLoadFailed")}</h1><p className="mt-2 text-sm text-muted-foreground">{error}</p><div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row"><Button className="min-h-11" asChild variant="outline"><Link href={returnTo}><ArrowLeft className="mr-2 h-4 w-4" />{t("backToRegistry")}</Link></Button><Button className="min-h-11" onClick={() => setRefresh((value) => value + 1)}>{t("retry")}</Button></div></div></div>
  if (!detail) return null

  const posted = detail.ledgerTotals.factPoints !== null || detail.ledgerTotals.rewardPoints !== null
  const visiblePoints = posted ? detail.ledgerTotals : detail.preview
  const guidance = pharmacyPromotionDetailGuidance(detail)
  const submitDisabled = !guidance.ready
    || loading
    || Boolean(error)
    || evidenceUploading
    || outboxState === "syncing"
    || outboxState === "synced"
    || outboxEntries.length > 0
  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-3 sm:p-5 lg:p-6">
      <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link href={returnTo} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground lg:min-h-10"><ArrowLeft className="h-4 w-4" />{t("backToRegistry")}</Link>
          <div className="mt-2 flex flex-wrap items-center gap-2"><DetailStatusBadge status={detail.status} label={stateLabel(detail.status)} /><DetailStatusBadge status={detail.l1State} label={`L1 · ${stateLabel(detail.l1State)}`} /><DetailStatusBadge status={detail.l2State} label={`L2 · ${stateLabel(detail.l2State)}`} /></div>
          <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-3xl">{detail.target.customer.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{localName(detail.promotion, locale)} · {detail.promotion.promotion.code} · v{detail.promotion.revision}</p>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="min-h-11 lg:min-h-9" variant="outline" onClick={() => setRefresh((value) => value + 1)} disabled={loading}><RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin motion-reduce:animate-none")} />{t("refresh")}</Button>
          </div>
          {outboxState !== "idle" ? <div className={cn("max-w-md text-xs", outboxState === "conflict" || outboxState === "error" ? "text-destructive" : "text-muted-foreground")} aria-live="polite"><p>{t(`outbox.${outboxState}`)} {outboxEntries.length > 0 ? t("outbox.count", { count: outboxEntries.length }) : null}</p>{outboxEntries[0]?.lastError ? <code className="mt-1 block break-all text-[10px]">{outboxEntries[0].lastError}</code> : null}<div className="mt-2 flex flex-wrap justify-end gap-2">{outboxState === "error" ? <Button size="sm" variant="outline" className="min-h-11" onClick={() => void retryOutbox()}>{t("outbox.retry")}</Button> : null}{outboxState === "conflict" ? <Button size="sm" variant="outline" className="min-h-11" onClick={() => void resolveOutboxConflict()}>{t("outbox.resolveConflict")}</Button> : null}</div></div> : null}
        </div>
      </header>

      {error ? <div className="flex flex-col gap-3 border border-red-200 bg-red-50 p-3 text-sm text-red-950 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-100 sm:flex-row sm:items-center sm:justify-between" role="alert"><span>{t("detailLoadFailed")}: {error}</span><Button className="min-h-11 shrink-0" variant="outline" onClick={() => setRefresh((value) => value + 1)}>{t("retry")}</Button></div> : null}

      <section
        className={cn(
          "border p-4 sm:p-5",
          guidance.canSubmit && !guidance.ready
            ? "border-amber-200 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/20"
            : "border-primary/25 bg-primary/[0.035]",
        )}
        aria-labelledby="mtm-pharmacy-promotion-next-step-title"
        data-testid="mtm-pharmacy-promotion-next-step"
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="flex min-w-0 gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center bg-background text-primary ring-1 ring-inset ring-border" aria-hidden="true">
              <FileCheck2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("nextResponsibleLabel")}</p>
              <h2 id="mtm-pharmacy-promotion-next-step-title" className="mt-1 text-lg font-semibold">
                {guidance.canSubmit
                  ? guidance.ready
                    ? t("submitForReview")
                    : t("notReady")
                  : t(`nextResponsible.${guidance.nextResponsible}`)}
              </h2>
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground">{t("executionStatus")}</dt>
                  <dd className="font-medium">{stateLabel(detail.status)}</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground">{t("reviewLevel")}</dt>
                  <dd className="font-medium">L1 {stateLabel(detail.l1State)} · L2 {stateLabel(detail.l2State)}</dd>
                </div>
              </dl>
              {guidance.blockers.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("notReady")}>
                  {guidance.blockers.map((blocker) => (
                    <li key={blocker} className="bg-background px-2.5 py-1 text-xs font-medium text-amber-950 ring-1 ring-inset ring-amber-200 dark:text-amber-100 dark:ring-amber-900/70">
                      {blockerLabel(blocker)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
          {guidance.canSubmit ? (
            <Button
              className="min-h-11 w-full md:w-auto"
              onClick={() => void submitForReview()}
              disabled={submitDisabled}
            >
              <FileCheck2 className="mr-2 h-4 w-4" />
              {t("submitForReview")}
            </Button>
          ) : guidance.canReview ? (
            <Button className="min-h-11 w-full md:w-auto" asChild>
              <Link href="/mtm/promotions?view=review">
                <ClipboardCheck className="mr-2 h-4 w-4" />
                {t("openReviewQueue")}
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Metric label={t("planQuantity")} value={quantity(detail.target.planQuantity, detail.target.unit, locale)} note={t("immutableSnapshot")} />
        <Metric label={t("factQuantity")} value={quantity(detail.factQuantity, detail.target.unit, locale)} note={t("sourceFact")} />
        <Metric label={t("summary.fact")} value={points(visiblePoints.factPoints, locale)} note={posted ? t("postedLedger") : t("previewOnly")} accent />
        <Metric label={t("summary.reward")} value={points(visiblePoints.rewardPoints, locale)} note={posted ? t("postedLedger") : t("previewOnly")} accent />
        <Metric label={t("summary.difference")} value={points(visiblePoints.difference, locale)} note={posted ? t("postedLedger") : t("previewOnly")} accent />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
        <div className="space-y-5">
          <section className="border border-zinc-200/70 bg-card dark:border-zinc-800">
            <header className="flex items-center gap-2 border-b px-4 py-3"><Building2 className="h-4 w-4 text-primary" /><h2 className="font-semibold">{t("pharmacyAndExecution")}</h2></header>
            <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">{t("pharmacy")}</dt><dd className="mt-1 font-medium">{detail.target.customer.name}</dd><dd className="text-xs text-muted-foreground">{detail.target.customer.code ? t("customerCodeValue", { value: detail.target.customer.code }) : t("noRegistration")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("address")}</dt><dd className="mt-1">{detail.target.customer.address || detail.target.customer.locality || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("employee")}</dt><dd className="mt-1 font-medium">{detail.employee.name}</dd><dd className="text-xs text-muted-foreground">{t("userGroupValue", { value: detail.target.team?.name || "—" })}<br />{t("managerValue", { value: detail.target.manager?.name || "—" })}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("contact")}</dt><dd className="mt-1">{detail.target.contact?.displayName || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("controlledVisit")}</dt><dd className="mt-1">{detail.visit ? <Link className="inline-flex min-h-11 items-center font-medium text-primary hover:underline lg:min-h-0" href={`/mtm/visits?visitId=${encodeURIComponent(detail.visit.id)}`}>{t.has(`visitStatus.${detail.visit.status}`) ? t(`visitStatus.${detail.visit.status}`) : t("unknownStatus")}</Link> : t("notLinked")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("timestamps")}</dt><dd className="mt-1 text-xs">{t("createdAt")}: {date(detail.createdAt, locale)}<br />{t("submittedAt")}: {date(detail.submittedAt, locale)}<br />{t("closedAt")}: {date(detail.closedAt, locale)}</dd></div>
            </dl>
          </section>

          <section className="border border-zinc-200/70 bg-card dark:border-zinc-800">
            <header className="flex items-center justify-between gap-3 border-b px-4 py-3"><span className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-primary" /><h2 className="font-semibold">{t("evidence")}</h2></span><Badge variant="outline">{detail.evidence.length}</Badge></header>
            {detail.permissions?.canSubmit && detail.status === "DRAFT" ? <div className="border-b bg-muted/20 p-4"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,.6fr)_auto] sm:items-end"><label className="space-y-1 text-sm font-medium"><span>{t("evidenceFile")}</span><input key={evidenceInputKey} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp,.zip" disabled={evidenceUploading || loading || Boolean(error) || outboxEntries.length > 0 || outboxState === "syncing" || outboxState === "synced"} className="block min-h-11 w-full cursor-pointer border bg-background px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-transparent file:font-medium" onChange={(event) => { setEvidenceFile(event.target.files?.[0] ?? null); evidenceIdentityRef.current = null; setEvidenceError(""); setEvidenceMessage("") }} /></label><label className="space-y-1 text-sm font-medium"><span>{t("evidenceTitle")}</span><Input value={evidenceTitle} maxLength={200} disabled={evidenceUploading || loading || Boolean(error) || outboxEntries.length > 0 || outboxState === "syncing" || outboxState === "synced"} className="min-h-11" onChange={(event) => setEvidenceTitle(event.target.value)} /></label><Button className="min-h-11" disabled={!evidenceFile || evidenceUploading || loading || Boolean(error) || outboxEntries.length > 0 || outboxState === "syncing" || outboxState === "synced"} onClick={() => void uploadEvidence()}>{evidenceUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FileCheck2 className="mr-2 h-4 w-4" />}{t("evidenceUpload")}</Button></div><p className="mt-2 text-xs text-muted-foreground">{t("evidenceFileHint")}</p><div className="mt-2 min-h-5 text-xs" aria-live="polite">{evidenceError ? <p className="text-destructive">{evidenceError}</p> : evidenceMessage ? <p className="text-emerald-700 dark:text-emerald-300">{evidenceMessage}</p> : null}</div></div> : null}
            {detail.evidence.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{t("noEvidence")}</p> : <div className="divide-y">{detail.evidence.map((item) => <div key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words font-medium">{item.document?.title || item.document?.fileName || (t.has(`evidenceKind.${item.kind}`) ? t(`evidenceKind.${item.kind}`) : t("unknownEvidence"))}</p><p className="mt-1 break-all text-xs text-muted-foreground">{date(item.capturedAt, locale)} · SHA-256 {item.contentHash.slice(0, 12)}… · {item.submittedByAgent?.name || "—"}</p></div>{item.downloadUrl ? <Button className="min-h-11 shrink-0 lg:min-h-8" asChild variant="outline" size="sm"><a href={item.downloadUrl}><Download className="mr-2 h-4 w-4" />{t("downloadEvidence")}</a></Button> : null}</div>)}</div>}
          </section>

          <section className="border border-zinc-200/70 bg-card dark:border-zinc-800">
            <header className="flex items-center gap-2 border-b px-4 py-3"><History className="h-4 w-4 text-primary" /><h2 className="font-semibold">{t("auditTimeline")}</h2></header>
            {detail.events.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{t("noEvents")}</p> : <div className="relative divide-y">
              {detail.events.map((event) => <div key={event.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[150px_1fr_auto]"><span className="text-xs text-muted-foreground">{date(event.occurredAt, locale)}</span><div><p className="text-sm font-medium">{t.has(`event.${event.eventType}`) ? t(`event.${event.eventType}`) : t("unknownEvent")}</p><p className="text-xs text-muted-foreground">{stateLabel(event.fromState)} → {stateLabel(event.toState)}</p></div><Clock3 className="hidden h-4 w-4 text-muted-foreground sm:block" /></div>)}
            </div>}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="border border-zinc-200/70 bg-card dark:border-zinc-800">
            <header className="flex items-center gap-2 border-b px-4 py-3"><ShieldCheck className="h-4 w-4 text-primary" /><h2 className="font-semibold">{t("governance")}</h2></header>
            <dl className="space-y-4 p-4 text-sm">
              <div><dt className="text-xs text-muted-foreground">{t("formula")}</dt><dd className="mt-1 font-medium">{detail.formula.code} · v{detail.formula.version}</dd><dd className="break-all font-mono text-[10px] text-muted-foreground">{detail.formula.definitionHash}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("approvalPolicy")}</dt><dd className="mt-1 font-medium">{detail.approvalPolicy.code} · v{detail.approvalPolicy.version}</dd><dd className="break-all font-mono text-[10px] text-muted-foreground">{detail.approvalPolicy.definitionHash}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("eligibilityLabel")}</dt><dd className="mt-1 flex flex-wrap items-center gap-2 font-medium"><span>{t.has(`eligibilityStatus.${detail.eligibility.status}`) ? t(`eligibilityStatus.${detail.eligibility.status}`) : t("unknownStatus")}</span>{detail.eligibility.overridden ? <Badge variant="warning">{t("eligibilityOverrideActive")}</Badge> : null}</dd>{detail.eligibility.overrideReason ? <dd className="mt-1 break-words text-xs text-muted-foreground">{t("eligibilityOverrideReason", { reason: detail.eligibility.overrideReason })}</dd> : null}</div>
              <div><dt className="text-xs text-muted-foreground">{t("source")}</dt><dd className="mt-1 flex flex-wrap items-center gap-2 font-medium"><span>{t.has(`sourceSystem.${detail.source.system}`) ? t(`sourceSystem.${detail.source.system}`) : t("unknownSource")}</span>{detail.source.freshness ? <DetailStatusBadge status={detail.source.freshness.state} label={t.has(`freshness.${detail.source.freshness.state}`) ? t(`freshness.${detail.source.freshness.state}`) : t("freshness.UNKNOWN")} /> : null}</dd><dd className="text-xs text-muted-foreground">{detail.source.reference || "—"}<br />{t("sourceObservedAt", { date: date(detail.source.observedAt, locale) })}<br />{t("sourceReceivedAt", { date: date(detail.source.receivedAt, locale) })}{detail.source.freshness?.ageMinutes !== null && detail.source.freshness?.ageMinutes !== undefined ? <><br />{t("freshnessAge", { minutes: detail.source.freshness.ageMinutes })}</> : null}</dd></div>
            </dl>
            {detail.policy && !detail.policy.ready ? <div className="m-4 mt-0 flex gap-2 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><XCircle className="h-4 w-4 shrink-0" /><span>{detail.policy.blockers.map(blockerLabel).join(" · ")}</span></div> : null}
          </section>

          <section className="border border-zinc-200/70 bg-card dark:border-zinc-800">
            <header className="flex items-center gap-2 border-b px-4 py-3"><UserRound className="h-4 w-4 text-primary" /><h2 className="font-semibold">{t("reviews")}</h2></header>
            {detail.reviews.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{t("noReviews")}</p> : <div className="divide-y">{detail.reviews.map((review) => <div key={review.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><DetailStatusBadge status={review.decision} label={`${review.level} · ${t.has(`decision.${review.decision}`) ? t(`decision.${review.decision}`) : t("unknownDecision")}`} /><span className="text-xs text-muted-foreground">{date(review.decidedAt, locale)}</span></div><p className="mt-2 text-sm font-medium">{review.reviewerNameSnapshot}</p>{review.reason ? <p className="mt-1 break-words text-sm text-muted-foreground">{review.reason}</p> : null}<p className="mt-2 text-xs tabular-nums text-muted-foreground">{t("factShort")} {points(review.factPointsPreview, locale)} · {t("rewardShort")} {points(review.rewardPointsPreview, locale)} · Δ {points(review.differencePointsPreview, locale)}</p></div>)}</div>}
          </section>

          <section className="border border-zinc-200/70 bg-card dark:border-zinc-800">
            <header className="flex items-center gap-2 border-b px-4 py-3"><Calculator className="h-4 w-4 text-primary" /><h2 className="font-semibold">{t("ledger")}</h2></header>
            {detail.ledger.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">{t("ledgerEmpty")}</p> : <div className="divide-y">{detail.ledger.map((entry) => { const sign = decimalSign(entry.delta); return <div key={entry.id} className="flex items-start justify-between gap-3 p-4"><div><p className="text-sm font-medium">{t.has(`ledgerBucket.${entry.bucket}`) ? t(`ledgerBucket.${entry.bucket}`) : t("unknownLedgerBucket")}</p><p className="mt-1 text-xs text-muted-foreground">{t.has(`ledgerEntry.${entry.entryType}`) ? t(`ledgerEntry.${entry.entryType}`) : t("unknownLedgerEntry")} · {date(entry.occurredAt, locale)}</p>{entry.reason ? <p className="mt-1 break-words text-xs text-muted-foreground">{entry.reason}</p> : null}</div><span className={cn("font-semibold tabular-nums", sign < 0 ? "text-red-600" : sign > 0 ? "text-emerald-600" : "text-muted-foreground")}>{sign > 0 ? "+" : ""}{points(entry.delta, locale)}</span></div> })}</div>}
          </section>
        </aside>
      </div>
    </div>
  )
}
