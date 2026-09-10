"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LockKeyhole,
  Loader2,
  MapPin,
  PencilLine,
  Plus,
  RotateCcw,
  Send,
  SlidersHorizontal,
  UserRound,
  Users,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/format-date"
import {
  RouteBuilderInlineAssignmentPanel,
  type RouteBuilderInlineAssignable,
} from "@/components/mtm/route-builder-inline-assignment-panel"
import { dateInputValueInTimezone, formatInTimezone, localDateTimeToUtc } from "@/lib/timezone"
import {
  MTM_ROUTE_TIME_SLOTS,
  normalizeMtmRouteTimeSlot,
} from "@/lib/mtm/route-time-slots"
import type { MtmRouteAssignment, MtmRouteCustomer, MtmRoutePoint, MtmRouteRecord } from "@/components/mtm/route-types"
import {
  coerceMtmRouteTargetTypes,
  routeTargetLabel,
  type MtmRouteTargetType,
} from "@/lib/mtm/route-target-types"
import type { MtmRoutePlannerContext, MtmRoutePlannerFilters } from "@/lib/mtm/route-planner-context"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { latestRouteDraft, routeDraftStorageKey, routeDraftStorageKeys } from "@/lib/mtm/route-draft-storage"

type Agent = { id: string; name: string; role?: string }
type Customer = MtmRouteCustomer
type Stop = {
  customerId: string
  contactId?: string | null
  customer: Customer
  contact?: {
    id: string
    displayName: string
    specialtyName?: string | null
  } | null
  status?: MtmRoutePoint["status"]
  plannedTime?: string | null
}
type CandidateDirection = MtmRoutePlannerContext["direction"] & string
type CandidateSort = "NAME" | "PRIORITY" | "LAST_VISIT" | "COVERAGE_GAP"
type CandidateFilterKey = keyof CandidateFilters
type CandidateFilters = MtmRoutePlannerFilters
type CandidateCoverage = {
  groupKey: string
  requiredCoverage: string
  actualMoi: string
  target: string
  actualCoverage: string
  uncoveredMoi: string
  explanation: { summary: { ru: string; az: string; en: string } }
}
type CandidateAvailability = {
  source:
    | "DIRECT_CONTACT_ASSIGNMENT"
    | "WORKPLACE_ASSIGNMENT"
    | "ORGANIZATION_ASSIGNMENT"
    | "ACTIVE_CATALOG"
  validFrom: string | null
  validThrough: string | null
}
type CandidateSelectionScope = {
  mode: "AGENT_ASSIGNMENTS" | "ACTIVE_CATALOG"
  activeOnly: true
  assignmentRequired: boolean
  agentId: string
  effectiveOn: string
}
type Candidate = {
  id: string
  kind: CandidateDirection
  customerId: string
  contactId: string | null
  name: string
  code: string | null
  category: string
  specialtyCode: string | null
  specialtyName: string | null
  psychotype: string | null
  score: string | null
  scoreFormulaVersion: string | null
  lastVisitAt: string | null
  plannedRoute: { id: string; date: string; status: string } | null
  availability: CandidateAvailability
  coverage: CandidateCoverage | null
  customer: Customer & {
    objectType?: string | null
    organizationKind?: string | null
    region?: string | null
    administrativeDistrict?: string | null
    locality?: string | null
    cityDistrict?: string | null
  }
}
type CoveragePreview = {
  available: boolean
  state: string
  period?: { start: string; end: string }
  policy?: { version: number; approvalReference: string | null }
  snapshot?: { id: string; frozenAt: string | null }
  groups?: Array<{
    key: string
    labels?: { ru: string; az: string; en: string }
    requiredCoverage: string
    actualCoverage: string
    uncoveredMoi: string
  }>
}
type MeetingAvailability = {
  customerId: string
  contactId: string | null
  plannedTime: string
  busyAgents: Array<{ id: string; name: string }>
  meetings: Array<{
    routeId: string
    agents: Array<{ id: string; name: string }>
    sameContact: boolean
  }>
}
type MeetingAvailabilityNotice = {
  kind: "same-agent" | "colleague"
  customerName: string
  contactName: string | null
  plannedTime: string
  agents: Array<{ id: string; name: string }>
  sameContact: boolean
}
type CandidateFacets = {
  region: string[]
  administrativeDistrict: string[]
  objectType: string[]
  organization: Array<{ id: string; name: string }>
  specialtyCode: string[]
  psychotype: string[]
}
type CandidatePagination = {
  schemaVersion: 1
  mode: "KEYSET" | "LEGACY_CAP"
  supported: boolean
  sortIntegrity: "FULL" | "PARTIAL"
  limit: number
  hasMore: boolean
  nextCursor: string | null
  reason?: string
}

type RouteBuilderDraftForm = {
  name: string
  date: string
  notes: string
  primaryAgentId: string
  participantIds: string[]
  stops: Stop[]
  direction: CandidateDirection
  wizardStep: 1 | 2 | 3
}

type StoredRouteBuilderDraft = {
  schemaVersion: 1
  routeId: string | null
  routeVersion: number | null
  savedAt: string
  form: RouteBuilderDraftForm
}

const emptyCandidateFacets: CandidateFacets = {
  region: [],
  administrativeDistrict: [],
  objectType: [],
  organization: [],
  specialtyCode: [],
  psychotype: [],
}

const emptyCandidateFilters: CandidateFilters = {
  region: "",
  administrativeDistrict: "",
  customerId: "",
  specialtyCode: "",
  psychotype: "",
}

const candidateDisplayPageSize = 8
const candidateResultPageSize = 50

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseCandidatePagination(value: unknown): CandidatePagination | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  const mode = value.mode
  const supported = value.supported
  const sortIntegrity = value.sortIntegrity
  const limit = value.limit
  const hasMore = value.hasMore
  const nextCursor = value.nextCursor
  const reason = value.reason
  if ((mode !== "KEYSET" && mode !== "LEGACY_CAP") || typeof supported !== "boolean") return null
  if ((sortIntegrity !== "FULL" && sortIntegrity !== "PARTIAL") || typeof limit !== "number" || !Number.isInteger(limit)) return null
  if (typeof hasMore !== "boolean" || !(nextCursor === null || typeof nextCursor === "string")) return null
  if (!(reason === undefined || typeof reason === "string")) return null
  return {
    schemaVersion: 1,
    mode,
    supported,
    sortIntegrity,
    limit,
    hasMore,
    nextCursor,
    ...(typeof reason === "string" ? { reason } : {}),
  }
}

function parseStoredRouteBuilderDraft(raw: string): StoredRouteBuilderDraft | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.form)) return null
    const form = value.form
    const direction = form.direction
    const wizardStep = form.wizardStep
    if (
      typeof form.name !== "string"
      || typeof form.date !== "string"
      || typeof form.notes !== "string"
      || typeof form.primaryAgentId !== "string"
      || !Array.isArray(form.participantIds)
      || !form.participantIds.every((id) => typeof id === "string")
      || !Array.isArray(form.stops)
      || !["DOCTOR", "PHARMACY", "ORGANIZATION"].includes(String(direction))
      || ![1, 2, 3].includes(Number(wizardStep))
      || typeof value.savedAt !== "string"
      || Number.isNaN(new Date(value.savedAt).getTime())
      || !(value.routeId === null || typeof value.routeId === "string")
      || !(value.routeVersion === null || (typeof value.routeVersion === "number" && Number.isInteger(value.routeVersion)))
    ) return null

    const stops = form.stops.flatMap((entry): Stop[] => {
      if (!isRecord(entry) || typeof entry.customerId !== "string" || !isRecord(entry.customer)) return []
      if (typeof entry.customer.id !== "string" || typeof entry.customer.name !== "string") return []
      if (!(entry.contactId === null || entry.contactId === undefined || typeof entry.contactId === "string")) return []
      if (!(entry.plannedTime === null || entry.plannedTime === undefined || typeof entry.plannedTime === "string")) return []
      if (!(entry.contact === null || entry.contact === undefined || (isRecord(entry.contact) && typeof entry.contact.id === "string" && typeof entry.contact.displayName === "string"))) return []
      const plannedTime = typeof entry.plannedTime === "string"
        ? normalizeMtmRouteTimeSlot(entry.plannedTime)
        : null
      return [{
        customerId: entry.customerId,
        contactId: typeof entry.contactId === "string" ? entry.contactId : null,
        customer: entry.customer as unknown as Customer,
        contact: entry.contact ? entry.contact as Stop["contact"] : null,
        status: typeof entry.status === "string" ? (entry.status as Stop["status"]) : undefined,
        plannedTime,
      }]
    })
    if (stops.length !== form.stops.length) return null

    return {
      schemaVersion: 1,
      routeId: value.routeId,
      routeVersion: value.routeVersion,
      savedAt: value.savedAt,
      form: {
        name: form.name,
        date: form.date,
        notes: form.notes,
        primaryAgentId: form.primaryAgentId,
        participantIds: form.participantIds as string[],
        stops,
        direction: direction as CandidateDirection,
        wizardStep: Number(wizardStep) as 1 | 2 | 3,
      },
    }
  } catch {
    return null
  }
}

function routeBuilderDraftSignature(form: RouteBuilderDraftForm): string {
  return JSON.stringify(form)
}

