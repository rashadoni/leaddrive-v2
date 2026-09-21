"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  BatteryMedium,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  ClipboardList,
  Clock3,
  CloudOff,
  ContactRound,
  Crosshair,
  Info,
  Loader2,
  MapPin,
  MapPinOff,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  ShieldAlert,
  Square,
  Undo2,
  UserRound,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  clearOperationalWeekSnapshotsForViewer,
  isOperationalWeekSnapshotExpired,
  loadLatestOperationalWeekSnapshot,
  loadOperationalWeekSnapshot,
  operationalWeekCacheKey,
  saveOperationalWeekSnapshot,
  type OperationalWeekSnapshot,
} from "@/lib/mtm/operational-week-cache"
import {
  fetchOperationalWeekJsonWithTimeout,
  isOperationalWeekApiEnvelope,
  isOperationalWeekCachedFacts,
  isOperationalWeekWorkdayMutationEnvelope,
  nextOperationalWeekTaskAttentionBoundary,
  operationalWeekGpsPresentationFreshness,
  operationalWeekTaskPresentationAttention,
  type OperationalWeekTaskAttention,
} from "@/lib/mtm/operational-week-client"
import { cn } from "@/lib/utils"
import { useMtmFieldContacts } from "@/hooks/use-mtm-org-settings"
import { createDateFormatter } from "@/lib/format-date"
import type { MtmManagerWorkdayState } from "@/lib/mtm/workday-open-anomaly"
import { summarizeTeamToday, teamTodayForScope, teamTodayScopeKey, type ClassifiedTeamRow } from "@/lib/mtm/team-today-summary"
import {
  WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH,
  WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH,
  type WorkforceWorkdayManagerActionBlockedReason,
} from "@/lib/workforce/workday-reopen-contract"

type WeekDays = 1 | 5 | 7
type WorkdayAction = "START" | "PAUSE" | "RESUME" | "FINISH"
type ManagerWorkdayActionKind = "reopen" | "undoReopen"
const MANAGER_WORKDAY_ACTION_KINDS: readonly ManagerWorkdayActionKind[] = ["reopen", "undoReopen"]

const OPERATIONAL_TASK_ATTENTION = new Set<OperationalWeekTaskAttention>(["OVERDUE", "RETURNED", "ACTIVE"])
const OPERATIONAL_TASK_ATTENTION_RANK: Record<OperationalWeekTaskAttention, number> = { OVERDUE: 0, RETURNED: 1, ACTIVE: 2 }
const OPERATIONAL_TASK_STATUSES = new Set(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "OVERDUE"])
const OPERATIONAL_TASK_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"])
const CANCELLATION_REASONS = [
  "CUSTOMER_REQUEST",
  "CUSTOMER_UNAVAILABLE",
  "AGENT_ILLNESS",
  "ROUTE_CONFLICT",
  "WEATHER",
  "TRANSPORT",
  "DUPLICATE_PLAN",
  "OTHER",
] as const
const WORKDAY_RECOVERY_MESSAGE_KEYS = new Set([
  "duplicateActive",
  "eventOrder",
  "alreadyExists",
  "completed",
  "stateChanged",
  "workdayUnavailable",
  "operationMismatch",
  "refresh",
])
/** A message key, or one per action when the message names the action it unlocks. */
type ManagerWorkdayMessageKey = string | Readonly<Record<ManagerWorkdayActionKind, string>>
/**
 * `managerWorkday.failure.*` message per refusal of the manager's reopen or
 * undo-reopen. Keyed by the shared contract, so a refusal the server can send
 * — as a 409/403 or as a week `blockedReason` — cannot lack a message.
 */
const MANAGER_WORKDAY_REFUSAL_MESSAGE_KEYS: Record<WorkforceWorkdayManagerActionBlockedReason, ManagerWorkdayMessageKey> = {
  WORKFORCE_WORKDAY_REOPEN_IDEMPOTENCY_MISMATCH: "idempotencyMismatch",
  WORKFORCE_WORKDAY_REOPEN_NOT_COMPLETED: "notCompleted",
  WORKFORCE_WORKDAY_REOPEN_NOT_TODAY: "notToday",
  WORKFORCE_WORKDAY_REOPEN_VERSION_CONFLICT: "versionConflict",
  WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS: "openShiftExists",
  WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED: "timesheetApproved",
  WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING: "correctionPending",
  WORKFORCE_WORKDAY_REOPEN_CORRECTED: "corrected",
  WORKFORCE_WORKDAY_REOPEN_HISTORY_INVALID: "historyInvalid",
  WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_REOPENED: "undoNotReopened",
  WORKFORCE_WORKDAY_REOPEN_UNDO_NOT_TODAY: "undoNotToday",
  WORKFORCE_WORKDAY_REOPEN_UNDO_VERSION_CONFLICT: "versionConflict",
  WORKFORCE_WORKDAY_REOPEN_UNDO_IDEMPOTENCY_MISMATCH: "idempotencyMismatch",
  WORKFORCE_WORKDAY_REOPEN_UNDO_HISTORY_INVALID: "historyInvalid",
  WORKFORCE_SESSION_PERMISSION_REQUIRED: "forbidden",
  WORKFORCE_SCOPE_DENIED: "forbidden",
  // As on the Workforce access screen, a missing mandatory MFA factor is a
  // localized instruction — here with where it is switched on.
  WORKFORCE_ATTENDANCE_MFA_REQUIRED: { reopen: "mfaRequiredReopen", undoReopen: "mfaRequiredUndo" },
}
const MANAGER_WORKDAY_FAILURE_MESSAGE_KEYS: Readonly<Record<string, ManagerWorkdayMessageKey>> = {
  ...MANAGER_WORKDAY_REFUSAL_MESSAGE_KEYS,
  WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMITED: "rateLimited",
}
/**
 * Refusals explained under the workday header instead of a button. The
 * others are ordinary states — a running shift is simply not finished yet.
 * The server reports missing MFA only on a day the manager could otherwise
 * change, so that instruction never appears on an unfinished day.
 */
const MANAGER_WORKDAY_EXPLAINED_REFUSALS = new Set<string>([
  "WORKFORCE_WORKDAY_REOPEN_OPEN_SHIFT_EXISTS",
  "WORKFORCE_WORKDAY_REOPEN_TIMESHEET_APPROVED",
  "WORKFORCE_WORKDAY_REOPEN_CORRECTION_PENDING",
  "WORKFORCE_WORKDAY_REOPEN_CORRECTED",
  "WORKFORCE_WORKDAY_REOPEN_HISTORY_INVALID",
  "WORKFORCE_WORKDAY_REOPEN_UNDO_HISTORY_INVALID",
  "WORKFORCE_SESSION_PERMISSION_REQUIRED",
  "WORKFORCE_SCOPE_DENIED",
  "WORKFORCE_ATTENDANCE_MFA_REQUIRED",
])

interface WeekQuery {
  date: string
  days: WeekDays
  regionId: string
  teamId: string
  agentId: string
  day: string
}

interface FilterOption {
  id: string
  name: string
  regionId: string | null
  teamId: string | null
}

interface WeekFilters {
  regions: FilterOption[]
  teams: FilterOption[]
  agents: FilterOption[]
}

interface SelectedAgent extends FilterOption {
  role: string | null
  regionName: string | null
  teamName: string | null
}

interface WorkdayEvidence {
  id: string | null
  state: string
  startedAt: string | null
  pausedAt: string | null
  finishedAt: string | null
  lastEventAt: string | null
}

interface GpsEvidence {
  freshness: string
  recordedAt: string | null
  accuracy: number | null
  battery: number | null
  reason: string | null
  onlineSeconds: number
  delayedSeconds: number
}

interface WeekPoint {
  id: string
  order: number
  status: string
  routeId: string | null
  visitId: string | null
  organizationId: string | null
  organizationName: string | null
  organizationType: string | null
  contactId: string | null
  contactName: string | null
  contactType: string | null
  specialtyName: string | null
  address: string | null
  plannedAt: string | null
  actualAt: string | null
  cancellationReason: string | null
  cancellationSource: string | null
  checkOutAt: string | null
  durationMinutes: number | null
  photoCount: number | null
  hasSignature: boolean
  hasNote: boolean
}

interface AlertGroup {
  key: string
  type: string
  category: string
  date: string
  hour: number
  count: number
  lastAt: string | null
  maxDistanceMeters: number | null
  messageKey: string | null
  messageParams: Record<string, string | number> | null
  fallbackText: string | null
}

interface TeamTodayRow {
  agentId: string
  name: string
  teamName: string | null
  lastGpsAt: string | null
  route: { visited: number; total: number } | null
  visits: Array<{ id: string; customerName: string | null; status: string; checkInAt: string | null; checkOutAt: string | null }>
  visitCount: number
  openAlerts: number
  workday: MtmManagerWorkdayState | null
}

interface TeamToday {
  /** `teamTodayScopeKey` of the filters the payload was fetched for. */
  scopeKey: string
  timezone: string
  today: string
  generatedAt: string | null
  rows: TeamTodayRow[]
  partial: boolean
  visitsTruncated: boolean
  workdayEnabled: boolean
}

interface WeekRoute {
  id: string
  name: string
  status: string
  publishedVersion: number | null
  pointsTruncated: boolean
  points: WeekPoint[]
}

interface WeekTask {
  id: string
  title: string
  status: string
  priority: string | null
  scheduledStartAt: string | null
  dueAt: string | null
  returnReason: string | null
  version: number | null
  attention: OperationalWeekTaskAttention
  routePointId: string | null
}

interface WeekDay {
  date: string
  isToday: boolean
  label: string | null
  summary: { planned: number; actual: number; cancelled: number }
  workday: WorkdayEvidence
  routes: WeekRoute[]
  unplannedVisits: WeekPoint[]
  tasks: WeekTask[]
  alertGroups: AlertGroup[]
}

interface PlanChange {
  id: string
  type: string
  status: string
  reason: string | null
  reasonCode: string | null
  routeId: string | null
  routeDate: string | null
  routePointId: string | null
  pointLabel: string | null
  requestedAt: string | null
  requestedByName: string | null
  decisionComment: string | null
  resolution: string | null
  rescheduleDate: string | null
  rescheduledRouteId: string | null
  canReview: boolean
  impact: { plannedStops: number; eligibleStops: number; actualStops: number }
}

interface WeekSummary {
  planned: number
  actual: number
  cancelled: number
  percentage: number | null
  numerator: number | null
  denominator: number | null
  formula: string | null
}

interface WeekContract {
  completeness: string
  reasons: string[]
  limits: string[]
}

interface WorkdayCapability {
  enabled: boolean
  canMutateSelf: boolean
  endpoint: string
  availableActions: WorkdayAction[]
  workdayId: string | null
  date: string | null
  requiresPriorDayClosure: boolean
  activeState: string | null
  activeStartedAt: string | null
  outsideSelectedWindow: boolean
}

interface ManagerWorkdayAction {
  allowed: boolean
  workdayId: string | null
  updatedAt: string | null
  blockedReason: string | null
}

interface ManagerWorkdayActions {
  reopen: ManagerWorkdayAction
  undoReopen: ManagerWorkdayAction
  /** False only when the server said the manager has no 2FA: then the dialog recommends it. */
  mfaEnrolled: boolean
}

interface ManagerWorkdayDialogTarget {
  kind: ManagerWorkdayActionKind
  workdayId: string
  expectedUpdatedAt: string
  /** Generated once per opened dialog: a retry repeats the action, never doubles it. */
  operationId: string
}

interface WeekFacts {
  timezone: string
  today: string
  generatedAt: string | null
  snapshotId: string | null
  lastSourceAt: string | null
  scopeRole: string | null
  gps: GpsEvidence
  selectedAgent: SelectedAgent
  days: WeekDay[]
  summary: WeekSummary
  tasks: WeekTask[]
  planChanges: PlanChange[]
  pendingPlanChanges: PlanChange[]
  contract: WeekContract
  workdayCapability: WorkdayCapability
  alertGroups: AlertGroup[]
  alertCount: number
  alertsTruncated: boolean
  managerWorkday: MtmManagerWorkdayState | null
  /** Absent in snapshots cached before the manager actions existed. */
  managerWorkdayActions?: ManagerWorkdayActions | null
}

interface BaseCoverageGroup {
  key: string
  label: string
  labels: { ru: string; az: string; en: string } | null
  order: number
  subjectType: "DOCTOR" | "PHARMACY"
  populationCount: number
  requiredCoverage: string
  actualMoi: string
  target: string
  actualCoverage: string
  uncoveredMoi: string
}

interface BaseCoverageTotals {
  groups: BaseCoverageGroup[]
  overall: Omit<BaseCoverageGroup, "key" | "label" | "labels" | "order" | "subjectType">
}

interface BaseCoverageData {
  available: boolean
  state: string
  period: { start: string; end: string }
  policy: {
    code: string
    version: number
    approvalReference: string | null
    sourceSystem: string
    sourceReference: string | null
  } | null
  snapshot: {
    id: string
    sourceCutoffAt: string | null
    sourceFreshnessAt: string | null
    frozenAt: string | null
  } | null
  totals: BaseCoverageTotals | null
}

interface BaseCoverageRow {
  id: string
  subjectType: "DOCTOR" | "PHARMACY"
  subjectId: string
  subjectName: string
  customerId: string | null
  customerName: string | null
  groupKey: string
  categoryLabel: string | null
  specialtyName: string | null
  uncoveredMoi: string
  explanation: { summary: { ru: string; az: string; en: string } }
  planningTarget: { customerId: string; contactId: string | null } | null
}

interface BaseCoverageRowsData {
  groupKey: string
  page: number
  total: number
  hasMore: boolean
  rows: BaseCoverageRow[]
}

interface NormalizedWeekResponse {
  filters: WeekFilters
  facts: WeekFacts | null
  bootstrapPartial: boolean
  canonicalToday: string
}

interface InitialWeekQuery {
  query: WeekQuery
  needsServerToday: boolean
}

interface OperationalWeekHomeProps {
  organizationId?: string | null
  viewerId?: string | null
}

type JsonRecord = Record<string, unknown>

const EMPTY_FILTERS: WeekFilters = { regions: [], teams: [], agents: [] }
const VALID_ACTIONS = new Set<WorkdayAction>(["START", "PAUSE", "RESUME", "FINISH"])

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function monthWindow(dateKey: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  const [year, month] = dateKey.split("-").map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, 1))
  if (!Number.isFinite(anchor.getTime()) || anchor.toISOString().slice(0, 7) !== dateKey.slice(0, 7)) return null
  const end = new Date(Date.UTC(year, month, 0))
  return { start: `${dateKey.slice(0, 7)}-01`, end: end.toISOString().slice(0, 10) }
}

function normalizeBaseCoverageGroup(value: unknown): BaseCoverageGroup | null {
  const source = record(value)
  const labelsSource = record(source.labels)
  const labels = firstString(labelsSource, "ru") && firstString(labelsSource, "az") && firstString(labelsSource, "en")
    ? {
        ru: firstString(labelsSource, "ru")!,
        az: firstString(labelsSource, "az")!,
        en: firstString(labelsSource, "en")!,
      }
    : null
  const subjectType = firstString(source, "subjectType")
  const key = firstString(source, "key")
  const label = firstString(source, "label")
  const order = firstNumber(source, "order")
  const populationCount = firstNumber(source, "populationCount")
  const requiredCoverage = firstString(source, "requiredCoverage")
  const actualMoi = firstString(source, "actualMoi")
  const target = firstString(source, "target")
  const actualCoverage = firstString(source, "actualCoverage")
  const uncoveredMoi = firstString(source, "uncoveredMoi")
  if (
    !key || !label || (subjectType !== "DOCTOR" && subjectType !== "PHARMACY")
    || order === null || populationCount === null || requiredCoverage === null
    || actualMoi === null || target === null || actualCoverage === null || uncoveredMoi === null
  ) return null
  return {
    key,
    label,
    labels,
    order,
    subjectType,
    populationCount,
    requiredCoverage,
    actualMoi,
    target,
    actualCoverage,
    uncoveredMoi,
  }
}

function normalizeBaseCoverage(value: unknown): BaseCoverageData | null {
  const envelope = record(value)
  const source = record(envelope.data)
  const available = source.available === true
  const state = firstString(source, "state")
  const periodSource = record(source.period)
  const period = {
    start: firstString(periodSource, "start") || "",
    end: firstString(periodSource, "end") || "",
  }
  if (!state || !period.start || !period.end) return null

  const policySource = record(source.policy)
  const policyCode = firstString(policySource, "code")
  const policyVersion = firstNumber(policySource, "version")
  const policy = policyCode && policyVersion !== null ? {
    code: policyCode,
    version: policyVersion,
    approvalReference: firstString(policySource, "approvalReference"),
    sourceSystem: firstString(policySource, "sourceSystem") || "",
    sourceReference: firstString(policySource, "sourceReference"),
  } : null
  const snapshotSource = record(source.snapshot)
  const snapshotId = firstString(snapshotSource, "id")
  const snapshot = snapshotId ? {
    id: snapshotId,
    sourceCutoffAt: firstString(snapshotSource, "sourceCutoffAt"),
    sourceFreshnessAt: firstString(snapshotSource, "sourceFreshnessAt"),
    frozenAt: firstString(snapshotSource, "frozenAt"),
  } : null

  if (!available) return { available: false, state, period, policy, snapshot, totals: null }
  const totalsSource = record(source.totals)
  const groups = list(totalsSource.groups)
    .map(normalizeBaseCoverageGroup)
    .filter((group): group is BaseCoverageGroup => Boolean(group))
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
  const overallSource = record(totalsSource.overall)
  const overall = normalizeBaseCoverageGroup({
    ...overallSource,
    key: "overall",
    label: "overall",
    order: 0,
    subjectType: "DOCTOR",
  })
  if (!policy || !snapshot || !groups.length || !overall) return null
  return {
    available: true,
    state,
    period,
    policy,
    snapshot,
    totals: {
      groups,
      overall: {
        populationCount: overall.populationCount,
        requiredCoverage: overall.requiredCoverage,
        actualMoi: overall.actualMoi,
        target: overall.target,
        actualCoverage: overall.actualCoverage,
        uncoveredMoi: overall.uncoveredMoi,
      },
    },
  }
}

function normalizeBaseCoverageRows(value: unknown): BaseCoverageRowsData | null {
  const source = record(record(value).data)
  const filter = record(source.filter)
  const groupKey = firstString(filter, "groupKey")
  const page = firstNumber(filter, "page")
  const total = firstNumber(source, "total")
  if (!groupKey || page === null || total === null || typeof source.hasMore !== "boolean") return null

  const rows = list(source.rows).map((value): BaseCoverageRow | null => {
    const row = record(value)
    const subjectType = firstString(row, "subjectType")
    const id = firstString(row, "id")
    const subjectId = firstString(row, "subjectId")
    const subjectName = firstString(row, "subjectName")
    const rowGroupKey = firstString(row, "groupKey")
    const uncoveredMoi = firstString(row, "uncoveredMoi")
    const summary = record(record(row.explanation).summary)
    const ru = firstString(summary, "ru")
    const az = firstString(summary, "az")
    const en = firstString(summary, "en")
    if (
      !id || !subjectId || !subjectName || rowGroupKey !== groupKey || !uncoveredMoi
      || (subjectType !== "DOCTOR" && subjectType !== "PHARMACY") || !ru || !az || !en
    ) return null
    const planningSource = record(row.planningTarget)
    const planningCustomerId = firstString(planningSource, "customerId")
    return {
      id,
      subjectType,
      subjectId,
      subjectName,
      customerId: firstString(row, "customerId"),
      customerName: firstString(row, "customerName"),
      groupKey: rowGroupKey,
      categoryLabel: firstString(row, "categoryLabel"),
      specialtyName: firstString(row, "specialtyName"),
      uncoveredMoi,
      explanation: { summary: { ru, az, en } },
      planningTarget: planningCustomerId ? {
        customerId: planningCustomerId,
        contactId: firstString(planningSource, "contactId"),
      } : null,
    }
  })
  if (rows.some((row) => row === null)) return null
  return { groupKey, page, total, hasMore: source.hasMore, rows: rows as BaseCoverageRow[] }
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function firstString(source: JsonRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(source[key])
    if (value) return value
  }
  return null
}

function firstNumber(source: JsonRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = numberValue(source[key])
    if (value !== null) return value
  }
  return null
}

