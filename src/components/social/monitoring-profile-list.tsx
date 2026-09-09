"use client"

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react"
import { useLocale, useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Activity, AlertTriangle, Archive, ArrowRight, ChartNoAxesCombined, Check, CheckCircle2, ChevronDown, ChevronUp, Eye, Facebook, Globe2, Info, Instagram,
  Loader2, MessageCircle, MoreHorizontal, Pause, Play, Plus, Radio, RotateCcw, SearchCheck, ShieldCheck, Square, Trash2, Youtube,
} from "lucide-react"
import { toast } from "sonner"
import { MonitoringProfileWizard } from "@/components/social/monitoring-profile-wizard"
import {
  MonitoringProfileLogo,
  MonitoringProfileGrid,
  type MonitoringProfileGridQueueState,
} from "@/components/social/monitoring-profile-grid"
import { MonitoringRunProgress } from "@/components/social/monitoring-run-progress"
import {
  canResumeMonitoringProfileRun,
  createMonitoringProfileRunResumeContext,
  mergeMonitoringCollectorAndProviderResult,
  monitoringCollectorResultHasPendingProvider,
  monitoringCollectorPendingProviderRunIds,
  monitoringProfileSourcesForPlatform,
  MONITORING_PROFILE_RUN_PLATFORMS,
  runMonitoringProfileSources,
  summarizeMonitoringProfileRunPlatforms,
  summarizeMonitoringProviderRuns,
  type MonitoringProfileProviderRun,
  type MonitoringProfileRunProgress,
  type MonitoringProfileRunPlatform,
  type MonitoringProfileSourceRunResult,
} from "@/lib/social/monitoring-profile-runner"
import {
  MONITORING_PROFILE_WORKFLOW_STORAGE_KEY,
  restoreMonitoringProfileWorkflowState,
  serializeMonitoringProfileWorkflowState,
  type MonitoringProfileWorkflowStage,
} from "@/lib/social/monitoring-profile-workflow-state"
import { CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD } from "@/lib/social/provider-spend-limits"
import {
  createMonitoringProfileBulkPlan,
} from "@/lib/social/monitoring-profile-bulk-run"
import {
  readSocialMonitoringRunJobResponse,
  socialMonitoringRunJobCanResume,
  socialMonitoringRunJobIsActive,
  socialMonitoringRunJobProfileCounts,
  socialMonitoringRunJobProfileQueueState,
  type SocialMonitoringRunJob,
} from "@/lib/social/monitoring-run-job-client"

type ProfileStatus = "active" | "paused" | "needs_resume" | "archived"
type WorkflowStage = MonitoringProfileWorkflowStage
type MonitoringProfileRunMode = "full" | "comments_only"

function preferredProfileStage(profile: Profile): WorkflowStage {
  return profile.findings.total > 0 || Boolean(profile.lastCollectedAt)
    ? "results"
    : "collection"
}

type PlatformCoverage = {
  platform: string
  scope: "selected_sources" | "broad_search" | "mixed" | "not_configured"
  collectionState: "configured" | "limited" | "needs_setup" | "paused" | "not_configured"
  commentState: "off" | "configured" | "limited" | "needs_setup"
  completeness: "confirmed_for_input" | "partial" | "pending" | "blocked" | "unknown"
  sourceCount: number
  activeSourceCount: number
  latestFoundCount: number
  latestAcceptedCount: number
  latestRejectedCount: number
  latestDuplicateCount: number
  latestRunStatuses: string[]
  latestCheckedAt: string | null
  lastSuccessfulAt: string | null
  lastError: string | null
  fullPlatformCoverage: false
}

type Profile = {
  id: string
  subjectId: string | null
  scenarioId: string | null
  name: string
  logoUrl: string | null
  status: ProfileStatus
  platforms: string[]
  directions: string[]
  sources: Array<{
    id: string
    platform: string
    sourceType: string
    label: string
    status: string
    isActive: boolean
    paid: boolean
    providerAccountFundedOnly: boolean
    commentsOnlyEligible: boolean
    maxTotalChargeUsd: number | null
    sharedAcrossMonitorings: boolean
  }>
  coverage: PlatformCoverage[]
  commentsEnabled: boolean
  archive: { matchedCount: number; scannedCount: number; status: string } | null
  findings: { total: number; new: number; last24Hours: number; last7Days: number; posts: number; comments: number; media: number; positive: number; neutral: number; negative: number; needsReview: number; needsAction: number }
  findingsByPlatform: Record<string, number>
  lastCollectedAt: string | null
  lastUpdatedAt: string
}

export type MonitoringProfileWorkspaceItem = Pick<
  Profile,
  "id" | "subjectId" | "name" | "logoUrl" | "status"
>

export type MonitoringProfileFindingsTarget = {
  platform?: Exclude<MonitoringProfileRunPlatform, "all">
  surface?: "posts" | "comments" | "media"
  sentiment?: "negative"
  status?: "new"
  dateRange?: "24h"
}

const noopMonitoringRunActivity = () => undefined
const MONITORING_RUN_JOB_POLL_MS = 2_000

const EXTERNAL_COMMENT_PLATFORMS = new Set(["facebook", "instagram", "tiktok"])

function monitoringProfileCommentsOnlySources(
  profile: Profile,
  platform: MonitoringProfileRunPlatform = "all",
) {
  if (!profile.commentsEnabled) return []
  const eligibleSourceIds = new Set(
    profile.sources
      .filter(source => (
        source.commentsOnlyEligible
        && source.paid
        && !source.providerAccountFundedOnly
      ))
      .filter(source => EXTERNAL_COMMENT_PLATFORMS.has(source.platform.toLowerCase()))
      .map(source => source.id),
  )
  return monitoringProfileSourcesForPlatform(profile.sources, platform)
    .filter(source => eligibleSourceIds.has(source.id))
}

function monitoringProfileRunRevision(profile: Profile): string {
  return JSON.stringify({
    scenarioId: profile.scenarioId,
    lastUpdatedAt: profile.lastUpdatedAt,
    platforms: [...profile.platforms].sort(),
    sources: profile.sources
      .map(source => ({
        id: source.id,
        platform: source.platform,
        isActive: source.isActive,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  })
}

type RunSourceApiResponse = {
  success?: boolean
  error?: string
  retryAfterSeconds?: number
  providerAccountFundedOnly?: boolean
  maxTotalChargeUsd?: number | null
  data?: MonitoringProfileSourceRunResult & { sharedAcrossMonitorings?: boolean }
}

type ProviderRunsApiResponse = {
  success?: boolean
  error?: string
  data?: MonitoringProfileProviderRun[]
}

type ReviewApplyRunState = "APPLIED" | "ROLLED_BACK" | "FINALIZED" | "FAILED"

type ReviewSafeApplyPlan = {
  mode: "SAFE_RESOLVE"
  planFingerprint: string
  eligibleLinks: number
  eligibleRows: number
  rejectLinks: number
  rejectRows: number
  releaseLinks: number
  releaseRows: number
  protectedMixedLinks: number
  protectedMixedRows: number
  protectedSharedLinks: number
  protectedSharedRows: number
  protectedStoredDecisionLinks: number
  protectedStoredDecisionRows: number
  protectedPreviousDecisionLinks: number
  protectedPreviousDecisionRows: number
  protectedRetentionLinks: number
  protectedRetentionRows: number
  rollbackUntil: string | null
}

type ReviewApplyRun = {
  id: string
  state: ReviewApplyRunState
  appliedGroupCount: number
  appliedRowCount: number
  rollbackUntil: string
  createdAt: string
  rolledBackAt: string | null
  finalizedAt: string | null
  rollbackAvailable: boolean
}

type ReviewDryRunSummary = {
  resolverVersion: string
  totalRows: number
  uniqueCandidates: number
  duplicateRows: number
  decisions: {
    reject: number
    release: number
    review: number
  }
  reasonBreakdown: Array<{
    reason: string
    count: number
  }>
  generatedAt: string
  safeApply: ReviewSafeApplyPlan
  latestRun: ReviewApplyRun | null
}

type ReviewDryRunApiResponse = {
  success?: boolean
  error?: string
  data?: ReviewDryRunSummary
}

type ReviewApplyApiResponse = {
  success?: boolean
  error?: string
  data?: {
    run?: ReviewApplyRun
  }
}

type ReviewApplyPhase =
  | "idle"
  | "confirm_apply"
  | "applying"
  | "confirm_rollback"
  | "rolling_back"

type ReviewApplyError =
  | "apply"
  | "stale"
  | "already_active"
  | "idempotency_conflict"
  | "nothing_eligible"
  | "rollback_window_unavailable"
  | "rollback"
  | "rollback_unavailable"

const PROVIDER_POLL_INTERVAL_MS = 5_000
const PROVIDER_POLL_MAX_ATTEMPTS = 240
const PROVIDER_TERMINAL_CONFIRMATION_POLLS = 2

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isReviewApplyRun(value: unknown): value is ReviewApplyRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const run = value as Record<string, unknown>
  return (
    typeof run.id === "string"
    && ["APPLIED", "ROLLED_BACK", "FINALIZED", "FAILED"].includes(String(run.state))
    && isNonNegativeInteger(run.appliedGroupCount)
    && isNonNegativeInteger(run.appliedRowCount)
    && typeof run.rollbackUntil === "string"
    && typeof run.createdAt === "string"
    && isNullableString(run.rolledBackAt)
    && isNullableString(run.finalizedAt)
    && typeof run.rollbackAvailable === "boolean"
  )
}

function isReviewSafeApplyPlan(value: unknown): value is ReviewSafeApplyPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const apply = value as Record<string, unknown>
  return (
    apply.mode === "SAFE_RESOLVE"
    && typeof apply.planFingerprint === "string"
    && apply.planFingerprint.length > 0
    && isNonNegativeInteger(apply.eligibleLinks)
    && isNonNegativeInteger(apply.eligibleRows)
    && isNonNegativeInteger(apply.rejectLinks)
    && isNonNegativeInteger(apply.rejectRows)
    && isNonNegativeInteger(apply.releaseLinks)
    && isNonNegativeInteger(apply.releaseRows)
    && apply.eligibleLinks === (apply.rejectLinks as number) + (apply.releaseLinks as number)
    && apply.eligibleRows === (apply.rejectRows as number) + (apply.releaseRows as number)
    && isNonNegativeInteger(apply.protectedMixedLinks)
    && isNonNegativeInteger(apply.protectedMixedRows)
    && isNonNegativeInteger(apply.protectedSharedLinks)
    && isNonNegativeInteger(apply.protectedSharedRows)
    && isNonNegativeInteger(apply.protectedStoredDecisionLinks)
    && isNonNegativeInteger(apply.protectedStoredDecisionRows)
    && isNonNegativeInteger(apply.protectedPreviousDecisionLinks)
    && isNonNegativeInteger(apply.protectedPreviousDecisionRows)
    && isNonNegativeInteger(apply.protectedRetentionLinks)
    && isNonNegativeInteger(apply.protectedRetentionRows)
    && isNullableString(apply.rollbackUntil)
  )
}

function isReviewDryRunSummary(value: unknown): value is ReviewDryRunSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const summary = value as Record<string, unknown>
  const decisions = summary.decisions && typeof summary.decisions === "object" && !Array.isArray(summary.decisions)
    ? summary.decisions as Record<string, unknown>
    : null
  const reasons = Array.isArray(summary.reasonBreakdown) ? summary.reasonBreakdown : null

  return (
    typeof summary.resolverVersion === "string"
    && isNonNegativeInteger(summary.totalRows)
    && isNonNegativeInteger(summary.uniqueCandidates)
    && isNonNegativeInteger(summary.duplicateRows)
    && Boolean(decisions)
    && isNonNegativeInteger(decisions?.reject)
    && isNonNegativeInteger(decisions?.release)
    && isNonNegativeInteger(decisions?.review)
    && summary.totalRows === summary.uniqueCandidates + summary.duplicateRows
    && summary.uniqueCandidates === (
      decisions.reject as number
      + (decisions.release as number)
      + (decisions.review as number)
    )
    && reasons !== null
    && reasons.every(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false
      const row = item as Record<string, unknown>
      return typeof row.reason === "string" && isNonNegativeInteger(row.count)
    })
    && typeof summary.generatedAt === "string"
    && isReviewSafeApplyPlan(summary.safeApply)
    && (summary.latestRun === null || isReviewApplyRun(summary.latestRun))
  )
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