function planningDateLabel(value: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return formatDate(new Date(`${value}T12:00:00Z`), locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

function assignmentDateLabel(value: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return formatDate(new Date(`${value}T12:00:00Z`), locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

function stopKey(input: { customerId: string; contactId?: string | null }): string {
  return input.contactId ? `${input.customerId}:${input.contactId}` : input.customerId
}

function meetingAvailabilityKey(customerId: string, contactId: string | null | undefined, plannedTime: string) {
  return `${customerId}:${contactId ?? ""}:${plannedTime}`
}

function CandidateFacetSelect({
  label,
  value,
  values,
  allLabel,
  disabled = false,
  onChange,
}: {
  label: string
  value: string
  values: string[]
  allLabel: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-xs">
      <span className="block text-muted-foreground">{label}</span>
      <Select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 text-xs lg:h-9" disabled={disabled}>
        <option value="">{allLabel}</option>
        {values.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
      </Select>
    </label>
  )
}

function CandidateOrganizationSelect({
  label,
  value,
  values,
  allLabel,
  onChange,
}: {
  label: string
  value: string
  values: Array<{ id: string; name: string }>
  allLabel: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-xs">
      <span className="block text-muted-foreground">{label}</span>
      <Select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 text-xs lg:h-9">
        <option value="">{allLabel}</option>
        {values.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </Select>
    </label>
  )
}

interface RouteBuilderProps {
  open: boolean
  initialData?: MtmRouteRecord
  initialDate?: string
  initialAgentId?: string
  initialDirection?: CandidateDirection
  initialPlannerContext?: MtmRoutePlannerContext
  initialCustomerId?: string | null
  initialContactId?: string | null
  orgId?: string
  viewerKey?: string
  timezone: string
  canPublish: boolean
  canManageAssignments: boolean
  canRequestCustomer: boolean
  onClose: () => void
  onSaved: (routeId?: string) => void | Promise<void>
  onPlannerContextChange?: (context: MtmRoutePlannerContext) => void
  onOpenExisting: (routeId: string) => void
  onRequestCustomer: (routeId?: string) => void
}

export function MtmRouteBuilder({
  open,
  initialData,
  initialDate,
  initialAgentId,
  initialDirection,
  initialPlannerContext,
  initialCustomerId,
  initialContactId,
  orgId,
  viewerKey,
  timezone,
  canPublish,
  canManageAssignments,
  canRequestCustomer,
  onClose,
  onSaved,
  onPlannerContextChange,
  onOpenExisting,
  onRequestCustomer,
}: RouteBuilderProps) {
  const t = useTranslations("mtmRoutesPage")
  const statusT = useTranslations("mtmStatus")
  const locale = useLocale()
  const [name, setName] = useState("")
  const [date, setDate] = useState("")
  const [notes, setNotes] = useState("")
  const [primaryAgentId, setPrimaryAgentId] = useState("")
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [stops, setStops] = useState<Stop[]>([])
  /** Asked before a non-empty selection is thrown away (audit C8). */
  const [discardOpen, setDiscardOpen] = useState(false)

  /**
   * Closing with customers chosen used to lose them silently.
   *
   * Verified on production 2026-09-10: one customer selected, "Ləğv et", the
   * planner gone, no dialog. Autosave restores a draft afterwards, which is
   * why this was survivable rather than fatal — but the audit already caught
   * the restore bringing back an older draft, so "it recovers" is not an
   * argument for not asking. An empty planner still closes on one press.
   */
  const requestClose = () => {
    if (stops.length > 0) {
      setDiscardOpen(true)
      return
    }
    onClose()
  }
  const [agents, setAgents] = useState<Agent[]>([])
  const [candidateResults, setCandidateResults] = useState<Candidate[]>([])
  const [candidateFacets, setCandidateFacets] = useState<CandidateFacets>(emptyCandidateFacets)
  const [candidateRegionOptions, setCandidateRegionOptions] = useState<string[]>([])
  const [candidateDistrictOptions, setCandidateDistrictOptions] = useState<string[]>([])
  const [candidateOrganizationOptions, setCandidateOrganizationOptions] = useState<Array<{ id: string; name: string }>>([])
  const [candidateTotal, setCandidateTotal] = useState(0)
  const [candidateLimited, setCandidateLimited] = useState(false)
  const [candidatePagination, setCandidatePagination] = useState<CandidatePagination | null>(null)
  const [candidatePageCursors, setCandidatePageCursors] = useState<Array<string | null>>([null])
  const [candidatePageIndex, setCandidatePageIndex] = useState(0)
  const [candidatePageRetryVersion, setCandidatePageRetryVersion] = useState(0)
  const [candidatePageTransitioning, setCandidatePageTransitioning] = useState(false)
  const [candidateSelectionScope, setCandidateSelectionScope] = useState<CandidateSelectionScope | null>(null)
  const [coveragePreview, setCoveragePreview] = useState<CoveragePreview | null>(null)
  const [direction, setDirection] = useState<CandidateDirection>("ORGANIZATION")
  const [routeTargetTypes, setRouteTargetTypes] = useState<MtmRouteTargetType[]>(() => coerceMtmRouteTargetTypes(null))
  const [routeTargetTypeId, setRouteTargetTypeId] = useState("")
  const [candidateSort, setCandidateSort] = useState<CandidateSort>("NAME")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)
  const [customerPickerOpen, setCustomerPickerOpen] = useState(true)
  const [prefillState, setPrefillState] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [candidateFilters, setCandidateFilters] = useState<CandidateFilters>(emptyCandidateFilters)
  const [visibleCandidateLimit, setVisibleCandidateLimit] = useState(candidateDisplayPageSize)
  const [customerSearch, setCustomerSearch] = useState("")
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false)
  const [customerSearchError, setCustomerSearchError] = useState("")
  const [candidateLoadErrorCode, setCandidateLoadErrorCode] = useState("")
  const [candidateReloadVersion, setCandidateReloadVersion] = useState(0)
  const [inlineAssignmentOpen, setInlineAssignmentOpen] = useState(false)
  const [savingAction, setSavingAction] = useState<"draft" | "publish" | null>(null)
  const [persistedRouteId, setPersistedRouteId] = useState<string | undefined>()
  const [persistedVersion, setPersistedVersion] = useState<number | undefined>()
  const [error, setError] = useState("")
  const [conflicts, setConflicts] = useState<Array<{ code: string; routeId: string }>>([])
  const [meetingAvailability, setMeetingAvailability] = useState<MeetingAvailability[]>([])
  const [meetingAvailabilityLoading, setMeetingAvailabilityLoading] = useState(false)
  const [resolvingConflictStopKey, setResolvingConflictStopKey] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<{ id: string; name?: string | null } | null>(null)
  const [recoverableDraft, setRecoverableDraft] = useState<StoredRouteBuilderDraft | null>(null)
  const [recoveredAt, setRecoveredAt] = useState<string | null>(null)
  const [draftReady, setDraftReady] = useState(false)
  const [draftStorageFailed, setDraftStorageFailed] = useState(false)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const agentSelectRef = useRef<HTMLSelectElement>(null)
  const customerSectionRef = useRef<HTMLDivElement>(null)
  const reviewSectionRef = useRef<HTMLDivElement>(null)
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const baselineDraftRef = useRef<RouteBuilderDraftForm | null>(null)
  const candidatePageCursor = candidatePageCursors[candidatePageIndex] ?? null
  // C8: черновик — это план на день для сотрудника, а не путь, которым
  // открыли планировщик. Клиент и контакт из ключа убраны: из-за них один и
  // тот же вторник существовал дважды, и приложение предлагало тот черновик,
  // чей ключ случайно совпал (см. src/lib/mtm/route-draft-storage.ts).
  const draftScope = {
    orgId,
    viewerKey,
    routeId: initialData?.id ?? null,
    date: initialDate || initialPlannerContext?.date || null,
    agentId: initialAgentId || initialPlannerContext?.agentId || null,
  }
  const draftStorageKey = routeDraftStorageKey(draftScope)
  const currentDraftForm = useMemo<RouteBuilderDraftForm>(() => ({
    name,
    date,
    notes,
    primaryAgentId,
    participantIds,
    stops,
    direction,
    wizardStep,
  }), [date, direction, name, notes, participantIds, primaryAgentId, stops, wizardStep])
  const currentDraftSignature = useMemo(() => routeBuilderDraftSignature(currentDraftForm), [currentDraftForm])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const primary = initialData?.assignments?.find((assignment: MtmRouteAssignment) => assignment.role === "PRIMARY")?.agentId
      ?? initialData?.agentId
      ?? initialAgentId
      ?? initialPlannerContext?.agentId
      ?? ""
    const initialName = initialData?.name ?? ""
    const initialRouteDate = initialData?.date
      ? initialData.date.slice(0, 10)
      : initialDate ?? initialPlannerContext?.date ?? dateInputValueInTimezone(new Date(), timezone)
    const initialNotes = initialData?.notes ?? ""
    const initialRouteDirection = initialData ? "ORGANIZATION" : initialDirection ?? initialPlannerContext?.direction ?? "ORGANIZATION"
    const initialParticipants = initialData?.assignments
      ?.filter((assignment: MtmRouteAssignment) => assignment.role === "PARTICIPANT")
      .map((assignment: MtmRouteAssignment) => assignment.agentId) ?? []
    setName(initialName)
    setDate(initialRouteDate)
    setNotes(initialNotes)
    setPrimaryAgentId(primary)
    setDirection(initialRouteDirection)
    setRouteTargetTypeId("")
    setParticipantIds(initialParticipants)
    const initialStops = (initialData?.points ?? []).flatMap((point: MtmRoutePoint): Stop[] => {
      const customerId = point.customerId ?? point.customer?.id
      return customerId && point.customer ? [{
        customerId,
        contactId: point.contactId ?? null,
        customer: point.customer,
        contact: point.contact ?? null,
        status: point.status,
        plannedTime: point.plannedTime
          ? normalizeMtmRouteTimeSlot(formatInTimezone(point.plannedTime, timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).slice(0, 5))
          : null,
      }] : []
    })
    setStops(initialStops)
    setCandidateResults([])
    setCandidateFacets(emptyCandidateFacets)
    setCandidateRegionOptions([])
    setCandidateDistrictOptions([])
    setCandidateOrganizationOptions([])
    setCandidateTotal(0)
    setCandidateLimited(false)
    setCandidatePagination(null)
    setCandidatePageCursors([null])
    setCandidatePageIndex(0)
    setCandidatePageRetryVersion(0)
    setCandidatePageTransitioning(false)
    setCandidateSelectionScope(null)
    setCoveragePreview(null)
    setCustomerSearch(initialPlannerContext?.search ?? "")
    setCustomerSearchError("")
    setCandidateLoadErrorCode("")
    setCandidateFilters({ ...emptyCandidateFilters, ...initialPlannerContext?.filters })
    setInlineAssignmentOpen(false)
    setAdvancedOpen(false)
    setWizardStep(initialStops.length > 0 ? 3 : 1)
    setCustomerPickerOpen(initialStops.length === 0 && !initialCustomerId)
    setPrefillState(!initialData && initialCustomerId ? "loading" : "idle")
    setPersistedRouteId(initialData?.id)
    setPersistedVersion(initialData?.version)
    setError("")
    setConflicts([])
    setMeetingAvailability([])
    setMeetingAvailabilityLoading(false)
    setResolvingConflictStopKey(null)
    setDuplicate(null)
    const initialWizardStep = initialStops.length > 0 ? 3 : 1
    const baselineDraft: RouteBuilderDraftForm = {
      name: initialName,
      date: initialRouteDate,
      notes: initialNotes,
      primaryAgentId: primary,
      participantIds: initialParticipants,
      stops: initialStops,
      direction: initialRouteDirection,
      wizardStep: initialWizardStep,
    }
    baselineDraftRef.current = baselineDraft
    setDraftReady(false)
    setRecoverableDraft(null)
    setRecoveredAt(null)
    setDraftStorageFailed(false)
    if (draftStorageKey) {
      try {
        // Собираем все ключи этого плана, включая написанные прежней, более
        // длинной схемой, и берём самый свежий по savedAt: именно так
        // черновик 09:43 переставал побеждать черновик 15:23.
        const draftKeys = routeDraftStorageKeys(window.localStorage, draftScope)
        const rawDraft = window.localStorage.getItem(draftStorageKey)
        const storedDraft = latestRouteDraft(
          draftKeys.map((key) => {
            const raw = window.localStorage.getItem(key)
            return raw ? parseStoredRouteBuilderDraft(raw) : null
          }),
        )
        const routeMatches = !initialData?.id || storedDraft?.routeId === null || storedDraft?.routeId === initialData.id
        if (storedDraft && routeMatches && routeBuilderDraftSignature(storedDraft.form) !== routeBuilderDraftSignature(baselineDraft)) {
          setRecoverableDraft(storedDraft)
        } else if (rawDraft) {
          window.localStorage.removeItem(draftStorageKey)
        }
      } catch {
        setDraftStorageFailed(true)
      }
    }
    setDraftReady(true)

    const headers: Record<string, string> = orgId ? { "x-organization-id": orgId } : {}
    const agentsPromise = fetch("/api/v1/mtm/agents?limit=200", { headers, signal: controller.signal }).then((response) => response.json())
    const settingsPromise = fetch("/api/v1/mtm/settings", { headers, signal: controller.signal }).then((response) => response.json())
    Promise.all([agentsPromise, settingsPromise])
      .then(([agentResult, settingsResult]) => {
        if (agentResult.success) setAgents(agentResult.data.agents ?? [])
        if (settingsResult.success) {
          const configured = coerceMtmRouteTargetTypes(settingsResult.data?.routeTargetTypes)
          setRouteTargetTypes(configured)
          const requestedDirection = initialData ? "ORGANIZATION" : initialDirection ?? initialPlannerContext?.direction ?? "ORGANIZATION"
          const selectedTarget = configured.find((target) => target.enabled && target.direction === requestedDirection)
            ?? configured.find((target) => target.enabled)
          setRouteTargetTypeId(selectedTarget?.id ?? "")
          if (selectedTarget) setDirection(selectedTarget.direction)
        }
      })
      .catch((loadError: unknown) => {
        if ((loadError as { name?: string })?.name !== "AbortError") setError(t("referenceLoadError"))
      })

    if (!initialData && initialCustomerId) {
      fetch(`/api/v1/mtm/customers/${initialCustomerId}`, { headers, signal: controller.signal })
        .then(async (response) => {
          const result = await response.json().catch(() => null)
          if (!response.ok || !result?.success || !result.data) throw new Error("PREFILL_CUSTOMER_FAILED")
          return result
        })
        .then((result) => {
          const customer = result.data as Customer
          setStops((current) => {
            const alreadySelected = current.some((stop) => (
              stop.customerId === customer.id
              && (initialContactId ? stop.contactId === initialContactId : true)
            ))
            return alreadySelected
              ? current
              : [{ customerId: customer.id, contactId: initialContactId ?? null, customer }, ...current]
          })
          setPrefillState("success")
          setCustomerPickerOpen(false)
        })
        .catch((loadError: unknown) => {
          if ((loadError as { name?: string })?.name !== "AbortError") {
            setPrefillState("error")
            setCustomerPickerOpen(true)
          }
        })
    }
    return () => controller.abort()
  }, [draftStorageKey, initialAgentId, initialContactId, initialCustomerId, initialData, initialDate, initialDirection, initialPlannerContext, open, orgId, t, timezone])

  useEffect(() => {
    if (!open || !draftReady || !draftStorageKey || recoverableDraft) return
    const baselineDraft = baselineDraftRef.current
    if (!baselineDraft || currentDraftSignature === routeBuilderDraftSignature(baselineDraft)) return
    const timeout = window.setTimeout(() => {
      const value: StoredRouteBuilderDraft = {
        schemaVersion: 1,
        routeId: persistedRouteId ?? initialData?.id ?? null,
        routeVersion: persistedVersion ?? initialData?.version ?? null,
        savedAt: new Date().toISOString(),
        form: currentDraftForm,
      }
      try {
        window.localStorage.setItem(draftStorageKey, JSON.stringify(value))
        setDraftStorageFailed(false)
      } catch {
        setDraftStorageFailed(true)
      }
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [currentDraftForm, currentDraftSignature, draftReady, draftStorageKey, initialData?.id, initialData?.version, open, persistedRouteId, persistedVersion, recoverableDraft])

  useEffect(() => {
    if (!open || !draftReady || !onPlannerContextChange) return
    onPlannerContextChange({
      schemaVersion: 1,
      date: date || null,
      agentId: primaryAgentId || null,
      direction,
      search: customerSearch,
      filters: { ...candidateFilters },
    })
  }, [candidateFilters, customerSearch, date, direction, draftReady, onPlannerContextChange, open, primaryAgentId])

  useEffect(() => {
    setCandidatePageCursors((current) => current.length === 1 && current[0] === null ? current : [null])
    setCandidatePageIndex((current) => current === 0 ? current : 0)
    setCandidatePageRetryVersion(0)
    setCandidatePageTransitioning(false)
  }, [
    candidateFilters,
    candidateReloadVersion,
    candidateSort,
    customerPickerOpen,
    customerSearch,
    date,
    direction,
    initialData?.id,
    open,
    orgId,
    persistedRouteId,
    primaryAgentId,
    routeTargetTypeId,
    routeTargetTypes,
  ])

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    if (!primaryAgentId || !date || !customerPickerOpen) {
      setCandidateResults([])
      setCandidateFacets(emptyCandidateFacets)
      setCandidateTotal(0)
      setCandidateLimited(false)
      setCandidatePagination(null)
      setCandidateSelectionScope(null)
      setCoveragePreview(null)
      setCustomerSearchLoading(false)
      setCandidateLoadErrorCode("")
      setCandidatePageTransitioning(false)
      return
    }

    const query = customerSearch.trim()
    const delay = query ? 250 : 0
    const isFirstCandidatePage = candidatePageIndex === 0 && candidatePageCursor === null
    setCustomerSearchLoading(true)
    setCustomerSearchError("")
    setCandidateLoadErrorCode("")
    if (isFirstCandidatePage) {
      setCandidateResults([])
      setCandidateFacets(emptyCandidateFacets)
      setCandidateTotal(0)
      setCandidateLimited(false)
      setCandidatePagination(null)
      setCandidateSelectionScope(null)
      setCoveragePreview(null)
    }
    const timeout = window.setTimeout(async () => {
      const params = new URLSearchParams({
        agentId: primaryAgentId,
        startDate: date,
        direction,
        period: "5_DAYS",
        sort: candidateSort,
        pagination: "keyset",
        limit: String(candidateResultPageSize),
      })
      const selectedTargetType = routeTargetTypes.find((target) => target.id === routeTargetTypeId && target.enabled)
        ?? routeTargetTypes.find((target) => target.enabled && target.direction === direction)
      if (selectedTargetType?.objectType) params.set("objectType", selectedTargetType.objectType)
      if (selectedTargetType?.organizationKind) params.set("organizationKind", selectedTargetType.organizationKind)
      if (query) params.set("search", query)
      for (const [key, value] of Object.entries(candidateFilters)) {
        if (value) params.set(key, value)
      }
      if (initialData?.id ?? persistedRouteId) params.set("excludeRouteId", initialData?.id ?? persistedRouteId ?? "")
      if (candidatePageCursor) params.set("cursor", candidatePageCursor)

      try {
        const response = await fetch(`/api/v1/mtm/routes/candidates?${params.toString()}`, {
          headers: orgId ? { "x-organization-id": orgId } : {},
          signal: controller.signal,
        })
        const result = await response.json().catch(() => null)
        if (!response.ok || !result?.success) {
          const requestError = new Error(result?.error ?? "MTM_ROUTE_CANDIDATE_LOAD_FAILED") as Error & { code?: string }
          requestError.code = result?.code
          throw requestError
        }
        setCandidateResults(result.data.candidates ?? [])
        if (isFirstCandidatePage) {
          const nextFacets = result.data.facets ?? emptyCandidateFacets
          setCandidateFacets(nextFacets)
          setCandidateRegionOptions((current) => (
            candidateFilters.region
              ? (current.length ? current : nextFacets.region ?? [])
              : nextFacets.region ?? []
          ))
          setCandidateDistrictOptions((current) => (
            candidateFilters.administrativeDistrict
              ? (current.length ? current : nextFacets.administrativeDistrict ?? [])
              : nextFacets.administrativeDistrict ?? []
          ))
          setCandidateOrganizationOptions((current) => (
            candidateFilters.customerId
              ? (current.length ? current : nextFacets.organization ?? [])
              : nextFacets.organization ?? []
          ))
          setCandidateTotal(result.data.total ?? 0)
          setCandidateLimited(Boolean(result.data.limited))
          setCandidateSelectionScope(result.data.selectionScope ?? null)
          setCoveragePreview(result.data.coverage ?? null)
        }
        setCandidatePagination(parseCandidatePagination(result.data.pagination))
      } catch (loadError: unknown) {
        if (controller.signal.aborted) return
        if (isFirstCandidatePage) {
          setCandidateResults([])
          setCandidateFacets(emptyCandidateFacets)
          setCandidatePagination(null)
          setCandidateSelectionScope(null)
          setCoveragePreview(null)
        }
        if ((loadError as { code?: string })?.code === "MTM_ROUTE_CANDIDATE_CURSOR_EXPIRED" || (loadError as { code?: string })?.code === "MTM_ROUTE_CANDIDATE_CURSOR_INVALID") {
          setCandidatePageCursors([null])
          setCandidatePageIndex(0)
          toast.warning(t("candidatePageExpired"))
        }
        setCandidateLoadErrorCode((loadError as { code?: string })?.code ?? "MTM_ROUTE_CANDIDATE_LOAD_FAILED")
        setCustomerSearchError(
          (loadError as { code?: string })?.code === "MTM_ROUTE_SCOPE_DENIED"
            ? t("candidateScopeDenied")
            : t("customerSearchFailed"),
        )
      } finally {
        if (!controller.signal.aborted) {
          setCustomerSearchLoading(false)
          setCandidatePageTransitioning(false)
        }
      }
    }, delay)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [
    candidateReloadVersion,
    candidatePageCursor,
    candidatePageIndex,
    candidatePageRetryVersion,
    candidateFilters,
    candidateSort,
    customerPickerOpen,
    date,
    direction,
    initialData?.id,
    open,
    orgId,
    persistedRouteId,
    primaryAgentId,
    routeTargetTypeId,
    routeTargetTypes,
    customerSearch,
    t,
  ])

  useEffect(() => {
    if (!open || !primaryAgentId || !date) {
      setMeetingAvailability([])
      setMeetingAvailabilityLoading(false)
      return
    }

    const slots = stops.flatMap((stop) => {
      if (!stop.plannedTime) return []
      return [{
        customerId: stop.customerId,
        contactId: stop.contactId ?? null,
        plannedTime: localDateTimeToUtc(`${date}T${stop.plannedTime}`, timezone).toISOString(),
      }]
    })
    if (slots.length === 0) {
      setMeetingAvailability([])
      setMeetingAvailabilityLoading(false)
      return
    }

    const uniqueSlots = [...new Map(slots.map((slot) => [
      meetingAvailabilityKey(slot.customerId, slot.contactId, slot.plannedTime),
      slot,
    ])).values()]
    const routeIdToExclude = persistedRouteId ?? initialData?.id
    const controller = new AbortController()
    setMeetingAvailabilityLoading(true)

    fetch("/api/v1/mtm/routes/meeting-availability", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(orgId ? { "x-organization-id": orgId } : {}),
      },
      body: JSON.stringify({
        date,
        ...(routeIdToExclude ? { excludeRouteId: routeIdToExclude } : {}),
        agentIds: [primaryAgentId, ...participantIds].filter(Boolean),
        slots: uniqueSlots,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json().catch(() => null)
        if (!response.ok || !result?.success) throw new Error("MEETING_AVAILABILITY_FAILED")
        return result.data?.meetings as MeetingAvailability[] | undefined
      })
      .then((meetings) => {
        if (!controller.signal.aborted) setMeetingAvailability(meetings ?? [])
      })
      .catch(() => {
        // The assistant is deliberately advisory. A temporary lookup failure
        // must never prevent a user from completing an otherwise valid draft.
        if (!controller.signal.aborted) setMeetingAvailability([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setMeetingAvailabilityLoading(false)
      })

    return () => controller.abort()
  }, [date, initialData?.id, open, orgId, participantIds, persistedRouteId, primaryAgentId, stops, timezone])

  useEffect(() => {
    setVisibleCandidateLimit(candidateDisplayPageSize)
  }, [candidateFilters, candidatePageIndex, candidateSort, customerSearch, date, direction, primaryAgentId, routeTargetTypeId])

  useEffect(() => {
    if (open && error) errorRef.current?.focus()
  }, [error, open])

  useEffect(() => {
    if (!open) return
    if (!primaryAgentId || !date) {
      setWizardStep(1)
      setCustomerPickerOpen(false)
      return
    }
    if (wizardStep === 3 && stops.length === 0) {
      setWizardStep(2)
      setCustomerPickerOpen(true)
    }
  }, [date, open, primaryAgentId, stops.length, wizardStep])

  const selectedCustomerPositions = useMemo(
    () => new Map(stops.map((stop, index) => [stopKey(stop), index + 1])),
    [stops],
  )
  const visibleCandidates = useMemo(
    () => candidateResults.slice(0, visibleCandidateLimit),
    [candidateResults, visibleCandidateLimit],
  )
  const candidatePagingSupported = candidatePagination?.mode === "KEYSET" && candidatePagination.supported
  const candidateCanGoPrevious = candidatePagingSupported && candidatePageIndex > 0
  const candidateCanGoNext = candidatePagingSupported && Boolean(candidatePagination?.hasMore && candidatePagination.nextCursor)
  const coverageLocale = locale === "az" ? "az" : locale === "en" ? "en" : "ru"
  const selectedAgentName = agents.find((agent) => agent.id === primaryAgentId)?.name
  const enabledRouteTargetTypes = useMemo(() => routeTargetTypes.filter((target) => target.enabled), [routeTargetTypes])
  const selectedRouteTargetType = enabledRouteTargetTypes.find((target) => target.id === routeTargetTypeId)
    ?? enabledRouteTargetTypes.find((target) => target.direction === direction)
    ?? enabledRouteTargetTypes[0]
  const selectedTargetLabel = selectedRouteTargetType
    ? routeTargetLabel(selectedRouteTargetType, locale)
    : t(directionLabelKey(direction))
  const candidateScopeMode = candidateSelectionScope?.mode ?? "AGENT_ASSIGNMENTS"
  const selectedOrganizationName = candidateOrganizationOptions.find((organization) => organization.id === candidateFilters.customerId)?.name

  function previousCandidatePage() {
    if (candidatePageTransitioning || customerSearchLoading) return
    setCandidatePageTransitioning(true)
    setCandidatePageIndex((current) => Math.max(0, current - 1))
  }

  function nextCandidatePage() {
    const nextCursor = candidatePagination?.nextCursor
    if (!nextCursor || customerSearchLoading || candidatePageTransitioning) return
    setCandidatePageTransitioning(true)
    setCandidatePageCursors((current) => {
      const nextIndex = candidatePageIndex + 1
      return current[nextIndex] === nextCursor
        ? current
        : [...current.slice(0, nextIndex), nextCursor]
    })
    setCandidatePageIndex((current) => current + 1)
  }

  const meetingAvailabilityByStop = useMemo(() => {
    const byStop = new Map<string, MeetingAvailabilityNotice[]>()
    const selectedAgentIds = new Set([primaryAgentId, ...participantIds].filter(Boolean))
    for (const matchingStop of stops) {
      if (!matchingStop.plannedTime) continue
      const plannedTime = localDateTimeToUtc(`${date}T${matchingStop.plannedTime}`, timezone).toISOString()
      const availability = meetingAvailability.find((slot) => (
        slot.customerId === matchingStop.customerId
        && slot.plannedTime === plannedTime
        && slot.contactId === (matchingStop.contactId ?? null)
      ))
      const ownAgents = new Map((availability?.busyAgents ?? []).map((agent) => [agent.id, agent]))
      const colleagueAgents = new Map<string, { id: string; name: string }>()
      let sameContact = false
      if (stops.filter((stop) => stop.plannedTime === matchingStop.plannedTime).length > 1) {
        for (const agent of agents) {
          if (selectedAgentIds.has(agent.id)) ownAgents.set(agent.id, agent)
        }
      }
      for (const meeting of availability?.meetings ?? []) {
        sameContact ||= meeting.sameContact
        for (const agent of meeting.agents) {
          if (selectedAgentIds.has(agent.id)) ownAgents.set(agent.id, agent)
          else colleagueAgents.set(agent.id, agent)
        }
      }
      const notices: MeetingAvailabilityNotice[] = []
      if (ownAgents.size > 0) {
        notices.push({
          kind: "same-agent",
          customerName: matchingStop.customer.name,
          contactName: matchingStop.contact?.displayName ?? null,
          plannedTime: matchingStop.plannedTime ?? "",
          agents: [...ownAgents.values()],
          sameContact,
        })
      }
      if (colleagueAgents.size > 0) {
        notices.push({
          kind: "colleague",
          customerName: matchingStop.customer.name,
          contactName: matchingStop.contact?.displayName ?? null,
          plannedTime: matchingStop.plannedTime ?? "",
          agents: [...colleagueAgents.values()],
          sameContact,
        })
      }
      if (notices.length > 0) {
        byStop.set(meetingAvailabilityKey(matchingStop.customerId, matchingStop.contactId, plannedTime), notices)
      }
    }
    return byStop
  }, [agents, date, meetingAvailability, participantIds, primaryAgentId, stops, timezone])
  const activeCandidateFilters = useMemo(() => {
    const entries: Array<{ key: CandidateFilterKey | "search"; label: string; value: string }> = [
      { key: "search", label: t("filterSearch"), value: customerSearch.trim() },
      { key: "region", label: t("filterRegion"), value: candidateFilters.region },
      { key: "administrativeDistrict", label: t("filterAdministrativeDistrict"), value: candidateFilters.administrativeDistrict },
      { key: "customerId", label: t("filterOrganization"), value: selectedOrganizationName ?? candidateFilters.customerId },
      { key: "specialtyCode", label: t("filterSpecialty"), value: direction === "DOCTOR" ? candidateFilters.specialtyCode : "" },
      { key: "psychotype", label: t("filterPsychotype"), value: direction === "DOCTOR" ? candidateFilters.psychotype : "" },
    ]
    return entries.filter((entry) => entry.value)
  }, [candidateFilters, customerSearch, direction, selectedOrganizationName, t])

  function changeRouteTargetType(target: MtmRouteTargetType) {
    setRouteTargetTypeId(target.id)
    setDirection(target.direction)
    setInlineAssignmentOpen(false)
    setCandidateFilters(emptyCandidateFilters)
    setCandidateRegionOptions([])
    setCandidateDistrictOptions([])
    setCandidateOrganizationOptions([])
    if (target.direction !== "PHARMACY" && candidateSort === "COVERAGE_GAP") {
      setCandidateSort("NAME")
    }
  }

  function directionLabelKey(value: CandidateDirection) {
    if (value === "DOCTOR") return "directionDoctors"
    if (value === "PHARMACY") return "directionPharmacies"
    return "directionOrganizations"
  }

  function clearAllCandidateFilters() {
    setCustomerSearch("")
    setCandidateFilters(emptyCandidateFilters)
    setCandidateDistrictOptions([])
    setCandidateOrganizationOptions([])
  }

  function removeCandidateFilter(key: CandidateFilterKey | "search") {
    if (key === "search") {
      setCustomerSearch("")
      return
    }
    if (key === "region") {
      setCandidateDistrictOptions([])
      setCandidateOrganizationOptions([])
    } else if (key === "administrativeDistrict") {
      setCandidateOrganizationOptions([])
    }
    setCandidateFilters((current) => {
      if (key === "region") {
        return { ...current, region: "", administrativeDistrict: "", customerId: "" }
      }
      if (key === "administrativeDistrict") {
        return { ...current, [key]: "", customerId: "" }
      }
      return { ...current, [key]: "" }
    })
  }

  function toggleParticipant(agentId: string) {
    setParticipantIds((current) => current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId])
  }

  function moveStop(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= stops.length) return
    setStops((current) => {
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  function removeStop(index: number) {
    setStops((current) => current.filter((_, stopIndex) => stopIndex !== index))
    if (stops.length === 1) setCustomerPickerOpen(true)
  }

  function updateStopTime(index: number, plannedTime: string) {
    setStops((current) => current.map((stop, stopIndex) => stopIndex === index
      ? { ...stop, plannedTime: plannedTime || null }
      : stop))
  }

  function autoScheduleStops() {
    setStops((current) => {
      const occupiedTimes = new Set(current.flatMap((stop) => stop.plannedTime ? [stop.plannedTime] : []))
      const availableTimes = MTM_ROUTE_TIME_SLOTS.filter((time) => time >= "09:00" && !occupiedTimes.has(time))
      let availableTimeIndex = 0

      return current.map((stop) => {
        if (stop.plannedTime) return stop
        const plannedTime = availableTimes[availableTimeIndex] ?? null
        availableTimeIndex += 1
        return { ...stop, plannedTime }
      })
    })
  }

  async function findNextAvailableTime(index: number) {
    const stop = stops[index]
    if (!stop || !date || !primaryAgentId) return

    const currentTime = stop.plannedTime ?? "07:30"
    const occupiedTimes = new Set(stops.flatMap((candidate, candidateIndex) => (
      candidateIndex !== index && candidate.plannedTime ? [candidate.plannedTime] : []
    )))
    const candidateTimes = MTM_ROUTE_TIME_SLOTS.filter((time) => (
      time >= "08:00"
      && time <= "20:00"
      && time > currentTime
      && !occupiedTimes.has(time)
    ))
    if (candidateTimes.length === 0) {
      toast.error(t("noFreeTimeToday"))
      return
    }

    const requestKey = stopKey(stop)
    const routeIdToExclude = persistedRouteId ?? initialData?.id
    setResolvingConflictStopKey(requestKey)
    try {
      const response = await fetch("/api/v1/mtm/routes/meeting-availability", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify({
          date,
          ...(routeIdToExclude ? { excludeRouteId: routeIdToExclude } : {}),
          agentIds: [primaryAgentId, ...participantIds].filter(Boolean),
          slots: candidateTimes.map((time) => ({
            customerId: stop.customerId,
            contactId: stop.contactId ?? null,
            plannedTime: localDateTimeToUtc(`${date}T${time}`, timezone).toISOString(),
          })),
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) throw new Error("MEETING_AVAILABILITY_FAILED")
      const availability = (result.data?.meetings as MeetingAvailability[] | undefined) ?? []
      const freeIndex = availability.findIndex((slot) => (slot.busyAgents ?? []).length === 0)
      if (freeIndex < 0 || !candidateTimes[freeIndex]) {
        toast.error(t("noFreeTimeToday"))
        return
      }

      const nextTime = candidateTimes[freeIndex]
      updateStopTime(index, nextTime)
      toast.success(t("nextFreeTimeApplied", { time: nextTime }))
    } catch {
      toast.error(t("nextFreeTimeFailed"))
    } finally {
      setResolvingConflictStopKey((current) => current === requestKey ? null : current)
    }
  }

  function addInlineAssignedCandidate(candidate: RouteBuilderInlineAssignable) {
    const nextStop: Stop = {
      customerId: candidate.customer.id,
      contactId: candidate.contact?.id ?? null,
      customer: candidate.customer,
      contact: candidate.contact,
    }
    setStops((current) => current.some((stop) => stopKey(stop) === stopKey(nextStop))
      ? current
      : [...current, nextStop])
    setCandidateReloadVersion((current) => current + 1)
    setCustomerPickerOpen(true)
  }

  function applyDraftForm(form: RouteBuilderDraftForm) {
    setName(form.name)
    setDate(form.date)
    setNotes(form.notes)
    setPrimaryAgentId(form.primaryAgentId)
    setParticipantIds(form.participantIds)
    setStops(form.stops)
    setDirection(form.direction)
    const restoredTarget = routeTargetTypes.find((target) => target.enabled && target.direction === form.direction)
    setRouteTargetTypeId(restoredTarget?.id ?? "")
    setWizardStep(form.wizardStep)
    setCustomerPickerOpen(form.wizardStep === 2)
    setCustomerSearch("")
    setCandidateFilters(emptyCandidateFilters)
    setError("")
    setConflicts([])
    setDuplicate(null)
  }

  function restoreLocalDraft() {
    if (!recoverableDraft) return
    applyDraftForm(recoverableDraft.form)
    setPersistedRouteId(recoverableDraft.routeId ?? initialData?.id)
    setPersistedVersion(recoverableDraft.routeVersion ?? initialData?.version)
    setRecoveredAt(recoverableDraft.savedAt)
    setRecoverableDraft(null)
    setDraftStorageFailed(false)
  }

  function discardLocalDraft({ resetCurrent = false }: { resetCurrent?: boolean } = {}) {
    if (draftStorageKey) {
      try {
        window.localStorage.removeItem(draftStorageKey)
      } catch {
        setDraftStorageFailed(true)
        return
      }
    }
    if (resetCurrent && baselineDraftRef.current) {
      applyDraftForm(baselineDraftRef.current)
      setPersistedRouteId(initialData?.id)
      setPersistedVersion(initialData?.version)
    }
    setRecoverableDraft(null)
    setRecoveredAt(null)
    setDraftStorageFailed(false)
  }

  async function save(action: "draft" | "publish") {
    if (!primaryAgentId || !date) {
      setError(t("builderRequiredError"))
      return
    }
    setSavingAction(action)
    setError("")
    setDuplicate(null)
    try {
      const assignments = [
        { agentId: primaryAgentId, role: "PRIMARY" },
        ...participantIds
          .filter((agentId) => agentId !== primaryAgentId)
          .map((agentId) => ({ agentId, role: "PARTICIPANT" })),
      ]
      const payload = {
        name: name || null,
        date,
        notes: notes || null,
        ...(persistedRouteId ? {} : { status: "DRAFT" as const }),
        agentId: primaryAgentId,
        assignments,
        points: stops.map((stop) => ({
          customerId: stop.customerId,
          contactId: stop.contactId ?? null,
          plannedTime: stop.plannedTime
            ? localDateTimeToUtc(`${date}T${stop.plannedTime}`, timezone).toISOString()
            : null,
        })),
      }
      const routeIdToEdit = persistedRouteId
      const isEdit = Boolean(routeIdToEdit)
      if (isEdit && typeof persistedVersion !== "number") {
        throw new Error(t("versionConflict"))
      }
      const response = await fetch(routeIdToEdit ? `/api/v1/mtm/routes/${routeIdToEdit}` : "/api/v1/mtm/routes", {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "content-type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify({
          ...payload,
          ...(isEdit ? { expectedVersion: persistedVersion } : {}),
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        if (result.code === "ROUTE_DUPLICATE" && result.duplicate?.id) setDuplicate(result.duplicate)
        throw new Error(result.code === "ROUTE_VERSION_CONFLICT"
          ? t("versionConflict")
          : result.error ?? t("saveFailed"))
      }

      const routeId = routeIdToEdit ?? result.data?.id
      if (typeof routeId !== "string" || !routeId) throw new Error(t("saveFailed"))
      const savedVersion = result.data?.version
      if (typeof savedVersion !== "number") throw new Error(t("saveFailed"))
      setPersistedRouteId(routeId)
      setPersistedVersion(savedVersion)
      setConflicts(result.meta?.conflicts ?? [])
      if (action === "publish") {
        const publishResponse = await fetch(`/api/v1/mtm/routes/${routeId}/publish`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(orgId ? { "x-organization-id": orgId } : {}),
          },
          body: JSON.stringify({ expectedVersion: savedVersion }),
        })
        const publishResult = await publishResponse.json()
        if (!publishResponse.ok) {
          setConflicts(publishResult.conflicts ?? result.meta?.conflicts ?? [])
          let publishError = publishResult.error ?? t("publishFailed")
          if (publishResult.code === "ROUTE_VERSION_CONFLICT") publishError = t("versionConflict")
          if (publishResult.code === "ROUTE_POINT_TIME_CONFLICT") publishError = t("sameRouteTimeConflictError")
          if (publishResult.code === "ROUTE_CONFLICT") publishError = t("routePublishConflictError")
          throw new Error(publishError)
        }
        if (typeof publishResult.data?.version === "number") {
          setPersistedVersion(publishResult.data.version)
        }
      }
      toast.success(action === "publish"
        ? t("publishSuccess")
        : t(routeIdToEdit ? "saveChangesSuccess" : "draftSaveSuccess"))
      discardLocalDraft()
      await onSaved(routeId)
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("saveFailed"))
    } finally {
      setSavingAction(null)
    }
  }

  if (!open) return null

  const isEditing = Boolean(initialData?.id || persistedRouteId)
  const isPublishedEdit = Boolean(initialData?.id) && initialData?.status !== "DRAFT"
  const dateWasChosenFromCalendar = Boolean(initialDate && !initialData)
  const canPublishFromBuilder = canPublish && !isPublishedEdit
  const setupComplete = Boolean(primaryAgentId && date)
  const customersComplete = stops.length > 0
  const unscheduledStopCount = stops.filter((stop) => !stop.plannedTime).length
  const activeStep = wizardStep
  const primaryAction = activeStep === 1
    ? !primaryAgentId
      ? "agent"
      : !date
        ? "date"
        : "continue"
    : activeStep === 2
      ? "review"
      : "save"
  const prefilledStop = initialCustomerId
    ? stops.find((stop) => stop.customerId === initialCustomerId) ?? stops[0]
    : undefined

  function focusStep(step: 1 | 2 | 3) {
    if (step === 1) {
      setWizardStep(1)
      setCustomerPickerOpen(false)
      window.requestAnimationFrame(() => {
        if (!primaryAgentId) agentSelectRef.current?.focus()
        else if (!date) dateInputRef.current?.focus()
      })
      return
    }
    if (step === 2) {
      if (!setupComplete) {
        focusStep(1)
        return
      }
      setWizardStep(2)
      setCustomerPickerOpen(true)
      window.requestAnimationFrame(() => customerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
      return
    }
    if (!setupComplete || !customersComplete) {
      focusStep(setupComplete ? 2 : 1)
      return
    }
    setWizardStep(3)
    setCustomerPickerOpen(false)
    window.requestAnimationFrame(() => {
      reviewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      reviewHeadingRef.current?.focus({ preventScroll: true })
    })
  }

  function runPrimaryAction() {
    if (primaryAction === "agent") {
      agentSelectRef.current?.focus()
      return
    }
    if (primaryAction === "date") {
      dateInputRef.current?.focus()
      return
    }
    if (primaryAction === "continue") {
      focusStep(2)
      return
    }
    if (primaryAction === "review") {
      if (!customersComplete) {
        customerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        return
      }
      focusStep(3)
      return
    }
    void save(canPublishFromBuilder ? "publish" : "draft")
  }

  const primaryActionLabel = primaryAction === "agent"
    ? t("chooseEmployeeAction")
    : primaryAction === "date"
      ? t("chooseDateAction")
      : primaryAction === "continue"
        ? t("continueToCustomers")
        : primaryAction === "review"
          ? t("reviewRouteAction")
        : canPublishFromBuilder
          ? t("saveAndPublish")
          : isEditing
            ? t("saveChanges")
            : t("saveDraft")

  return (
    <section data-testid="mtm-route-builder" className="flex min-h-0 max-h-dvh flex-col overflow-hidden border-y border-zinc-200 bg-card dark:border-zinc-700 min-[900px]:max-h-[min(52rem,calc(100dvh-2rem))]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <h2 className="truncate text-base font-semibold">
              {isEditing ? t("builderEditTitle") : t("builderNewTitle")}
            </h2>
            <span className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              {isPublishedEdit ? mtmStatusLabel(statusT, "route", initialData?.status ?? "DRAFT") : t("draft")}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{t("builderSubtitle")}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" data-testid="mtm-route-builder-close" onClick={requestClose} title={t("closeBuilder")} aria-label={t("closeBuilder")}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {recoverableDraft ? (
        <div
          data-testid="mtm-route-draft-recovery"
          className={`flex shrink-0 flex-col gap-2 border-b px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between ${
            initialData?.version != null
            && recoverableDraft.routeVersion != null
            && recoverableDraft.routeVersion !== initialData.version
              ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100"
              : "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/25 dark:text-sky-100"
          }`}
          role="status"
        >
          <div className="flex min-w-0 items-start gap-2">
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold">
                {initialData?.version != null
                && recoverableDraft.routeVersion != null
                && recoverableDraft.routeVersion !== initialData.version
                  ? t("routeDraftStaleTitle")
                  : t("routeDraftFoundTitle")}
              </p>
              <p className="mt-0.5 text-xs opacity-80">
                {initialData?.version != null
                && recoverableDraft.routeVersion != null
                && recoverableDraft.routeVersion !== initialData.version
                  ? t("routeDraftStaleHint", { draftVersion: recoverableDraft.routeVersion, serverVersion: initialData.version })
                  : t("routeDraftFoundHint", {
                    date: formatInTimezone(recoverableDraft.savedAt, timezone, { dateStyle: "medium", timeStyle: "short" }, locale),
                  })}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" size="sm" className="min-h-9" onClick={restoreLocalDraft}>{t("restoreRouteDraft")}</Button>
            <Button type="button" size="sm" variant="outline" className="min-h-9" onClick={() => discardLocalDraft()}>{t("discardRouteDraft")}</Button>
          </div>
        </div>
      ) : null}

      {recoveredAt ? (
        <div data-testid="mtm-route-draft-recovered" className="flex shrink-0 flex-col gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100 sm:flex-row sm:items-center sm:justify-between" role="status">
          <div className="flex min-w-0 items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold">{t("routeDraftRecoveredTitle")}</p>
              <p className="mt-0.5 text-xs opacity-80">{t("routeDraftRecoveredHint", { date: formatInTimezone(recoveredAt, timezone, { dateStyle: "medium", timeStyle: "short" }, locale) })}</p>
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" className="min-h-9 shrink-0" onClick={() => discardLocalDraft({ resetCurrent: true })}>{t("discardRecoveredRouteDraft")}</Button>
        </div>
      ) : null}

      {draftStorageFailed ? (
        <div data-testid="mtm-route-draft-storage-error" className="flex shrink-0 items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/25 dark:text-red-200" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{t("routeDraftStorageFailed")}</p>
        </div>
      ) : null}

      {error ? (
        <div ref={errorRef} role="alert" tabIndex={-1} className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 outline-none dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>{error}</p>
            {duplicate ? (
              <Button type="button" variant="link" className="h-auto p-0 text-red-700 dark:text-red-300" onClick={() => onOpenExisting(duplicate.id)}>
                {t("openExistingRoute")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> {t("conflictsFound", { count: conflicts.length })}
          </div>
          <p className="mt-1 text-xs">{t("conflictsNeedApproval")}</p>
        </div>
      ) : null}

      {isPublishedEdit ? (
        <div className="flex items-start gap-2 border-b border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t("publishedEditNotice")}</p>
        </div>
      ) : null}

      {initialCustomerId && !initialData ? (
        <div
          className={`border-b px-4 py-3 ${
            prefillState === "error"
              ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
              : "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20"
          }`}
          role={prefillState === "error" ? "alert" : "status"}
          aria-live="polite"
          data-testid="mtm-route-prefill-status"
        >
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
              prefillState === "error"
                ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200"
                : "bg-emerald-600 text-white"
            }`}>
              {prefillState === "loading" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : prefillState === "error" ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <p className="font-semibold">
                {prefillState === "loading"
                  ? t("prefillLoading")
                  : prefillState === "error"
                    ? t("prefillErrorTitle")
                    : t("prefillSuccessTitle")}
              </p>
              <p className="mt-0.5 break-words text-sm text-muted-foreground">
                {prefillState === "success" && prefilledStop
                  ? t("prefillSuccessHint", { name: prefilledStop.contact?.displayName ?? prefilledStop.customer.name })
                  : prefillState === "error"
                    ? t("prefillCustomerFailed")
                    : t("prefillLoadingHint")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="shrink-0 border-b border-zinc-200 px-4 py-2 dark:border-zinc-700" aria-label={t("builderProgressLabel")}>
        <ol className="mx-auto grid max-w-3xl grid-cols-3 gap-1 sm:gap-3">
          {([
            { step: 1 as const, label: t("progressWhoWhen"), complete: setupComplete, detail: setupComplete ? t("progressWhoWhenDone", { employee: selectedAgentName ?? "—", date: planningDateLabel(date, locale) }) : t("progressWhoWhenTodo") },
            { step: 2 as const, label: t("progressCustomers"), complete: customersComplete, detail: customersComplete ? t("progressCustomersDone", { count: stops.length }) : t("progressCustomersTodo") },
            { step: 3 as const, label: t("progressSave"), complete: false, detail: setupComplete && customersComplete ? t("progressSaveReady") : t("progressSaveTodo") },
          ]).map((item) => {
            const current = item.step === activeStep
            const available = item.step === 1 || (item.step === 2 && setupComplete) || (item.step === 3 && setupComplete && customersComplete)
            return (
              <li key={item.step}>
                <button
                  type="button"
                  onClick={() => focusStep(item.step)}
                  disabled={!available}
                  aria-current={current ? "step" : undefined}
                  aria-label={`${item.label}. ${item.detail}`}
                  className={`flex min-h-10 w-full items-center justify-center gap-2 rounded-full px-2 py-1.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                    current
                      ? "bg-primary/10 text-foreground"
                      : item.complete
                        ? "bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-100"
                        : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    item.complete
                      ? "bg-emerald-600 text-white"
                      : current
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {item.complete ? <Check className="h-4 w-4" /> : item.step}
                  </span>
                  <span className="truncate text-xs font-semibold sm:text-sm">{item.label}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="mx-auto min-h-0 w-full max-w-6xl flex-1 overflow-y-auto overscroll-contain">
        {activeStep === 1 ? (
        <section data-testid="mtm-route-wizard-step-1" className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <p className="text-lg font-semibold">{t("stepChooseAgent")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("stepChooseAgentHint")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="route-builder-primary">{t("primaryAgent")} *</Label>
              <Select
                id="route-builder-primary"
                ref={agentSelectRef}
                value={primaryAgentId}
                onChange={(event) => {
                  setPrimaryAgentId(event.target.value)
                  setParticipantIds((current) => current.filter((id) => id !== event.target.value))
                  setInlineAssignmentOpen(false)
                  setCandidateFilters(emptyCandidateFilters)
                  setCandidateRegionOptions([])
                  setCandidateDistrictOptions([])
                  setCandidateOrganizationOptions([])
                }}
              >
                <option value="">{t("selectAgent")}</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </Select>
            </div>
            {dateWasChosenFromCalendar ? (
              <div data-testid="mtm-route-calendar-date-confirmation" className="space-y-1">
                <span className="text-sm font-medium">{t("selectedCalendarDate")}</span>
                <div className="flex min-h-11 items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/20">
                  <CalendarDays className="h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{planningDateLabel(date, locale)}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{t("selectedCalendarDateHint")}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <Label htmlFor="route-builder-date">{t("singleRouteDate")} *</Label>
                <Input ref={dateInputRef} id="route-builder-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
              </div>
            )}
          </div>

          <details data-testid="mtm-route-optional-settings" className="border-y border-zinc-200 py-2 dark:border-zinc-700">
            <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
              <span className="inline-flex min-h-9 items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                {t("optionalRouteSettings")}
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </span>
            </summary>
            <div className="mt-3 space-y-4">
              <div>
                <Label htmlFor="route-builder-name">{t("routeName")}</Label>
                <Input id="route-builder-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("routeNamePlaceholder")} />
                <p className="mt-1 text-xs text-muted-foreground">{t("routeNameHint")}</p>
              </div>
              <div>
                <Label>{t("participants")}</Label>
                <div className="mt-2 max-h-48 divide-y divide-zinc-200 overflow-y-auto border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                  {agents.filter((agent) => agent.id !== primaryAgentId).map((agent) => {
                    const checked = participantIds.includes(agent.id)
                    return (
                      <label key={agent.id} className="flex min-h-10 cursor-pointer items-center gap-3 px-1 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleParticipant(agent.id)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                        <span className="text-xs text-muted-foreground">{mtmStatusLabel(statusT, "role", agent.role)}</span>
                      </label>
                    )
                  })}
                  {agents.length <= 1 ? <p className="py-3 text-xs text-muted-foreground">{t("noParticipants")}</p> : null}
                </div>
              </div>

              <div>
                <Label htmlFor="route-builder-notes">{t("notes")}</Label>
                <Textarea id="route-builder-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
              </div>
            </div>
          </details>
        </section>
        ) : null}

        {activeStep === 2 ? (
        <section data-testid="mtm-route-wizard-step-2" className="min-w-0 px-3 py-3 sm:px-4 sm:py-4">
          <div ref={customerSectionRef} className="scroll-mt-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{t("stepAddCustomers")}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{t("stepAddCustomersHint")}</p>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">{t("stopCount", { count: stops.length })}</span>
            </div>
            {stops.length > 0 ? (
              <div className="mb-2 flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/20 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{t("customersSelected", { count: stops.length })}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {stops.slice(0, 3).map((stop) => stop.contact?.displayName ?? stop.customer.name).join(" · ")}
                      {stops.length > 3 ? ` · ${t("moreCustomers", { count: stops.length - 3 })}` : ""}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] md:items-start md:gap-4">
              <aside
                data-testid="mtm-route-selected-stops-detail"
                className="order-2 hidden min-w-0 md:sticky md:top-0 md:block md:max-h-[calc(100dvh-14rem)] md:overflow-y-auto"
                aria-labelledby="mtm-route-selected-stops-heading"
              >
                <div className="border border-zinc-200 bg-card dark:border-zinc-700">
                  <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-3 py-3 dark:border-zinc-700">
                    <div className="min-w-0">
                      <h4 id="mtm-route-selected-stops-heading" className="text-sm font-semibold">{t("customersSelected", { count: stops.length })}</h4>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground" role="status" aria-live="polite">
                      {t("stopCount", { count: stops.length })}
                    </span>
                  </div>
                  {stops.length > 0 ? (
                    <ol className="divide-y divide-zinc-200 dark:divide-zinc-700">
                      {stops.map((stop, index) => {
                        const locked = isPublishedEdit && stop.status !== undefined && stop.status !== "PENDING"
                        const stopName = stop.contact?.displayName ?? stop.customer.name
                        return (
                          <li key={stopKey(stop)} className="flex min-h-14 items-center gap-2 px-3 py-2">
                            <span className="grid h-7 w-7 shrink-0 place-items-center border border-zinc-200 text-xs font-semibold tabular-nums dark:border-zinc-700">
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{stopName}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {[stop.contact ? stop.customer.name : null, stop.contact?.specialtyName, stop.customer.address ?? stop.customer.city ?? stop.customer.code].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="min-h-11 min-w-11 shrink-0 text-destructive"
                              disabled={locked}
                              onClick={() => removeStop(index)}
                              title={locked ? t("stopLocked") : t("removeStop")}
                              aria-label={locked ? t("stopLocked") : t("removeStopNamed", { name: stopName })}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </li>
                        )
                      })}
                    </ol>
                  ) : (
                    <p className="px-3 py-5 text-sm text-muted-foreground">{t("noStops")}</p>
                  )}
                  <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full"
                      onClick={() => focusStep(3)}
                      disabled={!customersComplete}
                    >
                      <MapPin className="h-4 w-4" />{t("reviewRouteAction")}
                    </Button>
                  </div>
                </div>
              </aside>
              <div className="min-w-0 md:order-1">
            {customerPickerOpen ? (
              <div id="route-builder-customer-picker" data-testid="mtm-route-customer-picker">
            {!setupComplete ? (
              <div className="grid min-h-44 place-items-center rounded-lg border border-zinc-200 bg-muted/25 p-5 text-center dark:border-zinc-700">
                <div className="max-w-md">
                  <CalendarDays className="mx-auto h-6 w-6 text-primary" />
                  <p className="mt-3 font-semibold">{t("customerPickerBlockedTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("customerPickerBlockedHint")}</p>
                  <Button type="button" className="mt-4 min-h-11" onClick={() => focusStep(1)}>
                    <UserRound className="h-4 w-4" />
                  {primaryAgentId ? t("chooseDateAction") : t("chooseEmployeeAction")}
                </Button>
                </div>
              </div>
            ) : (
              <>
            <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label={t("planningDirection")}>
              {enabledRouteTargetTypes.map((target) => (
                <Button
                  key={target.id}
                  type="button"
                  size="sm"
                  variant={selectedRouteTargetType?.id === target.id ? "default" : "outline"}
                  data-testid={`mtm-route-candidate-type-${target.id}`}
                  data-route-target-direction={target.direction}
                  className="min-h-10 px-4 text-xs sm:text-sm"
                  aria-pressed={selectedRouteTargetType?.id === target.id}
                  onClick={() => changeRouteTargetType(target)}
                >
                  {routeTargetLabel(target, locale)}
                </Button>
              ))}
            </div>
            <div className="mb-2 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <p data-testid="mtm-route-candidate-scope-summary">
                {t(candidateScopeMode === "ACTIVE_CATALOG" ? "candidateScopeCatalogSummary" : "candidateScopeAssignedSummary", {
                  agent: selectedAgentName ?? t("selectedEmployee"),
                  count: candidateTotal,
                  date: planningDateLabel(date, locale),
                  target: selectedTargetLabel,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                {canManageAssignments && candidateTotal > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-10 shrink-0"
                    data-testid="mtm-route-inline-assignment-open-partial"
                    onClick={() => setInlineAssignmentOpen(true)}
                  >
                    <Users className="mr-1 h-4 w-4" />{t("inlineAssignmentOpenAction")}
                  </Button>
                ) : null}
                {canRequestCustomer ? (
                  <Button type="button" size="sm" variant="outline" className="min-h-10 shrink-0" onClick={() => onRequestCustomer(persistedRouteId ?? initialData?.id)}>
                    <UserRound className="mr-1 h-4 w-4" />{t("requestNewCustomer")}
                  </Button>
                ) : null}
              </div>
            </div>
            <details data-testid="mtm-route-candidate-scope-explanation" className="group mb-2 rounded-lg border border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-sky-950 marker:hidden dark:text-sky-100">
                <span className="flex min-w-0 items-center gap-2">
                  <Users className="h-4 w-4 shrink-0" />
                  <span>{t("candidateScopeWhyTitle")}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-sky-200 px-3 py-2 text-xs leading-5 text-sky-900 dark:border-sky-900 dark:text-sky-200">
                <p>{t(candidateScopeMode === "ACTIVE_CATALOG" ? "candidateScopeCatalogHint" : "candidateScopeAssignedHint", {
                  agent: selectedAgentName ?? t("selectedEmployee"),
                  date: planningDateLabel(date, locale),
                  target: selectedTargetLabel,
                })}</p>
              </div>
            </details>
            <div className="relative">
              <Input
                id="route-builder-customer-search"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder={t("customerSearchPlaceholder")}
                className="pr-10"
                autoComplete="off"
                disabled={!primaryAgentId}
              />
              {customerSearchLoading ? (
                <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : customerSearch ? (
                <button
                  type="button"
                  onClick={() => setCustomerSearch("")}
                  className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={t("clearCustomerSearch")}
                  aria-label={t("clearCustomerSearch")}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            {!primaryAgentId ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t("selectAgentForCandidates")}</p>
            ) : null}
            <details
              data-testid="mtm-route-planning-tools"
              className="group mt-2 rounded-lg border border-zinc-200 dark:border-zinc-700"
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t("planningTools")}</span>
                  {activeCandidateFilters.length > 0 ? (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                      {activeCandidateFilters.length}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {t("candidateResultCount", { shown: visibleCandidates.length, total: candidateTotal })}
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
                <div className="max-w-sm">
                  <Select className="h-11" value={candidateSort} onChange={(event) => setCandidateSort(event.target.value as CandidateSort)} aria-label={t("candidateSort")}>
                    <option value="NAME">{t("sortCandidateName")}</option>
                    <option value="PRIORITY">{t("sortCandidatePriority")}</option>
                    <option value="LAST_VISIT">{t("sortCandidateLastVisit")}</option>
                    {direction === "PHARMACY" ? <option value="COVERAGE_GAP">{t("sortCandidateCoverageGap")}</option> : null}
                  </Select>
                </div>
            <div className="mt-3 border-y border-zinc-200 bg-muted/20 px-2 py-2 dark:border-zinc-700" data-testid="mtm-planning-filter-summary">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold text-foreground">{t("planningScope")}</span>
                <span className="border border-zinc-200 bg-card px-2 py-1 dark:border-zinc-700">
                  {selectedAgentName ?? t("agentNotSelected")}
                </span>
                <span className="border border-zinc-200 bg-card px-2 py-1 dark:border-zinc-700">
                  {date ? planningDateLabel(date, locale) : t("dateNotSelected")}
                </span>
                <span className="border border-zinc-200 bg-card px-2 py-1 dark:border-zinc-700">
                  {selectedRouteTargetType ? routeTargetLabel(selectedRouteTargetType, locale) : t(directionLabelKey(direction))}
                </span>
              </div>
              {activeCandidateFilters.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label={t("activeCandidateFilters", { count: activeCandidateFilters.length })}>
                  {activeCandidateFilters.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => removeCandidateFilter(filter.key)}
                      className="inline-flex min-h-11 max-w-full items-center gap-1 border border-primary/25 bg-primary/5 px-2 text-xs text-foreground hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-9"
                      aria-label={t("removeCandidateFilter", { filter: filter.label, value: filter.value })}
                    >
                      <span className="max-w-56 truncate"><span className="font-medium">{filter.label}:</span> {filter.value}</span>
                      <X className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  ))}
                  <Button type="button" size="sm" variant="ghost" className="min-h-11 lg:min-h-9" onClick={clearAllCandidateFilters}>
                    {t("clearCandidateFilters")}
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">{t("noActiveCandidateFilters")}</p>
              )}
            </div>
            {candidateLimited && candidateSort === "COVERAGE_GAP" ? (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("candidateCoverageSortLimited")}</p>
            ) : null}
            {candidatePagination?.mode === "LEGACY_CAP" && candidateLimited && candidateSort !== "COVERAGE_GAP" ? (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("candidateGlobalSortLimited")}</p>
            ) : null}
              <fieldset
                id="route-builder-advanced-filters"
                className="mt-3 grid gap-2 border-y border-zinc-200 py-3 dark:border-zinc-700 sm:grid-cols-2 xl:grid-cols-4"
              >
                <legend className="sr-only">{t("advancedFilters")}</legend>
                <CandidateFacetSelect
                  label={t("filterRegion")}
                  value={candidateFilters.region}
                  values={candidateRegionOptions}
                  allLabel={t("all")}
                  onChange={(value) => {
                    setCandidateFilters((current) => ({
                      ...current,
                      region: value,
                      administrativeDistrict: "",
                      customerId: "",
                    }))
                    setCandidateDistrictOptions([])
                    setCandidateOrganizationOptions([])
                  }}
                />
                <CandidateFacetSelect
                  label={t("filterAdministrativeDistrict")}
                  value={candidateFilters.administrativeDistrict}
                  values={candidateDistrictOptions}
                  allLabel={candidateFilters.region ? t("all") : t("selectRegionFirst")}
                  disabled={!candidateFilters.region}
                  onChange={(value) => {
                    setCandidateFilters((current) => ({ ...current, administrativeDistrict: value, customerId: "" }))
                    setCandidateOrganizationOptions([])
                  }}
                />
                <CandidateOrganizationSelect
                  label={t("filterOrganization")}
                  value={candidateFilters.customerId}
                  values={candidateOrganizationOptions}
                  allLabel={t("all")}
                  onChange={(value) => setCandidateFilters((current) => ({ ...current, customerId: value }))}
                />
                {direction === "DOCTOR" ? (
                  <>
                    <CandidateFacetSelect label={t("filterSpecialty")} value={candidateFilters.specialtyCode} values={candidateFacets.specialtyCode} allLabel={t("all")} onChange={(value) => setCandidateFilters((current) => ({ ...current, specialtyCode: value }))} />
                    <CandidateFacetSelect label={t("filterPsychotype")} value={candidateFilters.psychotype} values={candidateFacets.psychotype} allLabel={t("all")} onChange={(value) => setCandidateFilters((current) => ({ ...current, psychotype: value }))} />
                  </>
                ) : null}
                <div className="flex items-end">
                  <Button type="button" size="sm" variant="outline" className="min-h-11 w-full lg:min-h-9" onClick={clearAllCandidateFilters}>
                    {t("clearCandidateFilters")}
                  </Button>
                </div>
              </fieldset>
            {coveragePreview?.available && coveragePreview.groups?.length ? (
              <div className="mt-3 border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100" data-testid="mtm-planner-coverage-preview">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{t("candidateCoverageVerified", { version: coveragePreview.policy?.version ?? 0 })}</span>
                  <span className="tabular-nums">{t("candidateCoveragePeriod", { start: coveragePreview.period?.start ?? "—", end: coveragePreview.period?.end ?? "—" })}</span>
                </div>
                {coveragePreview.groups.map((group) => (
                  <p key={group.key} className="mt-1 tabular-nums">
                    {t("candidateCoverageSummary", {
                      group: group.labels?.[coverageLocale] ?? group.key,
                      required: group.requiredCoverage,
                      actual: group.actualCoverage,
                      uncovered: group.uncoveredMoi,
                    })}
                  </p>
                ))}
              </div>
            ) : coveragePreview ? (
              <p className="mt-2 text-xs text-muted-foreground">{t("candidateCoverageUnavailable")}</p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">{t("capacityPolicyPending")}</p>
              </div>
            </details>
            {inlineAssignmentOpen && canManageAssignments ? (
              <RouteBuilderInlineAssignmentPanel
                open={inlineAssignmentOpen}
                onOpenChange={setInlineAssignmentOpen}
                agentId={primaryAgentId}
                date={date}
                direction={direction}
                orgId={orgId}
                onAssigned={addInlineAssignedCandidate}
              />
            ) : (
            <div
              className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2"
              aria-live="polite"
              aria-busy={customerSearchLoading}
            >
              {visibleCandidates.map((candidate, candidateIndex) => {
                const selectedPosition = selectedCustomerPositions.get(stopKey(candidate))
                const availabilityLabel = candidate.availability.source === "DIRECT_CONTACT_ASSIGNMENT"
                  ? t("candidateAvailabilityDirectContact")
                  : candidate.availability.source === "WORKPLACE_ASSIGNMENT"
                    ? t("candidateAvailabilityWorkplace")
                    : candidate.availability.source === "ORGANIZATION_ASSIGNMENT"
                      ? t("candidateAvailabilityOrganization")
                      : t("candidateAvailabilityCatalog")
                const availabilityPeriod = candidate.availability.validFrom
                  ? candidate.availability.validThrough
                    ? t("candidateAvailabilityPeriod", {
                        from: assignmentDateLabel(candidate.availability.validFrom, locale),
                        through: assignmentDateLabel(candidate.availability.validThrough, locale),
                      })
                    : t("candidateAvailabilityOpenEnded", {
                        from: assignmentDateLabel(candidate.availability.validFrom, locale),
                      })
                  : t("candidateAvailabilityCatalogHint")
                const customerDetails = [candidate.code, candidate.specialtyName, candidate.psychotype]
                  .filter(Boolean)
                  .join(" | ")
                const customerLocation = [
                  candidate.customer.name !== candidate.name ? candidate.customer.name : null,
                  candidate.customer.address,
                  candidate.customer.district,
                  candidate.customer.city,
                  candidate.customer.territoryCode,
                ]
                  .filter(Boolean)
                  .join(" | ")
                return (
                  <button
                    key={candidate.id}
                    data-testid="mtm-route-candidate"
                    type="button"
                    disabled={Boolean(selectedPosition)}
                    aria-label={selectedPosition ? t("customerAlreadySelected", { position: selectedPosition }) : t("addCandidateAction", { name: candidate.name })}
                    onClick={() => setStops((current) => [...current, {
                      customerId: candidate.customerId,
                      contactId: candidate.contactId,
                      customer: candidate.customer,
                      contact: candidate.contactId
                        ? { id: candidate.contactId, displayName: candidate.name, specialtyName: candidate.specialtyName }
                        : null,
                    }])}
                    className={`group flex min-h-16 items-center gap-3 rounded-lg border border-zinc-200 bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:border-emerald-200 disabled:bg-emerald-50 disabled:opacity-100 dark:border-zinc-700 dark:disabled:border-emerald-900 dark:disabled:bg-emerald-950/20 ${
                      candidateIndex === visibleCandidates.length - 1 && visibleCandidates.length % 2 === 1
                        ? "sm:col-span-2"
                        : ""
                    }`}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${selectedPosition ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"}`}>
                      {selectedPosition ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="block min-w-0 flex-1 truncate text-sm font-medium">{candidate.name}</span>
                        <span className="shrink-0 border border-zinc-200 px-1.5 py-0.5 text-xs font-medium text-muted-foreground dark:border-zinc-700">
                          {candidate.category}
                        </span>
                      </span>
                      {customerDetails ? (
                        <span className="block truncate text-xs text-muted-foreground">{customerDetails}</span>
                      ) : null}
                      {customerLocation ? (
                        <span className="block truncate text-xs text-muted-foreground">{customerLocation}</span>
                      ) : null}
                      {selectedPosition ? (
                        <span className="block text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          {t("customerAlreadySelected", { position: selectedPosition })}
                        </span>
                      ) : null}
                      <span data-testid="mtm-route-candidate-availability" className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-sky-800 dark:text-sky-200" title={availabilityPeriod}>
                        <Users className="h-3 w-3 shrink-0" />
                        <span className="truncate font-medium">{availabilityLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate text-muted-foreground">{availabilityPeriod}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        <span>{candidate.lastVisitAt ? t("lastVisitValue", { date: candidate.lastVisitAt.slice(0, 10) }) : t("noLastVisit")}</span>
                        {candidate.plannedRoute ? <span className="text-amber-700 dark:text-amber-300">{t("alreadyPlanned", { date: candidate.plannedRoute.date })}</span> : null}
                        {candidate.coverage ? <span className="font-medium text-amber-800 dark:text-amber-300" title={candidate.coverage.explanation.summary[coverageLocale]}>{t("candidateCoverageGap", { value: candidate.coverage.uncoveredMoi })}</span> : null}
                      </span>
                    </span>
                    {!selectedPosition ? (
                      <span className="hidden shrink-0 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary sm:inline-flex">
                        {t("addCandidateShort")}
                      </span>
                    ) : null}
                  </button>
                )
              })}
              {!customerSearchLoading && customerSearchError ? (
                <div role="alert" className="col-span-full flex flex-wrap items-center gap-2 bg-card px-3 py-4 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">{customerSearchError}</span>
                  {candidateLoadErrorCode !== "MTM_ROUTE_SCOPE_DENIED" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={() => setCandidatePageRetryVersion((current) => current + 1)}
                    >
                      <RotateCcw className="h-4 w-4" />{t("candidatePaginationRetry")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {!customerSearchLoading && !customerSearchError && visibleCandidates.length === 0 ? (
                <div className="col-span-full bg-card px-4 py-5 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {!primaryAgentId
                      ? t("selectAgentForCandidates")
                      : customerSearch.trim()
                        ? t("noAvailableCustomers")
                        : activeCandidateFilters.length > 0
                          ? t("noCustomersWithFilters")
                          : t("noCustomers")}
                  </p>
                  {primaryAgentId && customerSearch.trim() ? (
                    <div className="mx-auto mt-2 max-w-xl">
                      <p className="text-sm leading-6 text-muted-foreground">{t("candidateSearchEmptyHint", {
                        agent: selectedAgentName ?? t("selectedEmployee"),
                        date: planningDateLabel(date, locale),
                        target: selectedTargetLabel,
                      })}</p>
                      <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => setCustomerSearch("")}>
                        <X className="h-4 w-4" />
                        {t("clearCustomerSearch")}
                      </Button>
                    </div>
                  ) : primaryAgentId && activeCandidateFilters.length > 0 ? (
                    <div className="mx-auto mt-2 max-w-xl">
                      <p className="text-sm leading-6 text-muted-foreground">{t("candidateFiltersEmptyHint", {
                        agent: selectedAgentName ?? t("selectedEmployee"),
                        date: planningDateLabel(date, locale),
                        target: selectedTargetLabel,
                      })}</p>
                      <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={clearAllCandidateFilters}>
                        <SlidersHorizontal className="h-4 w-4" />
                        {t("clearCandidateFilters")}
                      </Button>
                    </div>
                  ) : primaryAgentId ? (
                    <div className="mx-auto mt-2 max-w-xl">
                      <p className="text-sm leading-6 text-muted-foreground">
                        {candidateScopeMode === "ACTIVE_CATALOG"
                          ? t("candidateCatalogEmptyHint", { target: selectedTargetLabel })
                          : t("candidateAssignmentEmptyHint", {
                              agent: selectedAgentName ?? t("selectedEmployee"),
                              date: planningDateLabel(date, locale),
                              target: selectedTargetLabel,
                            })}
                      </p>
                      {canManageAssignments && candidateScopeMode === "AGENT_ASSIGNMENTS" ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-3 min-h-11"
                          data-testid="mtm-route-inline-assignment-open"
                          onClick={() => setInlineAssignmentOpen(true)}
                        >
                          <Users className="h-4 w-4" />
                          {t("inlineAssignmentOpenAction")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            )}
            {!inlineAssignmentOpen && visibleCandidates.length < candidateResults.length ? (
              <div className="mt-2 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 lg:min-h-9"
                  onClick={() => setVisibleCandidateLimit((current) => current + candidateDisplayPageSize)}
                >
                  {t("showMoreCandidates", {
                    count: Math.min(candidateDisplayPageSize, candidateResults.length - visibleCandidates.length),
                  })}
                </Button>
              </div>
            ) : null}
            {candidatePagingSupported ? (
              <nav
                data-testid="mtm-route-candidate-pagination"
                className="mt-3 flex flex-wrap items-center justify-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700"
                aria-label={t("candidatePaginationLabel")}
              >
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={previousCandidatePage}
                  disabled={!candidateCanGoPrevious || customerSearchLoading || candidatePageTransitioning}
                  aria-label={t("candidatePagePrevious")}
                >
                  <ChevronLeft className="h-4 w-4" />{t("candidatePagePrevious")}
                </Button>
                <span className="min-w-24 text-center text-xs text-muted-foreground" aria-live="polite" aria-atomic="true">
                  {customerSearchLoading ? t("candidatePageLoading") : t("candidatePagePosition", { page: candidatePageIndex + 1 })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={nextCandidatePage}
                  disabled={!candidateCanGoNext || customerSearchLoading || candidatePageTransitioning}
                  aria-label={t("candidatePageNext")}
                >
                  {customerSearchLoading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ChevronRight className="h-4 w-4" />}
                  {t("candidatePageNext")}
                </Button>
              </nav>
            ) : null}
              </>
            )}
              </div>
            ) : null}
              </div>
            </div>
          </div>
        </section>
        ) : null}

        {activeStep === 3 ? (
          <section ref={reviewSectionRef} data-testid="mtm-route-wizard-step-3" className="mx-auto w-full max-w-4xl scroll-mt-4 px-4 py-4 sm:px-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <h3 ref={reviewHeadingRef} tabIndex={-1} className="text-lg font-semibold outline-none">{t("stepReviewRoute")}</h3>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("reviewEditableHint")}</p>
              </div>
              <div className="grid shrink-0 gap-2 sm:grid-cols-2">
                <Button type="button" variant="outline" size="sm" className="min-h-11" data-testid="mtm-route-edit-setup" onClick={() => focusStep(1)}>
                  <PencilLine className="h-4 w-4" />{t("editWhoWhenAction")}
                </Button>
                <Button type="button" variant="outline" size="sm" className="min-h-11" data-testid="mtm-route-edit-customers" onClick={() => focusStep(2)}>
                  <Users className="h-4 w-4" />{t("editCustomersAction")}
                </Button>
              </div>
            </div>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2 border-y border-zinc-200 py-3 dark:border-zinc-700">
              <div>
                <p className="text-sm font-medium">{t("reviewOrderTitle")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("reviewOrderHint")}</p>
              </div>
              {unscheduledStopCount > 0 ? (
                <div className="flex max-w-sm flex-col gap-1 sm:items-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    data-testid="mtm-route-auto-schedule"
                    aria-describedby="mtm-route-auto-schedule-hint"
                    title={t("autoScheduleStopsHint")}
                    onClick={autoScheduleStops}
                  >
                    <Clock3 className="h-4 w-4" />{t("autoScheduleStops")}
                  </Button>
                  <p id="mtm-route-auto-schedule-hint" className="text-xs text-muted-foreground sm:text-right">{t("autoScheduleStopsHint")}</p>
                </div>
              ) : null}
            </div>
            <div data-testid="mtm-route-meeting-assistant">
              {meetingAvailabilityLoading ? (
                <div data-testid="mtm-route-meeting-assistant-loading" role="status" className="mb-2 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-200">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  {t("meetingAssistantLoading")}
                </div>
              ) : null}
              <div className="divide-y divide-zinc-200 border-b border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
              {stops.map((stop, index) => {
                const locked = isPublishedEdit && stop.status !== undefined && stop.status !== "PENDING"
                const stopMeetingNotices = stop.plannedTime
                  ? meetingAvailabilityByStop.get(meetingAvailabilityKey(
                      stop.customerId,
                      stop.contactId,
                      localDateTimeToUtc(`${date}T${stop.plannedTime}`, timezone).toISOString(),
                    )) ?? []
                  : []
                return (
                  <div key={stopKey(stop)} data-testid={`mtm-route-stop-${index}`} className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-zinc-200 text-xs font-semibold tabular-nums dark:border-zinc-700">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{stop.contact?.displayName ?? stop.customer.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[stop.contact ? stop.customer.name : null, stop.contact?.specialtyName, stop.customer.address ?? stop.customer.city ?? stop.customer.code].filter(Boolean).join(" · ")}
                      </span>
                      {locked ? <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><LockKeyhole className="h-3 w-3" />{t("stopLocked")}</span> : null}
                      {stopMeetingNotices.map((notice) => {
                        const agentNames = notice.agents.map((agent) => agent.name).join(", ")
                        return (
                          <div
                            key={`${notice.kind}:${agentNames}`}
                            data-testid={notice.kind === "same-agent" ? "mtm-route-meeting-conflict" : "mtm-route-meeting-coordination"}
                            className={`mt-2 flex max-w-xl items-start gap-1.5 rounded-md px-2 py-1.5 text-xs leading-5 ${
                              notice.kind === "same-agent"
                                ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                                : "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                            }`}
                          >
                            {notice.kind === "same-agent" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                            <div className="min-w-0">
                              <div className="font-medium">
                                {notice.kind === "same-agent"
                                  ? t("meetingAssistantBusy", { agents: agentNames, time: notice.plannedTime })
                                  : t(notice.sameContact ? "meetingAssistantTogetherContact" : "meetingAssistantTogether", {
                                      agents: agentNames,
                                      customer: notice.customerName,
                                      contact: notice.contactName ?? notice.customerName,
                                      time: notice.plannedTime,
                                    })}
                              </div>
                              <div className="opacity-90">
                                {notice.kind === "same-agent" ? t("meetingAssistantBusyHint") : t("meetingAssistantJointHint")}
                              </div>
                              {notice.kind === "same-agent" && !locked ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="mt-2 min-h-9 bg-white/80 text-xs hover:bg-white dark:bg-zinc-950/50 dark:hover:bg-zinc-950"
                                  data-testid="mtm-route-find-next-free-time"
                                  disabled={resolvingConflictStopKey === stopKey(stop)}
                                  onClick={() => void findNextAvailableTime(index)}
                                >
                                  {resolvingConflictStopKey === stopKey(stop)
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                                    : <Clock3 className="h-3.5 w-3.5" />}
                                  {resolvingConflictStopKey === stopKey(stop)
                                    ? t("findingNextFreeTime")
                                    : t("findNextFreeTime")}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </span>
                    <div className="col-span-2 flex flex-wrap items-center justify-end gap-1 sm:col-span-1 sm:flex-nowrap">
                      <div className="w-28 shrink-0">
                        <Label htmlFor={`route-stop-time-${index}`} className="sr-only">{t("plannedTime")}</Label>
                        <Select
                          id={`route-stop-time-${index}`}
                          data-testid={`mtm-route-stop-time-${index}`}
                          value={stop.plannedTime ?? ""}
                          onChange={(event) => updateStopTime(index, event.target.value)}
                          disabled={locked}
                          title={t("plannedTime")}
                          aria-label={`${t("plannedTime")}: ${stop.contact?.displayName ?? stop.customer.name}`}
                          className="h-11 px-2 text-xs"
                        >
                          <option value="">—</option>
                          {MTM_ROUTE_TIME_SLOTS.map((time) => <option key={time} value={time}>{time}</option>)}
                        </Select>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={() => moveStop(index, -1)} disabled={locked || index === 0} title={t("moveUp")} aria-label={t("moveStopUp", { name: stop.contact?.displayName ?? stop.customer.name })}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={() => moveStop(index, 1)} disabled={locked || index === stops.length - 1} title={t("moveDown")} aria-label={t("moveStopDown", { name: stop.contact?.displayName ?? stop.customer.name })}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 text-destructive" disabled={locked} onClick={() => removeStop(index)} title={locked ? t("stopLocked") : t("removeStop")} aria-label={locked ? t("stopLocked") : t("removeStopNamed", { name: stop.contact?.displayName ?? stop.customer.name })}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
              {stops.length === 0 ? (
                <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
                  <UserRound className="h-5 w-5" />
                  <span>{setupComplete ? t("noStops") : t("routeSetupRequiredHint")}</span>
                  <Button
                    type="button"
                    className="mt-1 min-h-11"
                    data-testid="mtm-route-empty-next-action"
                    onClick={() => focusStep(setupComplete ? 2 : 1)}
                  >
                    {setupComplete ? <Plus className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                    {setupComplete ? t("addRouteStopAction") : t("chooseEmployeeAction")}
                  </Button>
                </div>
              ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={async () => { onClose() }}
        title={t("discardBuilderTitle")}
        description={t("discardBuilderBody", { count: stops.length })}
        confirmLabel={t("discardBuilderConfirm")}
      />
      <div data-testid="mtm-route-builder-actions" className="sticky bottom-0 z-20 flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200 bg-card px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_18px_rgba(15,23,42,0.06)] dark:border-zinc-700 sm:px-4">
        <div id="route-builder-next-action" className="hidden min-w-0 items-start gap-2 text-sm sm:flex sm:flex-1" role="status" aria-live="polite">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <span className="text-[10px] font-bold">{activeStep}</span>
          </span>
          <span className="min-w-0">
            <span className="block font-medium">{t(primaryAction === "save" ? "readyToSaveTitle" : "nextActionTitle")}</span>
            <span className="block text-xs text-muted-foreground">
              {primaryAction === "agent"
                ? t("nextChooseEmployeeHint")
                : primaryAction === "date"
                  ? t("nextChooseDateHint")
                  : primaryAction === "continue"
                    ? t("nextAddCustomerHint")
                    : primaryAction === "review"
                      ? t("nextFinishCustomersHint", { count: stops.length })
                      : t("readyToSaveHint", { employee: selectedAgentName ?? "—", count: stops.length })}
            </span>
          </span>
        </div>
        <div className="flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto sm:shrink-0">
          {activeStep > 1 ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 min-w-11 shrink-0 px-3 sm:min-w-0 sm:px-4"
              data-testid="mtm-route-wizard-back"
              aria-label={activeStep === 3 ? t("editCustomersAction") : t("backAction")}
              onClick={() => focusStep(activeStep === 3 ? 2 : 1)}
            >
              <ChevronLeft className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">{activeStep === 3 ? t("editCustomersAction") : t("backAction")}</span>
            </Button>
          ) : null}
          <Button type="button" variant="ghost" className="hidden min-h-11 sm:inline-flex" data-testid="mtm-route-builder-cancel" onClick={requestClose}>{t("cancelBuilder")}</Button>
          {canPublishFromBuilder && activeStep === 3 ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 min-w-11 shrink-0 px-3 sm:min-w-0 sm:px-4"
              data-testid="mtm-route-save-draft"
              aria-label={isEditing ? t("saveChanges") : t("saveDraft")}
              onClick={() => void save("draft")}
              disabled={savingAction !== null}
            >
              {savingAction === "draft" ? (
                <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /><span className="hidden sm:inline">{t("saving")}</span></>
              ) : (
                <><Check className="h-4 w-4" /><span className="hidden sm:inline">{isEditing ? t("saveChanges") : t("saveDraft")}</span></>
              )}
            </Button>
          ) : null}
          <Button
            type="button"
            className="min-h-12 min-w-0 flex-1 px-4 text-sm sm:min-w-48 sm:flex-none"
            data-testid="mtm-route-primary-action"
            onClick={runPrimaryAction}
            disabled={savingAction !== null || (primaryAction === "review" && !customersComplete)}
            aria-describedby="route-builder-next-action"
            aria-busy={savingAction !== null}
          >
            {savingAction !== null ? (
              <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />{savingAction === "publish" ? t("publishing") : t("saving")}</>
            ) : (
              <>
                {primaryAction === "agent" ? <UserRound className="h-4 w-4" /> : primaryAction === "date" ? <CalendarDays className="h-4 w-4" /> : primaryAction === "continue" ? <Plus className="h-4 w-4" /> : primaryAction === "review" ? <Check className="h-4 w-4" /> : canPublishFromBuilder ? <Send className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                {primaryActionLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  )
}