function normalizeOption(value: unknown): FilterOption | null {
  const source = record(value)
  const team = record(source.team)
  const region = record(source.region)
  const id = firstString(source, "id", "value", "agentId", "teamId", "regionId")
  if (!id) return null
  return {
    id,
    name: firstString(source, "name", "label", "fullName", "title") || id,
    regionId: firstString(source, "regionId") || firstString(region, "id"),
    teamId: firstString(source, "teamId") || firstString(team, "id"),
  }
}

function normalizeOptions(value: unknown): FilterOption[] {
  return list(value).map(normalizeOption).filter((option): option is FilterOption => Boolean(option))
}

function normalizeWorkday(value: unknown): WorkdayEvidence {
  const source = record(value)
  return {
    id: firstString(source, "id", "workdayId"),
    state: (firstString(source, "state", "status") || "NOT_STARTED").toUpperCase(),
    startedAt: firstString(source, "startedAt", "startAt"),
    pausedAt: firstString(source, "pausedAt", "pauseAt"),
    finishedAt: firstString(source, "finishedAt", "completedAt", "closedAt", "endedAt", "endAt"),
    lastEventAt: firstString(source, "lastEventAt", "updatedAt"),
  }
}

function normalizeGps(value: unknown): GpsEvidence {
  const source = record(value)
  const location = record(source.location)
  const thresholds = record(source.thresholds)
  const accuracy = firstNumber(source, "accuracy", "accuracyMeters") ?? firstNumber(location, "accuracy", "accuracyMeters")
  let battery = firstNumber(source, "battery", "batteryLevel") ?? firstNumber(location, "battery", "batteryLevel")
  if (battery !== null && battery >= 0 && battery <= 1) battery *= 100
  const onlineSeconds = Math.max(1, firstNumber(thresholds, "onlineSeconds") ?? 120)
  const delayedSeconds = Math.max(onlineSeconds, firstNumber(thresholds, "delayedSeconds") ?? 900)
  return {
    freshness: (firstString(source, "freshness", "state", "status") || "NO_LOCATION").toUpperCase(),
    recordedAt: firstString(source, "recordedAt", "capturedAt", "timestamp", "lastSeenAt")
      || firstString(location, "recordedAt", "capturedAt", "timestamp"),
    accuracy,
    battery,
    reason: firstString(source, "reason", "missingReason", "explanation"),
    onlineSeconds,
    delayedSeconds,
  }
}

function normalizePoint(value: unknown, index: number, routeId: string | null): WeekPoint {
  const source = record(value)
  const organization = record(source.organization)
  const customer = record(source.customer)
  const contact = record(source.contact)
  const visit = record(source.visit)
  const actualEvidence = record(source.actualEvidence)
  const cancellationEvidence = record(source.cancellationEvidence)
  const organizationSource = Object.keys(organization).length ? organization : customer
  return {
    id: firstString(source, "id", "routePointId") || `${routeId || "point"}-${index + 1}`,
    order: firstNumber(source, "order", "orderIndex", "sequence", "position") ?? index + 1,
    status: (firstString(source, "executionState", "effectiveStatus", "status", "visitStatus") || firstString(visit, "status") || "PLANNED").toUpperCase(),
    routeId: firstString(source, "routeId") || routeId,
    visitId: firstString(source, "visitId") || firstString(visit, "id") || firstString(actualEvidence, "visitId"),
    organizationId: firstString(source, "organizationId", "customerId") || firstString(organizationSource, "id"),
    organizationName: firstString(source, "organizationName", "customerName") || firstString(organizationSource, "name", "title"),
    organizationType: firstString(source, "organizationType", "objectType") || firstString(organizationSource, "objectType"),
    contactId: firstString(source, "contactId") || firstString(contact, "id"),
    contactName: firstString(source, "contactName") || firstString(contact, "name", "fullName", "displayName"),
    contactType: firstString(source, "contactType") || firstString(contact, "type"),
    specialtyName: firstString(source, "specialtyName") || firstString(contact, "specialtyName"),
    address: firstString(source, "address", "formattedAddress")
      || firstString(organizationSource, "address", "formattedAddress")
      || firstString(contact, "address", "formattedAddress"),
    plannedAt: firstString(source, "plannedAt", "plannedStartAt", "scheduledAt", "plannedTime"),
    actualAt: firstString(source, "actualAt", "checkedInAt", "checkInAt", "completedAt")
      || firstString(visit, "checkedInAt", "checkInAt", "completedAt")
      || firstString(actualEvidence, "checkInAt", "checkedInAt", "visitedAt", "completedAt"),
    cancellationReason: firstString(source, "cancellationReason", "cancelReason", "reason") || firstString(cancellationEvidence, "reason"),
    cancellationSource: firstString(cancellationEvidence, "source"),
    checkOutAt: firstString(source, "checkOutAt") || firstString(actualEvidence, "checkOutAt"),
    durationMinutes: firstNumber(source, "durationMinutes") ?? firstNumber(actualEvidence, "durationMinutes"),
    photoCount: firstNumber(source, "photoCount") ?? firstNumber(actualEvidence, "photoCount"),
    hasSignature: source.hasSignature === true || actualEvidence.hasSignature === true,
    hasNote: source.hasNote === true || actualEvidence.hasNote === true,
  }
}

function normalizeAlertGroups(value: unknown): AlertGroup[] {
  return list(value).flatMap((item): AlertGroup[] => {
    const source = record(item)
    const latest = record(source.latest)
    const key = firstString(source, "key")
    const type = firstString(source, "type")
    const date = firstString(source, "date")
    const hour = firstNumber(source, "hour")
    const count = firstNumber(source, "count")
    if (!key || !type || !date || hour === null || count === null) return []
    const params = record(latest.messageParams)
    return [{
      key,
      type,
      category: firstString(source, "category") || "WARNING",
      date,
      hour,
      count,
      lastAt: firstString(source, "lastAt"),
      maxDistanceMeters: firstNumber(source, "maxDistanceMeters"),
      messageKey: firstString(latest, "messageKey"),
      messageParams: Object.keys(params).length
        ? Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number"))
        : null,
      fallbackText: firstString(latest, "fallbackText"),
    }]
  })
}

function asLeftOpen(state: MtmManagerWorkdayState | null): Extract<MtmManagerWorkdayState, { kind: "left-open" }> | null {
  return state && state.kind === "left-open" ? state : null
}

function normalizeManagerWorkday(value: unknown): MtmManagerWorkdayState | null {
  const source = record(value)
  const kind = firstString(source, "kind")
  switch (kind) {
    case "not-started": return { kind: "not-started" }
    case "working": return { kind: "working", since: firstString(source, "since") }
    case "paused": return { kind: "paused", since: firstString(source, "since") }
    case "finished": return { kind: "finished", at: firstString(source, "at") }
    case "left-open": return {
      kind: "left-open",
      since: firstString(source, "since"),
      workDate: firstString(source, "workDate"),
      days: Math.max(0, firstNumber(source, "days") ?? 0),
      hours: Math.max(0, firstNumber(source, "hours") ?? 0),
      status: firstString(source, "status") === "PAUSED" ? "PAUSED" : "STARTED",
    }
    default: return null
  }
}

function normalizeManagerWorkdayAction(value: unknown): ManagerWorkdayAction | null {
  const source = record(value)
  if (typeof source.allowed !== "boolean") return null
  const workdayId = firstString(source, "workdayId")
  const updatedAt = firstString(source, "updatedAt")
  return {
    // Without its target and version the request cannot be sent: never offer it.
    allowed: source.allowed === true && Boolean(workdayId && updatedAt),
    workdayId,
    updatedAt,
    blockedReason: firstString(source, "blockedReason"),
  }
}

function normalizeManagerWorkdayActions(value: unknown): ManagerWorkdayActions | null {
  const source = record(value)
  const reopen = normalizeManagerWorkdayAction(source.reopen)
  const undoReopen = normalizeManagerWorkdayAction(source.undoReopen)
  return reopen && undoReopen ? { reopen, undoReopen, mfaEnrolled: source.mfaEnrolled !== false } : null
}

function managerWorkdayFailureMessageKey(code: string | null, kind: ManagerWorkdayActionKind): string | null {
  if (!code || !Object.prototype.hasOwnProperty.call(MANAGER_WORKDAY_FAILURE_MESSAGE_KEYS, code)) return null
  const key = MANAGER_WORKDAY_FAILURE_MESSAGE_KEYS[code]
  return typeof key === "string" ? key : key[kind]
}

function clientOperationId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeTeamToday(value: unknown, scopeKey: string): TeamToday | null {
  const source = record(record(value).data)
  if (firstString(source, "mode") !== "TEAM_TODAY") return null
  const rows = list(source.rows).flatMap((item): TeamTodayRow[] => {
    const row = record(item)
    const agent = record(row.agent)
    const agentId = firstString(agent, "id")
    if (!agentId) return []
    const route = record(row.route)
    const total = firstNumber(route, "total")
    return [{
      agentId,
      name: firstString(agent, "name") || "—",
      teamName: firstString(agent, "teamName"),
      lastGpsAt: firstString(row, "lastGpsAt"),
      route: total === null ? null : { visited: Math.max(0, firstNumber(route, "visited") ?? 0), total },
      visits: list(row.visits).map((visitValue) => {
        const visit = record(visitValue)
        return {
          id: firstString(visit, "id") || "",
          customerName: firstString(visit, "customerName"),
          status: (firstString(visit, "status") || "").toUpperCase(),
          checkInAt: firstString(visit, "checkInAt"),
          checkOutAt: firstString(visit, "checkOutAt"),
        }
      }).filter((visit) => visit.id),
      openAlerts: Math.max(0, firstNumber(row, "openAlerts") ?? 0),
      visitCount: Math.max(0, firstNumber(row, "visitCount") ?? 0),
      workday: normalizeManagerWorkday(row.workday),
    }]
  })
  const completeness = record(source.completeness)
  return {
    scopeKey,
    timezone: firstString(source, "timezone") || "UTC",
    today: firstString(source, "today") || "",
    generatedAt: firstString(source, "generatedAt"),
    rows,
    partial: list(completeness.truncatedSources).includes("FILTER_AGENTS"),
    visitsTruncated: list(completeness.truncatedSources).includes("VISITS"),
    workdayEnabled: record(record(source.capabilities).workday).enabled === true,
  }
}

function normalizeRoute(value: unknown, index: number): WeekRoute {
  const source = record(value)
  const id = firstString(source, "id", "routeId") || `route-${index + 1}`
  return {
    id,
    // Prod 2026-09-14: an unnamed route rendered its cuid. The card now
    // builds "Marşrut · 14 sen" from the day instead (see renderDay).
    name: firstString(source, "name", "title") || "",
    status: (firstString(source, "status", "state") || "PUBLISHED").toUpperCase(),
    publishedVersion: firstNumber(source, "publishedVersion", "version"),
    pointsTruncated: booleanValue(source.pointsTruncated),
    points: list(source.points).map((point, pointIndex) => normalizePoint(point, pointIndex, id)),
  }
}

function normalizeTask(value: unknown, index: number): WeekTask {
  const source = record(value)
  const status = (firstString(source, "status", "state") || "PENDING").toUpperCase()
  const priority = firstString(source, "priority")?.toUpperCase() || null
  const returnReason = firstString(source, "returnReason")
  const rawAttention = firstString(source, "attention")?.toUpperCase()
  return {
    id: firstString(source, "id", "taskId") || `task-${index + 1}`,
    title: firstString(source, "title", "name", "subject") || "—",
    status,
    priority,
    scheduledStartAt: firstString(source, "scheduledStartAt", "scheduledAt", "startAt"),
    dueAt: firstString(source, "dueAt", "dueDate", "deadline"),
    returnReason,
    version: firstNumber(source, "version"),
    attention: rawAttention && OPERATIONAL_TASK_ATTENTION.has(rawAttention as OperationalWeekTaskAttention)
      ? rawAttention as OperationalWeekTaskAttention
      : status === "OVERDUE"
        ? "OVERDUE"
        : returnReason
          ? "RETURNED"
          : "ACTIVE",
    routePointId: firstString(source, "routePointId", "pointId"),
  }
}

function normalizeDay(value: unknown): WeekDay | null {
  const source = record(value)
  const date = firstString(source, "date", "day")
  if (!date) return null
  const explicitRoutes = list(source.routes)
  const route = record(source.route)
  const routes = explicitRoutes.length
    ? explicitRoutes.map(normalizeRoute)
    : Object.keys(route).length
      ? [normalizeRoute(route, 0)]
      : []
  const loosePoints = list(source.points)
  if (loosePoints.length && routes.length === 0) {
    routes.push({
      id: `published-${date}`,
      name: "",
      status: "PUBLISHED",
      publishedVersion: null,
      pointsTruncated: false,
      points: loosePoints.map((point, pointIndex) => normalizePoint(point, pointIndex, null)),
    })
  }
  const allPoints = routes.flatMap((candidate) => candidate.points)
  const summary = record(source.summary)
  return {
    date,
    isToday: source.isToday === true,
    label: firstString(source, "label", "weekday"),
    summary: {
      planned: firstNumber(summary, "plannedStops", "planned") ?? allPoints.length,
      actual: firstNumber(summary, "actualStops", "actual") ?? allPoints.filter((point) => point.status === "ACTUAL").length,
      cancelled: firstNumber(summary, "cancelledStops", "cancelled") ?? allPoints.filter((point) => point.status === "CANCELLED").length,
    },
    workday: normalizeWorkday(source.workday),
    routes,
    unplannedVisits: list(source.unplannedVisits).map((visit, visitIndex) => {
      const visitSource = record(visit)
      const status = (firstString(visitSource, "status") || "CHECKED_OUT").toUpperCase()
      return normalizePoint({
        ...visitSource,
        visitId: firstString(visitSource, "id", "visitId"),
        executionState: status === "CANCELLED" ? "CANCELLED" : status === "CHECKED_IN" ? "IN_PROGRESS" : "ACTUAL",
        actualAt: firstString(visitSource, "checkInAt", "checkedInAt"),
        order: visitIndex + 1,
      }, visitIndex, firstString(visitSource, "routeId"))
    }),
    tasks: list(source.tasks).map(normalizeTask),
    alertGroups: normalizeAlertGroups(source.alertGroups),
  }
}

function normalizePlanChange(value: unknown, index: number): PlanChange {
  const source = record(value)
  const point = record(source.point)
  const customer = record(source.customer)
  const contact = record(source.contact)
  return {
    id: firstString(source, "id", "requestId") || `change-${index + 1}`,
    type: (firstString(source, "type", "changeType", "action") || "CHANGE").toUpperCase(),
    status: (firstString(source, "status", "state") || "PENDING").toUpperCase(),
    reason: firstString(source, "reason", "requestReason", "note"),
    reasonCode: firstString(source, "reasonCode"),
    routeId: firstString(source, "routeId"),
    routeDate: firstString(source, "routeDate", "date"),
    routePointId: firstString(source, "routePointId", "pointId"),
    pointLabel: firstString(source, "pointLabel", "organizationName", "customerName")
      || firstString(point, "name", "label")
      || firstString(customer, "name")
      || firstString(contact, "displayName", "name"),
    requestedAt: firstString(source, "requestedAt", "submittedAt", "createdAt", "updatedAt"),
    requestedByName: firstString(source, "requestedByName", "requesterName"),
    decisionComment: firstString(source, "decisionComment", "reviewComment"),
    resolution: firstString(source, "resolution"),
    rescheduleDate: firstString(source, "rescheduleDate"),
    rescheduledRouteId: firstString(source, "rescheduledRouteId"),
    canReview: source.canReview === true,
    impact: {
      plannedStops: firstNumber(record(source.impact), "plannedStops") ?? 0,
      eligibleStops: firstNumber(record(source.impact), "eligibleStops") ?? 0,
      actualStops: firstNumber(record(source.impact), "actualStops") ?? 0,
    },
  }
}

function normalizedCompleteness(value: unknown): WeekContract {
  const source = record(value)
  const completenessSource = record(source.completeness)
  const rawReasons = list(source.reasons).length
    ? list(source.reasons)
    : list(source.truncatedSources).length
      ? list(source.truncatedSources)
      : list(completenessSource.reasons)
  const rawLimits = Array.isArray(source.limits) ? list(source.limits) : Object.keys(record(source.limits))
  const toMessages = (items: unknown[]) => items.map((item) => {
    if (typeof item === "string") return item
    const candidate = record(item)
    return firstString(candidate, "message", "reason", "code") || ""
  }).filter(Boolean)
  return {
    completeness: (source.authoritative === false
      ? "PARTIAL"
      : stringValue(source.completeness) || firstString(completenessSource, "status", "state") || firstString(source, "status") || "COMPLETE").toUpperCase(),
    reasons: toMessages(rawReasons),
    limits: toMessages(rawLimits),
  }
}

function normalizeWeekResponse(value: unknown): NormalizedWeekResponse {
  const envelope = record(value)
  const source = record(envelope.data ?? value)
  const canonicalToday = firstString(source, "today") || ""
  const filtersSource = record(source.filters)
  const filters: WeekFilters = {
    regions: normalizeOptions(filtersSource.regions ?? source.regions),
    teams: normalizeOptions(filtersSource.teams ?? source.teams),
    agents: normalizeOptions(filtersSource.agents ?? source.agents),
  }
  const bootstrapCompleteness = normalizedCompleteness(source.completeness)
  const selectedSource = record(source.selectedAgent ?? source.agent)
  const selectedOption = normalizeOption(selectedSource)
  if (!selectedOption) {
    return {
      filters,
      facts: null,
      bootstrapPartial: bootstrapCompleteness.completeness !== "COMPLETE",
      canonicalToday,
    }
  }

  const days = list(source.days).map(normalizeDay).filter((day): day is WeekDay => Boolean(day))
  const summarySource = record(source.summary)
  const planSource = record(summarySource.plan ?? summarySource.coverage ?? summarySource.planCoverage ?? source.coverage)
  const queues = record(source.queues)
  const flattenedTasks = days.flatMap((day) => day.tasks)
  const rawTasks = list(queues.tasks ?? queues.activeTasks ?? source.tasks)
  const tasks = (rawTasks.length ? rawTasks.map(normalizeTask) : flattenedTasks)
    .filter((task, index, all) => all.findIndex((candidate) => candidate.id === task.id) === index)
  const rawChanges = list(queues.planChanges ?? source.planChanges)
  const rawPendingChanges = list(queues.pendingPlanChanges)
  const capabilities = record(source.capabilities)
  const workdayCapability = record(capabilities.workday)
  const workdayContext = record(source.workdayContext)
  const activeWorkday = record(workdayContext.activeWorkday)
  const availableActions = list(workdayCapability.availableActions)
    .map((action) => stringValue(action)?.toUpperCase())
    .filter((action): action is WorkdayAction => Boolean(action && VALID_ACTIONS.has(action as WorkdayAction)))
  const scope = record(source.scope)
  const actor = record(source.actor)
  const planned = firstNumber(planSource, "planned", "plannedPoints", "plannedStops")
    ?? firstNumber(summarySource, "planned", "plannedPoints", "plannedStops")
    ?? days.flatMap((day) => day.routes.flatMap((route) => route.points)).length
  const actual = firstNumber(planSource, "actual", "actualPoints", "actualStops", "completed", "numerator")
    ?? firstNumber(summarySource, "actual", "actualPoints", "actualStops", "completedPoints")
    ?? days.flatMap((day) => day.routes.flatMap((route) => route.points)).filter((point) => ["ACTUAL", "COMPLETED", "CHECKED_OUT", "DONE"].includes(point.status)).length
  const cancelled = firstNumber(planSource, "cancelled", "cancelledPoints", "cancelledStops")
    ?? firstNumber(summarySource, "cancelled", "cancelledPoints", "cancelledStops")
    ?? days.flatMap((day) => day.routes.flatMap((route) => route.points)).filter((point) => point.status === "CANCELLED").length
  const percentage = firstNumber(planSource, "percentage", "percent", "coveragePct", "completionRate")
    ?? firstNumber(summarySource, "percentage", "coveragePct", "completionRate")
  const period = record(source.period)
  const today = canonicalToday
  const currentDay = days.find((day) => day.date === today)

  return {
    filters,
    bootstrapPartial: false,
    canonicalToday,
    facts: {
      timezone: firstString(source, "timezone") || firstString(period, "timezone") || "UTC",
      today,
      generatedAt: firstString(source, "generatedAt"),
      snapshotId: firstString(source, "snapshotId"),
      lastSourceAt: firstString(source, "lastSourceAt", "sourceUpdatedAt"),
      scopeRole: firstString(scope, "role") || firstString(actor, "role"),
      gps: normalizeGps(source.gps),
      selectedAgent: {
        ...selectedOption,
        role: firstString(selectedSource, "role"),
        regionName: firstString(record(selectedSource.region), "name"),
        teamName: firstString(record(selectedSource.team), "name"),
      },
      days,
      summary: {
        planned,
        actual,
        cancelled,
        percentage: percentage === null && planned - cancelled > 0 ? Math.round((actual / (planned - cancelled)) * 100) : percentage,
        numerator: firstNumber(planSource, "numerator", "actualStops") ?? actual,
        denominator: firstNumber(planSource, "denominator", "eligibleStops") ?? Math.max(0, planned - cancelled),
        formula: firstString(planSource, "formula", "explanation"),
      },
      tasks,
      planChanges: rawChanges.map(normalizePlanChange),
      pendingPlanChanges: (rawPendingChanges.length ? rawPendingChanges : rawChanges.filter((change) => {
        const status = (firstString(record(change), "status", "state") || "").toUpperCase()
        return ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO", "PENDING"].includes(status)
      })).map(normalizePlanChange),
      contract: normalizedCompleteness(source.completeness),
      workdayCapability: {
        // Old compatible servers did not expose this bit; their route module
        // always included workday data. New servers send false for Routes-only.
        enabled: workdayCapability.enabled !== false,
        canMutateSelf: booleanValue(workdayCapability.canMutateSelf),
        endpoint: firstString(workdayCapability, "endpoint") || "/api/v1/mtm/week/workday",
        availableActions,
        workdayId: firstString(workdayCapability, "workdayId", "id") || currentDay?.workday.id || null,
        date: firstString(workdayCapability, "date", "workdayDate") || today || null,
        requiresPriorDayClosure: booleanValue(workdayCapability.requiresPriorDayClosure) || booleanValue(activeWorkday.requiresPriorDayClosure),
        activeState: firstString(activeWorkday, "state", "status"),
        activeStartedAt: firstString(activeWorkday, "startedAt"),
        outsideSelectedWindow: booleanValue(activeWorkday.outsideSelectedWindow),
      },
      alertGroups: normalizeAlertGroups(record(queues.alerts).groups),
      alertCount: list(record(queues.alerts).items).length,
      alertsTruncated: booleanValue(record(queues.alerts).truncated),
      managerWorkday: normalizeManagerWorkday(workdayContext.managerState),
      managerWorkdayActions: normalizeManagerWorkdayActions(workdayContext.managerActions),
    },
  }
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function validDateKey(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDateKey()
}

function validWeekDays(value: string | null): WeekDays {
  return value === "1" || value === "7" ? Number(value) as WeekDays : 5
}

function initialWeekQuery(): InitialWeekQuery {
  const params = new URLSearchParams(window.location.search)
  const requestedDate = params.get("weekDate")
  const hasExplicitDate = Boolean(requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate))
  const date = validDateKey(requestedDate)
  return {
    query: {
      date,
      days: validWeekDays(params.get("weekDays")),
      regionId: params.get("weekRegionId") || "",
      teamId: params.get("weekTeamId") || "",
      agentId: params.get("weekAgentId") || "",
      day: validDateKey(params.get("weekDay") || requestedDate),
    },
    needsServerToday: !hasExplicitDate,
  }
}