async function waitForProviderRuns(
  providerRunIds: string[],
  shouldStop: () => boolean,
  onSnapshot?: (result: MonitoringProfileSourceRunResult) => void,
): Promise<MonitoringProfileSourceRunResult> {
  const ids = Array.from(new Set(providerRunIds.filter(Boolean))).slice(0, 50)
  if (ids.length === 0) {
    return {
      status: "pending",
      foundCount: 0,
      newCount: 0,
      duplicateCount: 0,
      error: "provider_progress_id_missing",
    }
  }
  let latest: MonitoringProfileSourceRunResult = {
    status: "pending",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
  }
  let terminalPolls = 0

  for (let attempt = 0; attempt < PROVIDER_POLL_MAX_ATTEMPTS; attempt += 1) {
    // Reconciliation is a best-effort recovery path for a delayed webhook.
    // A transient request failure must not discard the exact provider IDs and
    // turn the operator's next click into a second paid dispatch.
    try {
      const reconcileResponse = await fetch("/api/v1/social/provider-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      })
      await reconcileResponse.json().catch(() => null)
    } catch {
      // The read below may still succeed. If it does not, the same IDs remain
      // in the resumable provider-wait state and the next poll retries.
    }

    let body: ProviderRunsApiResponse | null = null
    let responseOk = false
    try {
      const response = await fetch(
        `/api/v1/social/provider-runs?ids=${encodeURIComponent(ids.join(","))}&limit=50`,
      )
      body = await response.json().catch(() => null) as ProviderRunsApiResponse | null
      responseOk = response.ok
    } catch {
      body = null
    }
    if (!responseOk || !body?.success || !Array.isArray(body.data)) {
      latest = {
        ...latest,
        status: "pending",
        error: body?.error || "provider_progress_unavailable",
      }
      onSnapshot?.(latest)
      if (shouldStop()) return latest
      await wait(PROVIDER_POLL_INTERVAL_MS)
      continue
    }

    latest = summarizeMonitoringProviderRuns(body.data)
    onSnapshot?.(latest)
    if (shouldStop()) return latest
    terminalPolls = latest.status === "pending" ? 0 : terminalPolls + 1
    if (terminalPolls >= PROVIDER_TERMINAL_CONFIRMATION_POLLS) return latest
    await wait(PROVIDER_POLL_INTERVAL_MS)
  }

  return { ...latest, status: "pending", error: "provider_poll_timeout" }
}

export type MonitoringProfileListProps = {
  workspaceMode: "directory" | "brand"
  workspaceProfileId: string | null
  onOpenProfile: (profile: MonitoringProfileWorkspaceItem) => void
  onOpenAllBrands: () => void
  onRunActivityChange?: (active: boolean) => void
  onOpenResults: (
    profile: Profile,
    target?: MonitoringProfileFindingsTarget,
  ) => void
  onCollectionBlocked?: () => void
}

/**
 * "Monitorings" — a visible brand-card grid plus one guided workbench for the
 * chosen brand/person. Subject and scenario are folded together here; neither
 * word is shown to the operator.
 */
export function MonitoringProfileList({
  workspaceMode,
  workspaceProfileId,
  onOpenProfile,
  onOpenAllBrands,
  onRunActivityChange = noopMonitoringRunActivity,
  onOpenResults,
  onCollectionBlocked,
}: MonitoringProfileListProps) {
  const t = useTranslations("socialMonitoring.profiles")
  const { data: session } = useSession()
  const canRunProfile = ["admin", "superadmin"].includes(session?.user?.role ?? "")
  const canManagePaidPolicy = session?.user?.role === "admin"
  const canApplyReview = canRunProfile
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Из карточки компании CRM приходит ссылка «взять на мониторинг»: мастер
  // открывается сразу и с уже подставленным названием клиента.
  const prefilledName = typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.search).get("newMonitoringName")?.trim() || null
  const [wizardOpen, setWizardOpen] = useState(Boolean(prefilledName))
  const [busyId, setBusyId] = useState<string | null>(null)
  const [logoUploadingId, setLogoUploadingId] = useState<string | null>(null)
  const [runningProfileId, setRunningProfileId] = useState<string | null>(null)
  const [runProgress, setRunProgress] = useState<Record<string, MonitoringProfileRunProgress>>({})
  const [bulkJob, setBulkJob] = useState<SocialMonitoringRunJob | null>(null)
  const [bulkJobMutating, setBulkJobMutating] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<WorkflowStage>("collection")
  const [workflowHydrated, setWorkflowHydrated] = useState(false)
  const stopRequestedRef = useRef(new Set<string>())
  const runLockRef = useRef(false)
  const bulkIdempotencyKeyRef = useRef<string | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const openedWorkspaceProfileIdRef = useRef<string | null>(null)

  useEffect(() => {
    const restored = restoreMonitoringProfileWorkflowState(
      window.localStorage.getItem(MONITORING_PROFILE_WORKFLOW_STORAGE_KEY),
    )
    setSelectedProfileId(restored.selectedProfileId)
    setActiveStage(restored.activeStage)
    setRunProgress(restored.runProgress)
    setWorkflowHydrated(true)
  }, [])

  useEffect(() => {
    if (!workflowHydrated) return
    window.localStorage.setItem(
      MONITORING_PROFILE_WORKFLOW_STORAGE_KEY,
      serializeMonitoringProfileWorkflowState({
        selectedProfileId,
        activeStage,
        runProgress,
      }),
    )
  }, [activeStage, runProgress, selectedProfileId, workflowHydrated])

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const response = await fetch("/api/v1/social/monitoring-profiles")
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error ?? "load_failed")
      setProfiles(body.data.profiles ?? [])
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : "load_failed")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const fetchLatestBulkJob = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/v1/social/monitoring-run-jobs?kind=PROFILE_FULL&latest=1",
      )
      const body = await readSocialMonitoringRunJobResponse(response)
      if (!response.ok || !body.success) return undefined
      if (body.data && body.data.kind !== "PROFILE_FULL") return undefined
      return body.data ?? null
    } catch {
      return undefined
    }
  }, [])

  useEffect(() => {
    let disposed = false
    void fetchLatestBulkJob().then(job => {
      if (!disposed && job !== undefined) setBulkJob(job)
    })
    return () => { disposed = true }
  }, [fetchLatestBulkJob])

  const bulkJobActive = socialMonitoringRunJobIsActive(bulkJob)

  useEffect(() => {
    if (!bulkJobActive) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      let continuePolling = true
      const latest = await fetchLatestBulkJob()
      if (disposed) return
      if (latest !== undefined) {
        setBulkJob(latest)
        continuePolling = socialMonitoringRunJobIsActive(latest)
        if (latest && !continuePolling) await load({ silent: true })
      }
      if (!disposed && continuePolling) {
        timer = setTimeout(() => { void poll() }, MONITORING_RUN_JOB_POLL_MS)
      }
    }

    timer = setTimeout(() => { void poll() }, MONITORING_RUN_JOB_POLL_MS)
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, [bulkJob?.id, bulkJob?.status, bulkJobActive, fetchLatestBulkJob, load])

  useEffect(() => {
    if (workspaceMode === "directory") {
      openedWorkspaceProfileIdRef.current = null
      if (selectedProfileId !== null) setSelectedProfileId(null)
      return
    }
    if (!workspaceProfileId) return
    const workspaceProfile = profiles.find(profile => profile.id === workspaceProfileId)
    if (!workspaceProfile || openedWorkspaceProfileIdRef.current === workspaceProfileId) return
    openedWorkspaceProfileIdRef.current = workspaceProfileId
    setSelectedProfileId(workspaceProfileId)
    setActiveStage(preferredProfileStage(workspaceProfile))
  }, [profiles, selectedProfileId, workspaceMode, workspaceProfileId])

  async function patch(profile: Profile, action: "pause" | "resume" | "stop") {
    if (!profile.subjectId) return
    setBusyId(profile.id)
    try {
      const response = await fetch(`/api/v1/social/monitoring-profiles/${profile.subjectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        if (body?.code === "social_monitoring_collection_blocked") {
          toast.error(t(
            canManagePaidPolicy
              ? "errors.collectionResetBlocked"
              : "errors.collectionResetBlockedAskAdmin",
          ))
          if (canManagePaidPolicy) onCollectionBlocked?.()
          return
        }
        throw new Error(body?.error ?? "action_failed")
      }
      toast.success(t(`actionSuccess.${action}`, { name: profile.name }))
      await load()
    } catch (caught) {
      console.error("Monitoring profile action failed", caught)
      toast.error(t("errors.actionFailed"))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteProfile(profile: Profile) {
    if (!profile.subjectId) return
    // A monitoring that is still running gets a stronger confirm and an
    // explicit force flag — the server refuses a non-forced delete for it.
    const stillRunning = profile.status !== "archived" && profile.status !== "needs_resume"
    const confirmKey = stillRunning ? "actions.deleteActiveConfirm" : "actions.deleteConfirm"
    if (!window.confirm(t(confirmKey, { name: profile.name }))) return
    setBusyId(profile.id)
    try {
      const query = stillRunning ? "?force=1" : ""
      const response = await fetch(`/api/v1/social/monitoring-profiles/${profile.subjectId}${query}`, { method: "DELETE" })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error ?? "delete_failed")
      toast.success(t("actionSuccess.delete", { name: profile.name }))
      await load()
    } catch (caught) {
      console.error("Monitoring profile deletion failed", caught)
      toast.error(t("errors.deleteFailed"))
    } finally {
      setBusyId(null)
    }
  }

  async function uploadProfileLogo(profile: Profile, file: File) {
    if (!profile.subjectId || logoUploadingId) return
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"])
    if (!allowedTypes.has(file.type) || file.size < 1 || file.size > 2 * 1024 * 1024) {
      toast.error(t("logo.invalid"))
      return
    }

    setLogoUploadingId(profile.id)
    try {
      const formData = new FormData()
      formData.set("file", file)
      const response = await fetch(
        `/api/v1/social/monitoring-profiles/${encodeURIComponent(profile.subjectId)}/logo`,
        { method: "POST", body: formData },
      )
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.data?.logoUrl) {
        throw new Error(body?.error ?? "logo_upload_failed")
      }
      setProfiles(current => current.map(item =>
        item.id === profile.id ? { ...item, logoUrl: body.data.logoUrl } : item))
      toast.success(t("logo.uploaded", { name: profile.name }))
      await load({ silent: true })
    } catch (caught) {
      console.error("Monitoring profile logo upload failed", caught)
      toast.error(t("logo.failed"))
    } finally {
      setLogoUploadingId(null)
    }
  }

  type ExecuteProfileRunOptions = {
    skipConfirmation?: boolean
    skipCoverageRepair?: boolean
    quiet?: boolean
  }

  async function executeProfileRun(
    profile: Profile,
    platform: MonitoringProfileRunPlatform = "all",
    runMode: MonitoringProfileRunMode = "full",
    coverageRepairAttempted = false,
    options: ExecuteProfileRunOptions = {},
  ): Promise<MonitoringProfileRunProgress | null> {
    if (
      !canRunProfile
      || profile.status !== "active"
      || !profile.subjectId
      || !profile.scenarioId
    ) return null
    const scenarioId = profile.scenarioId
    // The primary run is intentionally an "all channels" action. Repair every
    // managed discovery source before dispatching the sequential queue so one
    // operator click covers the whole monitoring instead of silently skipping
    // a platform that was absent from an older profile.
    const requiredAutomaticPlatforms = [
      "facebook",
      "instagram",
      "tiktok",
      "youtube",
      "web",
    ]
    const missingAutomaticPlatforms = requiredAutomaticPlatforms.filter((requiredPlatform) => {
      if (!profile.platforms.includes(requiredPlatform)) return true
      const activeSources = profile.sources.filter(source =>
        source.platform === requiredPlatform && source.isActive)
      if (requiredPlatform !== "web") return activeSources.length === 0
      // A legacy RSS-only profile technically has a WEB source, but an empty
      // Google Alerts feed must not suppress the canonical direct-news route.
      return !activeSources.some(source => source.sourceType === "keyword")
    })
    if (
      runMode === "full"
      && platform === "all"
      && missingAutomaticPlatforms.length > 0
      && !coverageRepairAttempted
      && !options.skipCoverageRepair
    ) {
      setBusyId(profile.id)
      try {
        const response = await fetch(`/api/v1/social/monitoring-profiles/${profile.subjectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "resume",
            platforms: Array.from(new Set([...profile.platforms, ...requiredAutomaticPlatforms])),
            directions: profile.directions,
          }),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok || !body?.data) throw new Error(body?.error ?? "coverage_repair_failed")
        await load()
        return await executeProfileRun(
          body.data as Profile,
          platform,
          runMode,
          true,
          options,
        )
      } catch (caught) {
        console.error("Monitoring profile coverage repair failed", caught)
        if (!options.quiet) toast.error(t("errors.actionFailed"))
        return null
      } finally {
        setBusyId(null)
      }
    }
    const previousProgress = runProgress[profile.id] ?? null
    const candidateSources = runMode === "comments_only"
      ? monitoringProfileCommentsOnlySources(profile, platform)
      : monitoringProfileSourcesForPlatform(profile.sources, platform)
    const baseProfileRevision = monitoringProfileRunRevision(profile)
    const profileRevision = runMode === "comments_only"
      ? `${baseProfileRevision}:comments-only`
      : baseProfileRevision
    const canResume = runMode === "full" && platform === "all" && canResumeMonitoringProfileRun({
      progress: previousProgress,
      scenarioId,
      profileRevision,
      sourceIds: candidateSources.map(source => source.id),
    })
    const completedSourceIds = canResume
      ? new Set(previousProgress!.sourceResults.map(source => source.sourceId))
      : new Set<string>()
    const sources = candidateSources
      .filter(source => !completedSourceIds.has(source.id))
    if (sources.length === 0) {
      if (!options.quiet) {
        toast.warning(runMode === "comments_only"
          ? t("run.commentsOnlyUnavailable")
          : platform === "all"
            ? t("run.noSources")
            : t("run.noPlatformSources", { platform: t(`platforms.${platform}`) }))
      }
      return null
    }
    const paidSources = sources.filter(source => source.paid)
    const providerAccountFundedOnly = paidSources.length > 0
      && paidSources.every(source => source.providerAccountFundedOnly)
    const sourcesToRun = sources
    const sharedCount = sources.filter(source => source.sharedAcrossMonitorings).length
    const confirmCopy = runMode === "comments_only"
      ? t("run.commentsOnlyConfirm", {
          name: profile.name,
          count: sourcesToRun.length,
          fuse: CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD.toFixed(2),
        })
      : canResume
      ? t("run.resumeConfirm", {
          name: profile.name,
          remaining: sourcesToRun.length,
          completed: previousProgress!.attempted,
          total: previousProgress!.total,
        })
      : paidSources.length === 0
      ? platform === "all"
        ? t("run.confirm", { name: profile.name, count: sourcesToRun.length })
        : t("run.confirmPlatform", {
            name: profile.name,
            count: sourcesToRun.length,
            platform: t(`platforms.${platform}`),
          })
      : providerAccountFundedOnly
        ? t("run.paidProviderAccountConfirm", {
            name: profile.name,
            count: sourcesToRun.length,
            paidCount: paidSources.length,
          })
        : t("run.paidClientFundedConfirm", {
          name: profile.name,
          count: sourcesToRun.length,
          paidCount: paidSources.length,
          fuse: CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD.toFixed(2),
          })
    const sharedCopy = sharedCount > 0 ? `\n\n${t("run.sharedIncluded", { count: sharedCount })}` : ""
    if (!options.skipConfirmation && !window.confirm(`${confirmCopy}${sharedCopy}`)) return null

    stopRequestedRef.current.delete(profile.id)
    setRunningProfileId(profile.id)
    const resumeContext = canResume && previousProgress?.resumeContext
      ? previousProgress.resumeContext
      : createMonitoringProfileRunResumeContext({
          scenarioId,
          profileRevision,
          sourceIds: candidateSources.map(source => source.id),
        })
    const restoredProviderWait = canResume
      && previousProgress?.current?.stage === "provider_wait"
      && previousProgress.current.providerWait
      ? {
          sourceId: previousProgress.current.id,
          ...previousProgress.current.providerWait,
        }
      : null
    let latePaidConfirmationGranted = runMode === "comments_only" || paidSources.length > 0
    try {
      const result = await runMonitoringProfileSources({
        sources: sourcesToRun,
        initialProgress: canResume ? previousProgress : null,
        shouldStop: () => stopRequestedRef.current.has(profile.id),
        onProgress: progress => {
          setRunProgress(current => ({
            ...current,
            [profile.id]: {
              ...progress,
              resumeContext: {
                ...resumeContext,
                updatedAt: new Date().toISOString(),
              },
            },
          }))
        },
        runSource: async (source, setStage, setPreview, setProviderWait) => {
          if (restoredProviderWait?.sourceId === source.id) {
            setProviderWait(
              restoredProviderWait.providerRunIds,
              restoredProviderWait.collectorResult,
            )
            setStage("provider_wait")
            const providerResult = await waitForProviderRuns(
              restoredProviderWait.providerRunIds,
              () => stopRequestedRef.current.has(profile.id),
              snapshot => {
                setPreview(mergeMonitoringCollectorAndProviderResult(
                  restoredProviderWait.collectorResult,
                  snapshot,
                ))
              },
            )
            return mergeMonitoringCollectorAndProviderResult(
              restoredProviderWait.collectorResult,
              providerResult,
            )
          }

          const requestSourceRun = async (
            paidConfirmed: boolean,
            clientFundedPaidSourceConfirmed = (
              source.paid && !source.providerAccountFundedOnly
            ),
          ) => {
            const response = await fetch(`/api/v1/social/monitoring-profiles/${encodeURIComponent(profile.subjectId!)}/run`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                scenarioId,
                sourceId: source.id,
                fullArchiveConfirmed: true,
                ...(runMode === "comments_only"
                  ? {
                      paidConfirmed: true,
                      commentsOnly: true,
                    }
                  : {
                      ...(paidConfirmed ? { paidConfirmed: true } : {}),
                      ...(paidConfirmed && clientFundedPaidSourceConfirmed && profile.commentsEnabled
                        ? { includeComments: true }
                        : {}),
                    }),
                ...(source.sharedAcrossMonitorings ? { fullSearchConfirmed: true } : {}),
              }),
            })
            const body = await response.json().catch(() => null) as RunSourceApiResponse | null
            return { response, body }
          }

          let { response, body } = await requestSourceRun(source.paid || latePaidConfirmationGranted)
          if (response.status === 409 && body?.error === "paid_run_confirmation_required") {
            const providerAccountFundedOnly = body.providerAccountFundedOnly === true
            const paidCopy = providerAccountFundedOnly
              ? t("run.paidProviderAccountConfirm", {
                  name: profile.name,
                  count: sourcesToRun.length,
                  paidCount: 1,
                })
              : t("run.paidClientFundedConfirm", {
                  name: profile.name,
                  count: sourcesToRun.length,
                  paidCount: 1,
                  fuse: CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD.toFixed(2),
                })
            if (!window.confirm(paidCopy)) {
              return {
                status: "failed",
                foundCount: 0,
                newCount: 0,
                duplicateCount: 0,
                error: body.error,
              }
            }
            latePaidConfirmationGranted = true
            // The profile may have rendered before the backend refreshed a
            // stale route plan. This 409 is the authoritative paid-route
            // signal; preserve the requested comments pass on the retry.
            ;({ response, body } = await requestSourceRun(
              true,
              !providerAccountFundedOnly,
            ))
          }
          if (response.status === 409 && body?.error === "collector_already_running") {
            return {
              status: "pending",
              foundCount: 0,
              newCount: 0,
              duplicateCount: 0,
              error: body.error,
            }
          }
          if (!response.ok || !body?.success || !body.data) {
            // A received HTTP rejection is definitive, including for a paid
            // source. Only a transport exception (where dispatch is unknown)
            // reaches the queue's conservative paid-pending fallback.
            return {
              status: "failed",
              foundCount: 0,
              newCount: 0,
              duplicateCount: 0,
              error: body?.error || t("run.sourceFailed"),
            }
          }
          if (
            body.data.runId
            && monitoringCollectorResultHasPendingProvider(body.data)
          ) {
            setStage("provider_wait")
            const providerRunIds = monitoringCollectorPendingProviderRunIds(body.data)
            setProviderWait(providerRunIds, body.data)
            let providerSnapshot: MonitoringProfileSourceRunResult | null = null
            try {
              const providerResult = await waitForProviderRuns(
                providerRunIds,
                () => stopRequestedRef.current.has(profile.id),
                snapshot => {
                  providerSnapshot = snapshot
                  setPreview(mergeMonitoringCollectorAndProviderResult(body.data!, snapshot))
                },
              )
              return mergeMonitoringCollectorAndProviderResult(body.data, providerResult)
            } catch (error) {
              const latestResult = providerSnapshot
                ? mergeMonitoringCollectorAndProviderResult(body.data, providerSnapshot)
                : body.data
              return {
                ...latestResult,
                status: "pending",
                error: error instanceof Error ? error.message : "provider_progress_unavailable",
              }
            }
          }
          return body.data
        },
      })

      if (result.phase === "completed") {
        if (!options.quiet) toast.success(t("run.toastCompleted", { name: profile.name, count: result.attempted }))
      } else if (result.phase === "stopped") {
        if (!options.quiet) toast.warning(t("run.toastStopped", { name: profile.name, completed: result.attempted, total: result.total }))
      } else if (result.phase === "completed_with_pending") {
        if (!options.quiet) toast.warning(t("run.providerTimeout"))
      } else {
        if (!options.quiet) toast.warning(t("run.toastIssues", {
          name: profile.name,
          failed: result.failed,
          skipped: result.skipped + result.partial + result.pending,
        }))
      }
      await load({ silent: true })
      if (!options.quiet && result.phase !== "stopped") {
        setActiveStage(result.review > 0 ? "review" : "results")
      }
      return result
    } catch (caught) {
      console.error("Monitoring profile run failed", caught)
      if (!options.quiet) toast.error(t("run.startFailed"))
      return null
    } finally {
      stopRequestedRef.current.delete(profile.id)
      setRunningProfileId(null)
    }
  }

  async function runProfile(
    profile: Profile,
    platform: MonitoringProfileRunPlatform = "all",
    runMode: MonitoringProfileRunMode = "full",
  ) {
    if (runLockRef.current) return
    runLockRef.current = true
    setBulkJob(null)
    try {
      await executeProfileRun(profile, platform, runMode)
    } finally {
      runLockRef.current = false
    }
  }

  async function runAllProfiles() {
    if (runLockRef.current || !canRunProfile) return
    const plan = createMonitoringProfileBulkPlan(profiles)
    if (plan.totalProfiles === 0) {
      toast.warning(t("bulk.noProfiles"))
      return
    }

    const confirmed = window.confirm(t("bulk.confirm", {
      profiles: plan.totalProfiles,
      sources: plan.totalSources,
      paid: plan.paidSources,
      shared: plan.sharedSources,
      fuse: CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD.toFixed(2),
    }))
    if (!confirmed) return

    runLockRef.current = true
    setBulkJobMutating(true)
    try {
      const requestKey = bulkIdempotencyKeyRef.current ?? crypto.randomUUID()
      bulkIdempotencyKeyRef.current = requestKey
      const response = await fetch("/api/v1/social/monitoring-run-jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({
          kind: "PROFILE_FULL",
          fullArchiveConfirmed: true,
          paidConfirmed: true,
          sharedConfirmed: true,
        }),
      })
      const body = await readSocialMonitoringRunJobResponse(response)
      if (!response.ok || !body.success || !body.data || body.data.kind !== "PROFILE_FULL") {
        throw new Error(body.error || "monitoring_run_job_start_failed")
      }
      setBulkJob(body.data)
      bulkIdempotencyKeyRef.current = null
      toast.success(t("bulk.toastQueued", { profiles: plan.totalProfiles }))
    } catch (caught) {
      console.error("Monitoring profile bulk job failed to start", caught)
      toast.error(t("bulk.startFailed"))
    } finally {
      runLockRef.current = false
      setBulkJobMutating(false)
    }
  }

  async function stopBulkRun() {
    if (!bulkJob || !socialMonitoringRunJobIsActive(bulkJob) || bulkJobMutating) return
    setBulkJobMutating(true)
    try {
      const response = await fetch(
        `/api/v1/social/monitoring-run-jobs/${encodeURIComponent(bulkJob.id)}/cancel`,
        { method: "POST" },
      )
      const body = await readSocialMonitoringRunJobResponse(response)
      if (!response.ok || !body.success || !body.data || body.data.kind !== "PROFILE_FULL") {
        throw new Error(body.error || "monitoring_run_job_cancel_failed")
      }
      setBulkJob(body.data)
      if (!socialMonitoringRunJobIsActive(body.data)) await load({ silent: true })
    } catch (caught) {
      console.error("Monitoring profile bulk job failed to cancel", caught)
      toast.error(t("bulk.cancelFailed"))
    } finally {
      setBulkJobMutating(false)
    }
  }

  async function resumeBulkRun() {
    if (!bulkJob || !socialMonitoringRunJobCanResume(bulkJob) || bulkJobMutating) return
    setBulkJobMutating(true)
    try {
      const response = await fetch(
        `/api/v1/social/monitoring-run-jobs/${encodeURIComponent(bulkJob.id)}/resume`,
        { method: "POST" },
      )
      const body = await readSocialMonitoringRunJobResponse(response)
      if (!response.ok || !body.success || !body.data || body.data.kind !== "PROFILE_FULL") {
        throw new Error(body.error || "monitoring_run_job_resume_failed")
      }
      setBulkJob(body.data)
    } catch (caught) {
      console.error("Monitoring profile bulk job failed to resume", caught)
      toast.error(t("bulk.resumeFailed"))
    } finally {
      setBulkJobMutating(false)
    }
  }

  function stopProfileRun(profileId: string) {
    stopRequestedRef.current.add(profileId)
    setRunProgress(current => {
      const progress = current[profileId]
      if (!progress || progress.phase !== "running") return current
      return {
        ...current,
        [profileId]: { ...progress, phase: "stopping" },
      }
    })
  }

  const bulkActive = bulkJobActive
  const runNavigationLocked = Boolean(runningProfileId) || bulkJobMutating

  useEffect(() => {
    onRunActivityChange(runNavigationLocked)
  }, [onRunActivityChange, runNavigationLocked])

  useEffect(() => {
    activeRunIdRef.current = runningProfileId
  }, [runningProfileId])

  useEffect(() => () => {
    const activeRunId = activeRunIdRef.current
    if (activeRunId) stopRequestedRef.current.add(activeRunId)
    onRunActivityChange(false)
  }, [onRunActivityChange])

  if (wizardOpen) {
    return (
      <div className="rounded-xl border p-4 sm:p-6">
        <MonitoringProfileWizard
          initialName={prefilledName ?? undefined}
          onClose={() => setWizardOpen(false)}
          onLaunched={() => { setWizardOpen(false); void load() }}
          onCollectionBlocked={onCollectionBlocked}
          canManagePaidPolicy={canManagePaidPolicy}
        />
      </div>
    )
  }

  const live = profiles.filter(profile => profile.status === "active" || profile.status === "paused")
  // A profile with no collection plan belongs in the archive, not in the active
  // list where it would read as a working monitor that simply found nothing.
  const archived = profiles.filter(profile => profile.status === "needs_resume" || profile.status === "archived")
  const selectedProfile = selectedProfileId
    ? profiles.find(profile => profile.id === selectedProfileId) ?? null
    : null
  const bulkEligibleProfileCount = createMonitoringProfileBulkPlan(profiles).totalProfiles
  const bulkQueueStates: Record<string, MonitoringProfileGridQueueState> = {}
  if (bulkJob) {
    for (const profile of profiles) {
      const state = socialMonitoringRunJobProfileQueueState(bulkJob, profile)
      if (state) bulkQueueStates[profile.id] = state
    }
  }
  const bulkProfileCounts = bulkJob
    ? socialMonitoringRunJobProfileCounts(bulkJob)
    : { total: 0, processed: 0 }

  return (
    <section className="space-y-6" aria-label={t("title")}>
      {workspaceMode === "directory" && (
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Radio className="h-5 w-5" />{t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3 w-3 text-emerald-600" />{t("liveSendOff")}
          </Badge>
          <Button
            type="button"
            variant="outline"
            data-testid="social-profile-open-all-brands"
            onClick={onOpenAllBrands}
            title={t("allBrands.hint")}
            disabled={runNavigationLocked}
          >
            <ChartNoAxesCombined className="mr-1 h-4 w-4" />
            {t("allBrands.open")}
          </Button>
          {bulkActive ? (
            <Button
              type="button"
              variant="outline"
              data-testid="social-profile-run-all-stop"
              onClick={() => void stopBulkRun()}
              disabled={bulkJobMutating || bulkJob?.status === "CANCEL_REQUESTED"}
            >
              {bulkJobMutating || bulkJob?.status === "CANCEL_REQUESTED"
                ? <Loader2 className="mr-1 h-4 w-4 animate-spin motion-reduce:animate-none" />
                : <Square className="mr-1 h-4 w-4" />}
              {t("bulk.stop")}
            </Button>
          ) : (
            <Button
              type="button"
              data-testid="social-profile-run-all"
              onClick={() => void runAllProfiles()}
              disabled={!canRunProfile || Boolean(runningProfileId) || bulkJobMutating || bulkEligibleProfileCount === 0}
            >
              <Play className="mr-1 h-4 w-4" />{t("bulk.start")}
            </Button>
          )}
          <Button
            variant="outline"
            data-testid="social-profile-new"
            onClick={() => setWizardOpen(true)}
            disabled={Boolean(runningProfileId) || bulkActive || bulkJobMutating}
          >
            <Plus className="mr-1 h-4 w-4" />{t("newMonitoring")}
          </Button>
        </div>
      </header>
      )}

      {workspaceMode === "directory" && (
      <details className="rounded-lg border bg-muted/20 px-3">
        <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Info className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
          {t("coverageNoticeTitle")}
        </summary>
        <p className="pb-3 text-xs leading-5 text-muted-foreground">{t("coverageNoticeText")}</p>
      </details>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />{t("loading")}
        </p>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="text-destructive">{t("errors.loadFailed")}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>{t("retry")}</Button>
        </div>
      )}

      {!loading && !error && bulkJob && (
        <MonitoringBulkRunStatus
          job={bulkJob}
          profileCounts={bulkProfileCounts}
          mutating={bulkJobMutating}
          showCancel={workspaceMode === "brand"}
          onCancel={() => { void stopBulkRun() }}
          onResume={() => { void resumeBulkRun() }}
        />
      )}

      {workspaceMode === "directory" && !loading && !error && profiles.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Radio className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 font-medium">{t("emptyTitle")}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("emptyHint")}</p>
          <Button className="mt-4" onClick={() => setWizardOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />{t("createFirst")}
          </Button>
        </div>
      )}

      {workspaceMode === "directory" && !loading && !error && profiles.length > 0 && (
        <>
          <MonitoringProfileGrid
            liveProfiles={live}
            archivedProfiles={archived}
            queueStates={bulkQueueStates}
            navigationLocked={runNavigationLocked}
            canUploadLogo={canRunProfile && !bulkActive && !bulkJobMutating}
            uploadingLogoId={logoUploadingId}
            deletingProfileId={busyId}
            actionLocked={Boolean(runningProfileId) || bulkActive || bulkJobMutating}
            onSelect={profileId => {
              if (runNavigationLocked) return
              setSelectedProfileId(profileId)
              const profile = profiles.find(candidate => candidate.id === profileId)
              if (profile) {
                setActiveStage(preferredProfileStage(profile))
                onOpenProfile(profile)
              }
            }}
            onOpenFindings={(profileId, target) => {
              if (runNavigationLocked) return
              const profile = profiles.find(candidate => candidate.id === profileId)
              if (profile) onOpenResults(profile, target ?? {})
            }}
            onUploadLogo={(item, file) => {
              const profile = profiles.find(candidate => candidate.id === item.id)
              if (profile) void uploadProfileLogo(profile, file)
            }}
            onDelete={(item) => {
              const profile = profiles.find(candidate => candidate.id === item.id)
              if (profile) void deleteProfile(profile)
            }}
          />
        </>
      )}

      {workspaceMode === "brand" && !loading && !error && selectedProfile && (
        <>
          <SelectedMonitoringWorkbench
            key={selectedProfile.id}
            profile={selectedProfile}
            busy={busyId === selectedProfile.id}
            actionLocked={Boolean(runningProfileId) || bulkActive || bulkJobMutating}
            runActive={runningProfileId === selectedProfile.id}
            runProgress={runProgress[selectedProfile.id] ?? null}
            activeStage={activeStage}
            canRunProfile={canRunProfile}
            canApplyReview={canApplyReview}
            onStageChange={setActiveStage}
            onOpenResults={onOpenResults}
            onPatch={patch}
            onDelete={deleteProfile}
            onRun={runProfile}
            onStopRun={stopProfileRun}
            onReviewChanged={() => load({ silent: true })}
          />
        </>
      )}

      {workspaceMode === "brand" && !loading && !error && !selectedProfile && (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-amber-600" aria-hidden="true" />
          <h3 className="mt-3 text-sm font-semibold">{t("workspaceUnavailableTitle")}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("workspaceUnavailableHint")}
          </p>
        </div>
      )}
    </section>
  )
}

