"use client"

import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  BadgeCheck,
  Bookmark,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Columns3,
  Download,
  FileBadge,
  FilePlus2,
  Filter,
  Loader2,
  PanelRight,
  RefreshCw,
  Search,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { PharmacyPromotionAgentCapture } from "@/components/mtm/pharmacy-promotion-agent-capture"
import { PharmacyPromotionCampaignAdmin } from "@/components/mtm/pharmacy-promotion-campaign-admin"
import { PharmacyPromotionDefinitionAdmin } from "@/components/mtm/pharmacy-promotion-definition-admin"
import { HelpButton } from "@/components/help/help-button"
import { MtmWorkflowGuide } from "@/components/mtm/mtm-workflow-guide"
import {
  PHARMACY_PROMOTION_SECONDARY_COLUMNS,
  pharmacyPromotionColumnsFromParam,
  type PharmacyPromotionSecondaryColumn,
} from "@/lib/mtm/pharmacy-promotion-columns"
import { cn } from "@/lib/utils"
import { createDateFormatter } from "@/lib/format-date"

type LocalizedName = { nameRu: string; nameAz: string; nameEn: string }

type PromotionRow = {
  id: string
  version: number
  status: string
  l1State: string
  l2State: string
  currentStep: "L1" | "L2" | null
  nextResponsible: "L1_REVIEWER" | "L2_REVIEWER" | null
  target: {
    customerName: string
    customerCode: string | null
    registrationCode: string | null
    address: string | null
    locality: string | null
    planQuantity: string | null
    unit: string
  }
  employee: {
    id: string
    name: string
    team: { id: string; name: string | null } | null
    manager: { id: string; name: string | null } | null
    userGroups?: Array<{ id: string; name: string }>
  }
  promotion: LocalizedName & {
    id: string
    code: string
    versionId: string
    revision: number
    type: LocalizedName & { id: string; code: string }
  }
  visit: { id: string; status: string; checkInAt: string | null; checkOutAt: string | null } | null
  factQuantity: string | null
  preview: { calculated: boolean; factPoints: string | null; rewardPoints: string | null; difference: string | null }
  ledger: { posted: boolean; factPoints: string | null; rewardPoints: string | null; difference: string | null }
  evidenceCount: number
  eligibility: { status: string; overridden: boolean; overrideReason: string | null; evaluatedStatus: string; reasons: string[] }
  policy: { ready: boolean; blockers: string[]; formulaVersion: number; approvalPolicyVersion: number }
  source: { system: string; reference: string | null; observedAt: string; receivedAt: string; freshness: { state: string; ageMinutes: number | null } }
  submittedAt: string | null
  readyAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

type RegistryData = {
  rows: PromotionRow[]
  pageInfo: { page: number; pageSize: number; total: number; totalPages: number }
  summary: {
    executions: number
    readyL1: number
    readyL2: number
    factPoints: string | null
    rewardPoints: string | null
    difference: string | null
  }
  filters: {
    agents: Array<{ id: string; name: string; teamId: string | null }>
    teams: Array<{ id: string; name: string }>
    regions?: Array<{ id: string; name: string }>
    localities?: Array<{ id: string; name: string }>
    territories?: Array<{ id: string; name: string }>
    contacts?: Array<{ id: string; name: string }>
    managers?: Array<{ id: string; name: string }>
    userGroups?: Array<{ id: string; name: string }>
    promotionVersions: Array<LocalizedName & {
      id: string
      revision: number
      promotion: { id: string; code: string }
      type: LocalizedName & { id: string; code: string }
    }>
  }
  normalizedFilters: Record<string, string | number>
  snapshotId: string
  syncScopeKey: string
  asOf: string
  timezone: string
  capabilities: {
    canCreateExecution: boolean
    canReview: boolean
    canBulkReview: boolean
    canExport: boolean
    canConfigure: boolean
    canManageTargets: boolean
    postingEnabled: boolean
  }
}

type CampaignVersion = LocalizedName & {
  id: string
  revision: number
  status: string
  startsOn: string
  endsOn: string
  definitionHash: string
  approvalReference: string | null
  eligibilityApprovalReference: string | null
  type: LocalizedName & { code: string; status: string }
  formula: { code: string; version: number; status: string; definitionHash: string }
  approvalPolicy: { code: string; version: number; status: string; definitionHash: string }
  _count: { targets: number }
}

type Campaign = {
  id: string
  code: string
  updatedAt: string
  versions: CampaignVersion[]
}

type PromotionSavedView = {
  id: string
  name: string
  filters: Record<string, string | number>
  isDefault: boolean
  sortOrder: number
}

type ReviewPreviewEntry = {
  executionId: string
  expectedVersion?: number
  previewHash?: string
  preview: {
    executionId: string
    calculation: { factPoints: string; rewardPoints: string; difference: string }
    nextState: { status: string; l1State: string; l2State: string; postsLedger: boolean }
  }
}

type ReviewPreview = {
  preview: ReviewPreviewEntry["preview"] | {
    entries: ReviewPreviewEntry[]
  }
  previewHash: string
  selectionHash?: string
  versions?: Array<{ executionId: string; expectedVersion: number }>
}

function isBulkReviewPreview(
  preview: ReviewPreview["preview"],
): preview is { entries: ReviewPreviewEntry[] } {
  return "entries" in preview && Array.isArray(preview.entries)
}

const FILTER_KEYS = [
  "q", "departmentId", "employeeId", "promotionId", "promotionType", "code",
  "executionStatus", "controlledVisitStatus", "l1Status", "l2Status", "ready",
  "regionId", "localityId", "territoryId", "contactId", "managerId", "userGroupId",
  "dateMode", "dateFrom", "dateTo", "amountMode", "amountMin", "amountMax",
  "sort", "direction", "pageSize",
] as const

const SAVED_FILTER_KEYS = new Set<string>([...FILTER_KEYS, "page", "columns", "density", "view"])

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [query])

  return matches
}

type PromotionWorkspaceView = "registry" | "review" | "campaigns"
type PromotionWorkspacePersona = "agent" | "reviewer" | "admin" | "reader"

export function pharmacyPromotionWorkspaceViews(
  capabilities: Pick<RegistryData["capabilities"], "canReview" | "canConfigure">,
): PromotionWorkspaceView[] {
  if (capabilities.canConfigure) return capabilities.canReview
    ? ["review", "registry", "campaigns"]
    : ["registry", "campaigns"]
  if (capabilities.canReview) return ["review", "registry"]
  return ["registry"]
}

function pharmacyPromotionWorkspacePersona(
  capabilities: Pick<RegistryData["capabilities"], "canCreateExecution" | "canReview" | "canConfigure">,
): PromotionWorkspacePersona {
  if (capabilities.canConfigure) return "admin"
  if (capabilities.canReview) return "reviewer"
  if (capabilities.canCreateExecution) return "agent"
  return "reader"
}

function savedViewSearchParams(filters: PromotionSavedView["filters"]) {
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (!SAVED_FILTER_KEYS.has(key) || value === "" || value === "NONE") continue
    next.set(key, String(value))
  }
  next.set("page", "1")
  return next
}

function localizedName(value: LocalizedName, locale: string) {
  return locale === "az" ? value.nameAz : locale === "en" ? value.nameEn : value.nameRu
}

function apiErrorCode(payload: unknown) {
  if (!payload || typeof payload !== "object") return null
  const value = payload as { code?: unknown }
  return typeof value.code === "string" && value.code.length > 0 ? value.code : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function reviewPreviewFromPayload(payload: unknown, bulk: boolean): ReviewPreview | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null
  const data = payload.data
  if (typeof data.previewHash !== "string" || !isRecord(data.preview)) return null
  if (bulk) {
    if (
      typeof data.selectionHash !== "string"
      || !Array.isArray(data.versions)
      || !Array.isArray(data.preview.entries)
    ) return null
  } else if (!isRecord(data.preview.calculation) || !isRecord(data.preview.nextState)) {
    return null
  }
  return data as unknown as ReviewPreview
}

function registryDataFromPayload(payload: unknown): RegistryData | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null
  const data = payload.data
  if (
    !Array.isArray(data.rows)
    || !isRecord(data.pageInfo)
    || !isRecord(data.summary)
    || !isRecord(data.filters)
    || !isRecord(data.capabilities)
    || typeof data.snapshotId !== "string"
    || typeof data.syncScopeKey !== "string"
    || data.syncScopeKey.length < 16
    || data.syncScopeKey.length > 128
  ) return null
  return data as unknown as RegistryData
}

function campaignsFromPayload(payload: unknown): Campaign[] | null {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.promotions)) return null
  return payload.data.promotions as Campaign[]
}

function savedViewsFromPayload(payload: unknown): PromotionSavedView[] | null {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.views)) return null
  return payload.data.views as PromotionSavedView[]
}

function formatPoints(value: string | null, locale: string) {
  if (value === null) return "—"
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

function formatDate(value: string | null, locale: string, includeTime = false) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return createDateFormatter(locale, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date)
}

function statusVariant(status: string): "success" | "warning" | "destructive" | "info" | "outline" {
  if (status === "APPROVED" || status === "CONNECTED" || status === "FRESH") return "success"
  if (status === "READY" || status === "IN_REVIEW" || status === "DELAYED") return "info"
  if (status === "RETURNED" || status === "DRAFT" || status === "NOT_READY") return "warning"
  if (status === "REJECTED" || status === "REVERSED" || status === "STALE") return "destructive"
  return "outline"
}

function PromotionStatusBadge({ status, label }: { status: string; label: string }) {
  const badgeVariant = statusVariant(status)
  const Icon = badgeVariant === "success"
    ? CheckCircle2
    : badgeVariant === "warning"
      ? AlertTriangle
      : badgeVariant === "destructive"
        ? XCircle
        : badgeVariant === "info"
          ? ClipboardCheck
          : ShieldAlert

  return <Badge variant={badgeVariant}><Icon className="mr-1 h-3 w-3" aria-hidden="true" />{label}</Badge>
}