function replaceWeekUrl(query: WeekQuery): void {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  url.searchParams.set("weekDate", query.date)
  url.searchParams.set("weekDays", String(query.days))
  query.regionId ? url.searchParams.set("weekRegionId", query.regionId) : url.searchParams.delete("weekRegionId")
  query.teamId ? url.searchParams.set("weekTeamId", query.teamId) : url.searchParams.delete("weekTeamId")
  query.agentId ? url.searchParams.set("weekAgentId", query.agentId) : url.searchParams.delete("weekAgentId")
  query.day ? url.searchParams.set("weekDay", query.day) : url.searchParams.delete("weekDay")
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
}

function shiftDate(date: string, amount: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return date
  parsed.setUTCDate(parsed.getUTCDate() + amount)
  return parsed.toISOString().slice(0, 10)
}

function formatTenantTimestamp(value: string | null, locale: string, timezone: string, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "—"
  if (/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) return value.slice(0, 5)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  try {
    return createDateFormatter(locale, { timeZone: timezone, ...options }).format(date)
  } catch {
    return createDateFormatter(locale, options).format(date)
  }
}

function formatCalendarDay(value: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${value}T12:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? value : createDateFormatter(locale, { timeZone: "UTC", ...options }).format(date)
}

function returnPath(query: WeekQuery, agentId: string, day: string): string {
  const params = new URLSearchParams({
    weekDate: query.date,
    weekDays: String(query.days),
    weekAgentId: agentId,
    weekDay: day,
  })
  if (query.regionId) params.set("weekRegionId", query.regionId)
  if (query.teamId) params.set("weekTeamId", query.teamId)
  return `/mtm?${params.toString()}`
}

