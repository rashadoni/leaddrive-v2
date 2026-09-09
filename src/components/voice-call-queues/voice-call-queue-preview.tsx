"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ListOrdered,
  Loader2,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"

export interface QueuePreviewLead {
  id: string
  contactName: string
  assignedTo: string | null
}

interface EligibleLead {
  leadId: string
  position: number
}

interface ExcludedGroup {
  code: string
  count: number
}

interface QueuePreviewData {
  requestedCount: number
  eligible: EligibleLead[]
  excludedGroups: ExcludedGroup[]
  blockers: string[]
}

type PreviewPhase = "loading" | "ready" | "creating" | "error"

const MAX_SELECTED_LEADS = 100

const EXCLUSION_KEY_BY_CODE = {
  no_phone: "exclusionNoPhone",
  invalid_phone: "exclusionNoPhone",
  voice_opt_out: "exclusionOptOut",
  opted_out: "exclusionOptOut",
  suppressed: "exclusionOptOut",
  consent_revoked: "exclusionOptOut",
  consent_required: "exclusionConsent",
  outside_calling_hours: "exclusionOutsideHours",
  voice_calling_hours_unconfigured: "exclusionOutsideHours",
  active_call_exists: "exclusionAlreadyQueued",
  active_or_queued_call: "exclusionAlreadyQueued",
  already_queued: "exclusionAlreadyQueued",
  duplicate_phone: "exclusionAlreadyQueued",
  connected_before: "exclusionConnectedBefore",
  already_connected: "exclusionConnectedBefore",
  phone_conversation_exists: "exclusionConnectedBefore",
  not_assigned: "exclusionOwnership",
  inaccessible: "exclusionOwnership",
  reassigned: "exclusionOwnership",
  lead_inactive: "exclusionInactive",
  user_limit_reached: "exclusionLimit",
  organization_limit_reached: "exclusionLimit",
  rate_limit_reached: "exclusionLimit",
  budget_limit_reached: "exclusionLimit",
  provider_unavailable: "exclusionUnavailable",
  voice_queue_disabled: "exclusionUnavailable",
} as const

type ExclusionTranslationKey =
  | (typeof EXCLUSION_KEY_BY_CODE)[keyof typeof EXCLUSION_KEY_BY_CODE]
  | "exclusionGeneric"

function normalizeCode(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_")
}

export function queueExclusionTranslationKey(code: string): ExclusionTranslationKey {
  const normalized = normalizeCode(code)
  return EXCLUSION_KEY_BY_CODE[normalized as keyof typeof EXCLUSION_KEY_BY_CODE]
    ?? "exclusionGeneric"
}

export function isVoiceQueueDisabledCode(value: unknown): boolean {
  if (typeof value !== "string") return false
  const code = normalizeCode(value)
  return code === "voice_queue_disabled" || code === "feature_disabled"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function normalizePreviewPayload(payload: unknown): QueuePreviewData | null {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) return null
  const data = payload.data
  if (!Array.isArray(data.eligible)) return null

  const eligible = data.eligible.flatMap((value): EligibleLead[] => {
    if (!isRecord(value) || typeof value.leadId !== "string") return []
    const position = typeof value.position === "number" && Number.isFinite(value.position)
      ? Math.max(1, Math.floor(value.position))
      : 1
    return [{ leadId: value.leadId, position }]
  }).sort((a, b) => a.position - b.position)

  const excluded = Array.isArray(data.excluded) ? data.excluded : []
  const fallbackCounts = new Map<string, number>()
  for (const value of excluded) {
    if (!isRecord(value) || typeof value.code !== "string") continue
    fallbackCounts.set(value.code, (fallbackCounts.get(value.code) ?? 0) + 1)
  }

  const excludedGroups = Array.isArray(data.excludedGroups)
    ? data.excludedGroups.flatMap((value): ExcludedGroup[] => {
        if (!isRecord(value) || typeof value.code !== "string") return []
        const count = typeof value.count === "number" && Number.isFinite(value.count)
          ? Math.max(0, Math.floor(value.count))
          : 0
        return count > 0 ? [{ code: value.code, count }] : []
      })
    : Array.from(fallbackCounts, ([code, count]) => ({ code, count }))

  const requestedCount = typeof data.requestedCount === "number" && Number.isFinite(data.requestedCount)
    ? Math.max(0, Math.floor(data.requestedCount))
    : eligible.length + excludedGroups.reduce((sum, group) => sum + group.count, 0)

  return {
    requestedCount,
    eligible,
    excludedGroups,
    blockers: stringArray(data.blockers),
  }
}

function responseCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  if (typeof payload.code === "string") return payload.code
  const blockers = stringArray(payload.blockers)
  return blockers[0] ?? null
}