function MonitoringBulkRunStatus({
  job,
  profileCounts,
  mutating,
  showCancel,
  onCancel,
  onResume,
}: {
  job: SocialMonitoringRunJob
  profileCounts: { total: number; processed: number }
  mutating: boolean
  showCancel: boolean
  onCancel: () => void
  onResume: () => void
}) {
  const t = useTranslations("socialMonitoring.profiles")
  const active = socialMonitoringRunJobIsActive(job)
  const title = job.status === "QUEUED"
    ? t("bulk.queuedTitle")
    : job.status === "RUNNING"
      ? t("bulk.runningTitle")
      : job.status === "WAITING_PROVIDER"
        ? t("bulk.waitingProviderTitle")
        : job.status === "CANCEL_REQUESTED"
          ? t("bulk.stoppingTitle")
          : job.status === "COMPLETED"
            ? t("bulk.completedTitle")
            : job.status === "COMPLETED_WITH_ISSUES"
              ? t("bulk.completedWithIssuesTitle")
              : job.status === "FAILED"
                ? t("bulk.failedTitle")
                : t("bulk.stoppedTitle")

  return (
    <section
      aria-label={title}
      className="rounded-xl border border-primary/20 bg-primary/[0.035] p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-background text-primary ring-1 ring-primary/15">
          {active
            ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : job.status === "COMPLETED"
              ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              : <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-medium" role="status" aria-live="polite">{title}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {t("bulk.brandProgress", {
                completed: profileCounts.processed,
                total: profileCounts.total,
              })}
            </p>
          </div>
          {active && job.currentItem?.profileName && (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {t("bulk.currentBrand", { name: job.currentItem.profileName })}
            </p>
          )}
          {active && job.currentItem?.sourceLabel && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {t("bulk.currentSource", { name: job.currentItem.sourceLabel })}
            </p>
          )}
          <MonitoringRunProgress
            completed={job.processedItems}
            total={job.totalItems}
            active={active && job.status !== "CANCEL_REQUESTED"}
            ariaLabel={title}
            ariaValueText={t("bulk.sourceProgress", {
              completed: job.processedItems,
              total: job.totalItems,
            })}
            className="mt-3"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs tabular-nums text-muted-foreground">
              {t("bulk.sourceProgress", {
                completed: job.processedItems,
                total: job.totalItems,
              })}
            </p>
            {showCancel && active && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="social-profile-run-all-status-stop"
                onClick={onCancel}
                disabled={mutating || job.status === "CANCEL_REQUESTED"}
              >
                {mutating || job.status === "CANCEL_REQUESTED"
                  ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                  : <Square className="mr-1 h-3.5 w-3.5" />}
                {t("bulk.stop")}
              </Button>
            )}
            {socialMonitoringRunJobCanResume(job) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="social-profile-run-all-resume"
                onClick={onResume}
                disabled={mutating}
              >
                {mutating
                  ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                  : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
                {t("bulk.resume")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function SelectedMonitoringWorkbench({
  profile,
  busy,
  actionLocked,
  runActive,
  runProgress,
  activeStage,
  canRunProfile,
  canApplyReview,
  onStageChange,
  onOpenResults,
  onPatch,
  onDelete,
  onRun,
  onStopRun,
  onReviewChanged,
}: {
  profile: Profile
  busy: boolean
  actionLocked: boolean
  runActive: boolean
  runProgress: MonitoringProfileRunProgress | null
  activeStage: WorkflowStage
  canRunProfile: boolean
  canApplyReview: boolean
  onStageChange: (stage: WorkflowStage) => void
  onOpenResults: (
    profile: Profile,
    target?: MonitoringProfileFindingsTarget,
  ) => void
  onPatch: (profile: Profile, action: "pause" | "resume" | "stop") => void
  onDelete: (profile: Profile) => void
  onRun: (
    profile: Profile,
    platform?: MonitoringProfileRunPlatform,
    runMode?: MonitoringProfileRunMode,
  ) => void
  onStopRun: (profileId: string) => void
  onReviewChanged: () => Promise<void>
}) {
  const t = useTranslations("socialMonitoring.profiles")
  const locale = useLocale()
  const workflowId = useId()
  const stageTriggerRefs = useRef<Record<WorkflowStage, HTMLButtonElement | null>>({
    collection: null,
    review: null,
    results: null,
  })
  const resultsAvailable = Boolean(profile.subjectId)
  const resumable = profile.status === "needs_resume" || profile.status === "archived"
  const runnableSourceCount = new Set(
    profile.sources
      .filter(source => source.isActive)
      .map(source => source.id),
  ).size
  const runDisabled =
    busy
    || !canRunProfile
    || actionLocked
    || profile.status !== "active"
    || runnableSourceCount === 0
    || !profile.subjectId
    || !profile.scenarioId
  const hasReviewWork = profile.findings.needsReview > 0 || (runProgress?.review ?? 0) > 0
  const visibleActiveStage = activeStage === "review" && !hasReviewWork ? "results" : activeStage
  const platformActions = MONITORING_PROFILE_RUN_PLATFORMS.map(platform => {
    const sourceCount = monitoringProfileSourcesForPlatform(profile.sources, platform).length
    const coverage = profile.coverage.find(item => item.platform === platform)
    return {
      platform,
      sourceCount,
      configured: Boolean(coverage && coverage.collectionState !== "not_configured"),
      resultCount: profile.findingsByPlatform?.[platform] ?? 0,
      Icon: platform === "facebook"
        ? Facebook
        : platform === "instagram"
          ? Instagram
          : platform === "youtube"
            ? Youtube
            : Globe2,
    }
  })
  const stages: Array<{
    id: WorkflowStage
    label: string
    hint: string
    Icon: typeof Radio
    count: number | null
    countLabel: string | null
    complete: boolean
  }> = [
    {
      id: "results",
      label: t("workflow.results"),
      hint: t("workflow.findingsTabHint"),
      Icon: SearchCheck,
      count: profile.findings.total,
      countLabel: t("workflow.acceptedShort"),
      complete: false,
    },
    ...(hasReviewWork ? [{
      id: "review",
      label: t("workflow.review"),
      hint: t("workflow.reviewTabHint"),
      Icon: Eye,
      count: profile.findings.needsReview,
      countLabel: t("card.findings.needsReview"),
      complete: profile.findings.needsReview === 0 && Boolean(runProgress && !runActive),
    } as const] : []),
    {
      id: "collection",
      label: t("workflow.collection"),
      hint: t("workflow.collectionTabHint"),
      Icon: Radio,
      count: null,
      countLabel: null,
      complete: Boolean(runProgress && !runActive),
    },
  ]

  const moveToStage = (stage: WorkflowStage) => {
    onStageChange(stage)
    window.requestAnimationFrame(() => stageTriggerRefs.current[stage]?.focus())
  }
  const requestRun = (platform: MonitoringProfileRunPlatform) => {
    moveToStage("collection")
    onRun(profile, platform)
  }
  const handleStageKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentStage: WorkflowStage,
  ) => {
    const navigationKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]
    if (!navigationKeys.includes(event.key)) return
    event.preventDefault()

    const enabledStages = stages.filter(stage => !runActive || stage.id === visibleActiveStage)
    const currentIndex = enabledStages.findIndex(stage => stage.id === currentStage)
    if (currentIndex < 0 || enabledStages.length < 2) return

    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? enabledStages.length - 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (currentIndex - 1 + enabledStages.length) % enabledStages.length
          : (currentIndex + 1) % enabledStages.length
    moveToStage(enabledStages[nextIndex].id)
  }

  return (
    <article
      data-testid="social-profile-workbench"
      className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm"
      aria-labelledby={`${workflowId}-title`}
    >
      <header className="flex flex-col gap-4 border-b bg-gradient-to-br from-primary/[0.065] via-card to-card px-4 py-5 sm:px-6">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <MonitoringProfileLogo name={profile.name} logoUrl={profile.logoUrl} />
            <div className="min-w-0 pt-0.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {t("workflow.selectedMonitoring")}
              </p>
              <h3 id={`${workflowId}-title`} className="mt-1 truncate text-xl font-semibold tracking-tight" title={profile.name}>
                {profile.name}
              </h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusBadge status={profile.status} />
                <span className="text-xs leading-5 text-muted-foreground">
                  {profile.lastCollectedAt
                    ? t("report.lastCollected", {
                        date: new Date(profile.lastCollectedAt).toLocaleString(locale),
                      })
                    : t("report.neverCollected")}
                </span>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
            <Button
              type="button"
              data-testid="social-profile-open-findings"
              className="group min-h-11 min-w-0 flex-1 px-4 lg:flex-none"
              disabled={!resultsAvailable || actionLocked}
              title={!resultsAvailable ? t("workflow.resultsRequireSubject") : undefined}
              onClick={() => onOpenResults(profile)}
            >
              <SearchCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t("report.view")}</span>
              <span className="rounded-full bg-primary-foreground/15 px-2 py-0.5 text-xs font-semibold tabular-nums">
                {profile.findings.total}
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5 motion-reduce:transform-none"
                aria-hidden="true"
              />
            </Button>
            {runActive ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 flex-1 bg-background/80 sm:flex-none"
                data-testid={`social-profile-stop-${profile.id}`}
                onClick={() => onStopRun(profile.id)}
                disabled={runProgress?.phase === "stopping"}
              >
                {runProgress?.phase === "stopping"
                  ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <Square className="h-4 w-4" aria-hidden="true" />}
                {runProgress?.phase === "stopping" ? t("run.stopping") : t("run.stop")}
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 flex-1 bg-background/80 sm:flex-none"
                    disabled={runDisabled}
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    {t("run.menu")}
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-64">
                  <DropdownMenuItem onClick={() => requestRun("all")}>
                    <Radio className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                      <span>{t("run.allSources")}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{runnableSourceCount}</span>
                    </span>
                  </DropdownMenuItem>
                  {platformActions.map(({ platform, sourceCount, Icon }) => (
                    <DropdownMenuItem
                      key={platform}
                      disabled={sourceCount === 0}
                      onClick={() => requestRun(platform)}
                    >
                      <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <span>{t(`platforms.${platform}`)}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{sourceCount}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 min-w-11 bg-background/50"
                  aria-label={t("moreActions", { name: profile.name })}
                  disabled={busy || actionLocked}
                >
                  {busy
                    ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    : <MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!resultsAvailable || actionLocked}
                  onClick={() => onOpenResults(profile)}
                >
                  <SearchCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("actions.openResults")}
                </DropdownMenuItem>
                {profile.status === "active" && (
                  <DropdownMenuItem onClick={() => onPatch(profile, "pause")}>
                    <Pause className="mr-2 h-4 w-4" aria-hidden="true" />{t("actions.pause")}
                  </DropdownMenuItem>
                )}
                {profile.status === "paused" && (
                  <DropdownMenuItem onClick={() => onPatch(profile, "resume")}>
                    <Play className="mr-2 h-4 w-4" aria-hidden="true" />{t("actions.resume")}
                  </DropdownMenuItem>
                )}
                {resumable && (
                  <DropdownMenuItem onClick={() => onPatch(profile, "resume")}>
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />{t("actions.restore")}
                  </DropdownMenuItem>
                )}
                {profile.status !== "archived" && (
                  <DropdownMenuItem onClick={() => {
                    if (window.confirm(t("actions.stopConfirm", { name: profile.name }))) onPatch(profile, "stop")
                  }}>
                    <Square className="mr-2 h-4 w-4" aria-hidden="true" />{t("actions.stop")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(profile)}>
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />{t("actions.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {!resultsAvailable && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("workflow.resultsRequireSubject")}</span>
          </p>
        )}
      </header>

      <nav
        role="tablist"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-2 border-b bg-muted/20 p-2"
        aria-label={t("workflow.stepsLabel", { name: profile.name })}
      >
        {stages.map(({ id, label, hint, Icon, count, countLabel, complete }) => {
          const active = visibleActiveStage === id
          const stageSwitchLocked = runActive && !active
          return (
            <button
              key={id}
              ref={node => {
                stageTriggerRefs.current[id] = node
              }}
              id={`${workflowId}-${id}-trigger`}
              data-testid={`social-profile-step-${id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${workflowId}-${id}-panel`}
              tabIndex={active ? 0 : -1}
              disabled={stageSwitchLocked}
              onClick={() => moveToStage(id)}
              onKeyDown={event => handleStageKeyDown(event, id)}
              className={[
                "group flex min-h-16 min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm shadow-sm transition-[border-color,background-color,box-shadow,transform] duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed motion-reduce:transform-none",
                active
                  ? "border-primary/35 bg-background font-semibold text-foreground shadow-md shadow-primary/5"
                  : stageSwitchLocked
                    ? "border-transparent bg-background/60 text-muted-foreground opacity-50"
                    : "border-border/70 bg-background/80 text-muted-foreground hover:-translate-y-0.5 hover:border-primary/20 hover:bg-background hover:text-foreground",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition-colors duration-200",
                  active
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : complete
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-border bg-muted/50 text-muted-foreground",
                ].join(" ")}
                aria-hidden="true"
              >
                {complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-5">{label}</span>
                <span className="mt-0.5 block text-xs font-normal leading-4 text-muted-foreground">{hint}</span>
              </span>
              {count !== null && countLabel && (
                <span
                  className={[
                    "rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  ].join(" ")}
                  aria-label={`${countLabel}: ${count}`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <section
          id={`${workflowId}-collection-panel`}
          data-testid="social-profile-stage-collection"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`${workflowId}-collection-trigger`}
          hidden={visibleActiveStage !== "collection"}
        >
          <CollectionStage
            profile={profile}
            busy={busy}
            runActive={runActive}
            runProgress={runProgress}
            runDisabled={runDisabled}
            runnableSourceCount={runnableSourceCount}
            anotherRunActive={actionLocked && !runActive}
            canRunProfile={canRunProfile}
            onRun={onRun}
            onRestore={() => onPatch(profile, "resume")}
            onContinue={() => moveToStage(hasReviewWork ? "review" : "results")}
          />
        </section>

        <section
          id={`${workflowId}-review-panel`}
          data-testid="social-profile-stage-review"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`${workflowId}-review-trigger`}
          hidden={visibleActiveStage !== "review" || !hasReviewWork}
        >
          <div className="space-y-4">
            <div>
              <h4 className="text-base font-semibold">{t("workflow.reviewTitle")}</h4>
              <p className="mt-1 max-w-[70ch] text-sm leading-5 text-muted-foreground">
                {t("workflow.reviewHint")}
              </p>
            </div>
            <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
              <div className="bg-background p-3.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("workflow.latestRunScope")}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {runProgress?.review ?? 0}
                </p>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">
                  {runProgress
                    ? t("workflow.latestRunReviewHint")
                    : t("workflow.latestRunUnavailable")}
                </p>
              </div>
              <div className="bg-background p-3.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("workflow.fullReviewQueue")}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {profile.findings.needsReview}
                </p>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">
                  {t("workflow.fullReviewQueueHint")}
                </p>
              </div>
            </div>
            {profile.subjectId ? (
              <ReviewDryRunPreview
                profile={profile}
                canApplyReview={canApplyReview}
                onReviewChanged={onReviewChanged}
                embedded
                active={visibleActiveStage === "review"}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("reviewDryRun.unavailable")}</p>
            )}
            <div className="flex justify-end border-t pt-4">
              <Button type="button" className="min-h-11" onClick={() => moveToStage("results")}>
                {t("workflow.continueToResults")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </section>

        <section
          id={`${workflowId}-results-panel`}
          data-testid="social-profile-stage-results"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`${workflowId}-results-trigger`}
          hidden={visibleActiveStage !== "results"}
        >
          <ResultsStage
            profile={profile}
            navigationLocked={actionLocked}
            platformActions={platformActions}
            onOpenResults={onOpenResults}
          />
        </section>
      </div>
    </article>
  )
}

function CollectionStage({
  profile,
  busy,
  runActive,
  runProgress,
  runDisabled,
  runnableSourceCount,
  anotherRunActive,
  canRunProfile,
  onRun,
  onRestore,
  onContinue,
}: {
  profile: Profile
  busy: boolean
  runActive: boolean
  runProgress: MonitoringProfileRunProgress | null
  runDisabled: boolean
  runnableSourceCount: number
  anotherRunActive: boolean
  canRunProfile: boolean
  onRun: (
    profile: Profile,
    platform?: MonitoringProfileRunPlatform,
    runMode?: MonitoringProfileRunMode,
  ) => void
  onRestore: () => void
  onContinue: () => void
}) {
  const t = useTranslations("socialMonitoring.profiles")
  const locale = useLocale()
  const resumable = profile.status === "needs_resume" || profile.status === "archived"

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-semibold">{t("workflow.collectionTitle")}</h4>
        <p className="mt-1 max-w-[70ch] text-sm leading-5 text-muted-foreground">
          {t("workflow.collectionHint")}
        </p>
      </div>

      {(profile.coverage ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={t("card.coverage")}>
          {(profile.coverage ?? []).map(coverage => (
            <span
              key={coverage.platform}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
            >
              <span
                className={[
                  "h-1.5 w-1.5 rounded-full",
                  coverage.collectionState === "configured"
                    ? "bg-emerald-500"
                    : coverage.collectionState === "limited" || coverage.collectionState === "paused"
                      ? "bg-amber-500"
                      : "bg-destructive",
                ].join(" ")}
                aria-hidden="true"
              />
              {t(`platforms.${coverage.platform}`)}
              <span className="text-muted-foreground">
                {t(`card.collectionState.${coverage.collectionState}`)}
              </span>
            </span>
          ))}
        </div>
      )}

      <ProfileRunFooter
        profile={profile}
        runActive={runActive}
        runProgress={runProgress}
        runDisabled={runDisabled}
        runnableSourceCount={runnableSourceCount}
        anotherRunActive={anotherRunActive}
        canRunProfile={canRunProfile}
        onRun={onRun}
      />

      {runProgress && !runActive && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/25 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">{t("workflow.collectionStepComplete")}</p>
            <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
              {t("workflow.collectionStepCompleteHint", {
                review: runProgress.review,
                accepted: runProgress.accepted,
              })}
            </p>
          </div>
          <Button type="button" className="min-h-11 shrink-0" onClick={onContinue}>
            {runProgress.review > 0 ? t("workflow.continueToReview") : t("workflow.continueToResults")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      <details className="border-t pt-1">
        <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("workflow.coverageDetails")}
        </summary>
        <div className="space-y-4 pb-2 pt-2">
          <dl className="space-y-1.5 text-xs">
            <Row
              label={t("card.directions")}
              value={profile.directions.length > 0
                ? profile.directions.map(direction => t(`directions.${direction}`)).join(", ")
                : t("card.none")}
            />
            <Row
              label={t("card.lastUpdated")}
              value={new Date(profile.lastUpdatedAt).toLocaleDateString(locale)}
            />
          </dl>
          <div>
            <p className="text-xs font-medium">{t("card.coverage")}</p>
            <div className="mt-2 divide-y border-y">
              {(profile.coverage ?? []).length === 0 && (
                <p className="py-3 text-xs text-muted-foreground">{t("card.scope.not_configured")}</p>
              )}
              {(profile.coverage ?? []).map(item => (
                <CoverageRow key={item.platform} coverage={item} />
              ))}
            </div>
          </div>
        </div>
      </details>

      {resumable && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-xs">
          <p className="text-muted-foreground">{t("card.resumeHint")}</p>
          <Button size="sm" variant="outline" className="mt-2 min-h-11" onClick={onRestore} disabled={busy}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t("actions.restore")}
          </Button>
        </div>
      )}

    </div>
  )
}

function ResultsStage({
  profile,
  navigationLocked,
  platformActions,
  onOpenResults,
}: {
  profile: Profile
  navigationLocked: boolean
  platformActions: Array<{
    platform: Exclude<MonitoringProfileRunPlatform, "all">
    configured: boolean
    resultCount: number
    Icon: typeof Radio
  }>
  onOpenResults: (
    profile: Profile,
    target?: MonitoringProfileFindingsTarget,
  ) => void
}) {
  const t = useTranslations("socialMonitoring.profiles")

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-lg font-semibold tracking-tight">{t("workflow.resultsTitle")}</h4>
            <span className="inline-flex rounded-full border bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {t("workflow.savedResultsScope")}
            </span>
          </div>
          <p className="mt-1 max-w-[70ch] text-sm leading-5 text-muted-foreground">
            {t("workflow.resultsHint")}
          </p>
        </div>
        <Button
          type="button"
          className="group min-h-11 shrink-0"
          disabled={!profile.subjectId || navigationLocked}
          title={!profile.subjectId ? t("workflow.resultsRequireSubject") : undefined}
          onClick={() => onOpenResults(profile)}
        >
          <SearchCheck className="h-4 w-4" aria-hidden="true" />
          {t("workflow.openCleanResults")}
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5 motion-reduce:transform-none"
            aria-hidden="true"
          />
        </Button>
      </div>

      {!profile.subjectId && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("workflow.resultsRequireSubject")}</span>
        </p>
      )}

      <div
        role="group"
        aria-label={t("workflow.resultsSummaryLabel", { name: profile.name })}
        className="grid grid-cols-2 gap-2 md:grid-cols-5"
      >
        <FindingMetric
          label={t("workflow.acceptedShort")}
          value={profile.findings.total}
          emphasis
          disabled={!profile.subjectId || navigationLocked}
          testId="social-profile-open-metric-all"
          ariaLabel={t("workflow.openFilteredResults", {
            filter: t("workflow.acceptedShort"),
            count: profile.findings.total,
          })}
          onClick={() => onOpenResults(profile)}
        />
        <FindingMetric
          label={t("workflow.posts")}
          value={profile.findings.posts}
          disabled={!profile.subjectId || navigationLocked}
          testId="social-profile-open-metric-posts"
          ariaLabel={t("workflow.openFilteredResults", {
            filter: t("workflow.posts"),
            count: profile.findings.posts,
          })}
          onClick={() => onOpenResults(profile, { surface: "posts" })}
        />
        <FindingMetric
          label={t("workflow.comments")}
          value={profile.findings.comments}
          disabled={!profile.subjectId || navigationLocked}
          testId="social-profile-open-metric-comments"
          ariaLabel={t("workflow.openFilteredResults", {
            filter: t("workflow.comments"),
            count: profile.findings.comments,
          })}
          onClick={() => onOpenResults(profile, { surface: "comments" })}
        />
        <FindingMetric
          label={t("card.findings.media")}
          value={profile.findings.media}
          disabled={!profile.subjectId || navigationLocked}
          testId="social-profile-open-metric-media"
          ariaLabel={t("workflow.openFilteredResults", {
            filter: t("card.findings.media"),
            count: profile.findings.media,
          })}
          onClick={() => onOpenResults(profile, { surface: "media" })}
        />
        <FindingMetric
          label={t("card.findings.negative")}
          value={profile.findings.negative}
          attention={profile.findings.negative > 0}
          disabled={!profile.subjectId || navigationLocked}
          testId="social-profile-open-metric-negative"
          ariaLabel={t("workflow.openFilteredResults", {
            filter: t("card.findings.negative"),
            count: profile.findings.negative,
          })}
          onClick={() => onOpenResults(profile, { sentiment: "negative" })}
        />
      </div>

      <section aria-labelledby={`${profile.id}-platform-findings-title`}>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h5 id={`${profile.id}-platform-findings-title`} className="text-sm font-semibold">
            {t("report.platformResultsLabel")}
          </h5>
          <span className="text-xs text-muted-foreground">{t("report.platformResultsHint")}</span>
        </div>
        <div
          role="group"
          aria-label={t("report.platformResultsLabel")}
          className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-2"
        >
          {platformActions.map(({ platform, configured, resultCount, Icon }) => (
            <button
              key={platform}
              type="button"
              data-testid={`social-profile-open-platform-${platform}`}
              disabled={!profile.subjectId || navigationLocked}
              onClick={() => onOpenResults(profile, { platform })}
              className="group flex min-h-20 min-w-0 items-center gap-3 rounded-xl border bg-background p-3 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
              aria-label={t("report.viewPlatform", {
                platform: t(`platforms.${platform}`),
                count: resultCount,
              })}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border bg-muted/35 text-muted-foreground transition-colors group-hover:border-primary/20 group-hover:bg-primary/[0.07] group-hover:text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{t(`platforms.${platform}`)}</span>
                <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={configured ? "h-1.5 w-1.5 rounded-full bg-emerald-500" : "h-1.5 w-1.5 rounded-full bg-amber-500"}
                    aria-hidden="true"
                  />
                  {configured ? t("report.configured") : t("report.notConfigured")}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="text-lg font-semibold tabular-nums">{resultCount}</span>
                <ArrowRight
                  className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary group-focus-visible:translate-x-0.5 motion-reduce:transform-none"
                  aria-hidden="true"
                />
              </span>
            </button>
          ))}
        </div>
      </section>

      {profile.findings.total === 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-dashed bg-muted/15 p-4 text-sm leading-5 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("workflow.emptyResults")}</span>
        </p>
      )}
    </div>
  )
}

function ReviewDryRunPreview({
  profile,
  canApplyReview,
  onReviewChanged,
  embedded = false,
  active = false,
}: {
  profile: Profile
  canApplyReview: boolean
  onReviewChanged: () => Promise<void>
  embedded?: boolean
  active?: boolean
}) {
  const t = useTranslations("socialMonitoring.profiles.reviewDryRun")
  const locale = useLocale()
  const disclosureId = useId()
  const triggerId = `${disclosureId}-trigger`
  const panelId = `${disclosureId}-panel`
  const panelTitleId = `${disclosureId}-title`
  const previewRequestRef = useRef<AbortController | null>(null)
  const mutationRequestRef = useRef<AbortController | null>(null)
  const confirmationRef = useRef<HTMLHeadingElement | null>(null)
  const applyActionRef = useRef<HTMLButtonElement | null>(null)
  const rollbackActionRef = useRef<HTMLButtonElement | null>(null)
  const mutationResultRef = useRef<HTMLDivElement | null>(null)
  const applyIdempotencyRef = useRef<string | null>(null)
  const rollbackIdempotencyRef = useRef<string | null>(null)
  const [open, setOpen] = useState(embedded)
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [preview, setPreview] = useState<ReviewDryRunSummary | null>(null)
  const [latestRun, setLatestRun] = useState<ReviewApplyRun | null>(null)
  const [applyPhase, setApplyPhase] = useState<ReviewApplyPhase>("idle")
  const [applyError, setApplyError] = useState<ReviewApplyError | null>(null)

  useEffect(() => () => {
    previewRequestRef.current?.abort()
    mutationRequestRef.current?.abort()
  }, [])

  useEffect(() => {
    if (applyPhase !== "confirm_apply" && applyPhase !== "confirm_rollback") return
    const frame = window.requestAnimationFrame(() => confirmationRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [applyPhase])

  const loadPreview = useCallback(async () => {
    if (!profile.subjectId) return
    previewRequestRef.current?.abort()
    const controller = new AbortController()
    previewRequestRef.current = controller
    setStatus("loading")

    try {
      const response = await fetch(
        `/api/v1/social/monitoring-profiles/${encodeURIComponent(profile.subjectId)}/review-dry-run`,
        { signal: controller.signal },
      )
      const body = await response.json().catch(() => null) as ReviewDryRunApiResponse | null
      const data = body?.data
      if (!response.ok || !body?.success || !isReviewDryRunSummary(data)) {
        throw new Error(body?.error || "review_dry_run_unavailable")
      }
      if (previewRequestRef.current !== controller) return
      setPreview(data)
      setLatestRun(current => data.latestRun ?? current)
      setStatus("ready")
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      console.error("Monitoring review dry-run failed", error)
      if (previewRequestRef.current === controller) setStatus("error")
    } finally {
      if (previewRequestRef.current === controller) previewRequestRef.current = null
    }
  }, [profile.subjectId])

  useEffect(() => {
    if (!embedded || !active || !open || status !== "idle") return
    void loadPreview()
  }, [active, embedded, loadPreview, open, status])

  function togglePreview() {
    if (open) {
      previewRequestRef.current?.abort()
      previewRequestRef.current = null
      setOpen(false)
      if (!preview) setStatus("idle")
      return
    }
    setOpen(true)
    void loadPreview()
  }

  async function applySafeDecisions() {
    if (
      !profile.subjectId
      || !canApplyReview
      || !preview
      || status !== "ready"
      || preview.safeApply.eligibleLinks === 0
      || latestRun?.state === "APPLIED"
    ) return

    mutationRequestRef.current?.abort()
    const controller = new AbortController()
    mutationRequestRef.current = controller
    const idempotencyKey = applyIdempotencyRef.current ?? window.crypto.randomUUID()
    applyIdempotencyRef.current = idempotencyKey
    setApplyError(null)
    setApplyPhase("applying")

    try {
      const response = await fetch(
        `/api/v1/social/monitoring-profiles/${encodeURIComponent(profile.subjectId)}/review-apply`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idempotencyKey,
            mode: "SAFE_RESOLVE",
            resolverVersion: preview.resolverVersion,
            planFingerprint: preview.safeApply.planFingerprint,
            expectedLinks: preview.safeApply.eligibleLinks,
            expectedRows: preview.safeApply.eligibleRows,
          }),
          signal: controller.signal,
        },
      )
      const body = await response.json().catch(() => null) as ReviewApplyApiResponse | null
      if (mutationRequestRef.current !== controller) return
      if (response.status === 409) {
        setApplyPhase("idle")
        const conflict = body?.error
        if ([
          "review_apply_preview_stale",
          "review_apply_already_active",
          "review_apply_idempotency_conflict",
          "review_apply_nothing_eligible",
          "review_apply_rollback_unavailable",
        ].includes(conflict ?? "")) {
          applyIdempotencyRef.current = null
        }
        setApplyError(
          conflict === "review_apply_preview_stale"
            ? "stale"
            : conflict === "review_apply_already_active"
              ? "already_active"
              : conflict === "review_apply_idempotency_conflict"
                ? "idempotency_conflict"
                : conflict === "review_apply_nothing_eligible"
                  ? "nothing_eligible"
                  : conflict === "review_apply_rollback_unavailable"
                    ? "rollback_window_unavailable"
                    : "apply",
        )
        await Promise.all([loadPreview(), onReviewChanged()])
        window.requestAnimationFrame(() => {
          if (conflict === "review_apply_already_active") {
            mutationResultRef.current?.focus()
          } else {
            applyActionRef.current?.focus()
          }
        })
        return
      }
      const run = body?.data?.run
      if (!response.ok || !body?.success || !isReviewApplyRun(run)) {
        throw new Error(body?.error || "review_apply_unavailable")
      }
      applyIdempotencyRef.current = null
      setLatestRun(run)
      setApplyPhase("idle")
      window.requestAnimationFrame(() => mutationResultRef.current?.focus())
      await Promise.all([loadPreview(), onReviewChanged()])
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      console.error("Monitoring review apply failed", error)
      if (mutationRequestRef.current === controller) {
        setApplyPhase("idle")
        setApplyError("apply")
      }
    } finally {
      if (mutationRequestRef.current === controller) mutationRequestRef.current = null
    }
  }

  async function rollbackSafeDecisions() {
    if (
      !profile.subjectId
      || !canApplyReview
      || !latestRun
      || latestRun.state !== "APPLIED"
      || !latestRun.rollbackAvailable
    ) return

    mutationRequestRef.current?.abort()
    const controller = new AbortController()
    mutationRequestRef.current = controller
    const idempotencyKey = rollbackIdempotencyRef.current ?? window.crypto.randomUUID()
    rollbackIdempotencyRef.current = idempotencyKey
    setApplyError(null)
    setApplyPhase("rolling_back")

    try {
      const response = await fetch(
        `/api/v1/social/monitoring-profiles/${encodeURIComponent(profile.subjectId)}/review-apply/${encodeURIComponent(latestRun.id)}/rollback`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey }),
          signal: controller.signal,
        },
      )
      const body = await response.json().catch(() => null) as ReviewApplyApiResponse | null
      if (mutationRequestRef.current !== controller) return
      if (response.status === 409) {
        rollbackIdempotencyRef.current = null
        setApplyPhase("idle")
        setApplyError("rollback_unavailable")
        await Promise.all([loadPreview(), onReviewChanged()])
        window.requestAnimationFrame(() => mutationResultRef.current?.focus())
        return
      }
      const run = body?.data?.run
      if (!response.ok || !body?.success || !isReviewApplyRun(run)) {
        throw new Error(body?.error || "review_rollback_unavailable")
      }
      rollbackIdempotencyRef.current = null
      setLatestRun(run)
      setApplyPhase("idle")
      window.requestAnimationFrame(() => mutationResultRef.current?.focus())
      await Promise.all([loadPreview(), onReviewChanged()])
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      console.error("Monitoring review rollback failed", error)
      if (mutationRequestRef.current === controller) {
        setApplyPhase("idle")
        setApplyError("rollback")
      }
    } finally {
      if (mutationRequestRef.current === controller) mutationRequestRef.current = null
    }
  }

  const generatedAt = preview ? new Date(preview.generatedAt) : null
  const generatedAtLabel = generatedAt && Number.isFinite(generatedAt.getTime())
    ? generatedAt.toLocaleString(locale)
    : preview?.generatedAt ?? ""

  const reasonLabel = (reason: string): string => {
    const key = `reasons.${reason}`
    return t.has(key) ? t(key) : reason
  }
  const mutationBusy = applyPhase === "applying" || applyPhase === "rolling_back"

  return (
    <section
      className={embedded ? "relative" : "pointer-events-auto relative mt-3 border-t pt-3"}
      aria-label={t("sectionLabel", { name: profile.name })}
    >
      {!embedded && (
        <Button
          id={triggerId}
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 w-full justify-between gap-3 whitespace-normal px-3 py-2 text-left"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={!profile.subjectId}
          onClick={togglePreview}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              {open
                ? t("hideAction")
                : t("previewAction", { count: profile.findings.needsReview })}
            </span>
          </span>
          {open
            ? <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
            : <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />}
        </Button>
      )}

      {!profile.subjectId && (
        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{t("unavailable")}</p>
      )}

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={embedded ? panelTitleId : triggerId}
          aria-busy={status === "loading" || mutationBusy}
          className={embedded ? "space-y-3" : "mt-2 space-y-3 border-y bg-muted/25 px-3 py-3"}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h5 id={panelTitleId} className="text-sm font-semibold">{t("title")}</h5>
              <p className="mt-1 max-w-[70ch] text-xs leading-5 text-muted-foreground">
                {t("noChanges")}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
              <Eye className="h-3 w-3" aria-hidden="true" />{t("readOnly")}
            </Badge>
          </div>

          {status === "loading" && (
            <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("loading")}
            </p>
          )}

          {status === "error" && (
            <div role="alert" className="space-y-2">
              <p className="flex items-start gap-2 text-xs leading-5 text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{preview ? t("refreshError") : t("error")}</span>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() => void loadPreview()}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{t("retry")}
              </Button>
            </div>
          )}

          {preview && (
            <>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("scopeSummary", {
                  total: preview.totalRows,
                  unique: preview.uniqueCandidates,
                  duplicates: preview.duplicateRows,
                })}
              </p>

              <div
                role="group"
                aria-label={t("scopeCountsLabel")}
                className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3"
              >
                <ReviewDryRunMetric label={t("metrics.rows")} value={preview.totalRows} />
                <ReviewDryRunMetric label={t("metrics.unique")} value={preview.uniqueCandidates} />
                <ReviewDryRunMetric label={t("metrics.duplicates")} value={preview.duplicateRows} />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium">{t("decisionsTitle")}</p>
                <div
                  role="group"
                  aria-label={t("decisionCountsLabel")}
                  className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3"
                >
                  <ReviewDryRunMetric
                    label={t("decisions.reject")}
                    value={preview.decisions.reject}
                    tone="warning"
                  />
                  <ReviewDryRunMetric
                    label={t("decisions.release")}
                    value={preview.decisions.release}
                    hint={t("decisions.releaseHint")}
                  />
                  <ReviewDryRunMetric
                    label={t("decisions.review")}
                    value={preview.decisions.review}
                    tone="attention"
                  />
                </div>
              </div>

              <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                <span>{t("releaseExplanation")}</span>
              </p>

              <details>
                <summary className="flex min-h-11 cursor-pointer select-none items-center text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  {t("reasonBreakdown", { count: preview.reasonBreakdown.length })}
                </summary>
                {preview.reasonBreakdown.length > 0 ? (
                  <dl className="divide-y border-y text-xs">
                    {preview.reasonBreakdown.map(item => (
                      <div key={item.reason} className="flex min-w-0 items-start justify-between gap-3 py-2">
                        <dt className="min-w-0 break-words text-muted-foreground" title={item.reason}>
                          {reasonLabel(item.reason)}
                        </dt>
                        <dd className="shrink-0 tabular-nums font-medium">{item.count.toLocaleString(locale)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">{t("noReasons")}</p>
                )}
              </details>

              <dl className="grid gap-x-4 gap-y-1 text-[11px] leading-4 text-muted-foreground sm:grid-cols-2">
                <div className="flex min-w-0 gap-1">
                  <dt className="shrink-0 font-medium text-foreground">{t("generatedAt")}:</dt>
                  <dd className="min-w-0 break-words">{generatedAtLabel}</dd>
                </div>
                <div className="flex min-w-0 gap-1">
                  <dt className="shrink-0 font-medium text-foreground">{t("resolverVersion")}:</dt>
                  <dd className="min-w-0 break-all">{preview.resolverVersion}</dd>
                </div>
              </dl>

              <ReviewApplyControls
                apply={preview.safeApply}
                latestRun={latestRun}
                canApplyReview={canApplyReview}
                phase={applyPhase}
                error={applyError}
                locale={locale}
                confirmationRef={confirmationRef}
                applyActionRef={applyActionRef}
                rollbackActionRef={rollbackActionRef}
                mutationResultRef={mutationResultRef}
                previewActionable={status === "ready"}
                onConfirmApply={() => {
                  setApplyError(null)
                  setApplyPhase("confirm_apply")
                }}
                onApply={() => void applySafeDecisions()}
                onCancel={() => {
                  const returningToApply = applyPhase === "confirm_apply"
                  setApplyPhase("idle")
                  window.requestAnimationFrame(() => {
                    if (returningToApply) {
                      applyActionRef.current?.focus()
                    } else {
                      rollbackActionRef.current?.focus()
                    }
                  })
                }}
                onRetryApply={() => {
                  setApplyError(null)
                  setApplyPhase("confirm_apply")
                }}
                onConfirmRollback={() => {
                  setApplyError(null)
                  setApplyPhase("confirm_rollback")
                }}
                onRollback={() => void rollbackSafeDecisions()}
                onRetryRollback={() => {
                  setApplyError(null)
                  setApplyPhase("confirm_rollback")
                }}
              />
            </>
          )}
        </div>
      )}
    </section>
  )
}

function ReviewApplyControls({
  apply,
  latestRun,
  canApplyReview,
  phase,
  error,
  locale,
  confirmationRef,
  applyActionRef,
  rollbackActionRef,
  mutationResultRef,
  previewActionable,
  onConfirmApply,
  onApply,
  onCancel,
  onRetryApply,
  onConfirmRollback,
  onRollback,
  onRetryRollback,
}: {
  apply: ReviewSafeApplyPlan
  latestRun: ReviewApplyRun | null
  canApplyReview: boolean
  phase: ReviewApplyPhase
  error: ReviewApplyError | null
  locale: string
  confirmationRef: RefObject<HTMLHeadingElement | null>
  applyActionRef: RefObject<HTMLButtonElement | null>
  rollbackActionRef: RefObject<HTMLButtonElement | null>
  mutationResultRef: RefObject<HTMLDivElement | null>
  previewActionable: boolean
  onConfirmApply: () => void
  onApply: () => void
  onCancel: () => void
  onRetryApply: () => void
  onConfirmRollback: () => void
  onRollback: () => void
  onRetryRollback: () => void
}) {
  const t = useTranslations("socialMonitoring.profiles.reviewDryRun.apply")
  const hasProtectedRows = (
    apply.protectedMixedRows
    + apply.protectedSharedRows
    + apply.protectedStoredDecisionRows
    + apply.protectedPreviousDecisionRows
    + apply.protectedRetentionRows
  ) > 0
  const runApplied = latestRun?.state === "APPLIED"
  const hasEligibleApply = !runApplied && apply.eligibleLinks > 0
  const canStartNewApply = hasEligibleApply && previewActionable && Boolean(apply.rollbackUntil)
  const runTimestamp = latestRun?.rolledBackAt
    ?? latestRun?.finalizedAt
    ?? latestRun?.createdAt
    ?? null
  const runTimestampLabel = runTimestamp
    ? new Date(runTimestamp).toLocaleString(locale)
    : ""
  const rollbackUntil = latestRun?.rollbackUntil ?? apply.rollbackUntil
  const rollbackUntilLabel = rollbackUntil
    ? new Date(rollbackUntil).toLocaleString(locale)
    : ""

  return (
    <section className="space-y-3 border-t pt-3" aria-label={t("sectionLabel")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h6 className="text-xs font-semibold">{t("title")}</h6>
          <p className="mt-1 max-w-[70ch] text-[11px] leading-4 text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {t("safeResolve")}
        </Badge>
      </div>

      <div
        role="group"
        aria-label={t("eligibleCountsLabel")}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4"
      >
        <ReviewDryRunMetric label={t("rejectLinks")} value={apply.rejectLinks} tone="warning" />
        <ReviewDryRunMetric label={t("rejectRows")} value={apply.rejectRows} />
        <ReviewDryRunMetric label={t("releaseLinks")} value={apply.releaseLinks} tone="attention" />
        <ReviewDryRunMetric label={t("releaseRows")} value={apply.releaseRows} />
      </div>

      {hasProtectedRows && (
        <details>
          <summary className="flex min-h-11 cursor-pointer select-none items-center text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            {t("protectedTitle")}
          </summary>
          <dl className="divide-y border-y text-xs">
            <ReviewApplyProtectedRow
              label={t("protectedMixed")}
              links={apply.protectedMixedLinks}
              rows={apply.protectedMixedRows}
              locale={locale}
              valuesLabel={t("protectedValues", {
                links: apply.protectedMixedLinks,
                rows: apply.protectedMixedRows,
              })}
            />
            <ReviewApplyProtectedRow
              label={t("protectedShared")}
              links={apply.protectedSharedLinks}
              rows={apply.protectedSharedRows}
              locale={locale}
              valuesLabel={t("protectedValues", {
                links: apply.protectedSharedLinks,
                rows: apply.protectedSharedRows,
              })}
            />
            <ReviewApplyProtectedRow
              label={t("protectedStoredDecision")}
              links={apply.protectedStoredDecisionLinks}
              rows={apply.protectedStoredDecisionRows}
              locale={locale}
              valuesLabel={t("protectedValues", {
                links: apply.protectedStoredDecisionLinks,
                rows: apply.protectedStoredDecisionRows,
              })}
            />
            <ReviewApplyProtectedRow
              label={t("protectedPreviousDecision")}
              links={apply.protectedPreviousDecisionLinks}
              rows={apply.protectedPreviousDecisionRows}
              locale={locale}
              valuesLabel={t("protectedValues", {
                links: apply.protectedPreviousDecisionLinks,
                rows: apply.protectedPreviousDecisionRows,
              })}
            />
            <ReviewApplyProtectedRow
              label={t("protectedRetention")}
              links={apply.protectedRetentionLinks}
              rows={apply.protectedRetentionRows}
              locale={locale}
              valuesLabel={t("protectedValues", {
                links: apply.protectedRetentionLinks,
                rows: apply.protectedRetentionRows,
              })}
            />
          </dl>
        </details>
      )}

      {error && (
        <div role="alert" className="space-y-2 text-xs">
          <p className="flex items-start gap-2 leading-5 text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t(`errors.${error}`)}</span>
          </p>
          {error === "apply" && canStartNewApply && (
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onRetryApply}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t("retryApply")}
            </Button>
          )}
          {error === "rollback" && latestRun?.rollbackAvailable && (
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onRetryRollback}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t("retryRollback")}
            </Button>
          )}
        </div>
      )}

      {phase === "applying" && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 border-y py-3 text-xs leading-5"
        >
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
          <div>
            <p className="font-medium">{t("applying")}</p>
            <p className="text-muted-foreground">
              {t("applyingHint", {
                links: apply.eligibleLinks,
                rows: apply.eligibleRows,
                rejectLinks: apply.rejectLinks,
                rejectRows: apply.rejectRows,
                releaseLinks: apply.releaseLinks,
                releaseRows: apply.releaseRows,
              })}
            </p>
          </div>
        </div>
      )}

      {phase === "rolling_back" && latestRun && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 border-y py-3 text-xs leading-5"
        >
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
          <div>
            <p className="font-medium">{t("rollingBack")}</p>
            <p className="text-muted-foreground">
              {t("rollingBackHint", {
                links: latestRun.appliedGroupCount,
                rows: latestRun.appliedRowCount,
              })}
            </p>
          </div>
        </div>
      )}

      {phase === "confirm_apply" && (
        <div className="space-y-3 border-y py-3">
          <div>
            <h6
              ref={confirmationRef}
              tabIndex={-1}
              className="text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("confirmTitle")}
            </h6>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("confirmBody", {
                links: apply.eligibleLinks,
                rows: apply.eligibleRows,
                rejectLinks: apply.rejectLinks,
                rejectRows: apply.rejectRows,
                releaseLinks: apply.releaseLinks,
                releaseRows: apply.releaseRows,
              })}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("noProviderCalls")}</p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {t("rollbackPlannedUntil", { time: rollbackUntilLabel })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="default" size="sm" className="min-h-11" onClick={onApply}>
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t("confirmAction", {
                links: apply.eligibleLinks,
                rows: apply.eligibleRows,
                rejectLinks: apply.rejectLinks,
                releaseLinks: apply.releaseLinks,
              })}
            </Button>
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onCancel}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {phase === "confirm_rollback" && latestRun && (
        <div className="space-y-3 border-y py-3">
          <div>
            <h6
              ref={confirmationRef}
              tabIndex={-1}
              className="text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("rollbackConfirmTitle")}
            </h6>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("rollbackConfirmBody", {
                links: latestRun.appliedGroupCount,
                rows: latestRun.appliedRowCount,
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="default" size="sm" className="min-h-11" onClick={onRollback}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("rollbackConfirmAction")}
            </Button>
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onCancel}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {phase === "idle" && latestRun && (
        <div
          ref={mutationResultRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className="space-y-2 border-y py-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start gap-2">
            {latestRun.state === "APPLIED" || latestRun.state === "FINALIZED"
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              : latestRun.state === "ROLLED_BACK"
                ? <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />}
            <div className="min-w-0">
              <p className="font-medium">{t(`runStates.${latestRun.state}`)}</p>
              <p className="mt-0.5 leading-5 text-muted-foreground">
                {t("runResult", {
                  links: latestRun.appliedGroupCount,
                  rows: latestRun.appliedRowCount,
                })}
              </p>
              {runTimestampLabel && (
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{runTimestampLabel}</p>
              )}
              {latestRun.state === "APPLIED" && (
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {t("pendingFinalization")}
                </p>
              )}
            </div>
          </div>
          {latestRun.state === "APPLIED" && latestRun.rollbackAvailable && (
            <div className="pt-1">
              <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
                {t("rollbackAvailableUntil", { time: rollbackUntilLabel })}
              </p>
              {canApplyReview ? (
                <Button
                  ref={rollbackActionRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={onConfirmRollback}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t("rollbackAction")}
                </Button>
              ) : (
                <p className="text-[11px] leading-4 text-muted-foreground">{t("adminOnly")}</p>
              )}
            </div>
          )}
          {latestRun.state === "APPLIED" && !latestRun.rollbackAvailable && (
            <p className="text-[11px] leading-4 text-muted-foreground">{t("rollbackUnavailable")}</p>
          )}
        </div>
      )}

      {phase === "idle" && canStartNewApply && (
        canApplyReview ? (
          <Button
            ref={applyActionRef}
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 w-full whitespace-normal"
            onClick={onConfirmApply}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t("action", {
              links: apply.eligibleLinks,
              rows: apply.eligibleRows,
              rejectLinks: apply.rejectLinks,
              rejectRows: apply.rejectRows,
              releaseLinks: apply.releaseLinks,
              releaseRows: apply.releaseRows,
            })}
          </Button>
        ) : (
          <p className="flex items-start gap-2 text-[11px] leading-4 text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t("adminOnly")}</span>
          </p>
        )
      )}

      {phase === "idle" && hasEligibleApply && !previewActionable && (
        <p className="text-[11px] leading-4 text-muted-foreground">{t("refreshBeforeApply")}</p>
      )}

      {phase === "idle" && hasEligibleApply && previewActionable && !apply.rollbackUntil && (
        <p className="text-[11px] leading-4 text-muted-foreground">{t("rollbackWindowUnavailable")}</p>
      )}

      {phase === "idle" && !runApplied && apply.eligibleLinks === 0 && (
        <p className="text-[11px] leading-4 text-muted-foreground">{t("nothingEligible")}</p>
      )}
    </section>
  )
}