function SummaryCard({ icon: Icon, label, value, hint, tone }: {
  icon: typeof BadgeCheck
  label: string
  value: string | number
  hint?: string
  tone: "blue" | "emerald" | "amber" | "violet"
}) {
  const toneClass = {
    blue: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  }[tone]
  return (
    <div className="min-w-0 border border-zinc-200/70 bg-card p-3 dark:border-zinc-800 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold tabular-nums">{value}</p>
          {hint ? <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", toneClass)}><Icon className="h-4 w-4" /></span>
      </div>
    </div>
  )
}

function LabeledInput({ label, ...props }: { label: string } & ComponentProps<typeof Input>) {
  return (
    <label className="space-y-1 text-sm font-medium">
      <span>{label}</span>
      <Input {...props} />
    </label>
  )
}

function ReviewDialog({ rows, open, onOpenChange, onApplied }: {
  rows: PromotionRow[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied: () => void
}) {
  const t = useTranslations("mtmPharmacyPromotions")
  const locale = useLocale()
  const steps = new Set(rows.map((row) => row.currentStep).filter(Boolean))
  const inferredStep = steps.size === 1 ? [...steps][0] as "L1" | "L2" : null
  const [decision, setDecision] = useState<"" | "APPROVED" | "REJECTED" | "RETURNED">("")
  const [reason, setReason] = useState("")
  const [preview, setPreview] = useState<ReviewPreview | null>(null)
  const [operationId, setOperationId] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setDecision("")
    setReason("")
    setPreview(null)
    setOperationId(null)
    setError("")
  }, [inferredStep, open, rows])

  const previewRequest = useMemo(() => inferredStep && decision ? ({
    level: inferredStep,
    decision,
    reason: reason.trim() || null,
  }) : null, [decision, inferredStep, reason])

  const localizedError = useCallback((payload: unknown, fallback: string) => {
    const code = apiErrorCode(payload)
    return code && t.has(`error.${code}`) ? t(`error.${code}`) : fallback
  }, [t])

  async function loadPreview() {
    if (!inferredStep) {
      setError(t("reviewStepMismatch"))
      return
    }
    if (!previewRequest) {
      setError(t("reviewDecisionRequired"))
      return
    }
    if (decision !== "APPROVED" && reason.trim().length === 0) {
      setError(t("reviewReasonRequired"))
      return
    }
    setPreviewing(true)
    setError("")
    try {
      const bulk = rows.length > 1
      const response = await fetch(bulk
        ? "/api/v1/mtm/pharmacy-promotion-executions/bulk/reviews/preview"
        : `/api/v1/mtm/pharmacy-promotion-executions/${encodeURIComponent(rows[0].id)}/reviews/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bulk
          ? { executionIds: rows.map((row) => row.id), ...previewRequest }
          : { expectedVersion: rows[0].version, ...previewRequest }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(localizedError(payload, t("reviewPreviewFailed")))
      const nextPreview = reviewPreviewFromPayload(payload, bulk)
      if (!nextPreview) throw new Error(t("reviewPreviewFailed"))
      setPreview(nextPreview)
      // A retry after a lost response must replay the same operation. This ID
      // lives with the preview and changes only when the preview inputs change.
      setOperationId(crypto.randomUUID())
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("reviewPreviewFailed"))
    } finally {
      setPreviewing(false)
    }
  }

  async function applyReview() {
    if (!preview || !operationId) return
    if (!previewRequest) return
    setApplying(true)
    setError("")
    try {
      const bulk = rows.length > 1
      const response = await fetch(bulk
        ? "/api/v1/mtm/pharmacy-promotion-executions/bulk/reviews"
        : `/api/v1/mtm/pharmacy-promotion-executions/${encodeURIComponent(rows[0].id)}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bulk ? {
          executionIds: rows.map((row) => row.id),
          ...previewRequest,
          operationId,
          idempotencyKey: operationId,
          previewHash: preview.previewHash,
          selectionHash: preview.selectionHash,
          versions: preview.versions,
        } : {
          expectedVersion: rows[0].version,
          ...previewRequest,
          operationId,
          idempotencyKey: operationId,
          previewHash: preview.previewHash,
        }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(localizedError(payload, t("reviewApplyFailed")))
      toast.success(t("reviewApplied", { count: rows.length }))
      setOperationId(null)
      onOpenChange(false)
      onApplied()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("reviewApplyFailed"))
    } finally {
      setApplying(false)
    }
  }

  const previewEntries: ReviewPreviewEntry[] = preview
    ? isBulkReviewPreview(preview.preview)
      ? preview.preview.entries
      : [{ executionId: rows[0]?.id ?? "", preview: preview.preview }]
    : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange} widthClassName="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{t("reviewTitle", { count: rows.length })}</DialogTitle>
        <DialogDescription>{t("reviewDescription")}</DialogDescription>
      </DialogHeader>
      <DialogContent data-testid="mtm-pharmacy-review-dialog" className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div data-testid="mtm-pharmacy-review-step" className="rounded-lg border border-zinc-200/70 bg-muted/30 px-3 py-2 dark:border-zinc-800">
            <p className="text-xs text-muted-foreground">{t("reviewLevel")}</p>
            <p className="mt-1 font-semibold">{inferredStep ?? t("unknownStatus")}</p>
          </div>
          <Select label={t("reviewDecision")} value={decision} disabled={previewing || applying} className="min-h-11" onChange={(event) => { setDecision(event.target.value as typeof decision); setPreview(null); setOperationId(null); setError("") }}>
            <option value="">{t("chooseDecision")}</option>
            <option value="APPROVED">{t("decision.APPROVED")}</option>
            <option value="RETURNED">{t("decision.RETURNED")}</option>
            <option value="REJECTED">{t("decision.REJECTED")}</option>
          </Select>
          <div className="rounded-lg border border-zinc-200/70 bg-muted/30 px-3 py-2 dark:border-zinc-800">
            <p className="text-xs text-muted-foreground">{t("selected")}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{rows.length}</p>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200/70 bg-background px-3 py-3 dark:border-zinc-800">
          <p className="text-xs font-medium text-muted-foreground">{t("selectedPharmacies")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {rows.slice(0, 6).map((row) => <Badge key={row.id} variant="outline">{row.target.customerName}</Badge>)}
            {rows.length > 6 ? <Badge variant="secondary">+{rows.length - 6}</Badge> : null}
          </div>
        </div>
        <div>
          <label htmlFor="promotion-review-reason" className="mb-1.5 block text-sm font-medium">{t("reviewReason")}</label>
          <Textarea
            id="promotion-review-reason"
            value={reason}
            disabled={previewing || applying}
            onChange={(event) => { setReason(event.target.value); setPreview(null); setOperationId(null); setError("") }}
            placeholder={decision === "APPROVED" ? t("reviewReasonOptional") : t("reviewReasonPlaceholder")}
            rows={3}
            maxLength={2_000}
          />
        </div>
        {error ? (
          <div role="alert" className="flex gap-2 border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        {preview ? (
          <section className="border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
              <div>
                <h3 className="font-semibold">{t("reviewPreviewReady")}</h3>
                <p className="text-xs text-muted-foreground">{t("reviewPreviewHint")}</p>
              </div>
            </div>
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto" aria-live="polite">
              {previewEntries.map((entry) => {
                const value = entry.preview
                return (
                  <div key={entry.executionId || value.executionId} className="grid grid-cols-2 gap-2 bg-background/80 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
                    <span className="col-span-2 truncate font-medium sm:col-span-1">{rows.find((row) => row.id === (entry.executionId || value.executionId))?.target.customerName ?? t("unknownExecution")}</span>
                    <span className="tabular-nums">{t("factShort")} {formatPoints(value.calculation.factPoints, locale)}</span>
                    <span className="tabular-nums">{t("rewardShort")} {formatPoints(value.calculation.rewardPoints, locale)}</span>
                    <PromotionStatusBadge status={value.nextState.postsLedger ? "APPROVED" : value.nextState.status} label={t.has(`status.${value.nextState.status}`) ? t(`status.${value.nextState.status}`) : t("unknownStatus")} />
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}
      </DialogContent>
      <DialogFooter className="flex-col-reverse sm:flex-row">
        <Button className="min-h-11 w-full sm:w-auto" variant="outline" onClick={() => onOpenChange(false)} disabled={previewing || applying}>{t("cancel")}</Button>
        {!preview ? (
          <Button className="min-h-11 w-full sm:w-auto" onClick={loadPreview} disabled={previewing || !inferredStep || !decision}>
            {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
            {t("buildPreview")}
          </Button>
        ) : (
          <>
            <Button className="min-h-11 w-full sm:w-auto" variant="outline" onClick={() => { setPreview(null); setOperationId(null); setError("") }} disabled={applying}>{t("rebuildPreview")}</Button>
            <Button className="min-h-11 w-full sm:w-auto" onClick={applyReview} disabled={applying || !operationId}>
              {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
              {t("applyDecision")}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  )
}

export function PharmacyPromotionWorkspace() {
  const t = useTranslations("mtmPharmacyPromotions")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchKey = searchParams.toString()
  const [data, setData] = useState<RegistryData | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [savedViews, setSavedViews] = useState<PromotionSavedView[]>([])
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("")
  const [savedViewsLoading, setSavedViewsLoading] = useState(true)
  const [showSaveView, setShowSaveView] = useState(false)
  const [savedViewName, setSavedViewName] = useState("")
  const [savedViewDefault, setSavedViewDefault] = useState(false)
  const [savingView, setSavingView] = useState(false)
  const [deletingView, setDeletingView] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [advanced, setAdvanced] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null)
  const [reviewRows, setReviewRows] = useState<PromotionRow[]>([])
  const [visibleColumns, setVisibleColumns] = useState<Set<PharmacyPromotionSecondaryColumn>>(
    () => pharmacyPromotionColumnsFromParam(new URLSearchParams(searchKey).get("columns")),
  )
  const [density, setDensity] = useState<"compact" | "comfortable">(
    () => new URLSearchParams(searchKey).get("density") === "compact" ? "compact" : "comfortable",
  )
  const compactFilterLayout = useMediaQuery("(max-width: 1023px), (max-width: 1279px) and (orientation: portrait)")
  const tabletLandscape = useMediaQuery("(min-width: 1024px) and (max-width: 1279px) and (orientation: landscape)")
  const desktopRegistry = useMediaQuery("(min-width: 1280px)")
  const requestRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null })
  const defaultViewAppliedRef = useRef(false)
  const latestSearchKeyRef = useRef(searchKey)
  const pendingSearchKeyRef = useRef<string | null>(null)
  const visibleColumnsRef = useRef(visibleColumns)
  const view = searchParams.get("view") === "review" || searchParams.get("view") === "campaigns"
    ? searchParams.get("view") as Exclude<PromotionWorkspaceView, "registry">
    : "registry"
  const availableViews = data
    ? pharmacyPromotionWorkspaceViews(data.capabilities)
    : (["registry"] satisfies PromotionWorkspaceView[])
  const persona = data ? pharmacyPromotionWorkspacePersona(data.capabilities) : "reader"
  const selectedSavedView = savedViews.find((candidate) => candidate.id === selectedSavedViewId)

  const localizedError = useCallback((payload: unknown, fallback: string) => {
    const code = apiErrorCode(payload)
    return code && t.has(`error.${code}`) ? t(`error.${code}`) : fallback
  }, [t])

  const replaceSearchParams = useCallback((next: URLSearchParams) => {
    const nextSearchKey = next.toString()
    latestSearchKeyRef.current = nextSearchKey
    pendingSearchKeyRef.current = nextSearchKey
    const nextColumns = pharmacyPromotionColumnsFromParam(next.get("columns"))
    visibleColumnsRef.current = nextColumns
    setVisibleColumns(nextColumns)
    setDensity(next.get("density") === "compact" ? "compact" : "comfortable")
    router.replace(`${pathname}${nextSearchKey ? `?${nextSearchKey}` : ""}`, { scroll: false })
  }, [pathname, router])

  useEffect(() => {
    if (pendingSearchKeyRef.current && pendingSearchKeyRef.current !== searchKey) return
    pendingSearchKeyRef.current = null
    latestSearchKeyRef.current = searchKey
    const next = new URLSearchParams(searchKey)
    const nextColumns = pharmacyPromotionColumnsFromParam(next.get("columns"))
    visibleColumnsRef.current = nextColumns
    setVisibleColumns(nextColumns)
    setDensity(next.get("density") === "compact" ? "compact" : "comfortable")
  }, [searchKey])

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const key of FILTER_KEYS) next[key] = searchParams.get(key) ?? ""
    setDraft(next)
  }, [searchKey, searchParams])

  const load = useCallback(async () => {
    requestRef.current.controller?.abort()
    const requestId = requestRef.current.id + 1
    const controller = new AbortController()
    requestRef.current = { id: requestId, controller }
    setLoadError("")
    if (!data) setLoading(true)
    else setRefreshing(true)
    try {
      const query = new URLSearchParams(searchKey)
      if (!query.has("view")) query.set("view", view)
      const response = await fetch(`/api/v1/mtm/pharmacy-promotion-executions?${query.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(localizedError(payload, t("loadFailed")))
      if (requestRef.current.id !== requestId) return
      const nextData = registryDataFromPayload(payload)
      if (!nextData) throw new Error(t("loadFailed"))
      setData(nextData)
      setSelected((current) => {
        const visible = new Set(nextData.rows.map((row) => row.id))
        return new Set([...current].filter((id) => visible.has(id)))
      })
    } catch (error) {
      if (controller.signal.aborted) return
      setLoadError(error instanceof Error ? error.message : t("loadFailed"))
    } finally {
      if (requestRef.current.id === requestId) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [data, localizedError, refreshKey, searchKey, t, view])

  useEffect(() => {
    void load()
    return () => requestRef.current.controller?.abort()
    // `load` intentionally changes for URL/refresh identity only.
  }, [searchKey, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view !== "campaigns" || !data?.capabilities.canConfigure) return
    const controller = new AbortController()
    setCampaignsLoading(true)
    fetch("/api/v1/mtm/pharmacy-promotions", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(localizedError(payload, t("campaignLoadFailed")))
        const nextCampaigns = campaignsFromPayload(payload)
        if (!nextCampaigns) throw new Error(t("campaignLoadFailed"))
        setCampaigns(nextCampaigns)
      })
      .catch((error) => { if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : t("campaignLoadFailed")) })
      .finally(() => { if (!controller.signal.aborted) setCampaignsLoading(false) })
    return () => controller.abort()
  }, [data?.capabilities.canConfigure, localizedError, refreshKey, t, view])

  useEffect(() => {
    const controller = new AbortController()
    setSavedViewsLoading(true)
    fetch("/api/v1/mtm/pharmacy-promotion-executions/views", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(localizedError(payload, t("savedViewsLoadFailed")))
        const nextViews = savedViewsFromPayload(payload)
        if (!nextViews) throw new Error(t("savedViewsLoadFailed"))
        setSavedViews(nextViews)
      })
      .catch((error) => {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : t("savedViewsLoadFailed"))
      })
      .finally(() => { if (!controller.signal.aborted) setSavedViewsLoading(false) })
    return () => controller.abort()
  }, [localizedError, t])

  useEffect(() => {
    if (!data || savedViewsLoading || defaultViewAppliedRef.current) return
    if (searchKey) return
    if (data.capabilities.canReview) return
    defaultViewAppliedRef.current = true
    const defaultView = savedViews.find((candidate) => candidate.isDefault)
    if (!defaultView) return
    setSelectedSavedViewId(defaultView.id)
    replaceSearchParams(savedViewSearchParams(defaultView.filters))
  }, [data, replaceSearchParams, savedViews, savedViewsLoading, searchKey])

  useEffect(() => {
    if (!data) return
    const nextViews = pharmacyPromotionWorkspaceViews(data.capabilities)
    const preferred = nextViews[0]
    const hasExplicitView = searchParams.has("view")
    if (nextViews.includes(view) && (hasExplicitView || view === preferred)) return
    defaultViewAppliedRef.current = true
    const next = new URLSearchParams(searchKey)
    next.set("view", nextViews.includes(view) ? view : preferred)
    next.delete("page")
    replaceSearchParams(next)
  }, [data, replaceSearchParams, searchKey, searchParams, view])

  function replaceParams(changes: Record<string, string | number | null | undefined>) {
    const next = new URLSearchParams(latestSearchKeyRef.current)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === undefined || value === "" || value === "NONE") next.delete(key)
      else next.set(key, String(value))
    }
    replaceSearchParams(next)
  }

  function applyFilters() {
    const changes: Record<string, string | number | null> = { page: null }
    for (const key of FILTER_KEYS) changes[key] = draft[key] || null
    setSelectedSavedViewId("")
    replaceParams(changes)
  }

  function resetFilters() {
    const current = new URLSearchParams(latestSearchKeyRef.current)
    const next = new URLSearchParams({ view })
    for (const key of ["columns", "density"] as const) {
      const value = current.get(key)
      if (value) next.set(key, value)
    }
    replaceSearchParams(next)
    setSelectedSavedViewId("")
  }

  function applySavedView(id: string) {
    setSelectedSavedViewId(id)
    const savedView = savedViews.find((candidate) => candidate.id === id)
    if (!savedView) return
    const next = savedViewSearchParams(savedView.filters)
    replaceSearchParams(next)
  }

  async function saveCurrentView() {
    if (!data || !savedViewName.trim()) return
    setSavingView(true)
    try {
      const response = await fetch("/api/v1/mtm/pharmacy-promotion-executions/views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: savedViewName.trim(),
          filters: data.normalizedFilters,
          isDefault: savedViewDefault,
          sortOrder: savedViews.length,
        }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(localizedError(payload, t("savedViewSaveFailed")))
      if (!isRecord(payload) || !isRecord(payload.data) || !isRecord(payload.data.view)) {
        throw new Error(t("savedViewSaveFailed"))
      }
      const created = payload.data.view as unknown as PromotionSavedView
      setSavedViews((current) => [
        ...current.map((candidate) => savedViewDefault ? { ...candidate, isDefault: false } : candidate),
        created,
      ])
      setSelectedSavedViewId(created.id)
      setSavedViewName("")
      setSavedViewDefault(false)
      setShowSaveView(false)
      toast.success(t("savedViewSaved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("savedViewSaveFailed"))
    } finally {
      setSavingView(false)
    }
  }

  async function deleteSelectedView() {
    const savedView = savedViews.find((candidate) => candidate.id === selectedSavedViewId)
    if (!savedView || !window.confirm(t("deleteSavedViewConfirm", { name: savedView.name }))) return
    setDeletingView(true)
    try {
      const response = await fetch(`/api/v1/mtm/pharmacy-promotion-executions/views/${encodeURIComponent(savedView.id)}`, { method: "DELETE" })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(localizedError(payload, t("savedViewDeleteFailed")))
      setSavedViews((current) => current.filter((candidate) => candidate.id !== savedView.id))
      setSelectedSavedViewId("")
      toast.success(t("savedViewDeleted"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("savedViewDeleteFailed"))
    } finally {
      setDeletingView(false)
    }
  }

  const rows = data?.rows ?? []
  const cellPadding = density === "compact" ? "py-2" : "py-3"
  const focusedRow = rows.find((row) => row.id === focusedRowId) ?? rows[0] ?? null
  const focusedPoints = focusedRow ? (focusedRow.ledger.posted ? focusedRow.ledger : focusedRow.preview) : null
  const showColumnControls = desktopRegistry || tabletLandscape
  const selectedRows = rows.filter((row) => selected.has(row.id))
  const selectedSteps = new Set(selectedRows.map((row) => row.currentStep).filter(Boolean))
  const bulkReady = Boolean(data?.capabilities.canBulkReview)
    && selectedRows.length > 0
    && selectedRows.length === selected.size
    && selectedSteps.size === 1
  const allReviewableOnPage = data?.capabilities.canBulkReview
    ? rows.filter((row) => Boolean(row.currentStep))
    : []
  const allSelected = allReviewableOnPage.length > 0 && allReviewableOnPage.every((row) => selected.has(row.id))

  function toggleColumn(column: PharmacyPromotionSecondaryColumn) {
    const next = new Set(visibleColumnsRef.current)
    if (next.has(column)) {
      if (next.size === 1) return
      next.delete(column)
    } else {
      next.add(column)
    }
    const columns = PHARMACY_PROMOTION_SECONDARY_COLUMNS.filter((candidate) => next.has(candidate)).join(",")
    setSelectedSavedViewId("")
    replaceParams({ columns, page: null })
  }

  function changeDensity(nextDensity: "compact" | "comfortable") {
    setSelectedSavedViewId("")
    replaceParams({ density: nextDensity, page: null })
  }

  const exportUrl = data ? (() => {
    const query = new URLSearchParams(searchKey)
    query.set("snapshotId", data.snapshotId)
    query.set("locale", locale)
    return `/api/v1/mtm/pharmacy-promotion-executions/export?${query.toString()}`
  })() : "#"

  const promotionOptions = useMemo(() => {
    const byPromotion = new Map<string, { id: string; code: string; name: string }>()
    for (const version of data?.filters.promotionVersions ?? []) {
      if (!byPromotion.has(version.promotion.id)) byPromotion.set(version.promotion.id, {
        id: version.promotion.id,
        code: version.promotion.code,
        name: localizedName(version, locale),
      })
    }
    return [...byPromotion.values()]
  }, [data?.filters.promotionVersions, locale])

  const typeOptions = useMemo(() => {
    const byType = new Map<string, { id: string; code: string; name: string }>()
    for (const version of data?.filters.promotionVersions ?? []) {
      if (!byType.has(version.type.id)) byType.set(version.type.id, {
        id: version.type.id,
        code: version.type.code,
        name: localizedName(version.type, locale),
      })
    }
    return [...byType.values()]
  }, [data?.filters.promotionVersions, locale])

  const activeFilterChips = useMemo(() => {
    const currentParams = new URLSearchParams(searchKey)
    const hiddenPreferences = new Set(["sort", "direction", "pageSize"])
    const labels: Partial<Record<(typeof FILTER_KEYS)[number], string>> = {
      q: t("search"),
      departmentId: t("department"),
      employeeId: t("employee"),
      promotionId: t("promotion"),
      promotionType: t("promotionType"),
      code: t("campaignCode"),
      executionStatus: t("executionStatus"),
      controlledVisitStatus: t("controlledVisitStatus"),
      l1Status: "L1",
      l2Status: "L2",
      ready: t("readiness"),
      regionId: t("region"),
      localityId: t("locality"),
      territoryId: t("territory"),
      contactId: t("contact"),
      managerId: t("manager"),
      userGroupId: t("userGroup"),
      dateMode: t("dateField"),
      dateFrom: t("dateFrom"),
      dateTo: t("dateTo"),
      amountMode: t("pointsField"),
      amountMin: t("amountMin"),
      amountMax: t("amountMax"),
    }
    const lookup = (items: Array<{ id: string; name: string }> | undefined, id: string) => items?.find((item) => item.id === id)?.name
    const valueLabel = (key: (typeof FILTER_KEYS)[number], value: string) => {
      if (key === "departmentId") return lookup(data?.filters.teams, value) ?? value
      if (key === "employeeId") return lookup(data?.filters.agents, value) ?? value
      if (key === "promotionId") return promotionOptions.find((item) => item.id === value)?.name ?? value
      if (key === "promotionType") return typeOptions.find((item) => item.id === value)?.name ?? value
      if (key === "regionId") return lookup(data?.filters.regions, value) ?? value
      if (key === "localityId") return lookup(data?.filters.localities, value) ?? value
      if (key === "territoryId") return lookup(data?.filters.territories, value) ?? value
      if (key === "contactId") return lookup(data?.filters.contacts, value) ?? value
      if (key === "managerId") return lookup(data?.filters.managers, value) ?? value
      if (key === "userGroupId") return lookup(data?.filters.userGroups, value) ?? value
      if (["executionStatus", "l1Status", "l2Status"].includes(key) && t.has(`status.${value}`)) return t(`status.${value}`)
      if (key === "controlledVisitStatus" && t.has(`visitStatus.${value}`)) return t(`visitStatus.${value}`)
      if (key === "ready" && t.has(`readinessOption.${value}`)) return t(`readinessOption.${value}`)
      if (key === "dateMode") {
        const dateLabels: Record<string, string> = { CREATED_AT: t("createdAt"), CONNECTED_AT: t("connectedAt"), CLOSED_AT: t("closedAt") }
        return dateLabels[value] ?? value
      }
      if (key === "amountMode") {
        const amountLabels: Record<string, string> = { FACT_POINTS: t("summary.fact"), REWARD_POINTS: t("summary.reward"), DIFFERENCE: t("summary.difference") }
        return amountLabels[value] ?? value
      }
      return value
    }

    return FILTER_KEYS.flatMap((key) => {
      if (hiddenPreferences.has(key)) return []
      const value = currentParams.get(key)
      if (!value || value === "NONE") return []
      return [{ key, label: labels[key] ?? key, value: valueLabel(key, value) }]
    })
  }, [data?.filters, promotionOptions, searchKey, t, typeOptions])

  const stateLabel = (status: string) => t.has(`status.${status}`)
    ? t(`status.${status}`)
    : t("unknownStatus")
  const freshnessLabel = (state: string) => t.has(`freshness.${state}`)
    ? t(`freshness.${state}`)
    : t("freshness.UNKNOWN")
  const blockerLabel = (code: string) => t.has(`blocker.${code}`)
    ? t(`blocker.${code}`)
    : t("unknownBlocker")
  const registrationLabel = (row: PromotionRow) => row.target.registrationCode
    ? t("registrationValue", { value: row.target.registrationCode })
    : row.target.customerCode
      ? t("customerCodeValue", { value: row.target.customerCode })
      : t("noRegistration")
  const nextResponsibleLabel = (value: PromotionRow["nextResponsible"]) => value && t.has(`nextResponsible.${value}`)
    ? t(`nextResponsible.${value}`)
    : t("nextResponsible.NONE")

  const advancedFilterFields = (
    <>
      <fieldset data-testid="mtm-pharmacy-filter-group-scope" className="rounded-lg border border-zinc-200/70 bg-background/80 p-3 dark:border-zinc-800">
        <legend className="px-1 text-sm font-semibold">{t("filterGroup.scope")}</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Select label={t("region")} value={draft.regionId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, regionId: event.target.value }))}><option value="">{t("allRegions")}</option>{(data?.filters.regions ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <Select label={t("locality")} value={draft.localityId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, localityId: event.target.value }))}><option value="">{t("allLocalities")}</option>{(data?.filters.localities ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <Select label={t("territory")} value={draft.territoryId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, territoryId: event.target.value }))}><option value="">{t("allTerritories")}</option>{(data?.filters.territories ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <Select label={t("contact")} value={draft.contactId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, contactId: event.target.value }))}><option value="">{t("allContacts")}</option>{(data?.filters.contacts ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <Select label={t("manager")} value={draft.managerId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, managerId: event.target.value }))}><option value="">{t("allManagers")}</option>{(data?.filters.managers ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <Select label={t("userGroup")} value={draft.userGroupId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, userGroupId: event.target.value }))}><option value="">{t("allUserGroups")}</option>{(data?.filters.userGroups ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
        </div>
      </fieldset>

      <fieldset data-testid="mtm-pharmacy-filter-group-workflow" className="rounded-lg border border-zinc-200/70 bg-background/80 p-3 dark:border-zinc-800">
        <legend className="px-1 text-sm font-semibold">{t("filterGroup.workflow")}</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label={t("promotion")} value={draft.promotionId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, promotionId: event.target.value }))}><option value="">{t("allPromotions")}</option>{promotionOptions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</Select>
          <Select label={t("promotionType")} value={draft.promotionType ?? ""} onChange={(event) => setDraft((current) => ({ ...current, promotionType: event.target.value }))}><option value="">{t("allTypes")}</option>{typeOptions.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</Select>
          <LabeledInput label={t("campaignCode")} placeholder={t("campaignCodePlaceholder")} value={draft.code ?? ""} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} />
          <Select label={t("executionStatus")} value={draft.executionStatus ?? ""} onChange={(event) => setDraft((current) => ({ ...current, executionStatus: event.target.value }))}><option value="">{t("allStatuses")}</option>{["DRAFT", "READY", "IN_REVIEW", "APPROVED", "RETURNED", "REJECTED", "REVERSED"].map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}</Select>
          <Select label={t("controlledVisitStatus")} value={draft.controlledVisitStatus ?? ""} onChange={(event) => setDraft((current) => ({ ...current, controlledVisitStatus: event.target.value }))}><option value="">{t("allStatuses")}</option>{["CHECKED_IN", "CHECKED_OUT", "CANCELLED"].map((status) => <option key={status} value={status}>{t(`visitStatus.${status}`)}</option>)}</Select>
          <Select label={t("readiness")} value={draft.ready ?? ""} onChange={(event) => setDraft((current) => ({ ...current, ready: event.target.value }))}><option value="">{t("allReadiness")}</option><option value="L1">{t("readinessOption.L1")}</option><option value="L2">{t("readinessOption.L2")}</option><option value="BLOCKED">{t("readinessOption.BLOCKED")}</option></Select>
          <Select label="L1" value={draft.l1Status ?? ""} onChange={(event) => setDraft((current) => ({ ...current, l1Status: event.target.value }))}><option value="">{t("allStatuses")}</option>{["NOT_READY", "READY", "APPROVED", "RETURNED", "REJECTED"].map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}</Select>
          <Select label="L2" value={draft.l2Status ?? ""} onChange={(event) => setDraft((current) => ({ ...current, l2Status: event.target.value }))}><option value="">{t("allStatuses")}</option>{["NOT_READY", "READY", "APPROVED", "RETURNED", "REJECTED"].map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}</Select>
        </div>
      </fieldset>

      <fieldset data-testid="mtm-pharmacy-filter-group-period-points" className="rounded-lg border border-zinc-200/70 bg-background/80 p-3 dark:border-zinc-800">
        <legend className="px-1 text-sm font-semibold">{t("filterGroup.periodPoints")}</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Select label={t("dateField")} value={draft.dateMode || "NONE"} onChange={(event) => setDraft((current) => ({ ...current, dateMode: event.target.value }))}><option value="NONE">{t("notSet")}</option><option value="CREATED_AT">{t("createdAt")}</option><option value="CONNECTED_AT">{t("connectedAt")}</option><option value="CLOSED_AT">{t("closedAt")}</option></Select>
          <LabeledInput type="date" label={t("dateFrom")} value={draft.dateFrom ?? ""} disabled={!draft.dateMode || draft.dateMode === "NONE"} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))} />
          <LabeledInput type="date" label={t("dateTo")} value={draft.dateTo ?? ""} disabled={!draft.dateMode || draft.dateMode === "NONE"} onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))} />
          <Select label={t("pointsField")} value={draft.amountMode || "NONE"} onChange={(event) => setDraft((current) => ({ ...current, amountMode: event.target.value }))}><option value="NONE">{t("notSet")}</option><option value="FACT_POINTS">{t("summary.fact")}</option><option value="REWARD_POINTS">{t("summary.reward")}</option><option value="DIFFERENCE">{t("summary.difference")}</option></Select>
          <LabeledInput inputMode="decimal" label={t("amountMin")} placeholder={t("amountMinPlaceholder")} value={draft.amountMin ?? ""} disabled={!draft.amountMode || draft.amountMode === "NONE"} onChange={(event) => setDraft((current) => ({ ...current, amountMin: event.target.value }))} />
          <LabeledInput inputMode="decimal" label={t("amountMax")} placeholder={t("amountMaxPlaceholder")} value={draft.amountMax ?? ""} disabled={!draft.amountMode || draft.amountMode === "NONE"} onChange={(event) => setDraft((current) => ({ ...current, amountMax: event.target.value }))} />
          <Select label={t("sort")} value={draft.sort || "createdAt"} onChange={(event) => setDraft((current) => ({ ...current, sort: event.target.value }))}>{["createdAt", "connectedAt", "closedAt", "pharmacy", "employee", "factPoints", "rewardPoints", "difference"].map((sort) => <option key={sort} value={sort}>{t(`sortOption.${sort}`)}</option>)}</Select>
          <Select label={t("direction")} value={draft.direction || "desc"} onChange={(event) => setDraft((current) => ({ ...current, direction: event.target.value }))}><option value="desc">{t("descending")}</option><option value="asc">{t("ascending")}</option></Select>
        </div>
      </fieldset>
    </>
  )

  return (
    <div data-testid="mtm-pharmacy-promotions" aria-busy={loading || refreshing} className="mx-auto max-w-[1680px] space-y-4 p-3 sm:p-5 lg:p-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><FileBadge className="h-3.5 w-3.5" />{t("eyebrow")}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
            <HelpButton slug="mtm-promotions" variant="label" className="h-11" />
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11 lg:min-h-9" variant="outline" onClick={() => setRefreshKey((value) => value + 1)} disabled={refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin motion-reduce:animate-none")} />{t("refresh")}
          </Button>
          {data?.capabilities.canExport ? <Button className="min-h-11 lg:min-h-9" variant="outline" asChild><a href={exportUrl}><Download className="mr-2 h-4 w-4" />{t("export")}</a></Button> : null}
        </div>
      </header>

      <nav aria-label={t("viewsLabel")} className={cn("grid border border-zinc-200/70 bg-card p-1 dark:border-zinc-800 sm:inline-grid", availableViews.length === 1 && "grid-cols-1 sm:min-w-[220px]", availableViews.length === 2 && "grid-cols-2 sm:min-w-[340px]", availableViews.length === 3 && "grid-cols-3 sm:min-w-[430px]") }>
        {availableViews.map((candidate) => (
          <button key={candidate} type="button" onClick={() => { setSelectedSavedViewId(""); replaceParams({ view: candidate, page: null, ready: candidate === "review" ? draft.ready || null : null }) }} className={cn("min-h-11 px-3 text-sm font-medium transition-colors lg:min-h-10", view === candidate ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {t(`view.${candidate}`)}{candidate === "review" && data ? <span className="ml-2 rounded-full bg-background/15 px-1.5 py-0.5 text-[10px]">{data.summary.readyL1 + data.summary.readyL2}</span> : null}
          </button>
        ))}
      </nav>

      {data ? (
        <section data-testid={`mtm-pharmacy-role-guide-${persona}`} className="flex items-start gap-3 border border-primary/20 bg-primary/[0.04] p-3 sm:p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            {persona === "agent" ? <FilePlus2 className="h-5 w-5" /> : persona === "reader" ? <Building2 className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{t(`roleGuide.${persona}.title`)}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t(`roleGuide.${persona}.hint`)}</p>
          </div>
        </section>
      ) : null}

      <MtmWorkflowGuide
        title={t("clarityGuide.title")}
        description={t("clarityGuide.description")}
        steps={availableViews.map((candidate) => ({
          title: t(`view.${candidate}`),
          icon: candidate === "registry" ? FilePlus2 : candidate === "review" ? ClipboardCheck : Building2,
          active: view === candidate,
          onClick: () => {
            setSelectedSavedViewId("")
            replaceParams({ view: candidate, page: null, ready: candidate === "review" ? draft.ready || null : null })
          },
        }))}
      />

      {data && !data.capabilities.postingEnabled && view !== "campaigns" ? (
        <div className="flex gap-3 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">{t("postingBlockedTitle")}</span>{" "}
            {data.capabilities.canConfigure ? t("postingBlockedAdminHint") : t("postingBlockedUserHint")}
          </div>
          {data.capabilities.canConfigure ? (
            <Button variant="outline" size="sm" className="min-h-11 shrink-0 border-amber-400 bg-background text-foreground" onClick={() => replaceParams({ view: "campaigns", page: null })}>{t("openCampaignSettings")}</Button>
          ) : null}
        </div>
      ) : null}

      {view !== "campaigns" ? (
        <>
          {view === "registry" && data?.capabilities.canCreateExecution ? <PharmacyPromotionAgentCapture scopeKey={data.syncScopeKey} /> : null}
          <details aria-label={t("savedViewsLabel")} className="group border border-zinc-200/70 bg-card dark:border-zinc-800">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium marker:hidden">
              <Bookmark className="h-4 w-4 text-muted-foreground" />
              {t("savedViewsLabel")}
              {selectedSavedView ? <span className="max-w-[14rem] truncate rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary" title={selectedSavedView.name}>{selectedSavedView.name}</span> : null}
            </summary>
            <div className="border-t border-zinc-200/70 p-3 dark:border-zinc-800">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Select label={t("savedViewsLabel")} value={selectedSavedViewId} disabled={savedViewsLoading} className="min-h-11 lg:min-h-10" onChange={(event) => applySavedView(event.target.value)}>
                    <option value="">{savedViewsLoading ? t("savedViewsLoading") : t("savedViewsNoneSelected")}</option>
                    {savedViews.map((savedView) => <option key={savedView.id} value={savedView.id}>{savedView.name}{savedView.isDefault ? ` · ${t("defaultView")}` : ""}</option>)}
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <Button className="min-h-11 lg:min-h-9" variant="outline" onClick={() => setShowSaveView((value) => !value)} aria-expanded={showSaveView}><Bookmark className="mr-2 h-4 w-4" />{t("saveView")}</Button>
                  <Button className="min-h-11 lg:min-h-9" variant="ghost" disabled={!selectedSavedViewId || deletingView} onClick={deleteSelectedView}><Trash2 className="mr-2 h-4 w-4" />{t("deleteSavedView")}</Button>
                </div>
              </div>
              {showSaveView ? (
                <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-[minmax(220px,1fr)_auto_auto] sm:items-end">
                  <LabeledInput label={t("savedViewName")} value={savedViewName} maxLength={80} placeholder={t("savedViewNamePlaceholder")} className="min-h-11 lg:min-h-10" onChange={(event) => setSavedViewName(event.target.value)} />
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input className="h-5 w-5" type="checkbox" checked={savedViewDefault} onChange={(event) => setSavedViewDefault(event.target.checked)} />{t("makeDefaultView")}</label>
                  <div className="grid grid-cols-2 gap-2 sm:flex"><Button className="min-h-11 lg:min-h-9" variant="ghost" onClick={() => { setShowSaveView(false); setSavedViewName(""); setSavedViewDefault(false) }} disabled={savingView}>{t("cancel")}</Button><Button className="min-h-11 lg:min-h-9" onClick={saveCurrentView} disabled={savingView || !data || !savedViewName.trim()}>{savingView ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="mr-2 h-4 w-4" />}{t("save")}</Button></div>
                </div>
              ) : null}
            </div>
          </details>

          <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <SummaryCard icon={Building2} label={t("summary.executions")} value={data?.summary.executions ?? "—"} hint={data ? t("asOf", { date: formatDate(data.asOf, locale, true) }) : undefined} tone="blue" />
            <SummaryCard icon={ClipboardCheck} label="L1" value={data?.summary.readyL1 ?? "—"} hint={t("summary.readyReview")} tone="amber" />
            <SummaryCard icon={BadgeCheck} label="L2" value={data?.summary.readyL2 ?? "—"} hint={t("summary.readyReview")} tone="violet" />
            <SummaryCard icon={Calculator} label={t("summary.difference")} value={formatPoints(data?.summary.difference ?? null, locale)} hint={`${t("summary.fact")}: ${formatPoints(data?.summary.factPoints ?? null, locale)} · ${t("summary.reward")}: ${formatPoints(data?.summary.rewardPoints ?? null, locale)}`} tone="emerald" />
          </section>

          <section aria-label={t("filtersLabel")} className="border border-zinc-200/70 bg-card dark:border-zinc-800">
            <div className="grid gap-2 p-3 [&_input]:min-h-11 [&_select]:min-h-11 md:grid-cols-[minmax(220px,1.5fr)_minmax(150px,1fr)_minmax(170px,1fr)_auto] lg:[&_input]:min-h-10 lg:[&_select]:min-h-10">
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label={t("search")} value={draft.q ?? ""} onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") applyFilters() }} placeholder={t("searchPlaceholder")} className="pl-9" /></div>
              <Select aria-label={t("department")} value={draft.departmentId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, departmentId: event.target.value, employeeId: "" }))}><option value="">{t("allDepartments")}</option>{data?.filters.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</Select>
              <Select aria-label={t("employee")} value={draft.employeeId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, employeeId: event.target.value }))}><option value="">{t("allEmployees")}</option>{data?.filters.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</Select>
              <div className="flex gap-2"><Button onClick={applyFilters} className="min-h-11 flex-1 lg:min-h-9 md:flex-none"><Filter className="mr-2 h-4 w-4" />{t("applyFilters")}</Button><Button data-testid="mtm-pharmacy-advanced-filters" className="min-h-11 min-w-11 lg:min-h-9 lg:min-w-9" variant="outline" size="icon" aria-label={t("advancedFilters")} aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}><SlidersHorizontal className="h-4 w-4" /></Button></div>
            </div>
            {activeFilterChips.length > 0 ? (
              <div data-testid="mtm-pharmacy-active-filters" className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
                <span className="mr-1 text-xs font-semibold text-muted-foreground">{t("activeFilters", { count: activeFilterChips.length })}</span>
                {activeFilterChips.map((filter) => (
                  <button key={filter.key} type="button" onClick={() => replaceParams({ [filter.key]: null, page: null })} aria-label={t("clearFilter", { filter: `${filter.label}: ${filter.value}` })} className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border bg-background px-3 text-xs transition-colors hover:border-primary hover:text-primary">
                    <span className="truncate"><strong>{filter.label}:</strong> {filter.value}</span><XCircle className="h-3.5 w-3.5 shrink-0" />
                  </button>
                ))}
                <Button variant="ghost" size="sm" className="min-h-9" onClick={resetFilters}>{t("resetFilters")}</Button>
              </div>
            ) : null}
            {advanced && !compactFilterLayout ? (
              <div className="space-y-3 border-t bg-muted/20 p-3 [&_input]:min-h-11 [&_select]:min-h-11 lg:[&_input]:min-h-10 lg:[&_select]:min-h-10">
                {advancedFilterFields}
                <div className="flex justify-end"><Button variant="ghost" onClick={resetFilters} className="min-h-11 lg:min-h-9"><XCircle className="mr-2 h-4 w-4" />{t("resetFilters")}</Button></div>
              </div>
            ) : null}
          </section>

          <Sheet open={advanced && compactFilterLayout} onOpenChange={setAdvanced}>
            <SheetContent
              side="right"
              data-testid="mtm-pharmacy-filter-sheet"
              className="flex h-dvh w-full flex-col gap-0 overflow-hidden p-0 [&>button]:grid [&>button]:min-h-11 [&>button]:min-w-11 [&>button]:place-items-center sm:max-w-full lg:max-w-3xl"
            >
              <SheetHeader className="border-b px-4 py-4 pr-14 text-left sm:px-6">
                <SheetTitle>{t("filterSheetTitle")}</SheetTitle>
                <SheetDescription>{t("filterSheetDescription")}</SheetDescription>
              </SheetHeader>
              <div data-testid="mtm-pharmacy-filter-scroll" className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4 pb-28 [&_input]:min-h-11 [&_select]:min-h-11 sm:p-6 sm:pb-28">
                {advancedFilterFields}
              </div>
              <SheetFooter className="absolute inset-x-0 bottom-0 grid grid-cols-2 gap-2 border-t bg-background/95 p-4 backdrop-blur sm:flex sm:space-x-0 sm:px-6">
                <Button data-testid="mtm-pharmacy-filter-reset" className="min-h-11" variant="outline" onClick={() => { resetFilters(); setAdvanced(false) }}>{t("resetFilters")}</Button>
                <Button data-testid="mtm-pharmacy-filter-apply" className="min-h-11" onClick={() => { applyFilters(); setAdvanced(false) }}><Filter className="mr-2 h-4 w-4" />{t("showResults")}</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          {loadError ? <div role="alert" className="flex items-start justify-between gap-3 border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"><span className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{loadError}</span><Button className="min-h-11 lg:min-h-8" variant="outline" size="sm" onClick={() => setRefreshKey((value) => value + 1)}>{t("retry")}</Button></div> : null}

          {data?.capabilities.canBulkReview && selected.size > 0 ? (
            <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 border border-primary/30 bg-background/95 p-3 shadow-lg backdrop-blur">
              <div><span className="font-semibold">{t("selectedCount", { count: selected.size })}</span>{!bulkReady ? <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">{t("sameStepRequired")}</span> : null}</div>
              <div className="flex gap-2"><Button className="min-h-11 xl:min-h-8" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>{t("clearSelection")}</Button><Button className="min-h-11 xl:min-h-8" size="sm" disabled={!bulkReady} onClick={() => setReviewRows(selectedRows)}><ClipboardCheck className="mr-2 h-4 w-4" />{t("reviewSelected")}</Button></div>
            </div>
          ) : null}

          <section className="border border-zinc-200/70 bg-card dark:border-zinc-800">
            {showColumnControls && data ? (
              <div data-testid="mtm-pharmacy-column-toolbar" className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{tabletLandscape ? t("tabletWorkspaceTitle") : t("tableSettingsTitle")}</p>
                  <p className="text-xs text-muted-foreground">{tabletLandscape ? t("tabletWorkspaceHint") : t("tableSettingsHint")}</p>
                </div>
                <div className="flex min-h-11 items-center gap-2">
                  <Select aria-label={t("densityLabel")} value={density} className="min-h-11 min-w-[150px]" onChange={(event) => changeDensity(event.target.value as "compact" | "comfortable")}>
                    <option value="comfortable">{t("density.comfortable")}</option>
                    <option value="compact">{t("density.compact")}</option>
                  </Select>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button data-testid="mtm-pharmacy-column-chooser" className="min-h-11" variant="outline"><Columns3 className="mr-2 h-4 w-4" />{t("columnChooser")}</Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 p-3">
                      <div>
                        <p className="font-semibold">{t("columnChooserTitle")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{t("columnChooserHint")}</p>
                      </div>
                      <div className="mt-3 space-y-1">
                        {PHARMACY_PROMOTION_SECONDARY_COLUMNS.map((column) => {
                          const checked = visibleColumns.has(column)
                          return (
                            <label key={column} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md px-2 text-sm hover:bg-muted">
                              <span>{t(`column.${column}`)}</span>
                              <input
                                data-testid={`mtm-pharmacy-column-${column}`}
                                type="checkbox"
                                className="h-5 w-5"
                                checked={checked}
                                disabled={checked && visibleColumns.size === 1}
                                onChange={() => toggleColumn(column)}
                              />
                            </label>
                          )
                        })}
                      </div>
                      <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">{t("requiredColumnsHint")}</p>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            ) : null}
            {loading && !data ? <div className="grid min-h-80 place-items-center"><div className="text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary motion-reduce:animate-none" /><p className="mt-3 text-sm text-muted-foreground">{t("loading")}</p></div></div> : rows.length === 0 ? <div className="grid min-h-72 place-items-center p-8 text-center"><div><Search className="mx-auto h-9 w-9 text-muted-foreground" /><h3 className="mt-3 font-semibold">{t("emptyTitle")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p></div></div> : (
              <>
                <div className="hidden overflow-x-auto xl:block">
                  <table className={cn("w-full border-collapse text-xs", visibleColumns.size > 5 ? "min-w-[1380px]" : "min-w-[920px]")}>
                    <caption className="sr-only">{t("registryCaption")}</caption>
                    <thead className="sticky top-0 z-10 bg-muted/95 text-left backdrop-blur">
                      <tr className="border-b">
                        {data?.capabilities.canBulkReview ? <th className="sticky left-0 z-20 w-10 bg-muted/95 px-3 py-2"><input type="checkbox" aria-label={t("selectPage")} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(allReviewableOnPage.map((row) => row.id)))} /></th> : null}
                        <th className={cn("sticky z-20 bg-muted/95 px-3 py-2 font-semibold shadow-[8px_0_12px_-12px_rgba(0,0,0,.45)]", data?.capabilities.canBulkReview ? "left-10" : "left-0")}>{t("pharmacy")}</th>
                        {visibleColumns.has("promotion") ? <th className="px-3 py-2 font-semibold">{t("promotion")}</th> : null}
                        {visibleColumns.has("employee") ? <th className="px-3 py-2 font-semibold">{t("employee")}</th> : null}
                        {visibleColumns.has("planFact") ? <th className="px-3 py-2 text-right font-semibold">{t("planFact")}</th> : null}
                        {visibleColumns.has("factPoints") ? <th className="px-3 py-2 text-right font-semibold">{t("summary.fact")}</th> : null}
                        {visibleColumns.has("rewardPoints") ? <th className="px-3 py-2 text-right font-semibold">{t("summary.reward")}</th> : null}
                        {visibleColumns.has("difference") ? <th className="px-3 py-2 text-right font-semibold">{t("summary.difference")}</th> : null}
                        {visibleColumns.has("review") ? <th className="px-3 py-2 font-semibold">L1 / L2</th> : null}
                        {visibleColumns.has("source") ? <th className="px-3 py-2 font-semibold">{t("source")}</th> : null}
                        <th className="sticky right-0 z-20 bg-muted/95 px-3 py-2 font-semibold shadow-[-8px_0_12px_-12px_rgba(0,0,0,.45)]">{t("actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map((row) => {
                        const points = row.ledger.posted ? row.ledger : row.preview
                        return (
                          <tr data-testid={`mtm-pharmacy-promotion-${row.id}`} key={row.id} className={cn("group align-top transition-colors hover:bg-muted/30", selected.has(row.id) && "bg-primary/5", row.source.freshness.state === "STALE" && "opacity-75")}>
                            {data?.capabilities.canBulkReview ? <td className={cn("sticky left-0 z-10 px-3 group-hover:bg-muted", cellPadding, selected.has(row.id) ? "bg-primary/5" : "bg-card")}><input type="checkbox" aria-label={t("selectRow", { name: row.target.customerName })} disabled={!row.currentStep} checked={selected.has(row.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next })} /></td> : null}
                            <td className={cn("sticky z-10 max-w-[240px] px-3 shadow-[8px_0_12px_-12px_rgba(0,0,0,.45)] group-hover:bg-muted", cellPadding, data?.capabilities.canBulkReview ? "left-10" : "left-0", selected.has(row.id) ? "bg-primary/5" : "bg-card")}><Link href={`/mtm/promotions/${row.id}?returnTo=${encodeURIComponent(`${pathname}?${searchKey}`)}`} className="font-semibold hover:text-primary hover:underline">{row.target.customerName}</Link><p className="mt-0.5 truncate text-muted-foreground">{registrationLabel(row)}</p><p className="truncate text-muted-foreground">{row.target.address || row.target.locality || "—"}</p></td>
                            {visibleColumns.has("promotion") ? <td className={cn("max-w-[230px] px-3", cellPadding)}><p className="font-medium">{localizedName(row.promotion, locale)}</p><p className="text-muted-foreground">{row.promotion.code} · {row.promotion.type.code} · v{row.promotion.revision}</p></td> : null}
                            {visibleColumns.has("employee") ? <td className={cn("max-w-[200px] px-3", cellPadding)}><p className="font-medium">{row.employee.name}</p><p className="truncate text-muted-foreground">{t("userGroupValue", { value: row.employee.userGroups?.map((group) => group.name).join(", ") || row.employee.team?.name || "—" })}</p><p className="truncate text-muted-foreground">{t("managerValue", { value: row.employee.manager?.name || "—" })}</p></td> : null}
                            {visibleColumns.has("planFact") ? <td className={cn("px-3 text-right tabular-nums", cellPadding)}><p>{formatPoints(row.target.planQuantity, locale)} / <span className="font-semibold">{formatPoints(row.factQuantity, locale)}</span></p><p className="text-[10px] text-muted-foreground">{row.target.unit}</p></td> : null}
                            {visibleColumns.has("factPoints") ? <td className={cn("px-3 text-right font-semibold tabular-nums", cellPadding)}>{formatPoints(points.factPoints, locale)}</td> : null}
                            {visibleColumns.has("rewardPoints") ? <td className={cn("px-3 text-right font-semibold tabular-nums", cellPadding)}>{formatPoints(points.rewardPoints, locale)}</td> : null}
                            {visibleColumns.has("difference") ? <td className={cn("px-3 text-right font-semibold tabular-nums", cellPadding)}>{formatPoints(points.difference, locale)}</td> : null}
                            {visibleColumns.has("review") ? <td className={cn("px-3", cellPadding)}><div className="flex gap-1"><PromotionStatusBadge status={row.l1State} label={`L1 ${stateLabel(row.l1State)}`} /><PromotionStatusBadge status={row.l2State} label={`L2 ${stateLabel(row.l2State)}`} /></div>{row.eligibility.overridden ? <Badge className="mt-1" variant="warning" title={row.eligibility.overrideReason ?? undefined}>{t("eligibilityOverrideActive")}</Badge> : null}<p className="mt-1 text-[10px] text-muted-foreground">{nextResponsibleLabel(row.nextResponsible)}</p>{!row.policy.ready ? <p className="mt-1 max-w-[210px] truncate text-[10px] text-amber-700 dark:text-amber-300" title={row.policy.blockers.map(blockerLabel).join(", ")}>{row.policy.blockers.map(blockerLabel).join(" · ")}</p> : null}</td> : null}
                            {visibleColumns.has("source") ? <td className={cn("px-3", cellPadding)}><PromotionStatusBadge status={row.source.freshness.state} label={freshnessLabel(row.source.freshness.state)} /><p className="mt-1 text-[10px] text-muted-foreground">{formatDate(row.source.observedAt, locale, true)}</p>{row.source.freshness.ageMinutes !== null ? <p className="text-[10px] text-muted-foreground">{t("freshnessAge", { minutes: row.source.freshness.ageMinutes })}</p> : null}</td> : null}
                            <td className={cn("sticky right-0 z-10 px-3 shadow-[-8px_0_12px_-12px_rgba(0,0,0,.45)] group-hover:bg-muted", cellPadding, selected.has(row.id) ? "bg-primary/5" : "bg-card")}><div className="flex gap-1"><Button asChild variant="ghost" size="sm"><Link href={`/mtm/promotions/${row.id}?returnTo=${encodeURIComponent(`${pathname}?${searchKey}`)}`}>{t("open")}</Link></Button>{data?.capabilities.canReview && row.currentStep ? <Button data-testid={`mtm-pharmacy-review-${row.id}`} size="sm" onClick={() => setReviewRows([row])}>{t("review")}</Button> : null}</div></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {tabletLandscape && focusedRow && focusedPoints ? (
                  <div data-testid="mtm-pharmacy-tablet-master-detail" className="grid min-h-[560px] grid-cols-[minmax(320px,0.9fr)_minmax(0,1.25fr)]">
                    <section aria-label={t("tabletMasterLabel")} className="max-h-[calc(100vh-10rem)] overflow-y-auto border-r">
                      <div className="sticky top-0 z-10 border-b bg-background/95 px-3 py-2 backdrop-blur">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("tabletMasterLabel")}</p>
                        <p className="text-sm font-semibold">{t("resultCount", { count: rows.length })}</p>
                      </div>
                      <div className="divide-y">
                        {rows.map((row) => {
                          const points = row.ledger.posted ? row.ledger : row.preview
                          const focused = row.id === focusedRow.id
                          return (
                            <div key={row.id} data-testid={`mtm-pharmacy-tablet-row-${row.id}`} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start transition-colors", focused && "bg-primary/[0.08]", selected.has(row.id) && "shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
                              <button
                                type="button"
                                aria-pressed={focused}
                                onClick={() => setFocusedRowId(row.id)}
                                className={cn("min-h-11 min-w-0 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary", density === "compact" && "py-2")}
                              >
                                <span className="flex items-start justify-between gap-2">
                                  <span className="min-w-0">
                                    <span className="block truncate font-semibold">{row.target.customerName}</span>
                                    <span className="block truncate text-xs text-muted-foreground">{registrationLabel(row)} · {row.target.locality || "—"}</span>
                                  </span>
                                  <ChevronRight className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", focused && "translate-x-0.5 text-primary")} />
                                </span>
                                <span className="mt-2 flex flex-wrap gap-1">
                                  <PromotionStatusBadge status={row.status} label={stateLabel(row.status)} />
                                  {visibleColumns.has("source") ? <PromotionStatusBadge status={row.source.freshness.state} label={freshnessLabel(row.source.freshness.state)} /> : null}
                                </span>
                                <span className="mt-2 grid grid-cols-2 gap-2 text-xs">
                                  {visibleColumns.has("employee") ? <span className="truncate text-muted-foreground">{row.employee.name}</span> : null}
                                  {visibleColumns.has("promotion") ? <span className="truncate text-right font-medium">{row.promotion.code}</span> : null}
                                  {visibleColumns.has("planFact") ? <span className="tabular-nums">{t("planFact")}: {formatPoints(row.target.planQuantity, locale)} / {formatPoints(row.factQuantity, locale)}</span> : null}
                                  {visibleColumns.has("factPoints") ? <span className="text-right font-semibold tabular-nums">{t("summary.fact")}: {formatPoints(points.factPoints, locale)}</span> : null}
                                </span>
                              </button>
                              {data?.capabilities.canBulkReview && row.currentStep ? (
                                <label className="grid min-h-11 min-w-11 cursor-pointer place-items-center" title={t("selectRow", { name: row.target.customerName })}>
                                  <span className="sr-only">{t("selectRow", { name: row.target.customerName })}</span>
                                  <input type="checkbox" className="h-5 w-5" checked={selected.has(row.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next })} />
                                </label>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    </section>

                    <aside data-testid="mtm-pharmacy-tablet-inspector" data-execution-id={focusedRow.id} aria-label={t("tabletDetailLabel")} className="sticky top-3 self-start p-4">
                      <div className="flex items-start gap-3 border-b pb-4">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><PanelRight className="h-5 w-5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{t("tabletDetailLabel")}</p>
                          <h2 className="mt-0.5 truncate text-xl font-semibold">{focusedRow.target.customerName}</h2>
                          <p className="truncate text-xs text-muted-foreground">{registrationLabel(focusedRow)} · {focusedRow.target.address || focusedRow.target.locality || "—"}</p>
                        </div>
                      </div>

                      <div data-testid="mtm-pharmacy-tablet-source-facts" data-source-visible={visibleColumns.has("source")} className="mt-4 flex flex-wrap gap-1.5">
                        <PromotionStatusBadge status={focusedRow.status} label={stateLabel(focusedRow.status)} />
                        {visibleColumns.has("source") ? <PromotionStatusBadge status={focusedRow.source.freshness.state} label={freshnessLabel(focusedRow.source.freshness.state)} /> : null}
                        {focusedRow.eligibility.overridden ? <Badge variant="warning">{t("eligibilityOverrideActive")}</Badge> : null}
                      </div>

                      {(visibleColumns.has("planFact") || visibleColumns.has("factPoints") || visibleColumns.has("rewardPoints") || visibleColumns.has("difference")) ? (
                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {visibleColumns.has("planFact") ? <div className="border bg-muted/20 p-2"><p className="text-[10px] uppercase text-muted-foreground">{t("planFact")}</p><p className="mt-1 font-semibold tabular-nums">{formatPoints(focusedRow.target.planQuantity, locale)} / {formatPoints(focusedRow.factQuantity, locale)}</p></div> : null}
                          {visibleColumns.has("factPoints") ? <div className="border bg-muted/20 p-2"><p className="text-[10px] uppercase text-muted-foreground">{t("summary.fact")}</p><p className="mt-1 font-semibold tabular-nums">{formatPoints(focusedPoints.factPoints, locale)}</p></div> : null}
                          {visibleColumns.has("rewardPoints") ? <div className="border bg-muted/20 p-2"><p className="text-[10px] uppercase text-muted-foreground">{t("summary.reward")}</p><p className="mt-1 font-semibold tabular-nums">{formatPoints(focusedPoints.rewardPoints, locale)}</p></div> : null}
                          {visibleColumns.has("difference") ? <div className="border bg-muted/20 p-2"><p className="text-[10px] uppercase text-muted-foreground">{t("summary.difference")}</p><p className="mt-1 font-semibold tabular-nums">{formatPoints(focusedPoints.difference, locale)}</p></div> : null}
                        </div>
                      ) : null}

                      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-y py-4 text-sm">
                        {visibleColumns.has("promotion") ? <><dt className="text-muted-foreground">{t("promotion")}</dt><dd className="truncate text-right">{localizedName(focusedRow.promotion, locale)} · v{focusedRow.promotion.revision}</dd></> : null}
                        {visibleColumns.has("employee") ? <><dt className="text-muted-foreground">{t("employee")}</dt><dd className="truncate text-right">{focusedRow.employee.name}</dd><dt className="text-muted-foreground">{t("manager")}</dt><dd className="truncate text-right">{focusedRow.employee.manager?.name || "—"}</dd></> : null}
                        {visibleColumns.has("review") ? <><dt className="text-muted-foreground">L1 / L2</dt><dd className="text-right">{stateLabel(focusedRow.l1State)} / {stateLabel(focusedRow.l2State)}</dd><dt className="text-muted-foreground">{t("nextResponsibleLabel")}</dt><dd className="text-right">{nextResponsibleLabel(focusedRow.nextResponsible)}</dd></> : null}
                        {visibleColumns.has("source") ? <><dt className="text-muted-foreground">{t("evidence")}</dt><dd className="text-right">{t("evidenceCount", { count: focusedRow.evidenceCount })}</dd><dt className="text-muted-foreground">{t("sourceObservedAt")}</dt><dd className="text-right">{formatDate(focusedRow.source.observedAt, locale, true)}</dd></> : null}
                      </dl>

                      {!focusedRow.policy.ready ? <div className="mt-4 flex gap-2 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{focusedRow.policy.blockers.map(blockerLabel).join(" · ")}</span></div> : null}

                      <div className={cn("mt-4 grid gap-2", data?.capabilities.canReview && focusedRow.currentStep ? "grid-cols-2" : "grid-cols-1")}>
                        <Button className="min-h-11" asChild variant="outline"><Link href={`/mtm/promotions/${focusedRow.id}?returnTo=${encodeURIComponent(`${pathname}?${searchKey}`)}`}>{t("details")}</Link></Button>
                        {data?.capabilities.canReview && focusedRow.currentStep ? <Button data-testid={`mtm-pharmacy-review-${focusedRow.id}`} className="min-h-11" onClick={() => setReviewRows([focusedRow])}>{t("reviewStep", { step: focusedRow.currentStep })}</Button> : null}
                      </div>
                    </aside>
                  </div>
                ) : null}

                {!tabletLandscape ? <div className="grid gap-3 p-3 xl:hidden md:grid-cols-2">
                  {rows.map((row) => {
                    const points = row.ledger.posted ? row.ledger : row.preview
                    return (
                      <article data-testid={`mtm-pharmacy-promotion-${row.id}`} key={row.id} aria-labelledby={`promotion-execution-${row.id}`} className={cn("border border-zinc-200/70 p-3 dark:border-zinc-800", selected.has(row.id) && "border-primary bg-primary/5", row.source.freshness.state === "STALE" && "border-dashed opacity-80")}>
                        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 id={`promotion-execution-${row.id}`}><Link href={`/mtm/promotions/${row.id}?returnTo=${encodeURIComponent(`${pathname}?${searchKey}`)}`} className="block break-words font-semibold hover:text-primary hover:underline">{row.target.customerName}</Link></h2><p className="mt-0.5 truncate text-xs text-muted-foreground">{registrationLabel(row)} · {row.target.locality || "—"}</p></div>{data?.capabilities.canBulkReview && row.currentStep ? <label className="grid min-h-11 min-w-11 shrink-0 cursor-pointer place-items-center"><span className="sr-only">{t("selectRow", { name: row.target.customerName })}</span><input type="checkbox" aria-label={t("selectRow", { name: row.target.customerName })} checked={selected.has(row.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next })} className="h-5 w-5" /></label> : null}</div>
                        <div className="mt-3 flex flex-wrap gap-1"><PromotionStatusBadge status={row.status} label={stateLabel(row.status)} /><PromotionStatusBadge status={row.source.freshness.state} label={freshnessLabel(row.source.freshness.state)} /><Badge variant="outline">{row.promotion.code}</Badge>{row.eligibility.overridden ? <Badge variant="warning" title={row.eligibility.overrideReason ?? undefined}>{t("eligibilityOverrideActive")}</Badge> : null}</div>
                        <div className="mt-3 grid grid-cols-3 gap-2 border-y py-3 text-center"><div><p className="text-[10px] uppercase text-muted-foreground">{t("summary.fact")}</p><p className="font-semibold tabular-nums">{formatPoints(points.factPoints, locale)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">{t("summary.reward")}</p><p className="font-semibold tabular-nums">{formatPoints(points.rewardPoints, locale)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">{t("summary.difference")}</p><p className="font-semibold tabular-nums">{formatPoints(points.difference, locale)}</p></div></div>
                        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs"><dt className="text-muted-foreground">{t("promotion")}</dt><dd className="truncate text-right">{localizedName(row.promotion, locale)} · v{row.promotion.revision}</dd><dt className="text-muted-foreground">{t("employee")}</dt><dd className="truncate text-right">{row.employee.name}</dd><dt className="text-muted-foreground">{t("userGroup")}</dt><dd className="truncate text-right">{row.employee.userGroups?.map((group) => group.name).join(", ") || row.employee.team?.name || "—"}</dd><dt className="text-muted-foreground">{t("manager")}</dt><dd className="truncate text-right">{row.employee.manager?.name || "—"}</dd><dt className="text-muted-foreground">{t("planFact")}</dt><dd className="text-right tabular-nums">{formatPoints(row.target.planQuantity, locale)} / <strong>{formatPoints(row.factQuantity, locale)}</strong> {row.target.unit}</dd><dt className="text-muted-foreground">{t("evidence")}</dt><dd className="text-right">{t("evidenceCount", { count: row.evidenceCount })} · {formatDate(row.source.observedAt, locale, true)}</dd><dt className="text-muted-foreground">L1 / L2</dt><dd className="text-right">{stateLabel(row.l1State)} / {stateLabel(row.l2State)}</dd><dt className="text-muted-foreground">{t("nextResponsibleLabel")}</dt><dd className="text-right">{nextResponsibleLabel(row.nextResponsible)}</dd></dl>
                        {!row.policy.ready ? <div className="mt-3 flex gap-2 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="h-4 w-4 shrink-0" /><span>{row.policy.blockers.map(blockerLabel).join(" · ")}</span></div> : null}
                        <div className={cn("mt-3 grid gap-2", data?.capabilities.canReview && row.currentStep ? "grid-cols-2" : "grid-cols-1")}><Button className="min-h-11" asChild variant="outline"><Link href={`/mtm/promotions/${row.id}?returnTo=${encodeURIComponent(`${pathname}?${searchKey}`)}`}>{t("details")}</Link></Button>{data?.capabilities.canReview && row.currentStep ? <Button data-testid={`mtm-pharmacy-review-${row.id}`} className="min-h-11" onClick={() => setReviewRows([row])}>{t("reviewStep", { step: row.currentStep })}</Button> : null}</div>
                      </article>
                    )
                  })}
                </div> : null}
              </>
            )}
            {data ? <footer className="flex flex-col gap-3 border-t px-3 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><div>{t("pageInfo", { from: data.pageInfo.total ? (data.pageInfo.page - 1) * data.pageInfo.pageSize + 1 : 0, to: Math.min(data.pageInfo.page * data.pageInfo.pageSize, data.pageInfo.total), total: data.pageInfo.total })} · {t("timezone", { value: data.timezone })}</div><div className="flex items-center gap-2"><Select aria-label={t("pageSize")} value={String(data.pageInfo.pageSize)} onChange={(event) => replaceParams({ pageSize: event.target.value, page: null })} className="min-h-11 min-w-20 xl:min-h-9"><option value="25">25</option><option value="50">50</option><option value="100">100</option></Select><Button className="min-h-11 min-w-11 xl:min-h-9 xl:min-w-9" aria-label={t("previousPage")} variant="outline" size="icon" disabled={data.pageInfo.page <= 1} onClick={() => replaceParams({ page: data.pageInfo.page - 1 })}><ChevronLeft className="h-4 w-4" /></Button><span className="min-w-16 text-center" aria-label={t("currentPage", { page: data.pageInfo.page, totalPages: data.pageInfo.totalPages })}>{data.pageInfo.page} / {data.pageInfo.totalPages}</span><Button className="min-h-11 min-w-11 xl:min-h-9 xl:min-w-9" aria-label={t("nextPage")} variant="outline" size="icon" disabled={data.pageInfo.page >= data.pageInfo.totalPages} onClick={() => replaceParams({ page: data.pageInfo.page + 1 })}><ChevronRight className="h-4 w-4" /></Button></div></footer> : null}
          </section>
        </>
      ) : data?.capabilities.canConfigure ? (
        <div className="space-y-4">
          <PharmacyPromotionDefinitionAdmin onChanged={() => setRefreshKey((value) => value + 1)} />
          <PharmacyPromotionCampaignAdmin campaigns={campaigns} loading={campaignsLoading} postingEnabled={data.capabilities.postingEnabled} onChanged={() => setRefreshKey((value) => value + 1)} />
        </div>
      ) : (
        <div className="grid min-h-72 place-items-center border border-dashed p-8 text-center"><div><ShieldAlert className="mx-auto h-9 w-9 text-muted-foreground" /><h3 className="mt-3 font-semibold">{t("campaignAdminOnly")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("campaignAdminOnlyHint")}</p></div></div>
      )}

      <ReviewDialog rows={reviewRows} open={reviewRows.length > 0} onOpenChange={(open) => { if (!open) setReviewRows([]) }} onApplied={() => { setSelected(new Set()); setRefreshKey((value) => value + 1) }} />
    </div>
  )
}
