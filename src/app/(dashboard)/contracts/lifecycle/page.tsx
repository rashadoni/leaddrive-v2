"use client"

/**
 * CLM (Contract Lifecycle) — slice-2 UI.
 *
 * Two-stream dashboard: upcoming/overdue renewal alerts + contracts
 * stuck in approval, grouped by bottleneck stage. Sales-ops sees what's
 * expiring and what's blocked, in one screen.
 */
import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { DidYouKnow } from "@/components/did-you-know"
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

/** Stable DOM id for an approval-stage group card, so the bottleneck KPI can
 *  scrollIntoView its queue group. Labels are free-text, so sanitize. */
function groupDomId(label: string): string {
  return "approval-group-" + label.replace(/[^a-zA-Z0-9]+/g, "-")
}

type PendingDecision = {
  contractId: string
  stageOrder: number
  stageId: string
  decision: "approve" | "reject"
  contractNumber: string
  companyName: string | null
  contractTitle: string
  valueAmount: number | null
  currency: string
}

interface Renewal {
  id: string
  contractId: string
  contractNumber: string
  contractTitle: string
  companyName: string | null
  contractStatus: string
  endDate: string | null
  valueAmount: number | null
  currency: string
  dueAt: string
  daysUntilDue: number
  daysBeforeExpiry: number
  isOverdue: boolean
}

interface Approval {
  contractId: string
  contractNumber: string
  contractTitle: string
  companyName: string | null
  valueAmount: number | null
  currency: string
  currentStageLabel: string
  currentStageOrder: number
  currentStageId: string
  assigneeUserId: string | null
  assigneeRole: string | null
  ageMs: number
}

interface ApprovalGroup {
  label: string
  contracts: Approval[]
}

interface LifecycleResponse {
  renewals: {
    items: Renewal[]
    total: number
    overdueCount: number
    next30dCount: number
    truncated: boolean
  }
  approvals: {
    items: Approval[]
    groups: ApprovalGroup[]
    total: number
    bottleneckStage: string | null
    bottleneckCount: number
    truncated: boolean
  }
  fetchCap: number
}

function formatMoney(n: number | null, currency: string): string {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—"
  const fmt = (v: number, suffix: string) =>
    `${currency} ${v.toFixed(v >= 100 ? 0 : 1)}${suffix}`
  if (n >= 1_000_000) return fmt(n / 1_000_000, "M")
  if (n >= 1_000) return fmt(n / 1_000, "K")
  return `${currency} ${Math.round(n)}`
}

function formatAge(ms: number): string {
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) {
    const hours = Math.floor(ms / 3_600_000)
    return hours <= 1 ? "<1h" : `${hours}h`
  }
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}