function ReviewApplyProtectedRow({
  label,
  links,
  rows,
  locale,
  valuesLabel,
}: {
  label: string
  links: number
  rows: number
  locale: string
  valuesLabel: string
}) {
  if (links === 0 && rows === 0) return null
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 py-2">
      <dt className="min-w-0 break-words text-muted-foreground">{label}</dt>
      <dd
        className="shrink-0 tabular-nums font-medium"
        aria-label={valuesLabel}
      >
        {links.toLocaleString(locale)} / {rows.toLocaleString(locale)}
      </dd>
    </div>
  )
}

function ReviewDryRunMetric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string
  value: number
  hint?: string
  tone?: "neutral" | "attention" | "warning"
}) {
  const toneClass = tone === "attention"
    ? "text-sky-700 dark:text-sky-300"
    : tone === "warning"
      ? "text-amber-800 dark:text-amber-300"
      : "text-foreground"

  return (
    <div className="min-w-0 bg-background px-3 py-2.5">
      <p className={`tabular-nums text-base font-semibold leading-none ${toneClass}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{label}</p>
      {hint && <p className="mt-1 text-[10px] font-medium leading-4 text-foreground">{hint}</p>}
    </div>
  )
}

function ProfileRunFooter({
  profile,
  runActive,
  runProgress,
  runDisabled,
  runnableSourceCount,
  anotherRunActive,
  canRunProfile,
  onRun,
}: {
  profile: Profile
  runActive: boolean
  runProgress: MonitoringProfileRunProgress | null
  runDisabled: boolean
  runnableSourceCount: number
  anotherRunActive: boolean
  canRunProfile: boolean
  onRun: (
    profile: Profile,
    platform?: MonitoringProfileRunPlatform,
    runMode?: MonitoringProfileRunMode,
  ) => void
}) {
  const t = useTranslations("socialMonitoring.profiles")
  const tSocial = useTranslations("socialMonitoring")
  const sharedSourceCount = new Set(
    profile.sources
      .filter(source => source.isActive && source.sharedAcrossMonitorings)
      .map(source => source.id),
  ).size
  const commentsOnlySourceCount = monitoringProfileCommentsOnlySources(profile).length
  const commentsOnlyDisabled = runDisabled || commentsOnlySourceCount === 0
  const platformSummaries = summarizeMonitoringProfileRunPlatforms(
    runProgress?.sourceResults ?? [],
  )
  const visibleRunCounts = runProgress
    ? {
        found: runProgress.found + (runProgress.current?.preview.found ?? 0),
        accepted: runProgress.accepted + (runProgress.current?.preview.accepted ?? 0),
        review: runProgress.review + (runProgress.current?.preview.review ?? 0),
        rejected: runProgress.rejected + (runProgress.current?.preview.rejected ?? 0),
        duplicates: runProgress.duplicates + (runProgress.current?.preview.duplicates ?? 0),
      }
    : null
  const disabledReason = !canRunProfile
    ? t("run.adminOnly")
    : profile.status !== "active"
    ? t("run.resumeFirst")
    : runnableSourceCount === 0 || !profile.subjectId || !profile.scenarioId
      ? t(sharedSourceCount > 0 ? "run.sharedOnly" : "run.noSources")
      : anotherRunActive
        ? t("run.anotherRunning")
        : null
  const currentSource = runProgress?.current
    ? [
        t(`platforms.${runProgress.current.platform}`),
        runProgress.current.label,
      ].filter(Boolean).join(" · ")
    : ""
  const terminalSummary = !runActive && runProgress
    ? runProgress.phase === "completed"
      ? t("run.completed")
      : runProgress.phase === "completed_with_pending"
        ? t("run.completedWithPending", { pending: runProgress.pending })
        : runProgress.phase === "completed_with_issues"
          ? t("run.completedWithIssues", {
              failed: runProgress.failed,
              partial: runProgress.partial,
              skipped: runProgress.skipped,
            })
          : runProgress.phase === "stopped"
            ? t("run.stopped")
            : null
    : null
  const terminalTone = runProgress?.phase === "completed"
    ? "text-emerald-700 dark:text-emerald-300"
    : runProgress && ["completed_with_issues", "completed_with_pending"].includes(runProgress.phase)
      ? "text-amber-800 dark:text-amber-300"
      : "text-muted-foreground"
  const canResumeInterruptedRun = Boolean(
    profile.scenarioId
    && canResumeMonitoringProfileRun({
      progress: runProgress,
      scenarioId: profile.scenarioId,
      profileRevision: monitoringProfileRunRevision(profile),
      sourceIds: monitoringProfileSourcesForPlatform(profile.sources, "all")
        .map(source => source.id),
    }),
  )
  const limitationText = (error: string) => {
    if (error.startsWith("unexpected_source_status:")) {
      return t("run.limitations.unexpected_source_status", {
        status: error.slice("unexpected_source_status:".length),
      })
    }
    const runKey = `run.limitations.${error}`
    if (t.has(runKey)) return t(runKey)
    const collectorKey = `collectorErrors.${error}`
    return tSocial.has(collectorKey) ? tSocial(collectorKey) : error
  }

  return (
    <div
      data-testid={`social-profile-run-${profile.id}`}
      className="pointer-events-auto relative mt-3 border-t pt-3"
    >
      {(runActive || runProgress) && (
        <div
          aria-label={t("run.progressLabel", { name: profile.name })}
          className="mb-3 space-y-2 bg-muted/30 px-3 py-2.5"
        >
          <div className="flex min-w-0 items-start gap-2 text-xs font-medium">
            {runActive
              ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
              : runProgress?.phase === "completed"
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
            <p
              role="status"
              aria-live="polite"
              className={`min-w-0 flex-1 break-words ${runActive ? "" : terminalTone}`}
            >
              {runActive
                ? runProgress?.phase === "stopping"
                  ? t("run.stopping")
                  : currentSource
                    ? runProgress?.current?.stage === "provider_wait"
                      ? `${t("run.waitingProvider")} ${currentSource}`
                      : t("run.currentSource", { source: currentSource })
                    : t("run.preparing")
                : terminalSummary}
            </p>
            <span className="shrink-0 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
              {t(runActive ? "run.currentRunTitle" : "run.lastRunTitle")}
            </span>
          </div>

          {runProgress && (
            <>
              <MonitoringRunProgress
                completed={runProgress.attempted}
                total={runProgress.total}
                active={runActive && runProgress.phase === "running"}
                ariaLabel={t("run.progressLabel", { name: profile.name })}
                ariaValueText={t("run.progress", {
                  attempted: runProgress.attempted,
                  total: runProgress.total,
                })}
              />
              <p className="text-[11px] leading-4 text-muted-foreground">
                {t("run.progress", {
                  attempted: runProgress.attempted,
                  total: runProgress.total,
                })}
              </p>
              <div
                role="group"
                aria-label={t("run.resultCountsLabel")}
                className="grid grid-cols-2 gap-2 sm:grid-cols-5"
              >
                <RunResultMetric
                  label={t("run.metrics.found")}
                  value={visibleRunCounts?.found ?? 0}
                />
                <RunResultMetric
                  label={t("run.metrics.accepted")}
                  value={visibleRunCounts?.accepted ?? 0}
                  tone="success"
                />
                <RunResultMetric
                  label={t("run.metrics.review")}
                  value={visibleRunCounts?.review ?? 0}
                  tone={(visibleRunCounts?.review ?? 0) > 0 ? "attention" : "neutral"}
                />
                <RunResultMetric
                  label={t("run.metrics.rejected")}
                  value={visibleRunCounts?.rejected ?? 0}
                  tone={(visibleRunCounts?.rejected ?? 0) > 0 ? "warning" : "neutral"}
                />
                <RunResultMetric
                  label={t("run.metrics.duplicates")}
                  value={visibleRunCounts?.duplicates ?? 0}
                />
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                {t(runActive ? "run.liveCountsHint" : "run.finalCountsHint")}
              </p>

              {platformSummaries.length > 0 && (
                <details className="rounded-lg border bg-background/70 px-3">
                  <summary className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                    {t("run.platformBreakdown")}
                    <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </summary>
                  <div className="divide-y border-t pb-1">
                    {platformSummaries.map(platform => (
                      <div key={platform.platform} className="py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                          <p className="text-xs font-medium">
                            {t.has(`platforms.${platform.platform}`)
                              ? t(`platforms.${platform.platform}`)
                              : platform.platform}
                          </p>
                          {platform.issueCount > 0 && (
                            <span className="text-[10px] text-amber-800 dark:text-amber-300">
                              {t("run.platformIssues", { count: platform.issueCount })}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                          {t("run.breakdownCounts", {
                            found: platform.found,
                            accepted: platform.accepted,
                            review: platform.review,
                            rejected: platform.rejected,
                            duplicates: platform.duplicates,
                          })}
                        </p>
                        <details className="mt-1.5">
                          <summary className="cursor-pointer select-none text-[11px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                            {t("run.sourceBreakdown", { count: platform.sources.length })}
                          </summary>
                          <div className="mt-1 divide-y pl-2">
                            {platform.sources.map(source => (
                              <div key={source.sourceId} className="py-1.5 text-[11px] leading-4">
                                <div className="flex min-w-0 items-baseline justify-between gap-2">
                                  <span className="min-w-0 break-words font-medium">
                                    {source.label || t(`platforms.${source.platform}`)}
                                  </span>
                                  <span className="shrink-0 text-muted-foreground">
                                    {t(`run.sourceStatus.${sourceRunStatusKey(source.status)}`)}
                                  </span>
                                </div>
                                <p className="text-muted-foreground">
                                  {t("run.breakdownCounts", {
                                    found: source.found,
                                    accepted: source.accepted,
                                    review: source.review,
                                    rejected: source.rejected,
                                    duplicates: source.duplicates,
                                  })}
                                </p>
                                {source.limitations.map(error => (
                                  <p
                                    key={error}
                                    className="break-words text-amber-800 dark:text-amber-300"
                                  >
                                    {t("run.sourceLimitation", { reason: limitationText(error) })}
                                  </p>
                                ))}
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {!runActive && (
        <div className={profile.commentsEnabled ? "grid gap-2 sm:grid-cols-2" : ""}>
          <Button
            type="button"
            variant={runProgress ? "outline" : "default"}
            size="sm"
            className="min-h-11 w-full"
            disabled={runDisabled}
            onClick={() => onRun(profile)}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {canResumeInterruptedRun
              ? t("run.resumeRemaining", {
                  remaining: (runProgress?.total ?? 0) - (runProgress?.attempted ?? 0),
                })
              : runProgress
                ? t("run.runAgain")
                : t("run.start")}
          </Button>
          {profile.commentsEnabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 w-full"
              data-testid={`social-profile-comments-only-${profile.id}`}
              disabled={commentsOnlyDisabled}
              onClick={() => onRun(profile, "all", "comments_only")}
            >
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("run.commentsOnly")}
            </Button>
          )}
        </div>
      )}

      {!runActive && disabledReason && (
        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{disabledReason}</p>
      )}
      {!runActive && !disabledReason && sharedSourceCount > 0 && (
        <p className="mt-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
          {t("run.sharedExcluded", { count: sharedSourceCount })}
        </p>
      )}
      {!runActive && !disabledReason && profile.commentsEnabled && commentsOnlySourceCount === 0 && (
        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
          {t("run.commentsOnlyUnavailable")}
        </p>
      )}
    </div>
  )
}

function sourceRunStatusKey(status: string): "success" | "partial" | "failed" | "skipped" | "pending" | "unknown" {
  const normalized = status.toLowerCase()
  if (["success", "completed", "imported"].includes(normalized)) return "success"
  if (normalized === "partial") return "partial"
  if (normalized === "failed") return "failed"
  if (normalized === "skipped") return "skipped"
  if (["pending", "queued", "running", "importing", "submitted"].includes(normalized)) return "pending"
  return "unknown"
}

function RunResultMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: number
  tone?: "neutral" | "success" | "attention" | "warning"
}) {
  const toneClass = tone === "success"
    ? "text-emerald-700 dark:text-emerald-300"
    : tone === "attention"
      ? "text-sky-700 dark:text-sky-300"
      : tone === "warning"
        ? "text-amber-800 dark:text-amber-300"
        : "text-foreground"
  return (
    <div className="min-w-0 rounded-lg border bg-background px-2.5 py-2.5">
      <p className={`tabular-nums text-base font-semibold leading-none ${toneClass}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{label}</p>
    </div>
  )
}

function CoverageRow({ coverage }: { coverage: PlatformCoverage }) {
  const t = useTranslations("socialMonitoring.profiles")
  const locale = useLocale()
  const stateTone = coverage.collectionState === "configured"
    ? "border-zinc-300 text-foreground dark:border-zinc-600"
    : coverage.collectionState === "limited" || coverage.collectionState === "paused"
      ? "border-amber-500/40 text-amber-800 dark:text-amber-300"
      : "border-destructive/40 text-destructive"
  const scope = coverage.scope === "selected_sources"
    ? t("card.scope.selected_sources", { count: coverage.sourceCount })
    : coverage.scope === "broad_search"
      ? t("card.scope.broad_search")
      : coverage.scope === "mixed"
        ? t("card.scope.mixed", { count: coverage.sourceCount })
        : t("card.scope.not_configured")
  const completeness = coverage.completeness === "confirmed_for_input"
    ? t("card.completeness.confirmed_for_input", { count: coverage.latestFoundCount })
    : coverage.completeness === "partial"
      ? t("card.completeness.partial", { count: coverage.latestFoundCount })
      : t(`card.completeness.${coverage.completeness}`)

  return (
    <div className="py-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">{t(`platforms.${coverage.platform}`)}</span>
        <Badge variant="outline" className={`shrink-0 text-[10px] ${stateTone}`}>
          {t(`card.collectionState.${coverage.collectionState}`)}
        </Badge>
      </div>
      <p className="mt-1 text-xs leading-4 text-muted-foreground">{scope}</p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
        {t(`card.commentState.${coverage.commentState}`)} · {completeness}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
        {coverage.latestCheckedAt
          ? t("card.lastAttempt", {
              date: new Date(coverage.latestCheckedAt).toLocaleString(locale),
              status: coverage.latestRunStatuses.join(", ") || t("card.unknownRunStatus"),
            })
          : t("card.neverAttempted")}
      </p>
      {coverage.latestCheckedAt && (
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {t("card.runCounts", {
            seen: coverage.latestFoundCount,
            accepted: coverage.latestAcceptedCount,
            rejected: coverage.latestRejectedCount,
            duplicates: coverage.latestDuplicateCount,
          })}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
        {coverage.lastSuccessfulAt
          ? t("card.lastSuccessful", { date: new Date(coverage.lastSuccessfulAt).toLocaleString(locale) })
          : t("card.neverSuccessful")}
      </p>
      {coverage.lastError && (
        <p className="mt-1 break-words text-[11px] leading-4 text-amber-700 dark:text-amber-300">
          {t("card.sourceError", { error: coverage.lastError })}
        </p>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: ProfileStatus }) {
  const t = useTranslations("socialMonitoring.profiles")
  const tone = status === "active"
    ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
    : status === "paused"
      ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
      : "border-muted-foreground/30 text-muted-foreground"
  return (
    <Badge variant="outline" className={`gap-1 bg-background/70 ${tone}`}>
      {status === "active"
        ? <Activity className="h-3 w-3" aria-hidden="true" />
        : status === "paused"
          ? <Pause className="h-3 w-3" aria-hidden="true" />
          : <Archive className="h-3 w-3" aria-hidden="true" />}
      {t(`status.${status}`)}
    </Badge>
  )
}

function FindingMetric({
  label,
  value,
  ariaLabel,
  testId,
  onClick,
  disabled,
  emphasis = false,
  attention = false,
}: {
  label: string
  value: number
  ariaLabel: string
  testId: string
  onClick: () => void
  disabled: boolean
  emphasis?: boolean
  attention?: boolean
}) {
  const tone = attention ? "text-amber-700 dark:text-amber-300" : "text-foreground"
  const valueClass = emphasis ? "text-xl font-semibold" : "text-lg font-semibold"
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={[
        "group flex min-h-14 min-w-0 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left shadow-sm",
        "transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-0 active:shadow-sm",
        "disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none",
        emphasis ? "border-primary/20 bg-primary/[0.045]" : "bg-background/80",
      ].join(" ")}
    >
      <span className="min-w-0 text-xs leading-4 text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <span className={["tabular-nums leading-none", valueClass, tone].join(" ")}>{value}</span>
        <ArrowRight
          className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary group-focus-visible:translate-x-0.5 motion-reduce:transform-none"
          aria-hidden="true"
        />
      </span>
    </button>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      {/* min-w-0 lets the flex item shrink; without it truncate never kicks in
          and a long platform list widens the card past a 375px viewport. */}
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  )
}