function requestHeaders(organizationId?: string): Record<string, string> {
  return organizationId ? { "x-organization-id": organizationId } : {}
}

export function VoiceCallQueuePreview({
  leads,
  organizationId,
  onClose,
  onCreated,
}: {
  leads: QueuePreviewLead[]
  organizationId?: string
  onClose: () => void
  onCreated: (queueId: string) => void
}) {
  const t = useTranslations("voiceCallQueue")
  const [phase, setPhase] = useState<PreviewPhase>("loading")
  const [preview, setPreview] = useState<QueuePreviewData | null>(null)
  const [queueDisabled, setQueueDisabled] = useState(false)
  const [consentConfirmed, setConsentConfirmed] = useState(false)
  const [errorKind, setErrorKind] = useState<"generic" | "tooMany" | "mixedOwners">("generic")
  const abortRef = useRef<AbortController | null>(null)
  const requestVersionRef = useRef(0)
  const idempotencyKeyRef = useRef(crypto.randomUUID())
  const consentId = useId()

  const selectionKey = useMemo(() => leads.map((lead) => lead.id).join(","), [leads])
  const leadById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads])
  const ownerUserId = useMemo(() => {
    const assignedOwners = Array.from(new Set(
      leads.map((lead) => lead.assignedTo).filter((value): value is string => Boolean(value)),
    ))
    return assignedOwners.length === 1 ? assignedOwners[0] : undefined
  }, [leads])
  const hasMixedOwners = useMemo(() => new Set(
    leads.map((lead) => lead.assignedTo).filter((value): value is string => Boolean(value)),
  ).size > 1, [leads])

  const abortPending = useCallback(() => {
    requestVersionRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const loadPreview = useCallback(async () => {
    abortPending()
    setPreview(null)
    setQueueDisabled(false)

    if (leads.length > MAX_SELECTED_LEADS) {
      setErrorKind("tooMany")
      setPhase("error")
      return
    }
    if (hasMixedOwners) {
      setErrorKind("mixedOwners")
      setPhase("error")
      return
    }

    const controller = new AbortController()
    const requestVersion = requestVersionRef.current
    abortRef.current = controller
    setErrorKind("generic")
    setPhase("loading")

    try {
      const response = await fetch("/api/v1/voice-call-queues/preview", {
        method: "POST",
        headers: {
          ...requestHeaders(organizationId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leadIds: leads.map((lead) => lead.id),
          ...(ownerUserId ? { ownerUserId } : {}),
        }),
        cache: "no-store",
        signal: controller.signal,
      })
      const payload: unknown = await response.json().catch(() => ({}))
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return

      const normalized = normalizePreviewPayload(payload)
      if (!response.ok || !normalized) {
        if (isVoiceQueueDisabledCode(responseCode(payload))) setQueueDisabled(true)
        setPhase("error")
        return
      }

      setPreview(normalized)
      setQueueDisabled(normalized.blockers.some(isVoiceQueueDisabledCode))
      setPhase("ready")
    } catch {
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return
      setPhase("error")
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [abortPending, hasMixedOwners, leads, organizationId, ownerUserId])

  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID()
    setConsentConfirmed(false)
    void loadPreview()
    return abortPending
  }, [abortPending, loadPreview, selectionKey])

  const createQueue = async () => {
    if (phase !== "ready" || !preview || preview.eligible.length === 0 || queueDisabled || !consentConfirmed) return
    abortPending()
    const controller = new AbortController()
    const requestVersion = requestVersionRef.current
    abortRef.current = controller
    setPhase("creating")

    try {
      const response = await fetch("/api/v1/voice-call-queues", {
        method: "POST",
        headers: {
          ...requestHeaders(organizationId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leadIds: leads.map((lead) => lead.id),
          ...(ownerUserId ? { ownerUserId } : {}),
          idempotencyKey: idempotencyKeyRef.current,
          consentConfirmed: true,
        }),
        signal: controller.signal,
      })
      const payload: unknown = await response.json().catch(() => ({}))
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return

      if (!response.ok) {
        if (isVoiceQueueDisabledCode(responseCode(payload))) {
          setQueueDisabled(true)
          setPhase("ready")
          return
        }
        setErrorKind("generic")
        setPhase("error")
        return
      }

      if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
        setPhase("error")
        return
      }
      const queue = payload.data.queue
      if (!isRecord(queue) || typeof queue.id !== "string") {
        setPhase("error")
        return
      }
      onCreated(queue.id)
    } catch {
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return
      setErrorKind("generic")
      setPhase("error")
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const excludedCount = preview?.excludedGroups.reduce((sum, group) => sum + group.count, 0) ?? 0
  const visibleOrder = preview?.eligible.slice(0, 8) ?? []
  const hiddenOrderCount = Math.max(0, (preview?.eligible.length ?? 0) - visibleOrder.length)

  return (
    <section
      aria-labelledby="voice-call-queue-preview-title"
      className="rounded-xl border border-zinc-200 bg-card dark:border-zinc-700"
    >
      <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-4 py-4 dark:border-zinc-700 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ListOrdered aria-hidden="true" className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 id="voice-call-queue-preview-title" className="text-base font-semibold text-foreground">
              {t("previewTitle")}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              {t("sequencePromise")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closePreview")}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </header>

      <div className="p-4 sm:p-5">
        {phase === "loading" ? (
          <div role="status" aria-live="polite" aria-busy="true" className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              {t("previewLoading")}
            </div>
            <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-16 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
              ))}
            </div>
          </div>
        ) : null}

        {phase === "error" ? (
          <div role="alert" className="flex flex-col gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-semibold">{t("previewErrorTitle")}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {errorKind === "tooMany"
                    ? t("selectionLimit", { count: MAX_SELECTED_LEADS })
                    : errorKind === "mixedOwners"
                      ? t("singleOwnerRequired")
                      : t("previewErrorDescription")}
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => void loadPreview()} className="min-h-11 shrink-0">
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {t("retry")}
            </Button>
          </div>
        ) : null}

        {(phase === "ready" || phase === "creating") && preview ? (
          <div className="space-y-5">
            <div className="grid grid-cols-3 divide-x divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
              <div className="px-3 py-3 sm:px-4">
                <p className="text-lg font-semibold tabular-nums">{preview.requestedCount}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("selectedCount")}</p>
              </div>
              <div className="px-3 py-3 sm:px-4">
                <p className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{preview.eligible.length}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("eligibleCount")}</p>
              </div>
              <div className="px-3 py-3 sm:px-4">
                <p className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400">{excludedCount}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("excludedCount")}</p>
              </div>
            </div>

            {queueDisabled ? (
              <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
                <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{t("featureDisabledTitle")}</p>
                  <p className="mt-1 text-sm leading-6">{t("featureDisabledDescription")}</p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
              <div>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{t("orderTitle")}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("orderHint")}</p>
                  </div>
                  <Clock3 aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                {visibleOrder.length > 0 ? (
                  <ol className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                    {visibleOrder.map((item) => {
                      const lead = leadById.get(item.leadId)
                      return (
                        <li key={item.leadId} className="flex min-h-11 items-center gap-3 px-3 py-2.5">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                            {item.position}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {lead?.contactName || t("leadPosition", { position: item.position })}
                          </span>
                          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </li>
                      )
                    })}
                    {hiddenOrderCount > 0 ? (
                      <li className="px-3 py-2.5 text-center text-xs text-muted-foreground">
                        {t("moreInOrder", { count: hiddenOrderCount })}
                      </li>
                    ) : null}
                  </ol>
                ) : (
                  <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center dark:border-zinc-700">
                    <p className="text-sm font-medium">{t("noneEligibleTitle")}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("noneEligibleDescription")}</p>
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold">{t("exclusionsTitle")}</h3>
                {preview.excludedGroups.length > 0 ? (
                  <ul className="space-y-2">
                    {preview.excludedGroups.map((group) => (
                      <li key={group.code} className="flex items-start justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
                        <span className="text-sm leading-5 text-muted-foreground">
                          {t(queueExclusionTranslationKey(group.code))}
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{group.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100">
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="text-sm">{t("noExclusions")}</p>
                  </div>
                )}
              </div>
            </div>

            <label
              htmlFor={consentId}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 transition-colors hover:bg-muted/30 dark:border-zinc-700"
            >
              <input
                id={consentId}
                type="checkbox"
                checked={consentConfirmed}
                onChange={(event) => setConsentConfirmed(event.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
              />
              <span className="text-sm leading-6">
                {t("consentLabel")}
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {t("consentHint")}
                </span>
              </span>
            </label>

            <footer className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
                {t("eligibilityRecheck")}
              </p>
              <Button
                type="button"
                onClick={() => void createQueue()}
                disabled={phase === "creating" || preview.eligible.length === 0 || queueDisabled || !consentConfirmed}
                className="min-h-11 w-full shrink-0 sm:w-auto"
              >
                {phase === "creating"
                  ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  : <PhoneCall aria-hidden="true" className="h-4 w-4" />}
                {phase === "creating" ? t("creating") : t("createQueue")}
              </Button>
            </footer>
          </div>
        ) : null}
      </div>
    </section>
  )
}
