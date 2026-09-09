"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, ArrowRight, CheckCircle2, HardDriveDownload, Loader2, ShieldCheck } from "lucide-react"
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
import {
  contactTransferReceiptFromResult,
  saveContactTransferReceipt,
  type ContactTransferReceipt,
} from "@/lib/mtm/contact-transfer-receipt"

export type ContactTransferAgent = {
  id: string
  name: string
  role: string
  status: string
}

type TransferIssue =
  | "CONTACT_NOT_AVAILABLE"
  | "CONTACT_INACTIVE"
  | "SOURCE_AGENT_UNAVAILABLE"
  | "TARGET_AGENT_UNAVAILABLE"
  | "SAME_AGENT"
  | "OWNER_CHANGED"
  | "MULTIPLE_PRIMARY_OWNERS"
  | "TARGET_ALREADY_ASSIGNED"
  | "FUTURE_ASSIGNMENT_CONFLICT"
  | "OPEN_VISIT_CONFLICT"
  | "ROUTE_PLAN_CONFLICT"

type TransferPreview = {
  previewToken: string
  effectiveFrom: string
  sourceAgent: ContactTransferAgent | null
  targetAgent: ContactTransferAgent | null
  warnings: string[]
  summary: {
    selected: number
    transferable: number
    excluded: number
    openVisitConflicts: number
    routePlanConflicts: number
    openTasks: number
    contactsWithOpenTasks: number
    transferred?: number
  }
  rows: Array<{
    contactId: string
    displayName: string | null
    issues: TransferIssue[]
    transferable: boolean
    openVisitCount: number
    plannedRouteCount: number
    openTaskCount: number
  }>
}

type TransferResult = {
  operationId: string
  effectiveFrom: string
  sourceAgent: ContactTransferAgent | null
  targetAgent: ContactTransferAgent | null
  summary: TransferPreview["summary"] & { transferred: number }
  excluded: TransferPreview["rows"]
}

type Step = "PARAMETERS" | "PREVIEW" | "RESULT"