function withReturnTo(path: string, returnTo: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`
}

function requestErrorMessage(status: number): "permission" | "notFound" | "rateLimited" | "error" {
  if (status === 401 || status === 403) return "permission"
  if (status === 404) return "notFound"
  if (status === 429) return "rateLimited"
  return "error"
}

export function OperationalWeekHome({ organizationId, viewerId }: OperationalWeekHomeProps) {
  const t = useTranslations("mtmDashboardPage.operationalWeek")
  const taskT = useTranslations("mtmTasksPage")
  const alertT = useTranslations("mtmAlertsPage")
  const locale = useLocale()
  // Read on the server and in the first client frame, before `query` exists:
  // the layout of that frame must match the link that was opened.
  const searchParams = useSearchParams()
  // With field contacts off a contact name stays readable (it is part of the
  // visit), but it no longer links to a contact card the organization hid.
  const { data: fieldContactsSession } = useSession()
  const { enabled: fieldContactsEnabled } = useMtmFieldContacts(fieldContactsSession?.user)
  const [query, setQuery] = useState<WeekQuery | null>(null)
  const [filters, setFilters] = useState<WeekFilters>(EMPTY_FILTERS)
  const [facts, setFacts] = useState<WeekFacts | null>(null)
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "refreshing" | "offline" | "snapshot" | "permission" | "notFound" | "rateLimited" | "error">("idle")
  const [baseCoverage, setBaseCoverage] = useState<BaseCoverageData | null>(null)
  const [baseCoveragePhase, setBaseCoveragePhase] = useState<"idle" | "loading" | "ready" | "unavailable" | "error">("idle")
  const [expandedCoverageGroup, setExpandedCoverageGroup] = useState<string | null>(null)
  const [baseCoverageRows, setBaseCoverageRows] = useState<BaseCoverageRowsData | null>(null)
  const [baseCoverageRowsPhase, setBaseCoverageRowsPhase] = useState<"idle" | "loading" | "loadingMore" | "ready" | "error">("idle")
  const [bootstrapPartial, setBootstrapPartial] = useState(false)
  const [cachedSnapshot, setCachedSnapshot] = useState<OperationalWeekSnapshot<WeekFacts> | null>(null)
  const [cacheWriteFailed, setCacheWriteFailed] = useState(false)
  const [needsServerToday, setNeedsServerToday] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [mutatingAction, setMutatingAction] = useState<WorkdayAction | null>(null)
  const [confirmingFinish, setConfirmingFinish] = useState(false)
  const [workdayError, setWorkdayError] = useState<string | null>(null)
  const [compactWeekProjection, setCompactWeekProjection] = useState(true)
  const [freshnessEpoch, setFreshnessEpoch] = useState<number | null>(null)
  const [cancellationTarget, setCancellationTarget] = useState<{ point: WeekPoint; day: WeekDay } | null>(null)
  const [cancellationReasonCode, setCancellationReasonCode] = useState("CUSTOMER_REQUEST")
  const [cancellationDetails, setCancellationDetails] = useState("")
  const [managerWorkdayTarget, setManagerWorkdayTarget] = useState<ManagerWorkdayDialogTarget | null>(null)
  const [managerWorkdayReason, setManagerWorkdayReason] = useState("")
  const [managerWorkdayPending, setManagerWorkdayPending] = useState(false)
  /** `final`: the day moved on (409), so this dialog can no longer succeed. */
  const [managerWorkdayError, setManagerWorkdayError] = useState<{ message: string; final: boolean } | null>(null)
  const [planMutationId, setPlanMutationId] = useState<string | null>(null)
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({})
  const [rescheduleDates, setRescheduleDates] = useState<Record<string, string>>({})
  const [cancellationsExpanded, setCancellationsExpanded] = useState(false)
  const [idleExpanded, setIdleExpanded] = useState(false)
  const [teamToday, setTeamToday] = useState<TeamToday | null>(null)
  const [teamPhase, setTeamPhase] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const teamRequestIdRef = useRef(0)
  const requestIdRef = useRef(0)
  const coverageRequestIdRef = useRef(0)
  const coverageRowsRequestIdRef = useRef(0)
  const coverageRowsAbortRef = useRef<AbortController | null>(null)
  const coverageKeyRef = useRef("")
  const inFlightRef = useRef(false)
  const coverageCanLoad = facts !== null && (phase === "ready" || phase === "refreshing")

  useEffect(() => {
    const initial = initialWeekQuery()
    setNeedsServerToday(initial.needsServerToday)
    if (!initial.needsServerToday) replaceWeekUrl(initial.query)
    setQuery(initial.query)
  }, [])

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const media = window.matchMedia("(max-width: 767px)")
    const syncProjection = () => setCompactWeekProjection(media.matches)
    syncProjection()
    media.addEventListener("change", syncProjection)
    return () => media.removeEventListener("change", syncProjection)
  }, [])

  const requestKey = useMemo(() => query ? JSON.stringify({
    date: query.date,
    days: query.days,
    regionId: query.regionId,
    teamId: query.teamId,
    agentId: query.agentId,
    locale,
    organizationId: organizationId || "",
    viewerId: viewerId || "",
    anchorMode: needsServerToday ? "TENANT_TODAY" : "EXPLICIT",
  }) : "", [locale, needsServerToday, organizationId, query, viewerId])

  useEffect(() => {
    setCancellationsExpanded(false)
  }, [requestKey])

  useEffect(() => {
    if (!query || !requestKey) return
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    inFlightRef.current = true
    setPhase((current) => facts && current !== "permission" && current !== "notFound" ? "refreshing" : "loading")

    const params = new URLSearchParams({ days: String(query.days), locale })
    if (!needsServerToday) params.set("anchor", query.date)
    if (query.regionId) params.set("regionId", query.regionId)
    if (query.teamId) params.set("teamId", query.teamId)
    if (query.agentId) params.set("agentId", query.agentId)

    void (async () => {
      try {
        const { response, body: result } = await fetchOperationalWeekJsonWithTimeout(`/api/v1/mtm/week?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
          headers: organizationId ? { "x-organization-id": String(organizationId) } : {},
        })
        if (!response.ok) {
          const failure = new Error(firstString(record(result), "error", "message") || `HTTP ${response.status}`)
          Object.assign(failure, { status: response.status })
          throw failure
        }
        if (!isOperationalWeekApiEnvelope(result)) {
          const failure = new Error("Invalid operational week response")
          Object.assign(failure, { status: 502 })
          throw failure
        }
        if (requestId !== requestIdRef.current) return
        const normalized = normalizeWeekResponse(result)
        const serverToday = /^\d{4}-\d{2}-\d{2}$/.test(normalized.canonicalToday)
          ? normalized.canonicalToday
          : query.date
        const selectedAgentId = normalized.facts?.selectedAgent.id || ""
        const canonicalQuery: WeekQuery = {
          ...query,
          date: needsServerToday ? serverToday : query.date,
          day: needsServerToday ? serverToday : query.day,
          agentId: query.agentId || selectedAgentId,
        }
        setFilters(normalized.filters)
        setBootstrapPartial(normalized.bootstrapPartial)
        setFacts(normalized.facts)
        setCachedSnapshot(null)
        setPhase("ready")
        if (needsServerToday) setNeedsServerToday(false)

        if (normalized.facts) {
          let cacheSaved = false
          if (organizationId && viewerId && selectedAgentId) {
            const cacheKey = operationalWeekCacheKey({
              organizationId,
              viewerId,
              agentId: selectedAgentId,
              date: canonicalQuery.date,
              days: canonicalQuery.days,
              regionId: canonicalQuery.regionId,
              teamId: canonicalQuery.teamId,
            })
            cacheSaved = Boolean(saveOperationalWeekSnapshot(cacheKey, normalized.facts, normalized.facts.snapshotId))
          }
          setCacheWriteFailed(!cacheSaved)
        } else {
          setCacheWriteFailed(false)
        }
        if (needsServerToday || canonicalQuery.agentId !== query.agentId) {
          replaceWeekUrl(canonicalQuery)
          setQuery(canonicalQuery)
        }
      } catch (error) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return
        const status = numberValue(record(error).status) || 0
        const explicitFailure = status >= 400 && status < 500
        const cacheKey = !needsServerToday && !explicitFailure && organizationId && viewerId && query.agentId
          ? operationalWeekCacheKey({
              organizationId,
              viewerId,
              agentId: query.agentId,
              date: query.date,
              days: query.days,
              regionId: query.regionId,
              teamId: query.teamId,
            })
          : null
        const exactCandidate = cacheKey ? loadOperationalWeekSnapshot<WeekFacts>(cacheKey) : null
        const exactSnapshot = exactCandidate && isOperationalWeekCachedFacts(exactCandidate.data) ? exactCandidate : null
        const latestCandidate = !exactSnapshot && needsServerToday && !explicitFailure && organizationId && viewerId
          ? loadLatestOperationalWeekSnapshot<WeekFacts>({ organizationId, viewerId })
          : null
        const latestEntry = latestCandidate && isOperationalWeekCachedFacts(latestCandidate.snapshot.data)
          ? latestCandidate
          : null
        if (((exactCandidate && !exactSnapshot) || (latestCandidate && !latestEntry)) && organizationId && viewerId) {
          clearOperationalWeekSnapshotsForViewer({ organizationId, viewerId })
        }
        const snapshot = exactSnapshot ?? latestEntry?.snapshot ?? null
        if (snapshot) {
          if (latestEntry) {
            const restoredDay = snapshot.data.days.some((day) => day.date === snapshot.data.today)
              ? snapshot.data.today
              : snapshot.data.days[0]?.date || latestEntry.identity.date
            const restoredQuery: WeekQuery = {
              date: latestEntry.identity.date,
              days: latestEntry.identity.days,
              regionId: latestEntry.identity.regionId || "",
              teamId: latestEntry.identity.teamId || "",
              agentId: latestEntry.identity.agentId,
              day: restoredDay,
            }
            setNeedsServerToday(false)
            replaceWeekUrl(restoredQuery)
            setQuery(restoredQuery)
          }
          setFacts(snapshot.data)
          setCachedSnapshot(snapshot)
          setCacheWriteFailed(false)
          setBootstrapPartial(false)
          setPhase(status >= 500 ? "snapshot" : "offline")
          return
        }
        const nextPhase = requestErrorMessage(status)
        if ((status === 401 || status === 403 || status === 404) && organizationId && viewerId) {
          clearOperationalWeekSnapshotsForViewer({ organizationId, viewerId })
        }
        if (nextPhase === "permission" || nextPhase === "notFound" || (status >= 400 && status < 429)) {
          setFacts(null)
          setCachedSnapshot(null)
          setCacheWriteFailed(false)
          setFilters(EMPTY_FILTERS)
          setBootstrapPartial(false)
        }
        setPhase(nextPhase)
      } finally {
        if (requestId === requestIdRef.current) inFlightRef.current = false
      }
    })()

    return () => controller.abort()
    // facts is intentionally excluded: a successful refresh must not start another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken, requestKey])

  // Prod 2026-09-14: without a selected employee the Panel was blank. A
  // supervisor's default is the scoped team today; a row opens the week.
  const teamViewActive = Boolean(query && !query.agentId)
  // Before the first client effect `query` is null, so that frame (and the
  // SSR HTML) reads the layout from the URL itself: a manager opening /mtm
  // does not watch the week heading and five card skeletons flash and vanish
  // at hydration, and a deep link `/mtm?weekAgentId=…` («back to the week»
  // from /mtm/visits) does not announce a team load it never requests.
  const urlAgentId = searchParams.get("weekAgentId") || ""
  const teamLayout = query ? teamViewActive : !urlAgentId
  const teamScopeKey = query ? teamTodayScopeKey(query) : ""
  // The bootstrap already named a refusal the team request on the same scope
  // repeats (no permission, employee unavailable): a second alert with a
  // «Retry» that repeats the 403 helps nobody. A timeout or a 429 on the
  // filter bootstrap says nothing about /week/team, which may have answered
  // with three open shifts a second ago: that line stays on screen, and the
  // summary carries its own retry by `teamPhase`.
  const bootstrapFailed = phase === "permission" || phase === "notFound"
  // The payload for the filters on screen. A summary fetched for «all teams»
  // is not shown under a team picked a moment later, even when the new
  // request fails: the numbers of another scope would stay there for ever.
  const currentTeamToday = teamTodayForScope(teamToday, teamScopeKey)
  useEffect(() => {
    const requestId = ++teamRequestIdRef.current
    if (!query || query.agentId) {
      setTeamPhase("idle")
      return
    }
    const controller = new AbortController()
    const scopeKey = teamTodayScopeKey(query)
    setTeamPhase((current) => current === "ready" ? current : "loading")
    const params = new URLSearchParams()
    if (query.regionId) params.set("regionId", query.regionId)
    if (query.teamId) params.set("teamId", query.teamId)
    void (async () => {
      try {
        const { response, body } = await fetchOperationalWeekJsonWithTimeout(`/api/v1/mtm/week/team?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
          headers: organizationId ? { "x-organization-id": String(organizationId) } : {},
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const normalized = normalizeTeamToday(body, scopeKey)
        if (!normalized) throw new Error("Invalid team response")
        if (requestId !== teamRequestIdRef.current) return
        setTeamToday(normalized)
        setTeamPhase("ready")
      } catch {
        if (controller.signal.aborted || requestId !== teamRequestIdRef.current) return
        setTeamPhase("error")
      }
    })()
    return () => controller.abort()
  }, [organizationId, query?.agentId, query?.regionId, query?.teamId, refreshToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const agentId = facts?.selectedAgent.id || ""
    const period = monthWindow(query?.date || "")
    const requestId = ++coverageRequestIdRef.current
    if (!coverageCanLoad || !agentId || !period) {
      coverageKeyRef.current = ""
      setBaseCoverage(null)
      setBaseCoveragePhase("idle")
      return
    }

    const controller = new AbortController()
    const coverageKey = `${organizationId || ""}:${agentId}:${period.start}:${period.end}`
    const coverageSelectionChanged = coverageKeyRef.current !== coverageKey
    coverageKeyRef.current = coverageKey
    if (coverageSelectionChanged) setBaseCoverage(null)
    setBaseCoveragePhase((current) => !coverageSelectionChanged && baseCoverage && current !== "error" ? current : "loading")
    const params = new URLSearchParams({
      agentId,
      periodStart: period.start,
      periodEnd: period.end,
    })
    void (async () => {
      try {
        const { response, body } = await fetchOperationalWeekJsonWithTimeout(`/api/v1/mtm/coverage?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
          headers: organizationId ? { "x-organization-id": String(organizationId) } : {},
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const normalized = normalizeBaseCoverage(body)
        if (!normalized) throw new Error("Invalid base coverage response")
        if (requestId !== coverageRequestIdRef.current) return
        setBaseCoverage(normalized)
        setBaseCoveragePhase(normalized.available ? "ready" : "unavailable")
      } catch {
        if (controller.signal.aborted || requestId !== coverageRequestIdRef.current) return
        setBaseCoverage(null)
        setBaseCoveragePhase("error")
      }
    })()
    return () => controller.abort()
    // baseCoverage is intentionally excluded: retaining the previous result avoids a refresh flash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverageCanLoad, facts?.selectedAgent.id, organizationId, query?.date, refreshToken])

  useEffect(() => {
    coverageRowsRequestIdRef.current += 1
    coverageRowsAbortRef.current?.abort()
    coverageRowsAbortRef.current = null
    setExpandedCoverageGroup(null)
    setBaseCoverageRows(null)
    setBaseCoverageRowsPhase("idle")
  }, [baseCoverage?.snapshot?.id, baseCoveragePhase])

  useEffect(() => {
    if (!query) return
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !inFlightRef.current && !mutatingAction && !planMutationId && (facts || !query.agentId)) {
        setRefreshToken((value) => value + 1)
      }
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [facts, mutatingAction, planMutationId, query])

  useEffect(() => {
    if (!facts?.gps.recordedAt || (phase !== "ready" && phase !== "refreshing")) return
    const recordedAtMs = Date.parse(facts.gps.recordedAt)
    if (!Number.isFinite(recordedAtMs)) return
    const nowMs = Date.now()
    const boundaries = [facts.gps.onlineSeconds, facts.gps.delayedSeconds]
      .map((seconds) => recordedAtMs + seconds * 1_000 + 1)
      .filter((boundary) => boundary > nowMs)
      .sort((left, right) => left - right)
    if (!boundaries.length) return
    const timeout = window.setTimeout(
      () => setFreshnessEpoch(Date.now()),
      Math.min(2_147_483_647, Math.max(1, boundaries[0] - nowMs)),
    )
    return () => window.clearTimeout(timeout)
  }, [facts?.gps.delayedSeconds, facts?.gps.onlineSeconds, facts?.gps.recordedAt, freshnessEpoch, phase])

  useEffect(() => {
    if (facts?.tasks) setFreshnessEpoch(Date.now())
  }, [facts?.tasks])

  useEffect(() => {
    if (!facts?.tasks.length) return
    const nowMs = Date.now()
    const boundary = nextOperationalWeekTaskAttentionBoundary(facts.tasks, nowMs)
    if (boundary === null) return
    const timeout = window.setTimeout(
      () => setFreshnessEpoch(Date.now()),
      Math.min(2_147_483_647, Math.max(1, boundary - nowMs)),
    )
    return () => window.clearTimeout(timeout)
  }, [facts?.tasks, freshnessEpoch])

  useEffect(() => {
    const refreshOnVisible = () => {
      if (document.visibilityState !== "visible") return
      setFreshnessEpoch(Date.now())
      // The team view polls once a minute, but a manager who comes back to
      // the tab after an hour should not read a summary up to 60 s stale.
      if ((facts || teamViewActive) && !inFlightRef.current && !mutatingAction && !planMutationId) setRefreshToken((value) => value + 1)
    }
    document.addEventListener("visibilitychange", refreshOnVisible)
    return () => document.removeEventListener("visibilitychange", refreshOnVisible)
  }, [facts, mutatingAction, planMutationId, teamViewActive])

  useEffect(() => {
    if (!query || !facts?.days.length) return
    if (facts.days.some((day) => day.date === query.day)) return
    const next = { ...query, day: facts.days[0].date }
    replaceWeekUrl(next)
    setQuery(next)
  }, [facts, query])

  useEffect(() => {
    if (!facts?.workdayCapability.availableActions.includes("FINISH")) setConfirmingFinish(false)
  }, [facts?.workdayCapability.availableActions])

  function updateQuery(next: WeekQuery, clearLevel: "facts" | "team" | "region" = "facts") {
    if (mutatingAction || planMutationId) return
    setNeedsServerToday(false)
    replaceWeekUrl(next)
    setFacts(null)
    setCachedSnapshot(null)
    setCacheWriteFailed(false)
    setPhase("loading")
    setBootstrapPartial(false)
    setWorkdayError(null)
    setConfirmingFinish(false)
    if (clearLevel === "region") setFilters((current) => ({ ...current, teams: [], agents: [] }))
    if (clearLevel === "team") setFilters((current) => ({ ...current, agents: [] }))
    setQuery(next)
  }

  function movePeriod(direction: -1 | 1) {
    if (!query) return
    const date = shiftDate(query.date, direction * (query.days === 1 ? 1 : 7))
    updateQuery({ ...query, date, day: date })
  }

  function chooseDay(date: string) {
    if (!query) return
    const next = { ...query, day: date }
    replaceWeekUrl(next)
    setQuery(next)
  }

  async function runWorkdayAction(action: WorkdayAction) {
    if (!query || !facts || mutatingAction || planMutationId || phase !== "ready" || cachedSnapshot || inFlightRef.current) return
    const capability = facts.workdayCapability
    if (!capability.enabled) return
    const actionDay = capability.date || query.day
    const day = facts.days.find((candidate) => candidate.date === actionDay)
    const existingWorkdayId = capability.workdayId || day?.workday.id
    if (action !== "START" && !existingWorkdayId) {
      setWorkdayError(t("workdayUnavailable"))
      return
    }
    setConfirmingFinish(false)
    setMutatingAction(action)
    setWorkdayError(null)
    try {
      const eventId = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `week-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const workdayId = action === "START"
        ? typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `workday-${Date.now()}-${Math.random().toString(16).slice(2)}`
        : existingWorkdayId!
      const { response, body: result } = await fetchOperationalWeekJsonWithTimeout(capability.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(organizationId ? { "x-organization-id": String(organizationId) } : {}),
        },
        body: JSON.stringify({
          clientEventId: eventId,
          action,
          occurredAt: new Date().toISOString(),
          ...(action === "START" ? { id: workdayId } : { workdayId }),
        }),
      })
      if (!response.ok || !isOperationalWeekWorkdayMutationEnvelope(result)) {
        if (response.status === 409) {
          const recovery = record(record(record(result).data).recovery)
          const messageKey = firstString(record(recovery.reason), "messageKey")
          const safeMessageKey = messageKey && WORKDAY_RECOVERY_MESSAGE_KEYS.has(messageKey)
            ? messageKey
            : "refresh"
          throw new Error(`STATE_CONFLICT:${safeMessageKey}`)
        }
        throw new Error(firstString(record(result), "error", "message") || "ACTION_FAILED")
      }
      toast.success(t("workdayUpdated"))
      setRefreshToken((value) => value + 1)
    } catch (error) {
      const conflictMessage = error instanceof Error && error.message.startsWith("STATE_CONFLICT:")
        ? error.message.slice("STATE_CONFLICT:".length)
        : null
      const conflict = Boolean(conflictMessage)
      const recoveryKey = conflictMessage && WORKDAY_RECOVERY_MESSAGE_KEYS.has(conflictMessage)
        ? conflictMessage
        : "refresh"
      setWorkdayError(conflict ? t(`workdayRecovery.${recoveryKey}` as never) : t("workdayActionFailed"))
      if (conflict) setRefreshToken((value) => value + 1)
    } finally {
      setMutatingAction(null)
    }
  }

  function refreshAfterPlanMutation() {
    if (organizationId && viewerId) clearOperationalWeekSnapshotsForViewer({ organizationId, viewerId })
    setCachedSnapshot(null)
    setRefreshToken((value) => value + 1)
  }

  async function submitCancellationRequest() {
    if (!cancellationTarget?.point.routeId || planMutationId || phase !== "ready" || cachedSnapshot) return
    const { point } = cancellationTarget
    const fallbackReason = t(`cancellationReason.${cancellationReasonCode}` as never)
    setPlanMutationId(`request:${point.id}`)
    try {
      const { response, body } = await fetchOperationalWeekJsonWithTimeout(`/api/v1/mtm/routes/${encodeURIComponent(point.routeId)}/change-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(organizationId ? { "x-organization-id": String(organizationId) } : {}),
        },
        body: JSON.stringify({
          changeType: "REMOVE_STOP",
          routePointId: point.id,
          reason: cancellationDetails.trim() || fallbackReason,
          payload: { reasonCode: cancellationReasonCode, source: "OPERATIONAL_WEEK" },
        }),
      })
      if (!response.ok) throw new Error(firstString(record(body), "error", "message") || "REQUEST_FAILED")
      toast.success(t("cancellationRequested"))
      setCancellationTarget(null)
      setCancellationDetails("")
      setCancellationReasonCode("CUSTOMER_REQUEST")
      refreshAfterPlanMutation()
    } catch {
      toast.error(t("cancellationRequestFailed"))
    } finally {
      setPlanMutationId(null)
    }
  }

  async function decidePlanChange(change: PlanChange, decision: "APPROVED" | "REJECTED" | "NEEDS_INFO" | "RESCHEDULE") {
    if (planMutationId || phase !== "ready" || cachedSnapshot) return
    const comment = decisionNotes[change.id]?.trim() || ""
    if ((decision === "REJECTED" || decision === "NEEDS_INFO") && !comment) {
      toast.error(t("decisionCommentRequired"))
      return
    }
    const rescheduleDate = decision === "RESCHEDULE" ? rescheduleDates[change.id] : undefined
    if (decision === "RESCHEDULE" && !rescheduleDate) {
      toast.error(t("rescheduleDateRequired"))
      return
    }
    setPlanMutationId(`decision:${change.id}`)
    try {
      const { response, body } = await fetchOperationalWeekJsonWithTimeout(`/api/v1/mtm/route-change-requests/${encodeURIComponent(change.id)}/decision`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(organizationId ? { "x-organization-id": String(organizationId) } : {}),
        },
        body: JSON.stringify({ decision, ...(comment ? { comment } : {}), ...(rescheduleDate ? { rescheduleDate } : {}) }),
      })
      if (!response.ok) throw new Error(firstString(record(body), "error", "message") || "DECISION_FAILED")
      toast.success(t(`decisionSaved.${decision.toLowerCase()}` as never))
      setDecisionNotes((current) => {
        const next = { ...current }
        delete next[change.id]
        return next
      })
      setRescheduleDates((current) => {
        const next = { ...current }
        delete next[change.id]
        return next
      })
      refreshAfterPlanMutation()
    } catch {
      toast.error(t("decisionFailed"))
    } finally {
      setPlanMutationId(null)
    }
  }

  function managerWorkdayFailureMessage(code: string | null, kind: ManagerWorkdayActionKind, status = 0): string {
    const key = managerWorkdayFailureMessageKey(code, kind)
    if (key) return t(`managerWorkday.failure.${key}`)
    if (status === 401 || status === 403) return t("managerWorkday.failure.forbidden")
    if (status === 429) return t("managerWorkday.failure.rateLimited")
    return t("managerWorkday.failure.generic")
  }

  function openManagerWorkdayDialog(kind: ManagerWorkdayActionKind) {
    if (managerWorkdayPending || phase !== "ready" || cachedSnapshot) return
    const action = facts?.managerWorkdayActions?.[kind]
    if (!action?.allowed || !action.workdayId || !action.updatedAt) return
    setManagerWorkdayReason("")
    setManagerWorkdayError(null)
    setManagerWorkdayTarget({
      kind,
      workdayId: action.workdayId,
      expectedUpdatedAt: action.updatedAt,
      operationId: clientOperationId(kind === "reopen" ? "workday-reopen" : "workday-reopen-undo"),
    })
  }

  function closeManagerWorkdayDialog() {
    if (managerWorkdayPending) return
    setManagerWorkdayTarget(null)
    setManagerWorkdayReason("")
    setManagerWorkdayError(null)
  }

  const managerWorkdayReasonLength = managerWorkdayReason.trim().length
  const managerWorkdayReasonValid = managerWorkdayReasonLength >= WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH
    && managerWorkdayReasonLength <= WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH

  async function submitManagerWorkdayAction() {
    const target = managerWorkdayTarget
    if (!target || managerWorkdayPending || !managerWorkdayReasonValid || managerWorkdayError?.final) return
    setManagerWorkdayPending(true)
    setManagerWorkdayError(null)
    const action = target.kind === "reopen" ? "reopen" : "reopen/undo"
    try {
      const { response, body } = await fetchOperationalWeekJsonWithTimeout(`/api/v1/workforce/workdays/${encodeURIComponent(target.workdayId)}/${action}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(organizationId ? { "x-organization-id": String(organizationId) } : {}),
        },
        body: JSON.stringify({
          operationId: target.operationId,
          expectedUpdatedAt: target.expectedUpdatedAt,
          reason: managerWorkdayReason.trim(),
        }),
      })
      const result = record(body)
      if (!response.ok || result.success !== true) {
        const final = response.status === 409
        setManagerWorkdayError({ message: managerWorkdayFailureMessage(firstString(result, "code"), target.kind, response.status), final })
        // The day changed under the manager: show its current state behind the message.
        if (final) refreshAfterPlanMutation()
        return
      }
      toast.success(t(target.kind === "reopen" ? "managerWorkday.reopenSucceeded" : "managerWorkday.undoSucceeded"))
      setManagerWorkdayTarget(null)
      setManagerWorkdayReason("")
      refreshAfterPlanMutation()
    } catch {
      setManagerWorkdayError({ message: t("managerWorkday.failure.generic"), final: false })
    } finally {
      setManagerWorkdayPending(false)
    }
  }

  const effectiveAgentId = facts?.selectedAgent.id || query?.agentId || ""
  const workdayMutationLive = phase === "ready" && cachedSnapshot === null
  const selectedDay = facts?.days.find((day) => day.date === query?.day) || facts?.days[0] || null
  const taskPresentationNow = freshnessEpoch || (facts?.generatedAt ? Date.parse(facts.generatedAt) : Date.now())
  const activeTasks = facts?.tasks
    .filter((task) => !["DONE", "COMPLETED", "CANCELLED", "CANCELED"].includes(task.status))
    .map((task) => ({
      ...task,
      attention: operationalWeekTaskPresentationAttention(task.attention, task.dueAt, taskPresentationNow),
    }))
    .sort((left, right) => OPERATIONAL_TASK_ATTENTION_RANK[left.attention] - OPERATIONAL_TASK_ATTENTION_RANK[right.attention]) || []
  const overdueTaskCount = activeTasks.filter((task) => task.attention === "OVERDUE").length
  const returnedTaskCount = activeTasks.filter((task) => task.attention === "RETURNED").length
  const shownActiveTaskCount = Math.min(5, activeTasks.length)
  const taskListHref = effectiveAgentId
    ? `/mtm/tasks?agentId=${encodeURIComponent(effectiveAgentId)}`
    : "/mtm/tasks"
  const displayedAgentOptions = useMemo(() => {
    if (!facts?.selectedAgent || filters.agents.some((option) => option.id === facts.selectedAgent.id)) return filters.agents
    return [facts.selectedAgent, ...filters.agents]
  }, [facts?.selectedAgent, filters.agents])

  function workdayPresentation(state: string) {
    switch (state) {
      case "ACTIVE": return { icon: PlayCircle, label: t("workday.active"), className: "text-emerald-700 dark:text-emerald-300" }
      case "PAUSED": return { icon: PauseCircle, label: t("workday.paused"), className: "text-amber-700 dark:text-amber-300" }
      case "CLOSED":
      case "FINISHED": return { icon: CheckCircle2, label: t("workday.closed"), className: "text-zinc-700 dark:text-zinc-200" }
      case "NOT_STARTED": return { icon: Circle, label: t("workday.notStarted"), className: "text-muted-foreground" }
      default: return { icon: Info, label: t("workday.unknown"), className: "text-muted-foreground" }
    }
  }

  const managerView = facts ? facts.scopeRole !== "AGENT" : true
  const leftOpenWorkday = asLeftOpen(facts?.managerWorkday ?? null)

  function shortTime(value: string | null, timezone: string): string {
    return formatTenantTimestamp(value, locale, timezone, { hour: "2-digit", minute: "2-digit", hour12: false })
  }

  /** One sentence for a shift the agent left open (prod 2026-09-14). */
  function leftOpenLabel(state: Extract<MtmManagerWorkdayState, { kind: "left-open" }>, timezone: string): string {
    return t("workdayLeftOpen", {
      date: state.since ? formatTenantTimestamp(state.since, locale, timezone, { day: "numeric", month: "short" }) : "—",
      time: shortTime(state.since, timezone),
      duration: state.days > 0 ? t("workdayOpenDays", { count: state.days }) : t("workdayOpenHours", { count: state.hours }),
    })
  }

  function managerWorkdayPresentation(state: MtmManagerWorkdayState, timezone: string) {
    switch (state.kind) {
      case "left-open": return { icon: AlertTriangle as typeof Info, label: leftOpenLabel(state, timezone), className: "text-red-700 dark:text-red-300" }
      case "working": return workdayPresentation("ACTIVE")
      case "paused": return workdayPresentation("PAUSED")
      case "finished": return workdayPresentation("CLOSED")
      default: return workdayPresentation("NOT_STARTED")
    }
  }

  /** Workday label for a day card or the strip; today follows the manager state. */
  function dayWorkdayPresentation(day: WeekDay) {
    // The third-person "agent did not close it" sentence is for a manager; an
    // agent reading about themselves keeps the plain workday state.
    if (managerView && day.isToday && facts?.managerWorkday) return managerWorkdayPresentation(facts.managerWorkday, facts.timezone)
    return workdayPresentation(day.workday.state)
  }

  /**
   * The manager's side of today's workday for the selected employee: reopen
   * a finished day, undo that reopen, or one line on why neither is possible.
   * A saved snapshot offers no action; a refresh in flight only disables it.
   */
  function renderManagerWorkdayControls() {
    const actions = facts?.managerWorkdayActions
    if (!actions || !managerView || facts?.workdayCapability.canMutateSelf || cachedSnapshot) return null
    if (actions.reopen.allowed) {
      return (
        <Button type="button" className="min-h-11" data-testid="mtm-week-workday-reopen" disabled={managerWorkdayPending || !workdayMutationLive} onClick={() => openManagerWorkdayDialog("reopen")}>
          <RotateCcw className="h-4 w-4" />{t("managerWorkday.reopenAction")}
        </Button>
      )
    }
    if (actions.undoReopen.allowed) {
      return (
        <Button type="button" variant="outline" className="min-h-11" data-testid="mtm-week-workday-reopen-undo" disabled={managerWorkdayPending || !workdayMutationLive} onClick={() => openManagerWorkdayDialog("undoReopen")}>
          <Undo2 className="h-4 w-4" />{t("managerWorkday.undoAction")}
        </Button>
      )
    }
    const refusalKind = MANAGER_WORKDAY_ACTION_KINDS.find((kind) => {
      const reason = actions[kind].blockedReason
      return Boolean(reason && MANAGER_WORKDAY_EXPLAINED_REFUSALS.has(reason))
    })
    return refusalKind ? (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" data-testid="mtm-week-workday-manager-blocked">
        <Info className="h-4 w-4 shrink-0" />{managerWorkdayFailureMessage(actions[refusalKind].blockedReason, refusalKind)}
      </span>
    ) : null
  }

  function alertTypeLabel(type: string): string {
    return alertT.has(`typeLabel_${type}` as never) ? alertT(`typeLabel_${type}` as never) : alertT("typeLabel_OTHER")
  }

  function alertGroupSentence(group: AlertGroup): string | null {
    if (group.messageKey && group.messageParams && alertT.has(`messages.${group.messageKey}` as never)) {
      try {
        return alertT(`messages.${group.messageKey}` as never, group.messageParams as never)
      } catch {
        return group.fallbackText
      }
    }
    return group.fallbackText
  }

  function renderAlertGroup(group: AlertGroup, compact: boolean) {
    const from = `${String(group.hour).padStart(2, "0")}:00`
    const to = `${String((group.hour + 1) % 24).padStart(2, "0")}:00`
    const sentence = compact ? null : alertGroupSentence(group)
    return (
      <li key={group.key} className={cn("text-xs", compact ? "py-1" : "py-2")}>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className={cn("font-semibold", group.category === "CRITICAL" ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-300")}>{alertTypeLabel(group.type)}</span>
          <span className="tabular-nums text-muted-foreground">{from}–{to}</span>
          <span className="tabular-nums">· {t("alertTimes", { count: group.count })}</span>
          {group.maxDistanceMeters !== null ? <span className="tabular-nums text-muted-foreground">· {t("alertDistance", { value: group.maxDistanceMeters })}</span> : null}
        </p>
        {sentence ? <p className="mt-0.5 leading-5 text-muted-foreground">{sentence}</p> : null}
      </li>
    )
  }

  function gpsPresentation(evidence: GpsEvidence) {
    if (evidence.reason === "PERMISSION_NOT_GRANTED") return { icon: ShieldAlert, label: t("gps.noPermission"), className: "text-red-700 dark:text-red-300" }
    const presentedFreshness = operationalWeekGpsPresentationFreshness(evidence.freshness, phase, {
      recordedAt: evidence.recordedAt,
      nowMs: Date.now(),
      onlineSeconds: evidence.onlineSeconds,
      delayedSeconds: evidence.delayedSeconds,
    })
    switch (presentedFreshness) {
      case "ONLINE": return { icon: Wifi, label: t("gps.online"), className: "text-emerald-700 dark:text-emerald-300" }
      case "DELAYED": return { icon: Clock3, label: t("gps.delayed"), className: "text-amber-700 dark:text-amber-300" }
      case "STALE": return { icon: WifiOff, label: t("gps.stale"), className: "text-zinc-600 dark:text-zinc-300" }
      case "NO_PERMISSION": return { icon: ShieldAlert, label: t("gps.noPermission"), className: "text-red-700 dark:text-red-300" }
      case "NO_LOCATION": return { icon: MapPinOff, label: t("gps.noLocation"), className: "text-muted-foreground" }
      default: return { icon: MapPinOff, label: t("gps.unknown"), className: "text-muted-foreground" }
    }
  }

  function taskStatusLabel(status: string): string {
    return OPERATIONAL_TASK_STATUSES.has(status)
      ? taskT(`statuses.${status}` as never)
      : t("taskValueUnavailable")
  }

  function taskPriorityLabel(priority: string | null): string {
    return priority && OPERATIONAL_TASK_PRIORITIES.has(priority)
      ? taskT(`priorities.${priority}` as never)
      : t("taskValueUnavailable")
  }

  function taskAttentionPresentation(attention: OperationalWeekTaskAttention) {
    switch (attention) {
      case "OVERDUE": return { label: t("taskAttentionOverdue"), variant: "destructive" as const }
      case "RETURNED": return { label: t("taskAttentionReturned"), variant: "warning" as const }
      default: return { label: t("taskAttentionActive"), variant: "outline" as const }
    }
  }

  function gpsReasonLabel(reason: string | null): string | null {
    if (reason === "PERMISSION_NOT_GRANTED") return t("gpsReason.permissionNotGranted")
    if (reason === "NO_LOCATION_REPORTED") return t("gpsReason.noLocationReported")
    return null
  }

  function pointPresentation(status: string) {
    if (["ACTUAL", "COMPLETED", "CHECKED_OUT", "DONE"].includes(status)) {
      return { icon: CheckCircle2, label: t("pointStatus.completed"), badge: "success" as const }
    }
    if (["CANCELLED", "CANCELED"].includes(status)) {
      return { icon: XCircle, label: t("pointStatus.cancelled"), badge: "destructive" as const }
    }
    if (["CHECKED_IN", "IN_PROGRESS", "ACTIVE"].includes(status)) {
      return { icon: CircleDot, label: t("pointStatus.inProgress"), badge: "info" as const }
    }
    if (["SKIPPED", "MISSED"].includes(status)) {
      return { icon: AlertTriangle, label: t("pointStatus.skipped"), badge: "warning" as const }
    }
    return { icon: Clock3, label: t("pointStatus.planned"), badge: "outline" as const }
  }

  function actionLabel(action: WorkdayAction): string {
    return t(`workdayAction.${action.toLowerCase()}`)
  }

  function organizationTypeLabel(value: string | null): string | null {
    if (value === "PHARMACY") return t("organizationType.pharmacy")
    if (value === "CLINIC") return t("organizationType.clinic")
    if (value === "STORE") return t("organizationType.store")
    if (value === "OTHER") return t("organizationType.other")
    return null
  }

  function contactTypeLabel(value: string | null): string | null {
    if (value === "DOCTOR") return t("contactType.doctor")
    if (value === "PHARMACIST") return t("contactType.pharmacist")
    if (value === "OTHER") return t("contactType.other")
    return null
  }

  function renderPoint(point: WeekPoint, day: WeekDay, displayNumber: number) {
    if (!query || !facts) return null
    const presentation = pointPresentation(point.status)
    const PointIcon = presentation.icon
    const context = returnPath(query, effectiveAgentId, day.date)
    const routeHref = point.routeId ? withReturnTo(`/mtm/routes?routeId=${encodeURIComponent(point.routeId)}`, context) : null
    const visitHref = point.visitId ? withReturnTo(`/mtm/visits?visitId=${encodeURIComponent(point.visitId)}`, context) : null
    const subjectMeta = [organizationTypeLabel(point.organizationType), contactTypeLabel(point.contactType), point.specialtyName].filter(Boolean)
    const pendingCancellation = facts.pendingPlanChanges.find((change) => change.type === "REMOVE_STOP" && change.routePointId === point.id)
    const canRequestCancellation = facts.scopeRole === "AGENT"
      && point.routeId
      && ["PENDING", "PLANNED"].includes(point.status)
      && !pendingCancellation
      && phase === "ready"
      && !cachedSnapshot
    return (
      <article key={point.id} className="border-t border-zinc-200 py-3 first:border-t-0 dark:border-zinc-700">
        <div className="flex items-start gap-2.5">
          {/* Prod 2026-09-14: orderIndex is 0-based and cards read «0», «1». */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
            {displayNumber}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                {point.organizationId && point.organizationName ? (
                  <Link
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold leading-5 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:min-h-0"
                    href={withReturnTo(`/mtm/customers/${encodeURIComponent(point.organizationId)}`, context)}
                  >
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{point.organizationName}</span>
                  </Link>
                ) : (
                  <span className="text-sm font-semibold">{t("unknownOrganization")}</span>
                )}
                {point.contactId && point.contactName && !fieldContactsEnabled ? (
                  <span className="flex min-h-11 items-center gap-1 text-xs text-muted-foreground md:min-h-0">
                    <ContactRound className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{point.contactName}</span>
                  </span>
                ) : point.contactId && point.contactName ? (
                  <Link
                    className="flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:min-h-0"
                    href={withReturnTo(`/mtm/contacts/${encodeURIComponent(point.contactId)}`, context)}
                  >
                    <ContactRound className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{point.contactName}</span>
                  </Link>
                ) : null}
                {subjectMeta.length ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subjectMeta.join(" · ")}</p> : null}
              </div>
              <Badge variant={presentation.badge} className="shrink-0 gap-1 whitespace-nowrap">
                <PointIcon className="h-3 w-3" />{presentation.label}
              </Badge>
            </div>
            {point.address ? (
              <p className="mt-1 flex items-start gap-1 text-xs leading-5 text-muted-foreground">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{point.address}</span>
              </p>
            ) : null}
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums">
              <div><dt className="text-muted-foreground">{t("planned")}</dt><dd className="font-medium">{formatTenantTimestamp(point.plannedAt, locale, facts.timezone, { hour: "2-digit", minute: "2-digit" })}</dd></div>
              <div><dt className="text-muted-foreground">{t("actual")}</dt><dd className="font-medium">{formatTenantTimestamp(point.actualAt, locale, facts.timezone, { hour: "2-digit", minute: "2-digit" })}</dd></div>
            </dl>
            {point.visitId && point.actualAt ? (
              <p className="mt-1.5 text-xs tabular-nums text-foreground" data-testid="mtm-week-visit-evidence">
                {[
                  point.checkOutAt
                    ? t("visitEvidence.inOut", { in: shortTime(point.actualAt, facts.timezone), out: shortTime(point.checkOutAt, facts.timezone) })
                    : t("visitEvidence.inOnly", { in: shortTime(point.actualAt, facts.timezone) }),
                  point.durationMinutes !== null ? t("visitEvidence.minutes", { count: point.durationMinutes }) : null,
                  point.photoCount ? t("visitEvidence.photos", { count: point.photoCount }) : null,
                  point.hasSignature ? t("visitEvidence.signature") : null,
                  point.hasNote ? t("visitEvidence.note") : null,
                ].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {point.status === "CANCELLED" || point.status === "CANCELED" ? (
              <p className="mt-2 text-xs text-red-700 dark:text-red-300">
                {point.cancellationReason
                  ? t("cancelReason", { reason: point.cancellationReason })
                  : point.cancellationSource === "PUBLISHED_ROUTE_STATUS"
                    ? t("cancelPublishedRoute")
                    : point.cancellationSource === "POINT_STATUS"
                      ? t("cancelPointStatus")
                      : point.cancellationSource === "VISIT"
                        ? t("cancelVisitEvidence")
                        : t("cancelReasonUnavailable")}
              </p>
            ) : null}
            {(routeHref || visitHref) ? (
              <div className="mt-2 flex flex-wrap gap-x-3">
                {routeHref ? <Link href={routeHref} className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary hover:underline md:min-h-0">{t("openRoute")}<ArrowUpRight className="h-3 w-3" /></Link> : null}
                {visitHref ? <Link href={visitHref} className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary hover:underline md:min-h-0">{t("openVisit")}<ArrowUpRight className="h-3 w-3" /></Link> : null}
              </div>
            ) : null}
            {pendingCancellation ? (
              <p className="mt-2 inline-flex min-h-8 items-center gap-1.5 bg-amber-50 px-2.5 text-xs font-medium text-amber-950 dark:bg-amber-950/25 dark:text-amber-100">
                <Clock3 className="h-3.5 w-3.5" />{t("cancellationPending")}
              </p>
            ) : canRequestCancellation ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 min-h-11 px-2 text-xs text-red-700 hover:text-red-800 dark:text-red-300 md:min-h-9"
                onClick={() => setCancellationTarget({ point, day })}
              >
                <XCircle className="mr-1.5 h-3.5 w-3.5" />{t("requestCancellation")}
              </Button>
            ) : null}
          </div>
        </div>
      </article>
    )
  }

  function renderDay(day: WeekDay, compact = false) {
    if (!query || !facts) return null
    const workday = dayWorkdayPresentation(day)
    const gps = gpsPresentation(facts.gps)
    const WorkdayIcon = workday.icon
    const dayAlertGroups = day.alertGroups ?? []
    const emptyPlanKey = day.date > facts.today ? "noPublishedPlanFuture" : day.date < facts.today ? "noPublishedPlanPast" : "noPublishedPlan"
    const GpsIcon = gps.icon
    const orderedRoutes = day.routes.map((route) => ({
      ...route,
      points: [...route.points].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
    }))
    const pointCount = orderedRoutes.reduce((total, route) => total + route.points.length, 0)
    const planRowsMayBeTruncated = orderedRoutes.some((route) => route.pointsTruncated) ||
      facts.contract.reasons.includes("ROUTES") || facts.contract.reasons.includes("ROUTE_POINTS")
    const context = returnPath(query, effectiveAgentId, day.date)
    return (
      <section
        key={day.date}
        aria-label={formatCalendarDay(day.date, locale, { weekday: "long", day: "numeric", month: "long" })}
        className={cn("min-w-0 bg-card", compact ? "border-y border-zinc-200 dark:border-zinc-700" : "border-r border-zinc-200 last:border-r-0 dark:border-zinc-700")}
      >
        <header className="border-b border-zinc-200 bg-muted/35 px-3 py-3 dark:border-zinc-700">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              className={cn("min-h-11 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40", query.day === day.date && "bg-primary/10")}
              aria-pressed={query.day === day.date}
              onClick={() => chooseDay(day.date)}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatCalendarDay(day.date, locale, { weekday: "short" })}</p>
              <p className="text-base font-semibold tabular-nums">{formatCalendarDay(day.date, locale, { day: "numeric", month: "short" })}</p>
            </button>
            <span className="text-xs text-muted-foreground">{t(planRowsMayBeTruncated ? "visibleStopsCount" : "stopsCount", { count: pointCount })}</span>
          </div>
          <div className="mt-2 grid gap-1.5 text-xs">
            {facts.workdayCapability.enabled ? <span className={cn("inline-flex items-center gap-1.5", workday.className)}><WorkdayIcon className="h-3.5 w-3.5" />{workday.label}</span> : null}
            {day.isToday ? <span className={cn("inline-flex items-center gap-1.5", gps.className)}><GpsIcon className="h-3.5 w-3.5" />{gps.label}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
            <span className="inline-flex items-center gap-1" aria-label={t("plannedCount", { count: day.summary.planned })}><Clock3 className="h-3 w-3" />{t("plannedShort")} {day.summary.planned}</span>
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300" aria-label={t("actualCount", { count: day.summary.actual })}><CheckCircle2 className="h-3 w-3" />{t("actualShort")} {day.summary.actual}</span>
            <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300" aria-label={t("cancelledCount", { count: day.summary.cancelled })}><XCircle className="h-3 w-3" />{t("cancelledShort")} {day.summary.cancelled}</span>
          </div>
          {facts.workdayCapability.enabled && day.workday.startedAt ? <p className="mt-2 text-[11px] text-muted-foreground">{t("dayStarted", { time: formatTenantTimestamp(day.workday.startedAt, locale, facts.timezone, { hour: "2-digit", minute: "2-digit" }) })}</p> : null}
          {facts.workdayCapability.enabled && day.workday.finishedAt ? <p className="mt-1 text-[11px] text-muted-foreground">{t("dayFinished", { time: formatTenantTimestamp(day.workday.finishedAt, locale, facts.timezone, { hour: "2-digit", minute: "2-digit" }) })}</p> : null}
        </header>
        <div className="px-3">
          {dayAlertGroups.length ? (
            <div className="border-b border-zinc-200 py-2 dark:border-zinc-700" data-testid="mtm-week-day-alerts">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300"><BellRing className="h-3.5 w-3.5" />{t("dayAlerts", { count: dayAlertGroups.reduce((total, group) => total + group.count, 0) })}</p>
              <ul>{dayAlertGroups.slice(0, 4).map((group) => renderAlertGroup(group, true))}</ul>
              <Link href={withReturnTo(`/mtm/alerts?agentId=${encodeURIComponent(effectiveAgentId)}`, context)} className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary hover:underline md:min-h-0">
                {dayAlertGroups.length > 4 ? t("moreAlertGroups", { count: dayAlertGroups.length - 4 }) : t("openAlerts")}<ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          ) : null}
          {pointCount ? orderedRoutes.map((route) => {
            // An unnamed route used to show its cuid; name it by its day.
            const routeLabel = route.name || t("routeFallbackName", { date: formatCalendarDay(day.date, locale, { day: "numeric", month: "short" }) })
            return (
              <section key={route.id} aria-label={routeLabel}>
                <div className="flex items-center justify-between gap-2 border-b border-zinc-200 py-2 text-xs dark:border-zinc-700">
                  <Link href={withReturnTo(`/mtm/routes?routeId=${encodeURIComponent(route.id)}`, context)} className="inline-flex min-h-11 min-w-0 items-center gap-1.5 font-medium hover:text-primary hover:underline md:min-h-0">
                    <RouteIcon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{routeLabel}</span>
                  </Link>
                  {!managerView && route.publishedVersion !== null ? <span className="shrink-0 text-muted-foreground">v{route.publishedVersion}</span> : null}
                </div>
                {route.points.map((point, index) => renderPoint(point, day, index + 1))}
              </section>
            )
          }) : (
            <div className="flex min-h-32 flex-col items-center justify-center gap-2 py-6 text-center">
              {planRowsMayBeTruncated ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CalendarDays className="h-5 w-5 text-muted-foreground" />}
              <p className="text-sm font-medium">{t(planRowsMayBeTruncated ? "planRowsLimited" : "noPublishedPlan")}</p>
              <p className="max-w-[32ch] text-xs text-muted-foreground">{t(planRowsMayBeTruncated ? "planRowsLimitedHint" : `${emptyPlanKey}Hint` as never)}</p>
            </div>
          )}
          {day.unplannedVisits.length ? (
            <div className="border-t border-zinc-200 py-2 dark:border-zinc-700">
              <p className="pb-1 text-xs font-semibold text-muted-foreground">{t("unplannedVisits")}</p>
              {day.unplannedVisits.map((visit, index) => renderPoint(visit, day, index + 1))}
            </div>
          ) : null}
          {day.tasks.length ? (
            <div className="border-t border-zinc-200 py-2 text-xs text-muted-foreground dark:border-zinc-700">
              <ClipboardList className="mr-1 inline h-3.5 w-3.5" />{t("dayTasks", { count: day.tasks.length })}
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  function renderPlanChange(change: PlanChange, railId: "compact" | "desktop") {
    if (!query || !facts) return null
    const changeContext = returnPath(query, effectiveAgentId, selectedDay?.date || query.day)
    const contextRouteId = change.rescheduledRouteId || change.routeId
    const href = contextRouteId ? withReturnTo(`/mtm/routes?routeId=${encodeURIComponent(contextRouteId)}`, changeContext) : null
    const statusLabel = change.resolution === "RESCHEDULE"
      ? t("changeStatus.rescheduled")
      : change.status === "SUBMITTED"
      ? t("changeStatus.submitted")
      : change.status === "IN_REVIEW"
        ? t("changeStatus.inReview")
        : change.status === "NEEDS_INFO"
          ? t("changeStatus.needsInfo")
          : change.status === "APPROVED"
            ? t("changeStatus.approved")
            : change.status === "REJECTED"
              ? t("changeStatus.rejected")
              : change.status === "CANCELLED"
                ? t("changeStatus.cancelled")
                : t("changeStatus.unknown")
    const typeLabel = change.type === "REMOVE_STOP"
      ? t("changeType.removeStop")
      : change.type === "ADD_STOP"
        ? t("changeType.addStop")
        : change.type === "CONFLICT_OVERRIDE"
          ? t("changeType.conflictOverride")
        : t("changeType.change")
    const decisionFieldId = `decision-${railId}-${change.id}`
    const rescheduleFieldId = `reschedule-${railId}-${change.id}`
    return (
      <li key={change.id} className="py-3 text-xs">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium">{typeLabel}</span>
          <span className="text-muted-foreground">{statusLabel}</span>
        </div>
        {change.pointLabel ? <p className="mt-1 text-muted-foreground">{change.pointLabel}</p> : null}
        {(change.requestedByName || change.requestedAt) ? (
          <p className="mt-1 text-muted-foreground">
            {change.requestedByName ? t("requestedBy", { name: change.requestedByName }) : null}
            {change.requestedByName && change.requestedAt ? " · " : null}
            {change.requestedAt ? formatTenantTimestamp(change.requestedAt, locale, facts.timezone, { dateStyle: "medium", timeStyle: "short" }) : null}
          </p>
        ) : null}
        {change.reasonCode ? <Badge variant="outline" className="mt-2">{t(`cancellationReason.${CANCELLATION_REASONS.includes(change.reasonCode as typeof CANCELLATION_REASONS[number]) ? change.reasonCode : "OTHER"}` as never)}</Badge> : null}
        <p className="mt-1 text-muted-foreground">{change.reason ? t("changeReason", { reason: change.reason }) : t("changeReasonUnavailable")}</p>
        {change.type === "REMOVE_STOP" ? (
          <p className="mt-2 bg-muted/60 px-2.5 py-2 leading-5 text-muted-foreground">
            {t("cancellationImpact", { planned: change.impact.plannedStops, eligible: change.impact.eligibleStops })}
          </p>
        ) : null}
        {change.decisionComment ? <p className="mt-2 text-muted-foreground">{t("decisionComment", { comment: change.decisionComment })}</p> : null}
        {change.resolution === "RESCHEDULE" && change.rescheduleDate ? <p className="mt-2 font-medium text-emerald-700 dark:text-emerald-300">{t("rescheduledFor", { date: formatCalendarDay(change.rescheduleDate, locale, { dateStyle: "medium" }) })}</p> : null}
        {change.type === "REMOVE_STOP" && change.canReview && ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"].includes(change.status) ? (
          <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
            <Label htmlFor={decisionFieldId} className="text-xs">{t("managerComment")}</Label>
            <Textarea
              id={decisionFieldId}
              value={decisionNotes[change.id] || ""}
              onChange={(event) => setDecisionNotes((current) => ({ ...current, [change.id]: event.target.value }))}
              rows={2}
              maxLength={1000}
              placeholder={t("managerCommentPlaceholder")}
              disabled={Boolean(planMutationId)}
            />
            <div className="space-y-1.5">
              <Label htmlFor={rescheduleFieldId} className="text-xs">{t("rescheduleDate")}</Label>
              <Input
                id={rescheduleFieldId}
                type="date"
                min={change.routeDate ? shiftDate(change.routeDate, 1) : undefined}
                max={change.routeDate ? shiftDate(change.routeDate, 180) : undefined}
                value={rescheduleDates[change.id] || ""}
                onChange={(event) => setRescheduleDates((current) => ({ ...current, [change.id]: event.target.value }))}
                disabled={Boolean(planMutationId)}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 min-[100rem]:grid-cols-1">
              <Button type="button" size="sm" className="min-h-11" disabled={Boolean(planMutationId)} onClick={() => void decidePlanChange(change, "APPROVED")}>{t("approveCancellation")}</Button>
              <Button type="button" size="sm" variant="secondary" className="min-h-11" disabled={Boolean(planMutationId)} onClick={() => void decidePlanChange(change, "RESCHEDULE")}>{t("rescheduleCancellation")}</Button>
              <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={Boolean(planMutationId)} onClick={() => void decidePlanChange(change, "NEEDS_INFO")}>{t("returnCancellation")}</Button>
              <Button type="button" size="sm" variant="destructive" className="min-h-11" disabled={Boolean(planMutationId)} onClick={() => void decidePlanChange(change, "REJECTED")}>{t("rejectCancellation")}</Button>
            </div>
          </div>
        ) : null}
        {href ? <Link className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline md:min-h-0" href={href}>{t("openRoute")}<ArrowUpRight className="h-3 w-3" /></Link> : null}
      </li>
    )
  }

  const periodLabel = facts?.days.length
    ? `${formatCalendarDay(facts.days[0].date, locale, { day: "numeric", month: "short" })} – ${formatCalendarDay(facts.days[facts.days.length - 1].date, locale, { day: "numeric", month: "short", year: "numeric" })}`
    : query?.date || "—"
  const snapshotExpired = cachedSnapshot ? isOperationalWeekSnapshotExpired(cachedSnapshot) : false
  const coverageAuthoritative = !facts?.contract.reasons.some((reason) => ["ROUTES", "ROUTE_POINTS", "VISITS"].includes(reason))
  const coveragePercentage = coverageAuthoritative ? facts?.summary.percentage ?? null : null
  const baseCoverageNumberFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }),
    [locale],
  )
  const baseCoverageLabelLocale = locale === "az" ? "az" : locale === "en" ? "en" : "ru"
  const baseCoverageNumber = (value: string | number) => {
    const parsed = typeof value === "number" ? value : Number(value)
    return Number.isFinite(parsed)
      ? baseCoverageNumberFormatter.format(parsed)
      : "—"
  }
  const baseCoverageReturnTo = query && facts
    ? returnPath(query, facts.selectedAgent.id, selectedDay?.date || query.day)
    : "/mtm"
  const pendingCancellations = facts?.pendingPlanChanges.filter((change) => change.type === "REMOVE_STOP") ?? []
  const pendingOtherPlanChanges = facts?.pendingPlanChanges.filter((change) => change.type !== "REMOVE_STOP") ?? []
  const gpsNeedsRecovery = selectedDay?.isToday && ["PERMISSION_NOT_GRANTED", "NO_LOCATION_REPORTED"].includes(facts?.gps.reason ?? "")
  const selectedGpsHistoryHref = query && selectedDay && effectiveAgentId
    ? withReturnTo(
        `/mtm/map?mode=history&agentId=${encodeURIComponent(effectiveAgentId)}&date=${encodeURIComponent(selectedDay.date)}`,
        returnPath(query, effectiveAgentId, selectedDay.date),
      )
    : null

  async function loadBaseCoverageRows(groupKey: string, page: number, append: boolean): Promise<void> {
    const snapshotId = baseCoverage?.snapshot?.id
    if (!snapshotId || baseCoveragePhase !== "ready") return
    coverageRowsAbortRef.current?.abort()
    const controller = new AbortController()
    coverageRowsAbortRef.current = controller
    const requestId = ++coverageRowsRequestIdRef.current
    setBaseCoverageRowsPhase(append ? "loadingMore" : "loading")
    if (!append) setBaseCoverageRows(null)
    const params = new URLSearchParams({ groupKey, uncoveredOnly: "true", page: String(page), limit: "5" })
    try {
      const { response, body } = await fetchOperationalWeekJsonWithTimeout(
        `/api/v1/mtm/coverage-snapshots/${encodeURIComponent(snapshotId)}/rows?${params.toString()}`,
        {
          signal: controller.signal,
          cache: "no-store",
          headers: organizationId ? { "x-organization-id": String(organizationId) } : {},
        },
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const normalized = normalizeBaseCoverageRows(body)
      if (!normalized || normalized.groupKey !== groupKey || normalized.page !== page) throw new Error("Invalid coverage rows response")
      if (requestId !== coverageRowsRequestIdRef.current) return
      setBaseCoverageRows((current) => {
        if (!append || !current || current.groupKey !== groupKey) return normalized
        const knownIds = new Set(current.rows.map((row) => row.id))
        return { ...normalized, rows: [...current.rows, ...normalized.rows.filter((row) => !knownIds.has(row.id))] }
      })
      setBaseCoverageRowsPhase("ready")
    } catch {
      if (controller.signal.aborted || requestId !== coverageRowsRequestIdRef.current) return
      setBaseCoverageRowsPhase("error")
    } finally {
      if (coverageRowsAbortRef.current === controller) coverageRowsAbortRef.current = null
    }
  }

  function toggleBaseCoverageRows(groupKey: string): void {
    if (expandedCoverageGroup === groupKey) {
      coverageRowsRequestIdRef.current += 1
      coverageRowsAbortRef.current?.abort()
      coverageRowsAbortRef.current = null
      setExpandedCoverageGroup(null)
      setBaseCoverageRows(null)
      setBaseCoverageRowsPhase("idle")
      return
    }
    setExpandedCoverageGroup(groupKey)
    void loadBaseCoverageRows(groupKey, 1, false)
  }

  function renderAttentionRailContent(railId: "compact" | "desktop") {
    if (!facts) return null
    return (
      <>
        <div data-testid={`mtm-swm15-coverage-${railId}`} className="px-4 py-5 lg:px-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">{t("publishedPlan")}</p>
              <h3 className="mt-1 text-base font-semibold">{t("coverageTitle")}</h3>
            </div>
            <span className="text-3xl font-semibold tabular-nums">{coveragePercentage === null ? "—" : `${Math.round(coveragePercentage)}%`}</span>
          </div>
          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
            aria-label={!coverageAuthoritative ? t("coveragePartial") : coveragePercentage === null ? t("coverageNotApplicable") : t("coverageProgress", { value: Math.round(coveragePercentage) })}
            role={coveragePercentage === null ? "img" : "progressbar"}
            aria-valuemin={coveragePercentage === null ? undefined : 0}
            aria-valuemax={coveragePercentage === null ? undefined : 100}
            aria-valuenow={coveragePercentage === null ? undefined : Math.round(coveragePercentage)}
          >
            <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, coveragePercentage || 0))}%` }} />
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">{t("planned")}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{facts.summary.planned}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("actual")}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{facts.summary.actual}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("cancelled")}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{facts.summary.cancelled}</dd></div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {!coverageAuthoritative
              ? t("coveragePartial")
              : facts.summary.denominator === 0
                ? t("coverageNotApplicable")
                : facts.summary.formula || t("coverageFormula", { numerator: facts.summary.numerator ?? facts.summary.actual, denominator: facts.summary.denominator ?? facts.summary.planned })}
          </p>
          {facts.lastSourceAt ? <p className="mt-2 text-xs text-muted-foreground">{t("sourceUpdatedAt", { date: formatTenantTimestamp(facts.lastSourceAt, locale, facts.timezone, { dateStyle: "medium", timeStyle: "short" }) })}</p> : null}

          <section className="mt-5 border-t border-zinc-200 pt-5 dark:border-zinc-700" data-testid="mtm-base-coverage">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary"><Building2 className="h-3.5 w-3.5" />{t("baseCoverageEyebrow")}</p>
                <h4 className="mt-1 text-sm font-semibold">{t("baseCoverageTitle")}</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  {baseCoverage?.period.start
                    ? t("baseCoveragePeriod", { date: formatCalendarDay(baseCoverage.period.start, locale, { month: "long", year: "numeric" }) })
                    : query?.date
                      ? t("baseCoveragePeriod", { date: formatCalendarDay(`${query.date.slice(0, 7)}-01`, locale, { month: "long", year: "numeric" }) })
                      : "—"}
                </p>
              </div>
              {baseCoveragePhase === "ready" && baseCoverage?.policy ? <Badge variant="success">{t("baseCoverageSigned", { version: baseCoverage.policy.version })}</Badge> : null}
            </div>

            {baseCoveragePhase === "loading" ? (
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />{t("baseCoverageLoading")}</div>
            ) : cachedSnapshot || phase === "offline" || phase === "snapshot" ? (
              <div className="mt-4 bg-muted/50 px-3 py-3 text-xs leading-5 text-muted-foreground"><CloudOff className="mr-1.5 inline h-4 w-4" />{t("baseCoverageOffline")}</div>
            ) : baseCoveragePhase === "error" ? (
              <div className="mt-4 bg-red-50 px-3 py-3 text-xs leading-5 text-red-900 dark:bg-red-950/25 dark:text-red-100" role="status"><WifiOff className="mr-1.5 inline h-4 w-4" />{t("baseCoverageLoadFailed")}</div>
            ) : baseCoveragePhase === "unavailable" && baseCoverage ? (
              <div className="mt-4 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-950 dark:bg-amber-950/25 dark:text-amber-100" role="status">
                <AlertTriangle className="mr-1.5 inline h-4 w-4" />
                {t(baseCoverage.state === "UNSIGNED_COVERAGE_POLICY"
                  ? "baseCoverageUnsigned"
                  : baseCoverage.state === "NO_COVERAGE_SNAPSHOT"
                    ? "baseCoverageNoSnapshot"
                    : baseCoverage.state === "COVERAGE_POLICY_SIGNATURE_INVALID"
                      ? "baseCoverageInvalidPolicy"
                      : baseCoverage.state === "COVERAGE_SNAPSHOT_INCOMPLETE"
                        ? "baseCoverageIncomplete"
                        : "baseCoverageUnavailable")}
              </div>
            ) : baseCoveragePhase === "ready" && baseCoverage?.available && baseCoverage.totals ? (
              <div className="mt-4 space-y-3">
                {baseCoverage.totals.groups.map((group) => {
                  const isExpanded = expandedCoverageGroup === group.key
                  const rows = isExpanded && baseCoverageRows?.groupKey === group.key ? baseCoverageRows.rows : []
                  const coverageRowsId = `base-coverage-rows-${railId}-${group.key}`
                  return (
                    <article key={group.key} className="border border-zinc-200 bg-muted/20 px-3 py-3 dark:border-zinc-700">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-xs font-semibold">{group.labels?.[baseCoverageLabelLocale] || group.label}</h5>
                        <Badge variant="outline">{t("baseCoverageObjects", { count: group.populationCount })}</Badge>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 2xl:grid-cols-4">
                        <div><dt className="text-[10px] leading-4 text-muted-foreground">{t("baseCoverageRequired")}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{baseCoverageNumber(group.requiredCoverage)}</dd></div>
                        <div><dt className="text-[10px] leading-4 text-muted-foreground">{t("baseCoverageActualMoi")}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{baseCoverageNumber(group.actualMoi)} <span className="font-normal text-muted-foreground">({baseCoverageNumber(group.target)})</span></dd></div>
                        <div><dt className="text-[10px] leading-4 text-muted-foreground">{t("baseCoverageActual")}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{baseCoverageNumber(group.actualCoverage)}</dd></div>
                        <div><dt className="text-[10px] leading-4 text-muted-foreground">{t("baseCoverageUncovered")}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-amber-800 dark:text-amber-300">{baseCoverageNumber(group.uncoveredMoi)}</dd></div>
                      </dl>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="mt-3 min-h-11 w-full justify-between px-2 text-xs md:min-h-9"
                        aria-expanded={isExpanded}
                        aria-controls={coverageRowsId}
                        onClick={() => toggleBaseCoverageRows(group.key)}
                      >
                        {isExpanded ? t("baseCoverageHideUncovered") : t("baseCoverageShowUncovered")}
                        <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", isExpanded && "rotate-180")} />
                      </Button>
                      {isExpanded ? (
                        <div id={coverageRowsId} className="mt-2 border-t border-zinc-200 pt-3 dark:border-zinc-700" data-testid={`mtm-base-coverage-rows-${railId}-${group.key}`}>
                          {baseCoverageRowsPhase === "loading" ? (
                            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />{t("baseCoverageRowsLoading")}</div>
                          ) : null}
                          {baseCoverageRowsPhase === "error" ? (
                            <div className="bg-red-50 px-3 py-2 text-xs text-red-900 dark:bg-red-950/25 dark:text-red-100" role="status">
                              <p>{t("baseCoverageRowsFailed")}</p>
                              <Button type="button" size="sm" variant="outline" className="mt-2 min-h-9" onClick={() => void loadBaseCoverageRows(group.key, baseCoverageRows ? baseCoverageRows.page + 1 : 1, Boolean(baseCoverageRows))}>{t("baseCoverageRowsRetry")}</Button>
                            </div>
                          ) : null}
                          {baseCoverageRowsPhase !== "loading" && !rows.length && baseCoverageRowsPhase !== "error" ? <p className="py-2 text-xs text-muted-foreground">{t("baseCoverageRowsEmpty")}</p> : null}
                          {rows.length ? (
                            <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                              {rows.map((row) => {
                                const detailPath = row.subjectType === "DOCTOR"
                                  ? (fieldContactsEnabled ? `/mtm/contacts/${encodeURIComponent(row.subjectId)}` : null)
                                  : row.customerId
                                    ? `/mtm/customers/${encodeURIComponent(row.customerId)}`
                                    : null
                                const planningPath = row.planningTarget
                                  ? `/mtm/routes?${new URLSearchParams({
                                      customerId: row.planningTarget.customerId,
                                      ...(row.planningTarget.contactId ? { contactId: row.planningTarget.contactId } : {}),
                                    }).toString()}`
                                  : null
                                return (
                                  <li key={row.id} className="py-3 first:pt-0">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="truncate text-xs font-semibold">{row.subjectName}</p>
                                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{[row.customerName, row.specialtyName || row.categoryLabel].filter(Boolean).join(" · ") || "—"}</p>
                                      </div>
                                      <span className="shrink-0 text-xs font-semibold tabular-nums text-amber-800 dark:text-amber-300">{t("baseCoverageRowUncovered", { value: baseCoverageNumber(row.uncoveredMoi) })}</span>
                                    </div>
                                    <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{row.explanation.summary[baseCoverageLabelLocale]}</p>
                                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                                      {detailPath ? <Link className="inline-flex min-h-9 items-center gap-1 font-medium text-primary hover:underline" href={withReturnTo(detailPath, baseCoverageReturnTo)}>{t("baseCoverageOpenObject")}<ArrowUpRight className="h-3 w-3" /></Link> : null}
                                      {planningPath ? <Link className="inline-flex min-h-9 items-center gap-1 font-medium text-primary hover:underline" href={withReturnTo(planningPath, baseCoverageReturnTo)}>{t("baseCoveragePlanVisit")}<ArrowUpRight className="h-3 w-3" /></Link> : null}
                                    </div>
                                  </li>
                                )
                              })}
                            </ul>
                          ) : null}
                          {baseCoverageRows?.hasMore && baseCoverageRowsPhase !== "error" ? (
                            <Button type="button" size="sm" variant="outline" className="mt-3 min-h-11 w-full md:min-h-9" disabled={baseCoverageRowsPhase === "loadingMore"} onClick={() => void loadBaseCoverageRows(group.key, baseCoverageRows.page + 1, true)}>
                              {baseCoverageRowsPhase === "loadingMore" ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
                              {t("baseCoverageLoadMore", { count: Math.max(0, baseCoverageRows.total - baseCoverageRows.rows.length) })}
                            </Button>
                          ) : null}
                          {baseCoverageRows && baseCoverageRows.total > 0 ? <p className="mt-2 text-[10px] text-muted-foreground">{t("baseCoverageRowsCount", { shown: baseCoverageRows.rows.length, total: baseCoverageRows.total })}</p> : null}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
                <div className="border-t-2 border-zinc-300 px-3 pt-3 dark:border-zinc-600">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{t("baseCoverageTotal")}</span><span className="text-xs font-semibold tabular-nums">{t("baseCoverageObjects", { count: baseCoverage.totals.overall.populationCount })}</span></div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 2xl:grid-cols-4">
                    <div><dt className="text-[10px] leading-4 text-muted-foreground">{t("baseCoverageRequired")}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{baseCoverageNumber(baseCoverage.totals.overall.requiredCoverage)}</dd></div>
                    <div><dt className="text-[10px] leading-4 text-muted-foreground">{t("baseCoverageActualMoi")}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{baseCoverageNumber(baseCoverage.totals.overall.actualMoi)} <span className="font-normal text-muted-foreground">({baseCoverageNumber(baseCoverage.totals.overall.target)})</span></dd></div>
                    <div><dt className="text-[10px] leading-4 text-muted-foreground">{t("baseCoverageActual")}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums">{baseCoverageNumber(baseCoverage.totals.overall.actualCoverage)}</dd></div>
                    <div><dt className="text-[10px] leading-4 text-muted-foreground">{t("baseCoverageUncovered")}</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-amber-800 dark:text-amber-300">{baseCoverageNumber(baseCoverage.totals.overall.uncoveredMoi)}</dd></div>
                  </dl>
                </div>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  {baseCoverage.snapshot?.frozenAt
                    ? t("baseCoverageFrozenAt", { date: formatTenantTimestamp(baseCoverage.snapshot.frozenAt, locale, facts.timezone, { dateStyle: "medium", timeStyle: "short" }) })
                    : null}
                  {baseCoverage.policy?.approvalReference ? ` · ${t("baseCoverageApproval", { reference: baseCoverage.policy.approvalReference })}` : null}
                </p>
              </div>
            ) : null}
          </section>
        </div>

        <section className="border-t border-zinc-200 px-4 py-5 dark:border-zinc-700 md:border-l md:border-t-0 min-[100rem]:border-l-0 min-[100rem]:border-t min-[100rem]:px-5">
          <h3 className="text-base font-semibold">{t("needsAttention")}</h3>
          <div className="mt-4 space-y-5">
            {(() => {
              const todayInPeriod = facts.days.some((day) => day.date === facts.today)
              const groups = (facts.alertGroups ?? []).filter((group) => !todayInPeriod || group.date === facts.today)
              const total = groups.reduce((sum, group) => sum + group.count, 0)
              const alertsHref = withReturnTo(
                `/mtm/alerts?agentId=${encodeURIComponent(effectiveAgentId)}`,
                query ? returnPath(query, effectiveAgentId, selectedDay?.date || query.day) : "/mtm",
              )
              return (
                <section data-testid={`mtm-week-alerts-${railId}`}>
                  <div className="flex items-center justify-between gap-2"><h4 className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300"><BellRing className="h-4 w-4" />{t(todayInPeriod ? "alertsToday" : "alertsInPeriod")}</h4><Badge variant={total ? "warning" : "outline"}>{total}{facts.alertsTruncated ? "+" : ""}</Badge></div>
                  {groups.length ? (
                    <>
                      <ul className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-700">{groups.slice(0, 6).map((group) => renderAlertGroup(group, false))}</ul>
                      <Link href={alertsHref} className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary hover:underline">
                        {groups.length > 6 ? t("moreAlertGroups", { count: groups.length - 6 }) : t("openAlerts")}<ArrowUpRight className="h-3 w-3 shrink-0" />
                      </Link>
                    </>
                  ) : <p className="mt-2 text-xs text-muted-foreground">{t("noOpenAlerts")}</p>}
                </section>
              )
            })()}
            <section className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <div className="flex items-center justify-between gap-2"><h4 className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-800 dark:text-red-200"><XCircle className="h-4 w-4" />{t("pendingCancellations")}</h4><Badge variant={pendingCancellations.length ? "destructive" : "outline"}>{pendingCancellations.length}</Badge></div>
              {pendingCancellations.length ? (
                <>
                  <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-700">
                    {pendingCancellations.slice(0, cancellationsExpanded ? pendingCancellations.length : 5).map((change) => renderPlanChange(change, railId))}
                  </ul>
                  {pendingCancellations.length > 5 ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                      <p className="text-xs text-muted-foreground">
                        {t("pendingCancellationsShown", {
                          shown: cancellationsExpanded ? pendingCancellations.length : 5,
                          total: pendingCancellations.length,
                        })}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-h-11 px-2 text-xs md:min-h-9"
                        aria-expanded={cancellationsExpanded}
                        onClick={() => setCancellationsExpanded((current) => !current)}
                      >
                        {t(cancellationsExpanded ? "showFewerCancellations" : "showAllCancellations")}
                        <ChevronDown className={cn("ml-1.5 h-4 w-4 transition-transform motion-reduce:transition-none", cancellationsExpanded && "rotate-180")} />
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : <p className="mt-2 text-xs text-muted-foreground">{t("noPendingCancellations")}</p>}
              {pendingOtherPlanChanges.length ? (
                <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                  <div className="flex items-center justify-between gap-2"><h5 className="text-xs font-semibold text-muted-foreground">{t("pendingPlanChanges")}</h5><Badge variant="warning">{pendingOtherPlanChanges.length}</Badge></div>
                  <ul className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-700">{pendingOtherPlanChanges.slice(0, 3).map((change) => renderPlanChange(change, railId))}</ul>
                </div>
              ) : null}
              {facts.planChanges.some((change) => !facts.pendingPlanChanges.some((pending) => pending.id === change.id)) ? (
                <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                  <h5 className="text-xs font-semibold text-muted-foreground">{t("recentPlanChanges")}</h5>
                  <ul className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-700">
                    {facts.planChanges.filter((change) => !facts.pendingPlanChanges.some((pending) => pending.id === change.id)).slice(0, 3).map((change) => renderPlanChange(change, railId))}
                  </ul>
                </div>
              ) : null}
            </section>
            <section className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <div className="flex items-center justify-between gap-2"><h4 className="inline-flex items-center gap-1.5 text-sm font-semibold"><ClipboardList className="h-4 w-4 text-primary" />{t("activeTasks")}</h4><Badge variant={activeTasks.length ? "info" : "outline"}>{activeTasks.length}</Badge></div>
              {activeTasks.length ? (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label={t("taskAttentionSummary", { overdue: overdueTaskCount, returned: returnedTaskCount })}>
                  <span className={overdueTaskCount ? "font-medium text-red-700 dark:text-red-300" : undefined}>{t("overdueTasksCount", { count: overdueTaskCount })}</span>
                  <span className={returnedTaskCount ? "font-medium text-amber-800 dark:text-amber-300" : undefined}>{t("returnedTasksCount", { count: returnedTaskCount })}</span>
                </p>
              ) : null}
              {activeTasks.length ? (
                <>
                  <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-700">
                    {activeTasks.slice(0, 5).map((task) => {
                      const attention = taskAttentionPresentation(task.attention)
                      return (
                        <li key={task.id} className="py-3">
                          <div className="flex items-start justify-between gap-2">
                            <Link
                              href={withReturnTo(
                                `/mtm/tasks/${encodeURIComponent(task.id)}`,
                                query ? returnPath(query, effectiveAgentId, selectedDay?.date || query.day) : "/mtm",
                              )}
                              className="inline-flex min-h-11 min-w-0 items-center gap-1 text-xs font-semibold leading-5 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            >
                              <span className="line-clamp-2">{task.title}</span><ArrowUpRight className="h-3 w-3 shrink-0" />
                            </Link>
                            <Badge variant={attention.variant} className="shrink-0">{attention.label}</Badge>
                          </div>
                          {/* Prod 2026-09-14: «ID cmqm7j…p468 · versiya 1» means nothing to a manager. */}
                          {!managerView ? (
                            <p className="mt-1 text-[11px] text-muted-foreground" title={task.id} aria-label={t("taskId", { id: task.id })}>
                              {t("taskId", { id: task.id.length > 12 ? `${task.id.slice(0, 6)}…${task.id.slice(-4)}` : task.id })}
                              {task.version === null ? null : <span> · {t("taskVersion", { version: task.version })}</span>}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Badge variant={task.status === "OVERDUE" ? "destructive" : "outline"}>{taskStatusLabel(task.status)}</Badge>
                            <Badge variant={task.priority === "URGENT" || task.priority === "HIGH" ? "warning" : "outline"}>{taskPriorityLabel(task.priority)}</Badge>
                          </div>
                          {(task.scheduledStartAt || task.dueAt) ? (
                            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                              <div><dt className="text-muted-foreground">{t("taskScheduledStart")}</dt><dd className="mt-0.5 tabular-nums">{formatTenantTimestamp(task.scheduledStartAt, locale, facts.timezone, { dateStyle: "medium", timeStyle: "short" })}</dd></div>
                              <div><dt className="text-muted-foreground">{t("taskDue")}</dt><dd className="mt-0.5 tabular-nums">{formatTenantTimestamp(task.dueAt, locale, facts.timezone, { dateStyle: "medium", timeStyle: "short" })}</dd></div>
                            </dl>
                          ) : null}
                          {task.returnReason ? <p className="mt-2 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-950 dark:bg-amber-950/25 dark:text-amber-100">{t("taskReturnedReason", { reason: task.returnReason })}</p> : null}
                        </li>
                      )
                    })}
                  </ul>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                    <p className="text-xs text-muted-foreground">{t("activeTasksShown", { shown: shownActiveTaskCount, total: activeTasks.length })}</p>
                    <Link href={taskListHref} className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                      {t("viewAllTasks")}<ArrowUpRight className="h-3 w-3 shrink-0" />
                    </Link>
                  </div>
                </>
              ) : <p className="mt-2 text-xs text-muted-foreground">{t("noActiveTasks")}</p>}
            </section>
          </div>
        </section>
      </>
    )
  }

  /**
   * One row of the team list. Audit 2026-09-21: the table's six columns
   * repeated «0», «—», «Визитов нет» for every idle agent; a row now names
   * only the facts it has, and the left edge (red / amber) is the group —
   * there are no "Problems (3)" headings repeating the summary's numbers.
   */
  function renderTeamRow(entry: ClassifiedTeamRow<TeamTodayRow>, tone: "problem" | "active" | "idle") {
    if (!query || !teamToday) return null
    const { row } = entry
    const timezone = teamToday.timezone
    const openWeek = () => updateQuery({ ...query, agentId: row.agentId, day: teamToday.today || query.day, date: teamToday.today || query.date })
    // Stage A of "close this shift": there is no server operation that closes
    // another agent's shift (POST /api/v1/mtm/week/workday is self-only and
    // reopen/undo work on COMPLETED days only), so a «Close» button would be
    // a lie. The honest action opens the agent's week, where the left-open
    // banner and the manager's controls already are. Stage B swaps this
    // handler and the button key once a manager FINISH exists.
    const openLeftOpenShift = openWeek
    const leftOpen = entry.flags.includes("shift-left-open")
    const accent = tone === "problem"
      ? (leftOpen ? "border-l-2 border-l-red-600" : "border-l-2 border-l-amber-500")
      : tone === "idle" ? "text-muted-foreground" : null
    // «Not started» is the absence of a fact, not a fact — no chip for it.
    const workday = teamToday.workdayEnabled && row.workday && row.workday.kind !== "not-started" ? managerWorkdayPresentation(row.workday, timezone) : null
    const WorkdayIcon = workday?.icon
    return (
      <li key={row.agentId} className={cn("grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-t border-zinc-200 px-4 py-2.5 hover:bg-muted/40 dark:border-zinc-700 lg:px-5", accent)} onClick={openWeek}>
        <div className="min-w-0">
          <button type="button" className="min-h-11 text-left font-semibold hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 md:min-h-0" onClick={(event) => { event.stopPropagation(); openWeek() }}>{row.name}</button>
          {row.teamName ? <span className="ml-2 text-xs text-muted-foreground">{row.teamName}</span> : null}
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            {workday && WorkdayIcon ? <span className={cn("inline-flex items-start gap-1.5", workday.className)}><WorkdayIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />{workday.label}</span> : null}
            {entry.flags.includes("in-field-no-plan") ? (
              <span className="text-amber-700 dark:text-amber-300">{t("teamNoRoute")}</span>
            ) : row.route ? (
              <span className="tabular-nums">{t("teamRouteProgress", { visited: row.route.visited, total: row.route.total })}</span>
            ) : (
              <span className="text-muted-foreground">{t("teamNoRoute")}</span>
            )}
            {entry.openVisitSince ? <span className="font-medium tabular-nums">{t("teamRowOpenVisit", { time: shortTime(entry.openVisitSince, timezone) })}</span> : null}
            {row.visitCount > 0 ? <span className="text-muted-foreground">{t("teamRowVisits", { count: row.visitCount })}</span> : null}
            {entry.flags.includes("in-field-no-gps") ? (
              <span className="text-amber-700 dark:text-amber-300">{t("teamNoGpsToday")}</span>
            ) : row.lastGpsAt ? (
              // Always grey: a last known position, never "live" (same rule as the map).
              <span className="tabular-nums text-muted-foreground">{t("teamRowLastGps", { time: shortTime(row.lastGpsAt, timezone) })}</span>
            ) : null}
            {row.openAlerts > 0 ? (
              <Link href={`/mtm/alerts?agentId=${encodeURIComponent(row.agentId)}`} onClick={(event) => event.stopPropagation()} className="text-amber-700 underline-offset-2 hover:underline dark:text-amber-300">{t("teamRowOpenAlerts", { count: row.openAlerts })}</Link>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          {leftOpen ? (
            <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0 md:min-h-0" onClick={(event) => { event.stopPropagation(); openLeftOpenShift() }}>{t("teamOpenWeek")}</Button>
          ) : null}
        </div>
      </li>
    )
  }

  /**
   * The team view: one line of facts, then only the rows that carry a fact.
   * Audit 2026-09-21 on prod: 17 × 6 cells, three meaningful, and the
   * 19-day open shift in the last column in the same font as «Не начат».
   * Every number here comes from `summarizeTeamToday`; JSX computes nothing.
   */
  function renderTeamToday() {
    const scoped = currentTeamToday
    const summary = scoped ? summarizeTeamToday(scoped.rows, { workdayEnabled: scoped.workdayEnabled, partial: scoped.partial, visitsTruncated: scoped.visitsTruncated }) : null
    const timezone = scoped?.timezone || "UTC"
    // No date before the query exists: the server's date and the browser's
    // can differ at hydration, and the heading must not.
    const titleDate = scoped?.today || query?.date || null
    return (
      <section data-testid="mtm-week-team-today" aria-labelledby="mtm-week-team-today-title">
        <h3 id="mtm-week-team-today-title" className="sr-only">
          {titleDate ? t("teamTodayTitle", { date: formatCalendarDay(titleDate, locale, { weekday: "long", day: "numeric", month: "long" }) }) : t("teamTodayTitleNoDate")}
        </h3>
        {!scoped || !summary ? (
          teamPhase === "error" ? (
            <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm lg:px-5">
              <WifiOff className="h-4 w-4 text-red-600" />
              <span className="font-semibold">{t("teamLoadFailed")}</span>
              <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-0" onClick={() => setRefreshToken((value) => value + 1)}>{t("retry")}</Button>
            </p>
          ) : (
            // A text line, not a block skeleton: the summary is one line, so
            // a 128 px placeholder promised more than what arrives.
            <p role="status" className="px-4 py-3 text-sm text-muted-foreground lg:px-5">{t("teamLoading")}</p>
          )
        ) : (
          <>
            {teamPhase === "error" ? (
              // The numbers shown are still true "as of" the time in the last
              // segment, so the list stays and only the refresh failure is named.
              <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-red-50 px-4 py-2 text-sm text-red-900 dark:bg-red-950/25 dark:text-red-100 lg:px-5">
                <WifiOff className="h-4 w-4" />
                <span className="font-medium">{t("teamLoadFailed")}</span>
                <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-0" onClick={() => setRefreshToken((value) => value + 1)}>{t("retry")}</Button>
              </p>
            ) : null}
            {summary.total === 0 ? (
              <p className="px-4 py-3 text-sm font-semibold lg:px-5">{t("noEmployeesTitle")}</p>
            ) : (
              <>
                {/* No separator glyph in the DOM: at 294 px a «·» would wrap to the
                    start of a line. The gap is the separator. No aria-live: the
                    60-second poll would announce the summary every minute. */}
                <p data-testid="mtm-week-team-summary" className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-sm lg:px-5">
                  <span className="text-base font-semibold">
                    {summary.inFieldBasis === "workday"
                      ? t("summaryInField", { count: summary.inField, total: summary.total })
                      : t("summaryOnVisit", { count: summary.inField, total: summary.total })}
                  </span>
                  {summary.openShifts.oldest ? (
                    <span className="font-semibold text-red-700 dark:text-red-300">
                      {t("summaryOpenShifts", {
                        count: summary.openShifts.count,
                        duration: summary.openShifts.oldest.days > 0
                          ? t("workdayOpenDays", { count: summary.openShifts.oldest.days })
                          : t("workdayOpenHours", { count: summary.openShifts.oldest.hours }),
                      })}
                    </span>
                  ) : null}
                  {summary.planned === 0 ? (
                    <span>{t("summaryNoPlans")}</span>
                  ) : summary.withoutPlan > 0 ? (
                    <span>{t("summaryWithoutPlan", { count: summary.withoutPlan })}</span>
                  ) : null}
                  {summary.partial ? <span className="text-amber-700 dark:text-amber-300">{t("summaryScopeTruncated", { count: summary.total })}</span> : null}
                  {summary.visitsTruncated ? <span className="text-amber-700 dark:text-amber-300">{t("teamVisitsTruncated")}</span> : null}
                  {scoped.generatedAt ? <span className="tabular-nums text-muted-foreground">{t("summaryAsOf", { time: shortTime(scoped.generatedAt, timezone) })}</span> : null}
                </p>
                <ul className="border-t border-zinc-200 dark:border-zinc-700">
                  {summary.problems.map((entry) => renderTeamRow(entry, "problem"))}
                  {summary.active.map((entry) => renderTeamRow(entry, "active"))}
                  {summary.idle.length > 0 ? (
                    // Fourteen «Не начат» rows fold into one line; the count lives
                    // only here. Without workforce-hrm "not started" is unprovable,
                    // so the tenant reads "no activity" instead.
                    <li className="border-t border-zinc-200 px-4 py-2 text-sm text-muted-foreground dark:border-zinc-700 lg:px-5">
                      <button type="button" data-testid="mtm-week-team-idle-toggle" className="inline-flex min-h-11 items-center gap-2 md:min-h-0" aria-expanded={idleExpanded} aria-controls="mtm-week-team-idle" onClick={() => setIdleExpanded((value) => !value)}>
                        {scoped.workdayEnabled ? t("teamIdleCollapsed", { count: summary.idle.length }) : t("teamIdleNoActivity", { count: summary.idle.length })}
                        <span className="underline">{idleExpanded ? t("teamIdleHide") : t("teamIdleShow")}</span>
                      </button>
                    </li>
                  ) : null}
                  {idleExpanded && summary.idle.length > 0 ? (
                    <li className="p-0">
                      <ul id="mtm-week-team-idle">
                        {summary.idle.map((entry) => renderTeamRow(entry, "idle"))}
                      </ul>
                    </li>
                  ) : null}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    )
  }

  /**
   * Filters and the refresh button. In the team view the endpoint is always
   * "today" for the tenant, so the period (1/5/7), the date and the arrows
   * controlled nothing and are not drawn; the eyebrow, the description and
   * «Last successful response: —» were instruction, not fact (audit 2026-09-21).
   */
  function renderScopeControls(compact: boolean) {
    const regionField = (
      <label className="grid gap-1 text-sm font-medium">
        <span>{t("region")}</span>
        <select
          className="h-11 w-full rounded-lg border border-zinc-200 bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-zinc-700"
          value={query?.regionId || ""}
          onChange={(event) => query && updateQuery({ ...query, regionId: event.target.value, teamId: "", agentId: "" }, "region")}
          disabled={!query || Boolean(mutatingAction) || phase === "loading" && filters.regions.length === 0}
        >
          <option value="">{t("allRegions")}</option>
          {filters.regions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>
    )
    const teamField = (
      <label className="grid gap-1 text-sm font-medium">
        <span>{t("team")}</span>
        <select
          className="h-11 w-full rounded-lg border border-zinc-200 bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-zinc-700"
          value={query?.teamId || ""}
          onChange={(event) => query && updateQuery({ ...query, teamId: event.target.value, agentId: "" }, "team")}
          disabled={!query || Boolean(mutatingAction) || phase === "loading" && filters.teams.length === 0}
        >
          <option value="">{t("allTeams")}</option>
          {filters.teams.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>
    )
    const employeeField = (
      <label className="grid gap-1 text-sm font-medium">
        <span>{t("employee")}</span>
        <select
          className="h-11 w-full rounded-lg border border-zinc-200 bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-zinc-700"
          value={effectiveAgentId}
          onChange={(event) => query && updateQuery({ ...query, agentId: event.target.value })}
          disabled={!query || Boolean(mutatingAction) || phase === "loading" && displayedAgentOptions.length === 0}
        >
          <option value="">{t("chooseEmployee")}</option>
          {displayedAgentOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>
    )
    const refreshButton = (
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-11 w-11"
        onClick={() => !inFlightRef.current && setRefreshToken((value) => value + 1)}
        disabled={!query || phase === "loading" || phase === "refreshing" || Boolean(mutatingAction)}
        aria-label={t("refresh")}
        title={t("refresh")}
      >
        <RefreshCw className={cn("h-4 w-4", phase === "refreshing" && "animate-spin motion-reduce:animate-none")} />
      </Button>
    )
    if (compact) {
      // The section's h2 is rendered by the caller, above the team summary,
      // so a screen reader's heading list keeps the section before its content.
      return (
        <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-700 lg:px-5">
          <div className="flex items-end gap-3">
            <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-3">
              {regionField}
              {teamField}
              {employeeField}
            </div>
            {refreshButton}
          </div>
        </div>
      )
    }
    return (
      <div className="px-4 py-5 lg:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              <CalendarDays className="h-4 w-4" />{t("eyebrow")}
            </div>
            <h2 id="operational-week-title" className="mt-1 text-xl font-semibold tracking-tight">{t("title")}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {facts ? (
              <div className="text-right text-xs text-muted-foreground">
                <p>{t("lastSuccessfulResponse")}</p>
                <p className="font-medium tabular-nums text-foreground">
                  {facts.generatedAt ? formatTenantTimestamp(facts.generatedAt, locale, facts.timezone, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                </p>
              </div>
            ) : null}
            {refreshButton}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(12rem,1.25fr)_auto]">
          {regionField}
          {teamField}
          {employeeField}
          <div className="grid gap-1">
            <span className="text-sm font-medium">{t("period")}</span>
            <div className="flex min-h-11 items-center rounded-full border border-zinc-200 p-1 dark:border-zinc-700" role="group" aria-label={t("period") }>
              {([1, 5, 7] as WeekDays[]).map((days) => (
                <button
                  key={days}
                  type="button"
                  aria-pressed={query?.days === days}
                  disabled={Boolean(mutatingAction)}
                  className={cn("min-h-11 min-w-11 rounded-full px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40", query?.days === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
                  onClick={() => query && updateQuery({ ...query, days, day: query.date })}
                >
                  {t("days", { count: days })}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="grid gap-1 text-sm font-medium">
            <span>{t("anchorDate")}</span>
            <input
              type="date"
              className="h-11 rounded-lg border border-zinc-200 bg-card px-3 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-zinc-700"
              value={query?.date || ""}
              disabled={Boolean(mutatingAction)}
              onChange={(event) => query && updateQuery({ ...query, date: validDateKey(event.target.value), day: validDateKey(event.target.value) })}
            />
          </label>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <Button type="button" variant="outline" size="icon" className="h-11 w-11" disabled={Boolean(mutatingAction)} onClick={() => movePeriod(-1)} aria-label={t("previousPeriod")}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-36 text-center text-sm font-medium tabular-nums">{periodLabel}</span>
            <Button type="button" variant="outline" size="icon" className="h-11 w-11" disabled={Boolean(mutatingAction)} onClick={() => movePeriod(1)} aria-label={t("nextPeriod")}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section data-testid="mtm-operational-week" aria-labelledby="operational-week-title" className="border-y border-zinc-200 bg-card dark:border-zinc-700">
      {/* Audit 2026-09-21: the first fact stands above any filter or heading.
          The section's own heading stays first for screen readers only. */}
      {teamLayout ? <h2 id="operational-week-title" className="sr-only">{t("title")}</h2> : null}
      {teamLayout && !bootstrapFailed ? renderTeamToday() : null}
      {renderScopeControls(teamLayout)}

      {(phase === "offline" || phase === "snapshot") && cachedSnapshot ? (
        <div className={cn("flex flex-col gap-2 border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between", snapshotExpired ? "bg-red-50 text-red-900 dark:bg-red-950/25 dark:text-red-100" : "bg-amber-50 text-amber-900 dark:bg-amber-950/25 dark:text-amber-100")} role="status">
          <span className="inline-flex items-center gap-2 font-medium">{phase === "snapshot" ? <AlertTriangle className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}{snapshotExpired ? t("expiredSnapshot") : phase === "snapshot" ? t("savedSnapshot") : t("offlineSnapshot")}</span>
          <span className="grid gap-0.5 text-xs sm:text-right">
            <span>{t("savedAt", { date: formatTenantTimestamp(cachedSnapshot.cachedAt, locale, facts?.timezone || "UTC", { dateStyle: "medium", timeStyle: "short" }) })}</span>
            <span>{t("expiresAt", { date: formatTenantTimestamp(cachedSnapshot.expiresAt, locale, facts?.timezone || "UTC", { dateStyle: "medium", timeStyle: "short" }) })}</span>
          </span>
        </div>
      ) : null}
      {facts && cacheWriteFailed && phase !== "offline" ? (
        <div className="flex flex-col gap-1 border-t border-zinc-200 bg-muted/35 px-4 py-3 text-sm dark:border-zinc-700" role="status">
          <span className="inline-flex items-center gap-2 font-medium"><CloudOff className="h-4 w-4 text-muted-foreground" />{t("offlineCopyNotSaved")}</span>
          <span className="text-xs text-muted-foreground">{t("offlineCopyNotSavedHint")}</span>
        </div>
      ) : null}
      {facts && facts.contract.completeness !== "COMPLETE" ? (
        <div className="border-t border-zinc-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-zinc-700 dark:bg-amber-950/25 dark:text-amber-100" role="status">
          <span className="inline-flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />{t("partialData")}</span>
          <p className="mt-1 text-xs">{t("partialDataHint")}</p>
        </div>
      ) : null}
      {facts && phase === "rateLimited" ? (
        <div className="flex flex-col gap-2 border-t border-zinc-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-zinc-700 dark:bg-amber-950/25 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between" role="status">
          <span className="inline-flex items-center gap-2 font-medium"><Clock3 className="h-4 w-4" />{t("rateLimitedTitle")}</span>
          <span className="text-xs">{t("rateLimitedHint")}</span>
        </div>
      ) : null}
      {facts && phase === "error" ? (
        <div className="flex flex-col gap-2 border-t border-zinc-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-zinc-700 dark:bg-red-950/25 dark:text-red-100 sm:flex-row sm:items-center sm:justify-between" role="status">
          <span className="inline-flex items-center gap-2 font-medium"><WifiOff className="h-4 w-4" />{t("refreshFailedSnapshot")}</span>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setRefreshToken((value) => value + 1)}>{t("retry")}</Button>
        </div>
      ) : null}
      {!facts && bootstrapPartial ? (
        <div className="border-t border-zinc-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-zinc-700 dark:bg-amber-950/25 dark:text-amber-100" role="status">
          <span className="inline-flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />{t("scopeListLimited")}</span>
        </div>
      ) : null}

      {facts ? (
        <>
          <div className={cn("grid border-t border-zinc-200 dark:border-zinc-700", facts.workdayCapability.enabled && "lg:grid-cols-[minmax(0,1fr)_minmax(18rem,auto)]")}>
            <div className="flex min-w-0 items-center gap-3 px-4 py-3 lg:px-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{facts.selectedAgent.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{facts.selectedAgent.name}</p>
                <p className="truncate text-xs text-muted-foreground">{[facts.selectedAgent.teamName, facts.selectedAgent.regionName].filter(Boolean).join(" · ") || t("scopeConfirmed")}</p>
              </div>
            </div>
            {facts.workdayCapability.enabled ? <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700 lg:border-l lg:border-t-0 lg:px-5">
              <div className="flex flex-wrap items-center gap-2">
                {facts.workdayCapability.canMutateSelf && facts.workdayCapability.availableActions.length ? facts.workdayCapability.availableActions.map((action) => (
                  <Button key={action} type="button" variant={action === "FINISH" ? "outline" : "default"} className="min-h-11" disabled={Boolean(mutatingAction) || !workdayMutationLive || (action === "FINISH" && confirmingFinish)} aria-expanded={action === "FINISH" ? confirmingFinish : undefined} onClick={() => action === "FINISH" ? setConfirmingFinish(true) : void runWorkdayAction(action)}>
                    {mutatingAction === action ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : action === "START" || action === "RESUME" ? <PlayCircle className="h-4 w-4" /> : action === "PAUSE" ? <PauseCircle className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    {actionLabel(action)}
                  </Button>
                )) : renderManagerWorkdayControls() ?? <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><ShieldAlert className="h-4 w-4" />{facts.workdayCapability.canMutateSelf ? t("workdayNoActions") : t("workdayReadOnly")}</span>}
              </div>
              {confirmingFinish ? (
                <div className="mt-3 border border-red-200 bg-red-50 p-3 text-sm text-red-950 dark:border-red-900 dark:bg-red-950/25 dark:text-red-100" role="alert">
                  <p className="font-semibold">{t("finishConfirmTitle")}</p>
                  <p className="mt-1 text-xs leading-5">{t("finishConfirmHint")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="destructive" className="min-h-11" disabled={Boolean(mutatingAction) || !workdayMutationLive} onClick={() => void runWorkdayAction("FINISH")}>{t("finishConfirmAction")}</Button>
                    <Button type="button" variant="outline" className="min-h-11" disabled={Boolean(mutatingAction)} onClick={() => setConfirmingFinish(false)}>{t("finishConfirmCancel")}</Button>
                  </div>
                </div>
              ) : null}
              {facts.workdayCapability.canMutateSelf ? <p className="mt-2 text-xs text-muted-foreground">{workdayMutationLive ? facts.workdayCapability.requiresPriorDayClosure ? t("workdayActionsPrior") : t("workdayActionsToday") : t("workdaySnapshotReadOnly")}</p> : null}
              {workdayError ? <p className="mt-2 text-xs text-red-700 dark:text-red-300" role="alert">{workdayError}</p> : null}
            </div> : null}
          </div>

          {facts.workdayCapability.enabled && leftOpenWorkday && !facts.workdayCapability.canMutateSelf ? (
            <div className="border-t border-zinc-200 bg-red-50 px-4 py-3 text-sm text-red-950 dark:border-zinc-700 dark:bg-red-950/25 dark:text-red-100" role="status" data-testid="mtm-week-workday-left-open">
              <p className="inline-flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{leftOpenLabel(leftOpenWorkday, facts.timezone)}</p>
              <p className="mt-1 text-xs leading-5">{t("workdayLeftOpenHint")}</p>
            </div>
          ) : null}
          {/* The close/continue instruction is for the agent who can act on it. */}
          {facts.workdayCapability.enabled && facts.workdayCapability.canMutateSelf && facts.workdayCapability.requiresPriorDayClosure ? (
            <div className="border-t border-zinc-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-zinc-700 dark:bg-amber-950/25 dark:text-amber-100" role="status">
              <p className="inline-flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{t("priorWorkdayTitle")}</p>
              <p className="mt-1 text-xs leading-5">{t("priorWorkdayHint", {
                date: facts.workdayCapability.date ? formatCalendarDay(facts.workdayCapability.date, locale, { dateStyle: "medium" }) : "—",
                time: formatTenantTimestamp(facts.workdayCapability.activeStartedAt, locale, facts.timezone, { timeStyle: "short" }),
              })}</p>
            </div>
          ) : null}

          {selectedDay ? (
            <div className={cn("grid border-t border-zinc-200 bg-muted/20 dark:border-zinc-700 sm:grid-cols-2", facts.workdayCapability.enabled ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
              {facts.workdayCapability.enabled ? (() => {
                const workday = dayWorkdayPresentation(selectedDay)
                const WorkdayIcon = workday.icon
                return <div className="px-4 py-3 lg:px-5"><p className="text-xs text-muted-foreground">{t("workdayState")}</p><p className={cn("mt-1 inline-flex items-center gap-1.5 text-sm font-medium", workday.className)}><WorkdayIcon className="h-4 w-4" />{workday.label}</p></div>
              })() : null}
              {(() => {
                const gps = gpsPresentation(facts.gps)
                const GpsIcon = gps.icon
                return <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700 sm:border-l sm:border-t-0 lg:px-5"><p className="text-xs text-muted-foreground">{t("gpsFreshness")}</p><p className={cn("mt-1 inline-flex items-center gap-1.5 text-sm font-medium", gps.className)}><GpsIcon className="h-4 w-4" />{gps.label}</p></div>
              })()}
              <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700 lg:border-l lg:border-t-0 lg:px-5"><p className="text-xs text-muted-foreground">{t("lastCoordinate")}</p><p className="mt-1 text-sm font-medium tabular-nums">{formatTenantTimestamp(facts.gps.recordedAt, locale, facts.timezone, { dateStyle: "medium", timeStyle: "short" })}</p></div>
              <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700 lg:border-l lg:border-t-0 lg:px-5">
                <p className="text-xs text-muted-foreground">{t("locationEvidence")}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  <span className="inline-flex items-center gap-1"><Crosshair className="h-3.5 w-3.5" />{facts.gps.accuracy === null ? "—" : t("accuracyMeters", { value: Math.round(facts.gps.accuracy) })}</span>
                  <span className="inline-flex items-center gap-1"><BatteryMedium className="h-3.5 w-3.5" />{facts.gps.battery === null ? "—" : `${Math.round(facts.gps.battery)}%`}</span>
                </div>
                {gpsReasonLabel(facts.gps.reason) ? <p className="mt-1 text-xs text-muted-foreground">{gpsReasonLabel(facts.gps.reason)}</p> : null}
                <Link href={withReturnTo(`/mtm/map?mode=history&agentId=${encodeURIComponent(effectiveAgentId)}&date=${encodeURIComponent(selectedDay.date)}`, returnPath(query!, effectiveAgentId, selectedDay.date))} className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary hover:underline md:min-h-0">{t("openGpsHistory")}<ArrowUpRight className="h-3 w-3" /></Link>
              </div>
            </div>
          ) : null}

          {gpsNeedsRecovery && facts ? (
            <section
              className="flex flex-col gap-3 border-t border-amber-200 bg-amber-50 px-4 py-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between lg:px-5"
              role="status"
              data-testid="mtm-operational-week-gps-recovery"
            >
              <div className="min-w-0">
                <p className="inline-flex items-center gap-2 text-sm font-semibold">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  {t(facts.gps.reason === "PERMISSION_NOT_GRANTED" ? "gpsRecovery.permissionTitle" : "gpsRecovery.noLocationTitle")}
                </p>
                <p className="mt-1 max-w-3xl text-xs leading-5">
                  {t(facts.gps.reason === "PERMISSION_NOT_GRANTED" ? "gpsRecovery.permissionHint" : "gpsRecovery.noLocationHint")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {selectedGpsHistoryHref ? (
                  <Button asChild variant="outline" className="min-h-11 bg-card/80">
                    <Link href={selectedGpsHistoryHref}>{t("openGpsHistory")}<ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 bg-card/80"
                  disabled={phase === "loading" || phase === "refreshing" || Boolean(mutatingAction)}
                  onClick={() => !inFlightRef.current && setRefreshToken((value) => value + 1)}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />{t("gpsRecovery.refresh")}
                </Button>
              </div>
            </section>
          ) : null}

          <div className="grid border-t border-zinc-200 dark:border-zinc-700 min-[100rem]:grid-cols-[minmax(0,1fr)_20rem]">
            <aside className="md:max-[100rem]:grid md:max-[100rem]:grid-cols-2 min-[100rem]:hidden" aria-label={t("needsAttention") }>
              {renderAttentionRailContent("compact")}
            </aside>

            <div className="min-w-0 border-t border-zinc-200 dark:border-zinc-700 min-[100rem]:border-t-0">
              {compactWeekProjection ? <div>
                <div className="flex gap-1 overflow-x-auto px-3 py-2" role="group" aria-label={t("chooseDay") }>
                  {facts.days.map((day) => (
                    <button key={day.date} type="button" aria-pressed={selectedDay?.date === day.date} onClick={() => chooseDay(day.date)} className={cn("min-h-11 min-w-[4.5rem] shrink-0 rounded-full px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40", selectedDay?.date === day.date ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                      <span className="block text-[11px] uppercase">{formatCalendarDay(day.date, locale, { weekday: "short" })}</span>
                      <span className="block tabular-nums">{formatCalendarDay(day.date, locale, { day: "numeric", month: "short" })}</span>
                    </button>
                  ))}
                </div>
                {selectedDay ? renderDay(selectedDay, true) : null}
              </div> : null}

              {!compactWeekProjection ? <div>
                <div className="overflow-x-auto">
                  <div
                    className={cn("grid", query?.days === 5 ? "min-w-[900px] grid-cols-5" : query?.days === 1 ? "grid-cols-1" : "min-w-[1260px] grid-cols-7")}
                  >
                    {facts.days.map((day) => renderDay(day))}
                  </div>
                </div>
              </div> : null}
            </div>

            <aside className="hidden min-w-0 min-[100rem]:block min-[100rem]:border-l" aria-label={t("needsAttention") }>
              {renderAttentionRailContent("desktop")}
            </aside>
          </div>
        </>
      ) : (phase === "loading" || phase === "idle") && !teamLayout ? (
        <div className="border-t border-zinc-200 px-4 py-8 dark:border-zinc-700" role="status" aria-live="polite">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-44 animate-pulse bg-muted/60 motion-reduce:animate-none" />)}
          </div>
          <p className="mt-3 text-center text-sm text-muted-foreground">{query?.agentId ? t("loadingWeek") : t("loadingScope")}</p>
        </div>
      ) : phase === "permission" ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-t border-zinc-200 px-4 py-8 text-center dark:border-zinc-700" role="alert">
          <ShieldAlert className="h-7 w-7 text-red-600" /><h3 className="text-base font-semibold">{t("permissionTitle")}</h3><p className="max-w-lg text-sm text-muted-foreground">{t("permissionHint")}</p>
        </div>
      ) : phase === "notFound" ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-t border-zinc-200 px-4 py-8 text-center dark:border-zinc-700" role="alert">
          <UserRound className="h-7 w-7 text-muted-foreground" /><h3 className="text-base font-semibold">{t("employeeUnavailableTitle")}</h3><p className="max-w-lg text-sm text-muted-foreground">{t("employeeUnavailableHint")}</p>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => query && updateQuery({ ...query, agentId: "" })}>{t("chooseAnotherEmployee")}</Button>
        </div>
      ) : phase === "rateLimited" ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-t border-zinc-200 px-4 py-8 text-center dark:border-zinc-700" role="alert">
          <Clock3 className="h-7 w-7 text-amber-600" /><h3 className="text-base font-semibold">{t("rateLimitedTitle")}</h3><p className="max-w-lg text-sm text-muted-foreground">{t("rateLimitedHint")}</p>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setRefreshToken((value) => value + 1)}>{t("retry")}</Button>
        </div>
      ) : phase === "error" ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-t border-zinc-200 px-4 py-8 text-center dark:border-zinc-700" role="alert">
          <WifiOff className="h-7 w-7 text-red-600" /><h3 className="text-base font-semibold">{t("loadFailedTitle")}</h3><p className="max-w-lg text-sm text-muted-foreground">{t("loadFailedHint")}</p>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setRefreshToken((value) => value + 1)}>{t("retry")}</Button>
        </div>
      ) : !teamLayout ? (
        <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-t border-zinc-200 px-4 py-8 text-center dark:border-zinc-700" role="status">
          <UserRound className="h-7 w-7 text-muted-foreground" /><h3 className="text-base font-semibold">{displayedAgentOptions.length ? t("chooseEmployeeTitle") : t("noEmployeesTitle")}</h3><p className="max-w-lg text-sm text-muted-foreground">{displayedAgentOptions.length ? t("chooseEmployeeHint") : t("noEmployeesHint")}</p>
        </div>
      ) : null}
      <Dialog open={Boolean(cancellationTarget)} onOpenChange={(open) => {
        if (!open && !planMutationId) {
          setCancellationTarget(null)
          setCancellationDetails("")
          setCancellationReasonCode("CUSTOMER_REQUEST")
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancellationDialogTitle")}</DialogTitle>
            <DialogDescription>
              {cancellationTarget?.point.organizationName || cancellationTarget?.point.contactName || t("unknownOrganization")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="operational-week-cancellation-reason">{t("cancellationReasonLabel")}</Label>
              <Select id="operational-week-cancellation-reason" value={cancellationReasonCode} onChange={(event) => setCancellationReasonCode(event.target.value)} disabled={Boolean(planMutationId)}>
                {CANCELLATION_REASONS.map((reason) => (
                  <option key={reason} value={reason}>{t(`cancellationReason.${reason}` as never)}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="operational-week-cancellation-details">{t("cancellationDetailsLabel")}</Label>
              <Textarea
                id="operational-week-cancellation-details"
                value={cancellationDetails}
                onChange={(event) => setCancellationDetails(event.target.value)}
                rows={4}
                maxLength={1000}
                placeholder={t("cancellationDetailsPlaceholder")}
                disabled={Boolean(planMutationId)}
              />
            </div>
            <p className="bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">{t("cancellationRequestEffect")}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={Boolean(planMutationId)} onClick={() => {
              setCancellationTarget(null)
              setCancellationDetails("")
              setCancellationReasonCode("CUSTOMER_REQUEST")
            }}>{t("cancelDialog")}</Button>
            <Button type="button" disabled={Boolean(planMutationId)} onClick={() => void submitCancellationRequest()}>
              {planMutationId?.startsWith("request:") ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
              {t("sendCancellationRequest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(managerWorkdayTarget)} onOpenChange={(open) => {
        if (!open) closeManagerWorkdayDialog()
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(managerWorkdayTarget?.kind === "undoReopen" ? "managerWorkday.undoTitle" : "managerWorkday.reopenTitle")}</DialogTitle>
            <DialogDescription>{facts?.selectedAgent.name || "—"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4" data-testid="mtm-week-workday-manager-dialog">
            <p className="bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
              {t(managerWorkdayTarget?.kind === "undoReopen" ? "managerWorkday.undoConsequence" : "managerWorkday.reopenConsequence")}
              {" "}{t("managerWorkday.historyNote")}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="operational-week-manager-workday-reason">{t("managerWorkday.reasonLabel")}</Label>
              <Textarea
                id="operational-week-manager-workday-reason"
                value={managerWorkdayReason}
                onChange={(event) => setManagerWorkdayReason(event.target.value)}
                rows={4}
                maxLength={WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH}
                placeholder={t("managerWorkday.reasonPlaceholder")}
                disabled={managerWorkdayPending}
                required
                data-dialog-initial-focus
                aria-invalid={managerWorkdayReason.length > 0 && !managerWorkdayReasonValid}
                aria-describedby="operational-week-manager-workday-reason-hint"
              />
              <p id="operational-week-manager-workday-reason-hint" className="text-xs text-muted-foreground">
                {t("managerWorkday.reasonHint", {
                  min: WORKFORCE_WORKDAY_REOPEN_REASON_MIN_LENGTH,
                  max: WORKFORCE_WORKDAY_REOPEN_REASON_MAX_LENGTH,
                  count: managerWorkdayReasonLength,
                })}
              </p>
            </div>
            {facts?.managerWorkdayActions?.mfaEnrolled === false ? (
              <p className="inline-flex items-start gap-2 text-xs text-muted-foreground" data-testid="mtm-week-workday-mfa-recommended">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{t("managerWorkday.mfaRecommended")}
              </p>
            ) : null}
            {managerWorkdayError ? (
              <p className="text-sm text-red-700 dark:text-red-300" role="alert" data-testid="mtm-week-workday-manager-error">{managerWorkdayError.message}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={managerWorkdayPending} onClick={closeManagerWorkdayDialog}>{t("cancelDialog")}</Button>
            <Button
              type="button"
              disabled={managerWorkdayPending || !managerWorkdayReasonValid || Boolean(managerWorkdayError?.final)}
              onClick={() => void submitManagerWorkdayAction()}
            >
              {managerWorkdayPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
              {t(managerWorkdayTarget?.kind === "undoReopen" ? "managerWorkday.confirmUndo" : "managerWorkday.confirmReopen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
