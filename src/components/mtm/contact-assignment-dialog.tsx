"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, UserMinus, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { ContactTransferAgent } from "@/components/mtm/contact-transfer-dialog"

type AssignmentIssue =
  | "CONTACT_NOT_AVAILABLE"
  | "CONTACT_INACTIVE"
  | "TARGET_AGENT_UNAVAILABLE"
  | "TARGET_ALREADY_ASSIGNED"
  | "NO_PRIMARY_ASSIGNMENT"
  | "MULTIPLE_PRIMARY_OWNERS"
  | "FUTURE_ASSIGNMENT_CONFLICT"
  | "OPEN_VISIT_CONFLICT"
  | "ROUTE_PLAN_CONFLICT"

type AssignmentRow = {
  contactId: string
  displayName: string | null
  issues: AssignmentIssue[]
  assignable: boolean
}

type AssignmentPreview = {
  previewToken: string
  effectiveFrom: string
  targetAgent: ContactTransferAgent | null
  summary: {
    selected: number
    assignable: number
    excluded: number
    unassigned: number
    openVisitConflicts: number
    routePlanConflicts: number
    changed?: number
  }
  rows: AssignmentRow[]
}

export type ContactAssignmentResult = {
  summary: AssignmentPreview["summary"] & { changed: number }
  excluded: AssignmentRow[]
}

type Step = "PARAMETERS" | "PREVIEW" | "RESULT"