function localDateKey(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export function ContactTransferDialog({
  open,
  onOpenChange,
  contactIds,
  sourceAgentId,
  agents,
  asOf,
  syncScopeKey,
  onCompleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactIds: string[]
  sourceAgentId: string
  agents: ContactTransferAgent[]
  asOf: string
  syncScopeKey: string
  onCompleted: (receipt: ContactTransferReceipt, storedOnDevice: boolean) => void
}) {
  const tt = useTranslations("mtmContactExplorer")
  const [step, setStep] = useState<Step>("PARAMETERS")
  const [targetAgentId, setTargetAgentId] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState(asOf || localDateKey())
  const [reason, setReason] = useState("")
  const [preview, setPreview] = useState<TransferPreview | null>(null)
  const [result, setResult] = useState<TransferResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [idempotencyKey, setIdempotencyKey] = useState("")
  const [receiptStored, setReceiptStored] = useState<boolean | null>(null)

  const sourceAgent = agents.find((agent) => agent.id === sourceAgentId) ?? null
  const targetAgents = useMemo(
    () => agents.filter((agent) => agent.id !== sourceAgentId && agent.status === "ACTIVE"),
    [agents, sourceAgentId],
  )

  const reset = () => {
    setStep("PARAMETERS")
    setTargetAgentId("")
    setEffectiveFrom(asOf || localDateKey())
    setReason("")
    setPreview(null)
    setResult(null)
    setError("")
    setIdempotencyKey("")
    setReceiptStored(null)
  }

  const close = () => {
    if (busy) return
    reset()
    onOpenChange(false)
  }

  const buildPreview = async () => {
    setError("")
    if (!sourceAgentId) {
      setError(tt("transfer.sourceRequired"))
      return
    }
    if (!targetAgentId) {
      setError(tt("transfer.targetRequired"))
      return
    }
    setBusy(true)
    try {
      const response = await fetch("/api/v1/mtm/contact-transfers/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ contactIds, sourceAgentId, targetAgentId, effectiveFrom }),
      })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: TransferPreview
      } | null
      if (!response.ok || !body?.success || !body.data) throw new Error(body?.error || tt("transfer.previewFailed"))
      setPreview(body.data)
      setIdempotencyKey(crypto.randomUUID())
      setStep("PREVIEW")
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : tt("transfer.previewFailed"))
    } finally {
      setBusy(false)
    }
  }

  const execute = async () => {
    if (!preview) return
    if (reason.trim().length < 3) {
      setError(tt("transfer.reasonRequired"))
      return
    }
    setError("")
    setBusy(true)
    try {
      const response = await fetch("/api/v1/mtm/contact-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          contactIds,
          sourceAgentId,
          targetAgentId,
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
        data?: TransferResult
      } | null
      if (!response.ok || !body?.success || !body.data) {
        if (body?.code === "MTM_CONTACT_TRANSFER_STALE_PREVIEW" || body?.code === "MTM_CONTACT_TRANSFER_CONFLICT") {
          setStep("PARAMETERS")
          setPreview(null)
          setIdempotencyKey("")
        }
        throw new Error(body?.error || tt("transfer.applyFailed"))
      }
      const receipt = contactTransferReceiptFromResult(syncScopeKey, body.data)
      const storedOnDevice = await saveContactTransferReceipt(receipt)
      setResult(body.data)
      setReceiptStored(storedOnDevice)
      setStep("RESULT")
      onCompleted(receipt, storedOnDevice)
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : tt("transfer.applyFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()} widthClassName="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{tt("transfer.title")}</DialogTitle>
        <DialogDescription>
          {step === "PARAMETERS"
            ? tt("transfer.parametersDescription", { count: contactIds.length })
            : step === "PREVIEW"
              ? tt("transfer.previewDescription")
              : tt("transfer.resultDescription")}
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        <div data-testid="mtm-contact-transfer-dialog" className="space-y-4">
          {step === "PARAMETERS" ? (
          <>
            <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">{tt("transfer.identityBoundaryTitle")}</p>
                  <p className="mt-0.5 text-xs opacity-80">{tt("transfer.identityBoundaryDescription")}</p>
                </div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>{tt("transfer.sourceAgent")}</Label>
                <div className="mt-1.5 flex min-h-10 items-center rounded-md border border-zinc-200 bg-muted/40 px-3 text-sm dark:border-zinc-700">
                  {sourceAgent?.name || tt("transfer.sourceMissing")}
                </div>
              </div>
              <div>
                <Label htmlFor="contact-transfer-target">{tt("transfer.targetAgent")}</Label>
                <Select
                  id="contact-transfer-target"
                  value={targetAgentId}
                  onChange={(event) => setTargetAgentId(event.target.value)}
                  className="mt-1.5 min-h-11"
                >
                  <option value="">{tt("transfer.chooseTarget")}</option>
                  {targetAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="contact-transfer-date">{tt("transfer.effectiveFrom")}</Label>
                <input
                  id="contact-transfer-date"
                  type="date"
                  value={effectiveFrom}
                  min={asOf || undefined}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                  className="mt-1.5 min-h-11 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{tt("transfer.previewHint")}</p>
          </>
        ) : null}

        {step === "PREVIEW" && preview ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Summary label={tt("transfer.selected")} value={preview.summary.selected} />
              <Summary label={tt("transfer.transferable")} value={preview.summary.transferable} tone="positive" />
              <Summary label={tt("transfer.excluded")} value={preview.summary.excluded} tone={preview.summary.excluded ? "warning" : "neutral"} />
              <Summary label={tt("transfer.openTasks")} value={preview.summary.openTasks} tone={preview.summary.openTasks ? "warning" : "neutral"} />
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-muted/30 p-3 text-sm dark:border-zinc-700">
              <span className="font-medium">{preview.sourceAgent?.name || "—"}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{preview.targetAgent?.name || "—"}</span>
              <span className="ml-auto text-xs text-muted-foreground">{preview.effectiveFrom}</span>
            </div>
            {preview.warnings.length > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
                {preview.warnings.map((warning) => <p key={warning}>{tt(`transfer.warnings.${warning}`)}</p>)}
              </div>
            ) : null}
            {preview.summary.openTasks > 0 ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100">
                <p className="font-medium">{tt("transfer.openTaskImpactTitle")}</p>
                <p className="mt-1 text-xs opacity-80">{tt("transfer.openTaskImpactDescription", {
                  tasks: preview.summary.openTasks,
                  contacts: preview.summary.contactsWithOpenTasks,
                })}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {preview.rows.filter((row) => row.openTaskCount > 0).map((row) => (
                    <span key={row.contactId} className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-900 dark:bg-sky-900/30 dark:text-sky-100">
                      {row.displayName || row.contactId}: {row.openTaskCount}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {preview.summary.excluded > 0 ? (
              <div>
                <h3 className="text-sm font-semibold">{tt("transfer.excludedContacts")}</h3>
                <div className="mt-2 max-h-56 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                  {preview.rows.filter((row) => !row.transferable).map((row) => (
                    <div key={row.contactId} className="p-3 text-sm">
                      <p className="font-medium">{row.displayName || row.contactId}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {row.issues.map((issue) => (
                          <span key={issue} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                            {tt(`transfer.issues.${issue}`)}
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
                {tt("transfer.noConflicts")}
              </div>
            )}
            <div>
              <Label htmlFor="contact-transfer-reason">{tt("transfer.reason")}</Label>
              <Textarea
                id="contact-transfer-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={1000}
                className="mt-1.5 resize-y"
                placeholder={tt("transfer.reasonPlaceholder")}
              />
              <p className="mt-1 text-xs text-muted-foreground">{tt("transfer.reasonHint")}</p>
            </div>
          </>
        ) : null}

        {step === "RESULT" && result ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">{tt("transfer.completedTitle")}</p>
                <p className="mt-1 text-sm">{tt("transfer.completedDescription", {
                  transferred: result.summary.transferred,
                  excluded: result.summary.excluded,
                })}</p>
              </div>
            </div>
            {result.excluded.length > 0 ? (
              <p className="text-xs text-muted-foreground">{tt("transfer.excludedPreserved")}</p>
            ) : null}
            <div className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
              receiptStored
                ? "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100"
                : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100"
            }`}>
              {receiptStored
                ? <HardDriveDownload className="mt-0.5 h-4 w-4 shrink-0" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <div>
                <p className="font-medium">
                  {receiptStored ? tt("transfer.receiptStoredTitle") : tt("transfer.receiptNotStoredTitle")}
                </p>
                <p className="mt-0.5 text-xs opacity-80">
                  {receiptStored ? tt("transfer.receiptStoredDescription") : tt("transfer.receiptNotStoredDescription")}
                </p>
              </div>
            </div>
          </div>
        ) : null}

          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
      </DialogContent>

      <DialogFooter>
        {step === "PARAMETERS" ? (
          <>
            <Button type="button" variant="outline" onClick={close} disabled={busy}>{tt("transfer.cancel")}</Button>
            <Button type="button" onClick={() => void buildPreview()} disabled={busy || contactIds.length === 0}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1 h-4 w-4" />}
              {busy ? tt("transfer.buildingPreview") : tt("transfer.review")}
            </Button>
          </>
        ) : step === "PREVIEW" ? (
          <>
            <Button type="button" variant="outline" onClick={() => { setStep("PARAMETERS"); setError("") }} disabled={busy}>
              {tt("transfer.changeParameters")}
            </Button>
            <Button type="button" onClick={() => void execute()} disabled={busy || !preview || preview.summary.transferable === 0}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-1 h-4 w-4" />}
              {busy ? tt("transfer.applying") : tt("transfer.apply", { count: preview?.summary.transferable ?? 0 })}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={close}>{tt("transfer.close")}</Button>
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
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
