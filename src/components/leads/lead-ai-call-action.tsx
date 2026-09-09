"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Loader2,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type Phase = "idle" | "checking" | "ready" | "blocked" | "starting" | "accepted" | "error"

interface PreflightData {
  eligible: boolean
  blockers: string[]
  requiresConsentConfirmation: boolean
  limits: {
    userRemaining: number | null
    organizationRemaining: number | null
  }
  schedule?: unknown
  canResolveUnknownCall?: boolean
}

interface PreflightResponse {
  success?: boolean
  data?: PreflightData
}

interface StartResponse {
  success?: boolean
  data?: {
    status?: string
    replayed?: boolean
  }
  code?: string
  error?: string
  blockers?: string[]
}

const BLOCKER_KEY_BY_CODE = {
  manual_ai_calls_disabled: "blockerFeatureDisabled",
  manual_lead_ai_calls_disabled: "blockerFeatureDisabled",
  feature_disabled: "blockerFeatureDisabled",
  voice_agent_disabled: "blockerVoiceAgentDisabled",
  voice_calling_hours_unconfigured: "blockerHoursUnconfigured",
  outside_calling_hours: "blockerOutsideHours",
  no_phone: "blockerNoPhone",
  invalid_phone: "blockerNoPhone",
  phone_changed: "blockerConsentRequired",
  voice_opt_out: "blockerOptOut",
  suppressed: "blockerOptOut",
  consent_revoked: "blockerOptOut",
  consent_required: "blockerConsentRequired",
  active_call_exists: "blockerActiveCall",
  active_or_queued_call: "blockerActiveCall",
  provider_unavailable: "blockerProviderUnavailable",
  no_active_voip: "blockerProviderUnavailable",
  provider_not_ready: "blockerProviderUnavailable",
  voice_bridge_unavailable: "blockerProviderUnavailable",
  user_limit_reached: "blockerLimitReached",
  organization_limit_reached: "blockerLimitReached",
  rate_limit_reached: "blockerLimitReached",
  budget_limit_reached: "blockerBudgetReached",
  lead_inactive: "blockerLeadInactive",
  not_assigned: "blockerNotAssigned",
  inaccessible: "blockerNotAssigned",
} as const

type BlockerTranslationKey = (typeof BLOCKER_KEY_BY_CODE)[keyof typeof BLOCKER_KEY_BY_CODE] | "blockerGeneric"

function normalizeBlockerCode(code: string): string {
  return code.trim().toLowerCase().replace(/[\s-]+/g, "_")
}

export function aiCallBlockerTranslationKey(code: string): BlockerTranslationKey {
  const normalized = normalizeBlockerCode(code)
  return BLOCKER_KEY_BY_CODE[normalized as keyof typeof BLOCKER_KEY_BY_CODE] ?? "blockerGeneric"
}

function isKnownBlockerCode(code: unknown): code is string {
  return typeof code === "string" && aiCallBlockerTranslationKey(code) !== "blockerGeneric"
}

function isPreflightData(value: unknown): value is PreflightData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  const limits = data.limits
  return typeof data.eligible === "boolean"
    && Array.isArray(data.blockers)
    && data.blockers.every((blocker) => typeof blocker === "string")
    && typeof data.requiresConsentConfirmation === "boolean"
    && !!limits
    && typeof limits === "object"
    && !Array.isArray(limits)
    && (
      (limits as Record<string, unknown>).userRemaining === null
      || Number.isFinite((limits as Record<string, unknown>).userRemaining)
    )
    && (
      (limits as Record<string, unknown>).organizationRemaining === null
      || Number.isFinite((limits as Record<string, unknown>).organizationRemaining)
    )
    && (
      data.canResolveUnknownCall === undefined
      || data.canResolveUnknownCall === true
    )
}

function remainingAttempts(limits: PreflightData["limits"]): number | null {
  const values = [limits.userRemaining, limits.organizationRemaining]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((value) => Math.max(0, Math.floor(value)))
  return values.length > 0 ? Math.min(...values) : null
}

function requestHeaders(organizationId?: string): Record<string, string> {
  return organizationId ? { "x-organization-id": organizationId } : {}
}