function formatLocalDate(iso: string | null): string {
  if (!iso) return "—"
  // Render the calendar date in the user's local timezone — UTC
  // toISOString().slice(0,10) shifts by a day for any contract whose
  // endDate is near the tz boundary (e.g. 02:00 Baku → 22:00 UTC prev day).
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

type DueTranslator = (key: string, values?: Record<string, number>) => string
function formatDueIn(days: number, t: DueTranslator): string {
  if (days < 0) return t("overdueDays", { days: Math.abs(days) })
  if (days === 0) return t("today")
  if (days === 1) return t("tomorrow")
  return t("inDays", { days })
}

export default function ContractLifecyclePage() {
  const t = useTranslations("slice2.contractLifecycle")
  const tc = useTranslations("slice2.common")
  useAutoTour("contractLifecycle")
  const [data, setData] = useState<LifecycleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Map of stageId → "approving" | "rejecting" | null for button loading state
  const [decidingStage, setDecidingStage] = useState<Record<string, "approving" | "rejecting" | null>>({})
  // Confirm-before-decide: a decision (approve/reject) on a contract is a legal/
  // financial gate, so it goes through a Dialog (facts + reject reason) instead
  // of firing on a single list click.
  const [pending, setPending] = useState<PendingDecision | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  // Hoisted controller ref so handleDecide can abort the previous load before
  // starting a new one, preventing a stale response from overwriting fresh state.
  const loadControllerRef = useRef<AbortController | null>(null)

  const loadData = () => {
    // Abort any in-flight load before starting a new one
    loadControllerRef.current?.abort()
    const controller = new AbortController()
    loadControllerRef.current = controller
    setLoading(true)
    fetch("/api/v1/contract-lifecycle", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        setData(json)
        setError(null)
      })
      .catch((e) => {
        if (e instanceof Error && e.name === "AbortError") return
        setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
    return () => loadControllerRef.current?.abort()
  }, [])

  const handleDecide = async (
    contractId: string,
    stageOrder: number,
    stageId: string,
    decision: "approve" | "reject",
    reason?: string,
  ) => {
    setDecidingStage((prev) => ({ ...prev, [stageId]: decision === "approve" ? "approving" : "rejecting" }))
    try {
      const res = await fetch(`/api/v1/contracts/${contractId}/approvals/${stageOrder}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, ...(reason?.trim() ? { reason: reason.trim() } : {}) }),
      })
      const json = await res.json()
      if (!json.success) {
        setError(json.error || t("decideError"))
        return
      }
      // Reload lifecycle data after successful decision; previous in-flight load
      // is aborted by loadData() itself via the hoisted controller ref.
      loadData()
    } catch {
      setError(t("decideConnectError"))
    } finally {
      setDecidingStage((prev) => ({ ...prev, [stageId]: null }))
    }
  }

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6" data-tour-id="lifecycle-header">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="w-8 h-8 text-primary" />
            {t("title")}
            <TourReplayButton tourId="contractLifecycle" />
            <HelpButton slug="contracts-lifecycle" variant="label" />
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            {t("subtitle")}
          </p>
          <DidYouKnow page="contract-lifecycle" className="mt-4" />
        </header>

        {error && (
          <MotionCard className="mb-4 p-4 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </MotionCard>
        )}

        {loading && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
            {tc("loading")}
          </MotionCard>
        )}

        {!loading && data && (data.renewals.truncated || data.approvals.truncated) && (
          <MotionCard className="mb-4 p-4 border border-amber-500 bg-amber-500/10 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm">
              {t("truncatedBanner", {
                count: data.fetchCap,
                kind: data.renewals.truncated && data.approvals.truncated
                  ? t("truncatedBoth")
                  : data.renewals.truncated
                    ? t("truncatedRenewals")
                    : t("truncatedApprovals"),
              })}
            </p>
          </MotionCard>
        )}

        {!loading && data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" data-tour-id="lifecycle-kpis">
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> {t("kpiRenewalAlerts")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.renewals.total}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {t("kpiOverdueRenewals")}
                </p>
                <p
                  className={`text-2xl font-bold mt-0.5 ${
                    data.renewals.overdueCount > 0 ? "text-red-600" : ""
                  }`}
                >
                  {data.renewals.overdueCount}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <UserCheck className="w-3 h-3" /> {t("kpiPendingApproval")}
                </p>
                <p className="text-2xl font-bold mt-0.5">
                  {data.approvals.total}
                </p>
              </MotionCard>
              <MotionCard className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {t("kpiBottleneckStage")}
                </p>
                {data.approvals.bottleneckStage ? (
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById(groupDomId(data.approvals.bottleneckStage!))
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className="group mt-0.5 block w-full text-left"
                    title={t("bottleneckJump")}
                  >
                    <span className="block truncate text-sm font-semibold group-hover:text-primary group-hover:underline transition-colors">
                      {data.approvals.bottleneckStage}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("waiting", { count: data.approvals.bottleneckCount })}
                    </span>
                  </button>
                ) : (
                  <p className="text-sm font-semibold mt-0.5">—</p>
                )}
              </MotionCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-muted-foreground" />
                  {t("renewalAlerts")}
                </h2>
                {data.renewals.items.length === 0 ? (
                  <MotionCard className="p-8 text-center text-muted-foreground">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-600 opacity-70" />
                    <p className="text-sm">{t("noRenewals")}</p>
                  </MotionCard>
                ) : (
                  <div className="space-y-2">
                    {data.renewals.items.slice(0, 20).map((r) => (
                      <MotionCard
                        key={r.id}
                        className={`p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg ${
                          r.isOverdue
                            ? "border-red-500 bg-red-500/5"
                            : r.daysUntilDue <= 14
                              ? "border-amber-500 bg-amber-500/5"
                              : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold truncate flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                              {r.companyName ?? t("noCompany")}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {r.contractNumber} · {r.contractTitle}
                            </p>
                            <p className="text-xs mt-1 font-mono">
                              {formatMoney(r.valueAmount, r.currency)} ·{" "}
                              {t("alertDays", { days: r.daysBeforeExpiry })}
                            </p>
                            {/* Act-on-it: the renewals column was read-only; an Open link
                                lets you jump to the contract to renew/amend. */}
                            <a
                              href={`/contracts/${r.contractId}`}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                            >
                              <ExternalLink className="w-3 h-3" /> {t("openContract")}
                            </a>
                          </div>
                          <div className="text-right shrink-0">
                            <p
                              className={`text-sm font-semibold ${
                                r.isOverdue
                                  ? "text-red-600"
                                  : r.daysUntilDue <= 14
                                    ? "text-amber-600"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {formatDueIn(r.daysUntilDue, tc as unknown as DueTranslator)}
                            </p>
                            {r.endDate && (
                              <p className="text-xs text-muted-foreground font-mono">
                                {t("ends", { date: formatLocalDate(r.endDate) })}
                              </p>
                            )}
                          </div>
                        </div>
                      </MotionCard>
                    ))}
                    {data.renewals.items.length > 20 && (
                      <p className="text-xs text-muted-foreground text-center pt-2">
                        {t("more", { count: data.renewals.items.length - 20 })}
                      </p>
                    )}
                  </div>
                )}
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-muted-foreground" />
                  {t("approvalQueue")}
                </h2>
                {data.approvals.groups.length === 0 ? (
                  <MotionCard className="p-8 text-center text-muted-foreground">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-600 opacity-70" />
                    <p className="text-sm">{t("noApprovals")}</p>
                  </MotionCard>
                ) : (
                  <div className="space-y-3">
                    {data.approvals.groups.map((g) => (
                      <MotionCard
                        key={g.label}
                        id={groupDomId(g.label)}
                        className="p-3 border border-zinc-200 dark:border-zinc-700 rounded-lg scroll-mt-4"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-semibold">{g.label}</h3>
                          <span
                            className={`text-sm font-mono ${
                              g.contracts.length >= 3
                                ? "text-amber-600 font-semibold"
                                : "text-muted-foreground"
                            }`}
                          >
                            {t("waiting", { count: g.contracts.length })}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {g.contracts.slice(0, 5).map((c) => {
                            const deciding = decidingStage[c.currentStageId]
                            return (
                            <div
                              key={c.currentStageId}
                              className="text-sm py-1.5 border-t first:border-t-0"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate">
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {c.contractNumber}
                                    </span>{" "}
                                    · {c.companyName ?? t("noCompany")}
                                  </p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {c.contractTitle} ·{" "}
                                    {formatMoney(c.valueAmount, c.currency)}
                                  </p>
                                </div>
                                <span
                                  className={`text-xs font-mono shrink-0 ${
                                    c.ageMs > 7 * 86_400_000
                                      ? "text-red-600"
                                      : c.ageMs > 3 * 86_400_000
                                        ? "text-amber-600"
                                        : "text-muted-foreground"
                                  }`}
                                >
                                  {formatAge(c.ageMs)}
                                </span>
                              </div>
                              {/* Approve / Reject — open a confirm dialog, never fire on a single click */}
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <button
                                  onClick={() => { setRejectReason(""); setPending({ contractId: c.contractId, stageOrder: c.currentStageOrder, stageId: c.currentStageId, decision: "approve", contractNumber: c.contractNumber, companyName: c.companyName, contractTitle: c.contractTitle, valueAmount: c.valueAmount, currency: c.currency }) }}
                                  disabled={!!deciding}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-600/10 text-green-700 hover:bg-green-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                  <ThumbsUp className="w-3 h-3" />
                                  {deciding === "approving" ? "…" : t("approveStage")}
                                </button>
                                <button
                                  onClick={() => { setRejectReason(""); setPending({ contractId: c.contractId, stageOrder: c.currentStageOrder, stageId: c.currentStageId, decision: "reject", contractNumber: c.contractNumber, companyName: c.companyName, contractTitle: c.contractTitle, valueAmount: c.valueAmount, currency: c.currency }) }}
                                  disabled={!!deciding}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-600/10 text-red-700 hover:bg-red-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                  <ThumbsDown className="w-3 h-3" />
                                  {deciding === "rejecting" ? "…" : t("rejectStage")}
                                </button>
                              </div>
                            </div>
                            )
                          })}
                          {g.contracts.length > 5 && (
                            <p className="text-xs text-muted-foreground pt-1">
                              {t("more", { count: g.contracts.length - 5 })}
                            </p>
                          )}
                        </div>
                      </MotionCard>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        <div className="mt-6 text-xs text-muted-foreground space-y-1">
          <p>{t("footerRenewals")}</p>
          <p>{t("footerApprovals")}</p>
        </div>
      </div>

      {/* Confirm approve/reject — a legal/financial gate never fires on one click */}
      <Dialog open={pending !== null} onOpenChange={(o: boolean) => { if (!o) setPending(null) }} widthClassName="max-w-md">
        <DialogContent>
          {pending && (() => {
            const deciding = decidingStage[pending.stageId]
            const isReject = pending.decision === "reject"
            const reasonMissing = isReject && !rejectReason.trim()
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{isReject ? t("confirmRejectTitle") : t("confirmApproveTitle")}</DialogTitle>
                  <DialogDescription>{isReject ? t("confirmRejectDesc") : t("confirmApproveDesc")}</DialogDescription>
                </DialogHeader>
                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-0.5">
                  <p className="font-medium">{pending.companyName ?? t("noCompany")}</p>
                  <p className="text-xs text-muted-foreground">{pending.contractNumber} · {pending.contractTitle}</p>
                  <p className="text-xs font-mono">{formatMoney(pending.valueAmount, pending.currency)}</p>
                  <a href={`/contracts/${pending.contractId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                    <ExternalLink className="w-3 h-3" /> {t("openContract")}
                  </a>
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-medium mb-1">
                    {t("reasonLabel")}{isReject && <span className="text-destructive"> *</span>}
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder={t("reasonPlaceholder")}
                    rows={3}
                    maxLength={2000}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" size="sm" onClick={() => setPending(null)}>{t("cancel")}</Button>
                  <Button
                    size="sm"
                    variant={isReject ? "destructive" : "default"}
                    disabled={!!deciding || reasonMissing}
                    onClick={() => {
                      const p = pending
                      setPending(null)
                      void handleDecide(p.contractId, p.stageOrder, p.stageId, p.decision, rejectReason)
                    }}
                  >
                    {isReject ? t("confirmReject") : t("confirmApprove")}
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </MotionPage>
  )
}