function localDateKey(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export function ContactAssignmentDialog({
  open,
  onOpenChange,
  mode,
  contactIds,
  agents,
  asOf,
  initialTargetAgentId,
  defaultReason,
  onCompleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "ASSIGN" | "UNASSIGN"
  contactIds: string[]
  agents: ContactTransferAgent[]
  asOf: string
  initialTargetAgentId?: string
  defaultReason?: string
  onCompleted: (result: ContactAssignmentResult) => void
}) {
  const t = useTranslations("mtmContactExplorer.assignment")
  const [step, setStep] = useState<Step>("PARAMETERS")
  const [targetAgentId, setTargetAgentId] = useState(initialTargetAgentId ?? "")
  const [effectiveFrom, setEffectiveFrom] = useState(asOf || localDateKey())
  const [reason, setReason] = useState(defaultReason ?? "")
  const [preview, setPreview] = useState<AssignmentPreview | null>(null)
  const [result, setResult] = useState<ContactAssignmentResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [idempotencyKey, setIdempotencyKey] = useState("")

  const targetAgents = useMemo(
    () => agents.filter((agent) => agent.status === "ACTIVE"),
    [agents],
  )

  const reset = () => {
    setStep("PARAMETERS")
    setTargetAgentId(mode === "ASSIGN" ? initialTargetAgentId ?? "" : "")
    setEffectiveFrom(asOf || localDateKey())
    setReason(defaultReason ?? "")
    setPreview(null)
    setResult(null)
    setError("")
    setIdempotencyKey("")
  }

  useEffect(() => {
    if (!open) return
    setStep("PARAMETERS")
    setTargetAgentId(mode === "ASSIGN" ? initialTargetAgentId ?? "" : "")
    setEffectiveFrom(asOf || localDateKey())
    setReason(defaultReason ?? "")
    setPreview(null)
    setResult(null)
    setError("")
    setIdempotencyKey("")
  }, [asOf, defaultReason, initialTargetAgentId, mode, open])

  const close = () => {
    if (busy) return
    reset()
    onOpenChange(false)
  }

  const buildPreview = async () => {
    setError("")
    if (mode === "ASSIGN" && !targetAgentId) {
      setError(t("targetRequired"))
      return
    }
    if (reason.trim().length < 3) {
      setError(t("reasonRequired"))
      return
    }
    setBusy(true)
    try {
      const response = await fetch("/api/v1/mtm/contact-assignments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          contactIds,
          mode,
          targetAgentId: mode === "ASSIGN" ? targetAgentId : null,
          effectiveFrom,
          reason: reason.trim(),
        }),
      })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: AssignmentPreview
      } | null
      if (!response.ok || !body?.success || !body.data) {
        throw new Error(body?.error || t("previewFailed"))
      }
      setPreview(body.data)
      setIdempotencyKey(crypto.randomUUID())
      setStep("PREVIEW")
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : t("previewFailed"))
    } finally {
      setBusy(false)
    }
  }

  const execute = async () => {
    if (!preview) return
    setError("")
    setBusy(true)
    try {
      const response = await fetch("/api/v1/mtm/contact-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          contactIds,
          mode,
          targetAgentId: mode === "ASSIGN" ? targetAgentId : null,
          effectiveFrom,
          reason: reason.trim(),
          previewToken: preview.previewToken,
          idempotencyKey,
        }),
      })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        code?: string
        data?: ContactAssignmentResult
      } | null
      if (!response.ok || !body?.success || !body.data) {
        if (body?.code === "MTM_CONTACT_ASSIGNMENT_STALE_PREVIEW"
          || body?.code === "MTM_CONTACT_ASSIGNMENT_CONFLICT") {
          setStep("PARAMETERS")
          setPreview(null)
          setIdempotencyKey("")
        }
        throw new Error(body?.error || t("applyFailed"))
      }
      setResult(body.data)
      setStep("RESULT")
      onCompleted(body.data)
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : t("applyFailed"))
    } finally {
      setBusy(false)
    }
  }

  const ModeIcon = mode === "ASSIGN" ? UserPlus : UserMinus

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()} widthClassName="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{mode === "ASSIGN" ? t("assignTitle") : t("unassignTitle")}</DialogTitle>
        <DialogDescription>
          {step === "PARAMETERS"
            ? t("parametersDescription", { count: contactIds.length })
            : step === "PREVIEW"
              ? t("previewDescription")
              : t("resultDescription")}
        </DialogDescription>
      </DialogHeader>
      <DialogContent className="space-y-4">
        {step === "PARAMETERS" ? (
          <>
            <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">{t("identityBoundaryTitle")}</p>
                  <p className="mt-0.5 text-xs opacity-80">{t("identityBoundaryDescription")}</p>
                </div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {mode === "ASSIGN" ? (
                <div>
                  <Label htmlFor="contact-assignment-target">{t("targetAgent")}</Label>
                  <Select
                    id="contact-assignment-target"
                    value={targetAgentId}
                    onChange={(event) => setTargetAgentId(event.target.value)}
                    className="mt-1.5 min-h-11"
                  >
                    <option value="">{t("chooseTarget")}</option>
                    {targetAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <div>
                <Label htmlFor="contact-assignment-date">{t("effectiveFrom")}</Label>
                <input
                  id="contact-assignment-date"
                  type="date"
                  value={effectiveFrom}
                  min={asOf || undefined}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                  className="mt-1.5 min-h-11 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="contact-assignment-reason">{t("reason")}</Label>
              <Textarea
                id="contact-assignment-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                className="mt-1.5 resize-y"
                placeholder={t("reasonPlaceholder")}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("previewHint")}</p>
            </div>
          </>
        ) : null}

        {step === "PREVIEW" && preview ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Summary label={t("selected")} value={preview.summary.selected} />
              <Summary label={t("canChange")} value={preview.summary.assignable} tone="positive" />
              <Summary label={t("excluded")} value={preview.summary.excluded} tone={preview.summary.excluded ? "warning" : "neutral"} />
              <Summary label={t("planConflicts")} value={preview.summary.routePlanConflicts} tone={preview.summary.routePlanConflicts ? "warning" : "neutral"} />
            </div>
            {mode === "ASSIGN" ? (
              <div className="rounded-lg border border-zinc-200 bg-muted/30 p-3 text-sm dark:border-zinc-700">
                {t("newOwner")}: <span className="font-medium">{preview.targetAgent?.name || "—"}</span>
                <span className="float-right text-xs text-muted-foreground">{preview.effectiveFrom}</span>
              </div>
            ) : null}
            {preview.summary.excluded > 0 ? (
              <div>
                <h3 className="text-sm font-semibold">{t("excludedContacts")}</h3>
                <div className="mt-2 max-h-56 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                  {preview.rows.filter((row) => !row.assignable).map((row) => (
                    <div key={row.contactId} className="p-3 text-sm">
                      <p className="font-medium">{row.displayName || row.contactId}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {row.issues.map((issue) => (
                          <span key={issue} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                            {t(`issues.${issue}`)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100">
                <CheckCircle2 className="h-4 w-4" />
                {t("noConflicts")}
              </div>
            )}
          </>
        ) : null}

        {step === "RESULT" && result ? (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">{t("completedTitle")}</p>
              <p className="mt-1 text-sm">{t("completedDescription", {
                changed: result.summary.changed,
                excluded: result.summary.excluded,
              })}</p>
            </div>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </DialogContent>
      <DialogFooter>
        {step === "PARAMETERS" ? (
          <>
            <Button type="button" variant="outline" onClick={close} disabled={busy}>{t("cancel")}</Button>
            <Button type="button" onClick={() => void buildPreview()} disabled={busy || contactIds.length === 0}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />}
              {busy ? t("buildingPreview") : t("review")}
            </Button>
          </>
        ) : step === "PREVIEW" ? (
          <>
            <Button type="button" variant="outline" onClick={() => { setStep("PARAMETERS"); setError("") }} disabled={busy}>
              {t("changeParameters")}
            </Button>
            <Button type="button" onClick={() => void execute()} disabled={busy || !preview || preview.summary.assignable === 0}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ModeIcon className="mr-1 h-4 w-4" />}
              {busy ? t("applying") : t("apply", { count: preview?.summary.assignable ?? 0 })}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={close}>{t("close")}</Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}

function Summary({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: number
  tone?: "positive" | "warning" | "neutral"
}) {
  return (
    <div className={`rounded-lg border p-3 ${
      tone === "positive"
        ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20"
        : tone === "warning"
          ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20"
          : "border-zinc-200 bg-muted/30 dark:border-zinc-700"
    }`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