export function LeadAiCallAction({
  leadId,
  organizationId,
  className,
}: {
  leadId: string
  organizationId?: string
  className?: string
}) {
  const t = useTranslations("leads.aiCall")
  const consentId = useId()
  const unknownResolutionId = useId()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [preflight, setPreflight] = useState<PreflightData | null>(null)
  const [blockers, setBlockers] = useState<string[]>([])
  const [consentConfirmed, setConsentConfirmed] = useState(false)
  const [unknownResolutionConfirmed, setUnknownResolutionConfirmed] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const requestVersionRef = useRef(0)
  const idempotencyKeyRef = useRef<string | null>(null)
  const previousLeadIdRef = useRef(leadId)
  const previousOrganizationIdRef = useRef(organizationId)

  const abortPendingRequest = useCallback(() => {
    requestVersionRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  useEffect(() => () => abortPendingRequest(), [abortPendingRequest])

  useEffect(() => {
    if (
      previousLeadIdRef.current === leadId
      && previousOrganizationIdRef.current === organizationId
    ) return
    previousLeadIdRef.current = leadId
    previousOrganizationIdRef.current = organizationId
    abortPendingRequest()
    setOpen(false)
    setPhase("idle")
    setPreflight(null)
    setBlockers([])
    setConsentConfirmed(false)
    setUnknownResolutionConfirmed(false)
    idempotencyKeyRef.current = null
  }, [abortPendingRequest, leadId, organizationId])

  const checkEligibility = async () => {
    abortPendingRequest()
    const requestVersion = requestVersionRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setPhase("checking")
    setPreflight(null)
    setBlockers([])

    try {
      const response = await fetch(`/api/v1/leads/${encodeURIComponent(leadId)}/ai-call`, {
        method: "GET",
        headers: requestHeaders(organizationId),
        cache: "no-store",
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({} as PreflightResponse)) as PreflightResponse
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return

      if (response.status === 404) {
        setBlockers(["not_assigned"])
        setPhase("blocked")
        return
      }

      if (!response.ok || payload.success !== true || !isPreflightData(payload.data)) {
        setPhase("error")
        return
      }

      const next = payload.data
      setPreflight(next)
      setBlockers(Array.isArray(next.blockers) ? next.blockers : [])
      setPhase(next.eligible ? "ready" : "blocked")
    } catch {
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return
      setPhase("error")
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const openPreflight = () => {
    setOpen(true)
    setConsentConfirmed(false)
    setUnknownResolutionConfirmed(false)
    idempotencyKeyRef.current = crypto.randomUUID()
    void checkEligibility()
  }

  const closeDialog = () => {
    if (phase === "starting") return
    abortPendingRequest()
    setOpen(false)
    setPhase("idle")
    setPreflight(null)
    setBlockers([])
    setConsentConfirmed(false)
    setUnknownResolutionConfirmed(false)
    idempotencyKeyRef.current = null
  }

  const startCall = async () => {
    if (phase !== "ready" || !consentConfirmed || !idempotencyKeyRef.current) return
    abortPendingRequest()
    const requestVersion = requestVersionRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setPhase("starting")

    try {
      const response = await fetch(`/api/v1/leads/${encodeURIComponent(leadId)}/ai-call`, {
        method: "POST",
        headers: {
          ...requestHeaders(organizationId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyRef.current,
          consentConfirmed: true,
        }),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({} as StartResponse)) as StartResponse
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return

      if (response.status === 404) {
        setBlockers(["not_assigned"])
        setPhase("blocked")
        return
      }

      if (payload.success === true && response.ok && payload.data) {
        setPhase("accepted")
        return
      }

      const structuredBlockers = Array.isArray(payload.blockers)
        ? payload.blockers.filter(isKnownBlockerCode)
        : []
      const structuredCode = isKnownBlockerCode(payload.code)
        ? payload.code
        : isKnownBlockerCode(payload.error)
          ? payload.error
          : null
      if (structuredBlockers.length > 0 || structuredCode) {
        setBlockers(structuredBlockers.length > 0 ? structuredBlockers : [structuredCode!])
        setPhase("blocked")
        return
      }

      setPhase("error")
    } catch {
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return
      setPhase("error")
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const resolveUnknownCall = async () => {
    if (phase !== "blocked" || !preflight?.canResolveUnknownCall || !unknownResolutionConfirmed) return
    abortPendingRequest()
    const requestVersion = requestVersionRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setPhase("starting")

    try {
      const response = await fetch(`/api/v1/leads/${encodeURIComponent(leadId)}/ai-call/resolve-unknown`, {
        method: "POST",
        headers: {
          ...requestHeaders(organizationId),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resolution: "unknown_no_redial",
          acknowledgeNoRedial: true,
        }),
        signal: controller.signal,
      })
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return
      if (!response.ok) {
        setPhase("error")
        return
      }
      setUnknownResolutionConfirmed(false)
      await checkEligibility()
    } catch {
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return
      setPhase("error")
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const uniqueBlockerKeys = Array.from(new Set(
    (blockers.length > 0 ? blockers : ["unknown"]).map(aiCallBlockerTranslationKey),
  ))
  const remaining = preflight ? remainingAttempts(preflight.limits) : null

  return (
    <>
      <Button
        type="button"
        onClick={openPreflight}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn("min-h-11 w-full gap-2 sm:w-auto lg:min-h-9", className)}
      >
        <PhoneCall aria-hidden="true" className="h-4 w-4" />
        {t("action")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return
          closeDialog()
        }}
        hideClose={phase === "starting"}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <DialogContent className="space-y-4">
          {phase === "checking" ? (
            <div role="status" aria-live="polite" aria-busy="true" className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                {t("checking")}
              </div>
              <div className="h-16 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" aria-hidden="true" />
            </div>
          ) : null}

          {phase === "ready" && preflight ? (
            <>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold">{t("ready")}</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">{t("singleAttemptHint")}</p>
                    {remaining !== null ? (
                      <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                        <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
                        {t("remainingToday", { count: remaining })}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <label
                htmlFor={consentId}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30"
              >
                <input
                  id={consentId}
                  type="checkbox"
                  checked={consentConfirmed}
                  onChange={(event) => setConsentConfirmed(event.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                />
                <span className="text-sm leading-relaxed">
                  {t("consentLabel")}
                  {preflight.requiresConsentConfirmation ? (
                    <span className="mt-1 block text-xs text-muted-foreground">{t("consentRequiredHint")}</span>
                  ) : null}
                </span>
              </label>
            </>
          ) : null}

          {phase === "blocked" ? (
            <div className="space-y-3">
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div className="min-w-0 space-y-2">
                    <p className="text-sm font-semibold">{t("blockedTitle")}</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
                      {uniqueBlockerKeys.map((key) => <li key={key}>{t(key)}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
              {preflight?.canResolveUnknownCall ? (
                <label
                  htmlFor={unknownResolutionId}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3"
                >
                  <input
                    id={unknownResolutionId}
                    type="checkbox"
                    checked={unknownResolutionConfirmed}
                    onChange={(event) => setUnknownResolutionConfirmed(event.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                  />
                  <span className="text-sm leading-relaxed">{t("unknownResolutionConsent")}</span>
                </label>
              ) : null}
            </div>
          ) : null}

          {phase === "starting" ? (
            <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-24 items-center gap-3 rounded-lg border bg-muted/30 p-4">
              <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none" />
              <p className="text-sm font-medium">{t("starting")}</p>
            </div>
          ) : null}

          {phase === "accepted" ? (
            <div role="status" aria-live="polite" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-100">
              <div className="flex items-start gap-3">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{t("acceptedTitle")}</p>
                  <p className="text-sm leading-relaxed">{t("acceptedDescription")}</p>
                </div>
              </div>
            </div>
          ) : null}

          {phase === "error" ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{t("errorTitle")}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{t("errorDescription")}</p>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>

        {phase !== "checking" ? (
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={phase === "starting"}
              className="min-h-11 w-full sm:w-auto"
            >
              {phase === "accepted" ? t("close") : t("cancel")}
            </Button>
            {phase === "ready" ? (
              <Button
                type="button"
                onClick={() => void startCall()}
                disabled={!consentConfirmed}
                className="min-h-11 w-full gap-2 sm:w-auto"
              >
                <PhoneCall aria-hidden="true" className="h-4 w-4" />
                {t("start")}
              </Button>
            ) : null}
            {phase === "blocked" || phase === "error" ? (
              preflight?.canResolveUnknownCall && phase === "blocked" ? (
                <Button
                  type="button"
                  onClick={() => void resolveUnknownCall()}
                  disabled={!unknownResolutionConfirmed}
                  className="min-h-11 w-full gap-2 sm:w-auto"
                >
                  <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                  {t("unknownResolutionAction")}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void checkEligibility()}
                  className="min-h-11 w-full gap-2 sm:w-auto"
                >
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                  {t("retry")}
                </Button>
              )
            ) : null}
          </DialogFooter>
        ) : null}
      </Dialog>
    </>
  )
}
