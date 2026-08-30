"use client"

import type { FormEvent } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { CalendarClock, Check, Loader2, MapPin, Pencil, Plus, RefreshCw, Settings2, X } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  workforceDefaultPolicyDefinition,
  workforceDefaultShiftDefinition,
} from "@/lib/workforce/default-profile"

type PolicyDefinition = {
  expectedWorkSeconds: number
  lateGraceSeconds: number
  undertimeToleranceSeconds: number
  overtimeThresholdSeconds: number
  longPauseThresholdSeconds: number | null
}

type ShiftDefinition = {
  startTime: string
  endTime: string
  timezone: string
  daysOfWeek: number[]
  plannedBreaks?: Array<{
    startTime: string
    endTime: string
  }>
}

type WorkforcePolicy = {
  id: string
  teamId: string | null
  version: number
  status: "DRAFT" | "ACTIVE"
  name: string
  effectiveFrom: string
  effectiveTo: string | null
  definition: PolicyDefinition
  definitionHash: string
  provenance: "TENANT_ADMIN" | "SYSTEM_PROVISIONING"
  systemProfileVersion: string | null
}

type WorkforceShift = {
  id: string
  teamId: string | null
  code: string
  isDefault: boolean
  version: number
  status: "DRAFT" | "ACTIVE"
  name: string
  timezone: string
  definition: ShiftDefinition
  definitionHash: string
  provenance: "TENANT_ADMIN" | "SYSTEM_PROVISIONING"
  systemProfileVersion: string | null
}

type WorkforceEmployee = {
  id: string
  name: string | null
  email: string | null
  externalCode: string | null
  teamId: string | null
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED"
  team: WorkforceTeam | null
}

type WorkforceTeam = {
  id: string
  name: string
  code: string | null
  isActive: boolean
}

type WorkforceSite = {
  id: string
  code: string
  name: string
  type: string
  timezone: string
  addressLabel: string | null
  responsibleTeamId: string | null
  status: "ACTIVE" | "ARCHIVED"
}

type WorkforceSiteAssignment = {
  id: string
  agentId: string
  siteId: string
  kind: "PRIMARY" | "SECONDARY" | "TEMPORARY"
  effectiveFrom: string
  effectiveTo: string | null
}

type WorkforceSiteGeofenceRevision = {
  id: string
  siteId: string
  revision: number
  kind: "CIRCLE"
  centerLatitude: number
  centerLongitude: number
  radiusMeters: number
  calibrationReference: string
  definitionHash: string
  effectiveFrom: string
  effectiveTo: string | null
}

type WorkforceShiftRosterItem = {
  id: string
  code: string
  name: string
  timezone: string
  teamId: string | null
  isDefault: boolean
}

type WorkforceShiftAssignment = {
  id: string
  agentId: string
  templateId: string
  effectiveFrom: string
  effectiveTo: string | null
  agent: WorkforceEmployee
  template: WorkforceShiftRosterItem
}

type WorkforceShiftDefaultAssignment = {
  id: string
  templateId: string
  effectiveFrom: string
  effectiveTo: string | null
  template: WorkforceShiftRosterItem
}

type ConfigurationData = {
  policies: WorkforcePolicy[]
  shifts: WorkforceShift[]
  assignments: WorkforceShiftAssignment[]
  roster: {
    employees: WorkforceEmployee[]
    teams: WorkforceTeam[]
    shiftTemplates: WorkforceShiftRosterItem[]
  }
  sites: WorkforceSite[]
  siteAssignments: WorkforceSiteAssignment[]
  directoryEmployees: WorkforceEmployee[]
  defaultAssignments: WorkforceShiftDefaultAssignment[]
}

type PolicyForm = {
  id: string | null
  name: string
  teamId: string
  effectiveFrom: string
  effectiveTo: string
  expectedWorkSeconds: string
  lateGraceSeconds: string
  undertimeToleranceSeconds: string
  overtimeThresholdSeconds: string
  longPauseThresholdSeconds: string
}

type ShiftForm = {
  id: string | null
  code: string
  name: string
  teamId: string
  startTime: string
  endTime: string
  timezone: string
  daysOfWeek: number[]
  plannedBreaks: Array<{
    startTime: string
    endTime: string
  }>
}

type AssignmentForm = {
  agentId: string
  templateId: string
  effectiveFrom: string
}

type BulkAssignmentDraft = {
  agentIds: string[]
  templateId: string
  effectiveFrom: string
}

type BulkAssignmentOutcome = "READY" | "NO_CHANGE" | "EMPLOYEE_UNAVAILABLE" | "TEMPLATE_TEAM_MISMATCH" | "CONFLICT"

type BulkAssignmentPreview = {
  effectiveFrom: string
  templateId: string
  items: Array<{
    agentId: string
    outcome: BulkAssignmentOutcome
    currentAssignmentId: string | null
    closesAssignmentId: string | null
  }>
  summary: Record<BulkAssignmentOutcome, number>
}

type DefaultAssignmentForm = {
  templateId: string
  effectiveFrom: string
}

type SiteAssignmentForm = {
  agentId: string
  siteId: string
  kind: "PRIMARY" | "SECONDARY" | "TEMPORARY"
  effectiveFrom: string
  effectiveTo: string
}

type SiteForm = {
  code: string
  name: string
  type: "OFFICE" | "WAREHOUSE" | "TEMPORARY" | "CUSTOMER" | "HOME_REMOTE"
  timezone: string
  addressLabel: string
  responsibleTeamId: string
}

type GeofenceForm = {
  effectiveFrom: string
  centerLatitude: string
  centerLongitude: string
  radiusMeters: string
  calibrationReference: string
}

function emptyPolicyForm(): PolicyForm {
  const definition = workforceDefaultPolicyDefinition()
  return {
    id: null,
    name: "",
    teamId: "",
    effectiveFrom: "",
    effectiveTo: "",
    expectedWorkSeconds: String(definition.expectedWorkSeconds),
    lateGraceSeconds: String(definition.lateGraceSeconds),
    undertimeToleranceSeconds: String(definition.undertimeToleranceSeconds),
    overtimeThresholdSeconds: String(definition.overtimeThresholdSeconds),
    longPauseThresholdSeconds: String(definition.longPauseThresholdSeconds),
  }
}

function emptyShiftForm(): ShiftForm {
  const definition = workforceDefaultShiftDefinition()
  return {
    id: null,
    code: "",
    name: "",
    teamId: "",
    startTime: definition.startTime,
    endTime: definition.endTime,
    timezone: definition.timezone,
    daysOfWeek: definition.daysOfWeek,
    plannedBreaks: definition.plannedBreaks,
  }
}

function emptyAssignmentForm(): AssignmentForm {
  return { agentId: "", templateId: "", effectiveFrom: "" }
}

function emptyBulkAssignmentDraft(): BulkAssignmentDraft {
  return { agentIds: [], templateId: "", effectiveFrom: "" }
}

function emptyDefaultAssignmentForm(): DefaultAssignmentForm {
  return { templateId: "", effectiveFrom: "" }
}

function emptySiteAssignmentForm(): SiteAssignmentForm {
  return { agentId: "", siteId: "", kind: "PRIMARY", effectiveFrom: "", effectiveTo: "" }
}

function emptySiteForm(): SiteForm {
  return {
    code: "",
    name: "",
    type: "OFFICE",
    timezone: workforceDefaultShiftDefinition().timezone,
    addressLabel: "",
    responsibleTeamId: "",
  }
}

function emptyGeofenceForm(): GeofenceForm {
  return { effectiveFrom: "", centerLatitude: "", centerLongitude: "", radiusMeters: "", calibrationReference: "" }
}

function asDateKey(value: string | null): string {
  return value ? value.slice(0, 10) : ""
}

function integerValue(value: string): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function finiteNumberValue(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function mapPinHref(latitude: number | null, longitude: number | null): string | null {
  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(latitude))}&mlon=${encodeURIComponent(String(longitude))}#map=18/${latitude}/${longitude}`
}

function messageForError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function WorkforceConfigurationWorkbench() {
  const { data: session, status: sessionStatus } = useSession()
  const t = useTranslations("workforceConfigurationPage")
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const role = session?.user?.role
  const isAdministrator = role === "admin" || role === "superadmin"
  const [data, setData] = useState<ConfigurationData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [policyForm, setPolicyForm] = useState<PolicyForm>(emptyPolicyForm)
  const [shiftForm, setShiftForm] = useState<ShiftForm>(emptyShiftForm)
  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>(emptyAssignmentForm)
  const [bulkAssignmentDraft, setBulkAssignmentDraft] = useState<BulkAssignmentDraft>(emptyBulkAssignmentDraft)
  const [bulkAssignmentPreview, setBulkAssignmentPreview] = useState<BulkAssignmentPreview | null>(null)
  const [siteAssignmentForm, setSiteAssignmentForm] = useState<SiteAssignmentForm>(emptySiteAssignmentForm)
  const [siteForm, setSiteForm] = useState<SiteForm>(emptySiteForm)
  const [geofenceForm, setGeofenceForm] = useState<GeofenceForm>(emptyGeofenceForm)
  const [selectedGeofenceSiteId, setSelectedGeofenceSiteId] = useState("")
  const [geofenceRevisions, setGeofenceRevisions] = useState<WorkforceSiteGeofenceRevision[]>([])
  const [geofenceError, setGeofenceError] = useState<string | null>(null)
  const [defaultAssignmentForm, setDefaultAssignmentForm] = useState<DefaultAssignmentForm>(emptyDefaultAssignmentForm)
  const [assignmentPreviewDate, setAssignmentPreviewDate] = useState("")
  const [assignmentPreview, setAssignmentPreview] = useState<WorkforceShiftAssignment[] | null>(null)
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [savingShift, setSavingShift] = useState(false)
  const [savingAssignment, setSavingAssignment] = useState(false)
  const [savingSiteAssignment, setSavingSiteAssignment] = useState(false)
  const [savingSite, setSavingSite] = useState(false)
  const [savingGeofence, setSavingGeofence] = useState(false)
  const [loadingGeofences, setLoadingGeofences] = useState(false)
  const [savingDefaultAssignment, setSavingDefaultAssignment] = useState(false)
  const [previewingAssignments, setPreviewingAssignments] = useState(false)
  const [previewingBulkAssignments, setPreviewingBulkAssignments] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)

  const request = useCallback(async (path: string, method: "GET" | "POST" | "PATCH", body?: unknown) => {
    if (!organizationId) throw new Error(t("organizationUnavailable"))
    const response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "x-organization-id": organizationId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.success) throw new Error(result.error || "HTTP " + response.status)
    return result.data as unknown
  }, [organizationId, t])

  const load = useCallback(async () => {
    if (!organizationId || !isAdministrator) return
    setLoading(true)
    setError(null)
    try {
      const [policyData, shiftData, assignmentData, siteData, siteAssignmentData, defaultAssignmentData] = await Promise.all([
        request("/api/v1/workforce/configuration/policies", "GET") as Promise<{ policies: WorkforcePolicy[] }>,
        request("/api/v1/workforce/configuration/shifts", "GET") as Promise<{ shifts: WorkforceShift[] }>,
        request("/api/v1/workforce/configuration/assignments", "GET") as Promise<{
          assignments: WorkforceShiftAssignment[]
          roster: { employees: WorkforceEmployee[], teams: WorkforceTeam[], shiftTemplates: WorkforceShiftRosterItem[] }
          directoryEmployees: WorkforceEmployee[]
        }>,
        request("/api/v1/workforce/configuration/sites", "GET") as Promise<{
          sites: WorkforceSite[]
        }>,
        request("/api/v1/workforce/configuration/site-assignments", "GET") as Promise<{
          assignments: WorkforceSiteAssignment[]
        }>,
        request("/api/v1/workforce/configuration/shifts/default", "GET") as Promise<{
          defaultAssignments: WorkforceShiftDefaultAssignment[]
        }>,
      ])
      setData({
        policies: policyData.policies,
        shifts: shiftData.shifts,
        assignments: assignmentData.assignments,
        roster: assignmentData.roster,
        sites: siteData.sites,
        siteAssignments: siteAssignmentData.assignments,
        directoryEmployees: assignmentData.directoryEmployees,
        defaultAssignments: defaultAssignmentData.defaultAssignments,
      })
    } catch (cause) {
      setData(null)
      setError(messageForError(cause, t("loadFailed")))
    } finally {
      setLoading(false)
    }
  }, [isAdministrator, organizationId, request, t])

  useEffect(() => {
    void load()
  }, [load])

  const loadGeofenceRevisions = useCallback(async () => {
    if (!organizationId || !selectedGeofenceSiteId) {
      setGeofenceRevisions([])
      setGeofenceError(null)
      return
    }
    setLoadingGeofences(true)
    setGeofenceError(null)
    try {
      const result = await request(
        "/api/v1/workforce/configuration/sites/" + encodeURIComponent(selectedGeofenceSiteId) + "/geofences",
        "GET",
      ) as { revisions: WorkforceSiteGeofenceRevision[] }
      setGeofenceRevisions(result.revisions)
    } catch (cause) {
      setGeofenceRevisions([])
      setGeofenceError(messageForError(cause, t("geofenceLoadFailed")))
    } finally {
      setLoadingGeofences(false)
    }
  }, [organizationId, request, selectedGeofenceSiteId, t])

  useEffect(() => {
    void loadGeofenceRevisions()
  }, [loadGeofenceRevisions])

  const policyFormTitle = policyForm.id ? t("editPolicyDraft") : t("newPolicyDraft")
  const shiftFormTitle = shiftForm.id ? t("editShiftDraft") : t("newShiftDraft")
  const weekdays = useMemo(() => [
    { value: 1, key: "monday" },
    { value: 2, key: "tuesday" },
    { value: 3, key: "wednesday" },
    { value: 4, key: "thursday" },
    { value: 5, key: "friday" },
    { value: 6, key: "saturday" },
    { value: 7, key: "sunday" },
  ], [])
  const employeeLabel = (employee: WorkforceEmployee) => [
    employee.name || employee.email || employee.externalCode || t("unnamedEmployee"),
    employee.team?.name ?? t("unassignedTeam"),
    t("directoryStatus." + employee.status),
  ].join(" · ")
  const bulkAssignmentEmployeesById = useMemo(() => new Map(
    (data?.roster.employees ?? []).map((employee) => [employee.id, employee]),
  ), [data?.roster.employees])
  const bulkAssignmentEmployeeLabel = (agentId: string) => {
    const employee = bulkAssignmentEmployeesById.get(agentId)
    return employee ? employeeLabel(employee) : t("unavailableEmployee")
  }
  const siteLabel = (site: WorkforceSite) => [
    site.name,
    site.code,
    t("directoryStatus." + site.status),
  ].join(" · ")
  const selectedGeofenceSite = data?.sites.find((site) => site.id === selectedGeofenceSiteId) ?? null
  const geofenceImpactAssignments = useMemo(() => {
    if (!data || !selectedGeofenceSiteId || !geofenceForm.effectiveFrom) return []
    return data.siteAssignments.filter((assignment) => (
      assignment.siteId === selectedGeofenceSiteId
      && assignment.effectiveFrom.slice(0, 10) <= geofenceForm.effectiveFrom
      && (assignment.effectiveTo == null || assignment.effectiveTo.slice(0, 10) >= geofenceForm.effectiveFrom)
    ))
  }, [data, geofenceForm.effectiveFrom, selectedGeofenceSiteId])

  function startPolicyEdit(policy: WorkforcePolicy) {
    const definition = policy.definition
    setPolicyForm({
      id: policy.id,
      name: policy.name,
      teamId: policy.teamId ?? "",
      effectiveFrom: asDateKey(policy.effectiveFrom),
      effectiveTo: asDateKey(policy.effectiveTo),
      expectedWorkSeconds: String(definition.expectedWorkSeconds),
      lateGraceSeconds: String(definition.lateGraceSeconds),
      undertimeToleranceSeconds: String(definition.undertimeToleranceSeconds),
      overtimeThresholdSeconds: String(definition.overtimeThresholdSeconds),
      longPauseThresholdSeconds: definition.longPauseThresholdSeconds == null ? "" : String(definition.longPauseThresholdSeconds),
    })
  }

  function startShiftEdit(shift: WorkforceShift) {
    const definition = shift.definition
    setShiftForm({
      id: shift.id,
      code: shift.code,
      name: shift.name,
      teamId: shift.teamId ?? "",
      startTime: definition.startTime,
      endTime: definition.endTime,
      timezone: definition.timezone,
      daysOfWeek: definition.daysOfWeek,
      plannedBreaks: definition.plannedBreaks ?? [],
    })
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const expectedWorkSeconds = integerValue(policyForm.expectedWorkSeconds)
    const lateGraceSeconds = integerValue(policyForm.lateGraceSeconds)
    const undertimeToleranceSeconds = integerValue(policyForm.undertimeToleranceSeconds)
    const overtimeThresholdSeconds = integerValue(policyForm.overtimeThresholdSeconds)
    const longPauseThresholdSeconds = policyForm.longPauseThresholdSeconds.trim()
      ? integerValue(policyForm.longPauseThresholdSeconds)
      : null
    if (
      !policyForm.name.trim()
      || !policyForm.effectiveFrom
      || expectedWorkSeconds == null
      || lateGraceSeconds == null
      || undertimeToleranceSeconds == null
      || overtimeThresholdSeconds == null
      || (policyForm.longPauseThresholdSeconds.trim() && longPauseThresholdSeconds == null)
    ) {
      toast.error(t("policyValidationFailed"))
      return
    }
    setSavingPolicy(true)
    try {
      const definition = {
        expectedWorkSeconds,
        lateGraceSeconds,
        undertimeToleranceSeconds,
        overtimeThresholdSeconds,
        longPauseThresholdSeconds,
      }
      if (policyForm.id) {
        await request("/api/v1/workforce/configuration/policies/" + encodeURIComponent(policyForm.id), "PATCH", {
          name: policyForm.name.trim(),
          effectiveFrom: policyForm.effectiveFrom,
          effectiveTo: policyForm.effectiveTo || null,
          definition,
        })
      } else {
        await request("/api/v1/workforce/configuration/policies", "POST", {
          name: policyForm.name.trim(),
          teamId: policyForm.teamId.trim() || null,
          effectiveFrom: policyForm.effectiveFrom,
          effectiveTo: policyForm.effectiveTo || null,
          definition,
        })
      }
      setPolicyForm(emptyPolicyForm())
      toast.success(t("policySaved"))
      await load()
    } catch (cause) {
      toast.error(messageForError(cause, t("saveFailed")))
    } finally {
      setSavingPolicy(false)
    }
  }

  async function saveShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const plannedBreaks = shiftForm.plannedBreaks.map((plannedBreak) => ({
      startTime: plannedBreak.startTime.trim(),
      endTime: plannedBreak.endTime.trim(),
    }))
    if (
      !shiftForm.code.trim()
      || !shiftForm.name.trim()
      || !shiftForm.startTime
      || !shiftForm.endTime
      || !shiftForm.timezone.trim()
      || shiftForm.daysOfWeek.length === 0
      || plannedBreaks.some((plannedBreak) => !plannedBreak.startTime || !plannedBreak.endTime)
    ) {
      toast.error(t("shiftValidationFailed"))
      return
    }
    setSavingShift(true)
    try {
      const definition = {
        startTime: shiftForm.startTime,
        endTime: shiftForm.endTime,
        timezone: shiftForm.timezone.trim(),
        daysOfWeek: [...shiftForm.daysOfWeek].sort((left, right) => left - right),
        ...(plannedBreaks.length > 0 ? { plannedBreaks } : {}),
      }
      if (shiftForm.id) {
        await request("/api/v1/workforce/configuration/shifts/" + encodeURIComponent(shiftForm.id), "PATCH", {
          name: shiftForm.name.trim(),
          definition,
        })
      } else {
        await request("/api/v1/workforce/configuration/shifts", "POST", {
          code: shiftForm.code.trim(),
          name: shiftForm.name.trim(),
          teamId: shiftForm.teamId.trim() || null,
          definition,
        })
      }
      setShiftForm(emptyShiftForm())
      toast.success(t("shiftSaved"))
      await load()
    } catch (cause) {
      toast.error(messageForError(cause, t("saveFailed")))
    } finally {
      setSavingShift(false)
    }
  }

  async function saveAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!assignmentForm.agentId || !assignmentForm.templateId || !assignmentForm.effectiveFrom) {
      toast.error(t("assignmentValidationFailed"))
      return
    }
    setSavingAssignment(true)
    try {
      await request("/api/v1/workforce/configuration/assignments", "POST", assignmentForm)
      setAssignmentForm(emptyAssignmentForm())
      setAssignmentPreview(null)
      toast.success(t("assignmentSaved"))
      await load()
    } catch (cause) {
      toast.error(messageForError(cause, t("saveFailed")))
    } finally {
      setSavingAssignment(false)
    }
  }

  async function saveSiteAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!siteAssignmentForm.agentId || !siteAssignmentForm.siteId || !siteAssignmentForm.effectiveFrom || (siteAssignmentForm.kind === "TEMPORARY" && !siteAssignmentForm.effectiveTo)) {
      toast.error(t("siteAssignmentValidationFailed"))
      return
    }
    setSavingSiteAssignment(true)
    try {
      await request("/api/v1/workforce/configuration/site-assignments", "POST", {
        ...siteAssignmentForm,
        effectiveTo: siteAssignmentForm.effectiveTo || null,
      })
      setSiteAssignmentForm(emptySiteAssignmentForm())
      toast.success(t("siteAssignmentSaved"))
      await load()
    } catch (cause) {
      toast.error(messageForError(cause, t("saveFailed")))
    } finally {
      setSavingSiteAssignment(false)
    }
  }

  async function saveSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!siteForm.code.trim() || !siteForm.name.trim() || !siteForm.timezone.trim()) {
      toast.error(t("siteValidationFailed"))
      return
    }
    setSavingSite(true)
    try {
      const result = await request("/api/v1/workforce/configuration/sites", "POST", {
        code: siteForm.code.trim(),
        name: siteForm.name.trim(),
        type: siteForm.type,
        timezone: siteForm.timezone.trim(),
        addressLabel: siteForm.addressLabel.trim() || null,
        responsibleTeamId: siteForm.responsibleTeamId || null,
      }) as { site: WorkforceSite }
      setSiteForm(emptySiteForm())
      setSelectedGeofenceSiteId(result.site.id)
      toast.success(t("siteSaved"))
      await load()
    } catch (cause) {
      toast.error(messageForError(cause, t("saveFailed")))
    } finally {
      setSavingSite(false)
    }
  }

  async function saveGeofence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const centerLatitude = finiteNumberValue(geofenceForm.centerLatitude)
    const centerLongitude = finiteNumberValue(geofenceForm.centerLongitude)
    const radiusMeters = integerValue(geofenceForm.radiusMeters)
    if (
      !selectedGeofenceSite
      || !geofenceForm.effectiveFrom
      || centerLatitude == null || centerLatitude < -90 || centerLatitude > 90
      || centerLongitude == null || centerLongitude < -180 || centerLongitude > 180
      || radiusMeters == null || radiusMeters < 25 || radiusMeters > 5_000
      || !geofenceForm.calibrationReference.trim()
    ) {
      toast.error(t("geofenceValidationFailed"))
      return
    }
    setSavingGeofence(true)
    try {
      await request(
        "/api/v1/workforce/configuration/sites/" + encodeURIComponent(selectedGeofenceSite.id) + "/geofences",
        "POST",
        {
          effectiveFrom: geofenceForm.effectiveFrom,
          centerLatitude,
          centerLongitude,
          radiusMeters,
          calibrationReference: geofenceForm.calibrationReference.trim(),
        },
      )
      setGeofenceForm(emptyGeofenceForm())
      toast.success(t("geofenceSaved"))
      await loadGeofenceRevisions()
    } catch (cause) {
      toast.error(messageForError(cause, t("saveFailed")))
    } finally {
      setSavingGeofence(false)
    }
  }

  async function saveDefaultAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!defaultAssignmentForm.templateId || !defaultAssignmentForm.effectiveFrom) {
      toast.error(t("defaultAssignmentValidationFailed"))
      return
    }
    setSavingDefaultAssignment(true)
    try {
      await request("/api/v1/workforce/configuration/shifts/default", "POST", defaultAssignmentForm)
      setDefaultAssignmentForm(emptyDefaultAssignmentForm())
      toast.success(t("defaultAssignmentSaved"))
      await load()
    } catch (cause) {
      toast.error(messageForError(cause, t("saveFailed")))
    } finally {
      setSavingDefaultAssignment(false)
    }
  }

  async function previewAssignmentsForDate() {
    if (!assignmentPreviewDate) {
      toast.error(t("assignmentPreviewDateRequired"))
      return
    }
    setPreviewingAssignments(true)
    try {
      const previewData = await request(
        "/api/v1/workforce/configuration/assignments?effectiveDate=" + encodeURIComponent(assignmentPreviewDate),
        "GET",
      ) as { preview: { assignments: WorkforceShiftAssignment[] } | null }
      setAssignmentPreview(previewData.preview?.assignments ?? [])
    } catch (cause) {
      toast.error(messageForError(cause, t("saveFailed")))
    } finally {
      setPreviewingAssignments(false)
    }
  }

  function updateBulkAssignmentDraft(update: (current: BulkAssignmentDraft) => BulkAssignmentDraft) {
    setBulkAssignmentDraft((current) => update(current))
    // Results describe one exact local draft only. Editing any input makes a
    // former result stale; clearing it prevents a review from being mistaken
    // for an approval of a different set of employees or date.
    setBulkAssignmentPreview(null)
  }

  function toggleBulkAssignmentEmployee(agentId: string) {
    updateBulkAssignmentDraft((current) => {
      if (current.agentIds.includes(agentId)) {
        return { ...current, agentIds: current.agentIds.filter((id) => id !== agentId) }
      }
      if (current.agentIds.length >= 200) return current
      return { ...current, agentIds: [...current.agentIds, agentId] }
    })
  }

  async function previewBulkAssignments() {
    if (!bulkAssignmentDraft.templateId || !bulkAssignmentDraft.effectiveFrom || bulkAssignmentDraft.agentIds.length === 0) {
      toast.error(t("bulkAssignmentValidationFailed"))
      return
    }
    setPreviewingBulkAssignments(true)
    try {
      const preview = await request(
        "/api/v1/workforce/configuration/assignments/preview",
        "POST",
        bulkAssignmentDraft,
      ) as BulkAssignmentPreview
      setBulkAssignmentPreview(preview)
    } catch (cause) {
      toast.error(messageForError(cause, t("saveFailed")))
    } finally {
      setPreviewingBulkAssignments(false)
    }
  }

  async function activate(kind: "policy" | "shift", id: string) {
    setActivating(kind + ":" + id)
    try {
      const path = kind === "policy"
        ? "/api/v1/workforce/configuration/policies/" + encodeURIComponent(id) + "/activate"
        : "/api/v1/workforce/configuration/shifts/" + encodeURIComponent(id) + "/activate"
      await request(path, "POST", {})
      toast.success(kind === "policy" ? t("policyActivated") : t("shiftActivated"))
      await load()
    } catch (cause) {
      toast.error(messageForError(cause, t("saveFailed")))
    } finally {
      setActivating(null)
    }
  }

  if (sessionStatus === "loading") {
    return <div className="h-48 animate-pulse border-y border-zinc-200 bg-muted/40 motion-reduce:animate-none" aria-label={t("loading")} role="status" />
  }

  if (!isAdministrator) {
    return (
      <section className="border-y border-zinc-200 py-6 dark:border-zinc-700" role="alert">
        <PageDescription icon={Settings2} title={t("adminOnlyTitle")} description={t("adminOnlyHint")} />
      </section>
    )
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-700 lg:flex-row lg:items-end lg:justify-between">
        <PageDescription icon={Settings2} title={t("title")} description={t("subtitle")} />
        <Button type="button" variant="outline" className="min-h-12" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : ""} />
          {t("refresh")}
        </Button>
      </header>

      {loading && !data ? <div className="h-48 animate-pulse border-y border-zinc-200 bg-muted/40 motion-reduce:animate-none" aria-label={t("loading")} role="status" /> : null}
      {error ? <section className="border-y border-zinc-200 py-5 dark:border-zinc-700" role="alert"><p className="font-medium">{t("loadFailed")}</p><p className="mt-1 text-sm text-muted-foreground">{error}</p></section> : null}

      {data ? <>
        <section aria-labelledby="workforce-directory" className="border-y border-zinc-200 py-6 dark:border-zinc-700">
          <div className="flex flex-col gap-1">
            <h2 id="workforce-directory" className="text-lg font-semibold">{t("directoryTitle")}</h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("directoryHint")}</p>
          </div>
          <div className="mt-6 grid gap-6 border-t border-zinc-200 pt-6 dark:border-zinc-700 lg:grid-cols-3">
            <div>
              <h3 className="font-medium">{t("directoryTeams")}</h3>
              <div className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                {data.roster.teams.map((team) => <article key={team.id} className="py-3"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{team.name}</p>{team.code ? <Badge variant="outline">{team.code}</Badge> : null}<Badge variant={team.isActive ? "default" : "secondary"}>{t(team.isActive ? "directoryStatus.ACTIVE" : "directoryStatus.INACTIVE")}</Badge></div></article>)}
                {data.roster.teams.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t("directoryNoTeams")}</p> : null}
              </div>
            </div>
            <div>
              <h3 className="font-medium">{t("directoryEmployees")}</h3>
              <div className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                {data.directoryEmployees.map((employee) => <article key={employee.id} className="py-3"><p className="font-medium">{employee.name || employee.email || employee.externalCode || t("unnamedEmployee")}</p><p className="mt-1 text-sm text-muted-foreground">{employee.team?.name ?? t("unassignedTeam")}</p><Badge className="mt-2" variant={employee.status === "ACTIVE" ? "default" : employee.status === "SUSPENDED" ? "destructive" : "secondary"}>{t("directoryStatus." + employee.status)}</Badge></article>)}
                {data.directoryEmployees.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t("directoryNoEmployees")}</p> : null}
              </div>
            </div>
            <div>
              <h3 className="font-medium">{t("directorySites")}</h3>
              <div className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                {data.sites.map((site) => <article key={site.id} className="py-3"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{site.name}</p><Badge variant="outline">{site.code}</Badge><Badge variant={site.status === "ACTIVE" ? "default" : "secondary"}>{t("directoryStatus." + site.status)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{site.type} · {site.timezone}</p></article>)}
                {data.sites.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t("directoryNoSites")}</p> : null}
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="workforce-site-geofence-configuration" className="border-y border-zinc-200 py-6 dark:border-zinc-700">
          <div className="flex gap-3"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div><h2 id="workforce-site-geofence-configuration" className="text-lg font-semibold">{t("sitesGeofencesTitle")}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("sitesGeofencesHint")}</p></div></div>
          <div className="mt-6 grid gap-8 border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:grid-cols-2">
            <form onSubmit={saveSite} className="space-y-4" aria-labelledby="workforce-site-create-title">
              <div><h3 id="workforce-site-create-title" className="font-medium">{t("newSite")}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("siteFutureOnlyHint")}</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><label htmlFor="workforce-site-code" className="text-sm font-medium">{t("siteCode")}</label><Input id="workforce-site-code" value={siteForm.code} onChange={(event) => setSiteForm((current) => ({ ...current, code: event.target.value }))} maxLength={64} required /></div>
                <div className="space-y-1.5"><label htmlFor="workforce-site-name" className="text-sm font-medium">{t("name")}</label><Input id="workforce-site-name" value={siteForm.name} onChange={(event) => setSiteForm((current) => ({ ...current, name: event.target.value }))} maxLength={160} required /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select id="workforce-site-type" label={t("siteType")} value={siteForm.type} onChange={(event) => setSiteForm((current) => ({ ...current, type: event.target.value as SiteForm["type"] }))}>
                  {(["OFFICE", "WAREHOUSE", "TEMPORARY", "CUSTOMER", "HOME_REMOTE"] as const).map((type) => <option key={type} value={type}>{t("siteTypes." + type)}</option>)}
                </Select>
                <div className="space-y-1.5"><label htmlFor="workforce-site-timezone" className="text-sm font-medium">{t("timezone")}</label><Input id="workforce-site-timezone" value={siteForm.timezone} onChange={(event) => setSiteForm((current) => ({ ...current, timezone: event.target.value }))} required /></div>
              </div>
              <div className="space-y-1.5"><label htmlFor="workforce-site-address" className="text-sm font-medium">{t("siteAddressLabel")}</label><Input id="workforce-site-address" value={siteForm.addressLabel} onChange={(event) => setSiteForm((current) => ({ ...current, addressLabel: event.target.value }))} maxLength={500} /></div>
              <Select id="workforce-site-responsible-team" label={t("siteResponsibleTeam")} value={siteForm.responsibleTeamId} onChange={(event) => setSiteForm((current) => ({ ...current, responsibleTeamId: event.target.value }))}>
                <option value="">{t("organizationScope")}</option>{data.roster.teams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.code ? " · " + team.code : ""} · {t(team.isActive ? "directoryStatus.ACTIVE" : "directoryStatus.INACTIVE")}</option>)}
              </Select>
              <Button type="submit" className="min-h-12" disabled={savingSite}>{savingSite ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}{t("createSite")}</Button>
            </form>
            <form onSubmit={saveGeofence} className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0" aria-labelledby="workforce-geofence-revision-title">
              <div><h3 id="workforce-geofence-revision-title" className="font-medium">{t("newGeofenceRevision")}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("geofenceFutureOnlyHint")}</p></div>
              <Select id="workforce-geofence-site" label={t("sitePicker")} value={selectedGeofenceSiteId} onChange={(event) => { setSelectedGeofenceSiteId(event.target.value); setGeofenceForm(emptyGeofenceForm()) }}>
                <option value="">{t("selectSite")}</option>{data.sites.filter((site) => site.status === "ACTIVE").map((site) => <option key={site.id} value={site.id}>{siteLabel(site)}</option>)}
              </Select>
              {selectedGeofenceSite ? <>
                <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><label htmlFor="workforce-geofence-latitude" className="text-sm font-medium">{t("geofenceLatitude")}</label><Input id="workforce-geofence-latitude" type="number" min="-90" max="90" step="any" value={geofenceForm.centerLatitude} onChange={(event) => setGeofenceForm((current) => ({ ...current, centerLatitude: event.target.value }))} required /></div><div className="space-y-1.5"><label htmlFor="workforce-geofence-longitude" className="text-sm font-medium">{t("geofenceLongitude")}</label><Input id="workforce-geofence-longitude" type="number" min="-180" max="180" step="any" value={geofenceForm.centerLongitude} onChange={(event) => setGeofenceForm((current) => ({ ...current, centerLongitude: event.target.value }))} required /></div></div>
                <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><label htmlFor="workforce-geofence-radius" className="text-sm font-medium">{t("geofenceRadius")}</label><Input id="workforce-geofence-radius" type="number" min="25" max="5000" step="1" value={geofenceForm.radiusMeters} onChange={(event) => setGeofenceForm((current) => ({ ...current, radiusMeters: event.target.value }))} required /></div><div className="space-y-1.5"><label htmlFor="workforce-geofence-effective-from" className="text-sm font-medium">{t("effectiveFrom")}</label><Input id="workforce-geofence-effective-from" type="date" value={geofenceForm.effectiveFrom} onChange={(event) => setGeofenceForm((current) => ({ ...current, effectiveFrom: event.target.value }))} required /></div></div>
                <div className="space-y-1.5"><label htmlFor="workforce-geofence-calibration" className="text-sm font-medium">{t("geofenceCalibrationReference")}</label><Input id="workforce-geofence-calibration" value={geofenceForm.calibrationReference} onChange={(event) => setGeofenceForm((current) => ({ ...current, calibrationReference: event.target.value }))} maxLength={500} required /><p className="text-xs leading-5 text-muted-foreground">{t("geofenceCalibrationHint")}</p></div>
                {mapPinHref(finiteNumberValue(geofenceForm.centerLatitude), finiteNumberValue(geofenceForm.centerLongitude)) ? <a className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={mapPinHref(finiteNumberValue(geofenceForm.centerLatitude), finiteNumberValue(geofenceForm.centerLongitude))!} target="_blank" rel="noreferrer">{t("openGeofenceMapPin")}</a> : null}
                <div className="rounded-md bg-muted/50 p-3 text-sm" aria-live="polite"><p className="font-medium">{t("geofenceImpactPreview", { count: geofenceImpactAssignments.length, date: geofenceForm.effectiveFrom || "—" })}</p><p className="mt-1 text-muted-foreground">{t("geofenceImpactHint")}</p>{geofenceImpactAssignments.length > 0 ? <ul className="mt-2 list-disc pl-5 text-muted-foreground">{geofenceImpactAssignments.map((assignment) => <li key={assignment.id}>{employeeLabel(data.directoryEmployees.find((employee) => employee.id === assignment.agentId) ?? { id: assignment.agentId, name: null, email: null, externalCode: null, teamId: null, status: "INACTIVE", team: null })}</li>)}</ul> : null}</div>
                <Button type="submit" className="min-h-12" disabled={savingGeofence}>{savingGeofence ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <MapPin />}{t("scheduleGeofenceRevision")}</Button>
              </> : <p className="text-sm text-muted-foreground">{t("geofenceSiteRequired")}</p>}
              {geofenceError ? <p className="text-sm text-destructive" role="alert">{geofenceError}</p> : null}
              {selectedGeofenceSite ? <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700"><h4 className="font-medium">{t("geofenceRevisionHistory")}</h4>{loadingGeofences ? <p className="mt-2 text-sm text-muted-foreground">{t("loading")}</p> : <div className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">{geofenceRevisions.map((revision) => <article key={revision.id} className="py-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{t("version", { value: revision.revision })}</Badge><Badge variant="secondary">{t("geofenceCircle", { radius: revision.radiusMeters })}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{t("effectiveRange", { start: asDateKey(revision.effectiveFrom), end: revision.effectiveTo ? asDateKey(revision.effectiveTo) : t("openEnded") })}</p>{mapPinHref(revision.centerLatitude, revision.centerLongitude) ? <a className="mt-1 inline-flex text-sm underline underline-offset-4" href={mapPinHref(revision.centerLatitude, revision.centerLongitude)!} target="_blank" rel="noreferrer">{t("openGeofenceMapPin")}</a> : null}</article>)}{geofenceRevisions.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t("noGeofenceRevisions")}</p> : null}</div>}</div> : null}
            </form>
          </div>
        </section>

        <section aria-labelledby="workforce-policy-configuration" className="border-y border-zinc-200 py-6 dark:border-zinc-700">
          <div className="flex flex-col gap-1">
            <h2 id="workforce-policy-configuration" className="text-lg font-semibold">{t("policiesTitle")}</h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("policiesHint")}</p>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("defaultProfileHint")}</p>
          </div>
          <form className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-700" onSubmit={savePolicy}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-medium">{policyFormTitle}</h3>
              {policyForm.id ? <Button type="button" variant="ghost" className="min-h-10" onClick={() => setPolicyForm(emptyPolicyForm)}><X />{t("cancelEdit")}</Button> : null}
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="space-y-1.5"><label htmlFor="workforce-policy-name" className="text-sm font-medium">{t("name")}</label><Input id="workforce-policy-name" value={policyForm.name} onChange={(event) => setPolicyForm((current) => ({ ...current, name: event.target.value }))} maxLength={160} required /></div>
              <div className="space-y-1.5"><Select id="workforce-policy-team" label={t("teamScopePicker")} value={policyForm.teamId} onChange={(event) => setPolicyForm((current) => ({ ...current, teamId: event.target.value }))} disabled={Boolean(policyForm.id)}><option value="">{t("organizationScope")}</option>{data.roster.teams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.code ? " · " + team.code : ""} · {t(team.isActive ? "directoryStatus.ACTIVE" : "directoryStatus.INACTIVE")}</option>)}</Select><p className="text-xs leading-5 text-muted-foreground">{policyForm.id ? t("scopeImmutableHint") : t("teamPickerHint")}</p></div>
              <div className="space-y-1.5"><label htmlFor="workforce-policy-from" className="text-sm font-medium">{t("effectiveFrom")}</label><Input id="workforce-policy-from" type="date" value={policyForm.effectiveFrom} onChange={(event) => setPolicyForm((current) => ({ ...current, effectiveFrom: event.target.value }))} required /></div>
              <div className="space-y-1.5"><label htmlFor="workforce-policy-to" className="text-sm font-medium">{t("effectiveTo")}</label><Input id="workforce-policy-to" type="date" value={policyForm.effectiveTo} onChange={(event) => setPolicyForm((current) => ({ ...current, effectiveTo: event.target.value }))} /><p className="text-xs leading-5 text-muted-foreground">{t("openEndedHint")}</p></div>
            </div>
            <fieldset className="mt-6 grid gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-700 md:grid-cols-2 xl:grid-cols-5">
              <legend className="text-sm font-medium">{t("calculationInputs")}</legend>
              <NumberInput id="workforce-policy-expected" label={t("expectedWorkSeconds")} value={policyForm.expectedWorkSeconds} onChange={(value) => setPolicyForm((current) => ({ ...current, expectedWorkSeconds: value }))} />
              <NumberInput id="workforce-policy-grace" label={t("lateGraceSeconds")} value={policyForm.lateGraceSeconds} onChange={(value) => setPolicyForm((current) => ({ ...current, lateGraceSeconds: value }))} />
              <NumberInput id="workforce-policy-undertime" label={t("undertimeToleranceSeconds")} value={policyForm.undertimeToleranceSeconds} onChange={(value) => setPolicyForm((current) => ({ ...current, undertimeToleranceSeconds: value }))} />
              <NumberInput id="workforce-policy-overtime" label={t("overtimeThresholdSeconds")} value={policyForm.overtimeThresholdSeconds} onChange={(value) => setPolicyForm((current) => ({ ...current, overtimeThresholdSeconds: value }))} />
              <NumberInput id="workforce-policy-long-pause" label={t("longPauseThresholdSeconds")} value={policyForm.longPauseThresholdSeconds} onChange={(value) => setPolicyForm((current) => ({ ...current, longPauseThresholdSeconds: value }))} optional />
            </fieldset>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{t("policyFutureOnlyHint")}</p>
            <Button type="submit" className="mt-5 min-h-12" disabled={savingPolicy}>{savingPolicy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}{policyForm.id ? t("saveDraft") : t("createDraft")}</Button>
          </form>
          <div className="mt-8 border-t border-zinc-200 dark:border-zinc-700">
            {data.policies.map((policy) => <article key={policy.id} className="flex flex-col gap-4 py-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{policy.name}</p><Badge variant={policy.status === "ACTIVE" ? "default" : "secondary"}>{policy.status === "ACTIVE" ? t("active") : t("draft")}</Badge><Badge variant="outline">{t("version", { value: policy.version })}</Badge>{policy.provenance === "SYSTEM_PROVISIONING" ? <Badge variant="outline">{t("systemDefaultProfile", { version: policy.systemProfileVersion ?? "—" })}</Badge> : null}</div><p className="mt-2 text-sm text-muted-foreground">{policy.teamId ? t("teamScope", { teamId: policy.teamId }) : t("organizationScope")}</p><p className="mt-1 text-sm text-muted-foreground">{t("effectiveRange", { start: asDateKey(policy.effectiveFrom), end: policy.effectiveTo ? asDateKey(policy.effectiveTo) : t("openEnded") })}</p></div>
              {policy.status === "DRAFT" ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-12" onClick={() => startPolicyEdit(policy)}><Pencil />{t("editDraft")}</Button><Button type="button" className="min-h-12" disabled={activating !== null} onClick={() => void activate("policy", policy.id)}>{activating === "policy:" + policy.id ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Check />}{t("activatePolicy")}</Button></div> : null}
            </article>)}
            {data.policies.length === 0 ? <p className="py-8 text-sm text-muted-foreground">{t("noPolicies")}</p> : null}
          </div>
        </section>

        <section aria-labelledby="workforce-shift-configuration" className="border-y border-zinc-200 py-6 dark:border-zinc-700">
          <div className="flex flex-col gap-1">
            <h2 id="workforce-shift-configuration" className="text-lg font-semibold">{t("shiftsTitle")}</h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("shiftsHint")}</p>
          </div>
          <form className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-700" onSubmit={saveShift}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-medium">{shiftFormTitle}</h3>
              {shiftForm.id ? <Button type="button" variant="ghost" className="min-h-10" onClick={() => setShiftForm(emptyShiftForm)}><X />{t("cancelEdit")}</Button> : null}
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="space-y-1.5"><label htmlFor="workforce-shift-code" className="text-sm font-medium">{t("shiftCode")}</label><Input id="workforce-shift-code" value={shiftForm.code} onChange={(event) => setShiftForm((current) => ({ ...current, code: event.target.value }))} maxLength={80} required disabled={Boolean(shiftForm.id)} /><p className="text-xs leading-5 text-muted-foreground">{shiftForm.id ? t("scopeImmutableHint") : null}</p></div>
              <div className="space-y-1.5"><label htmlFor="workforce-shift-name" className="text-sm font-medium">{t("name")}</label><Input id="workforce-shift-name" value={shiftForm.name} onChange={(event) => setShiftForm((current) => ({ ...current, name: event.target.value }))} maxLength={160} required /></div>
              <div className="space-y-1.5"><Select id="workforce-shift-team" label={t("teamScopePicker")} value={shiftForm.teamId} onChange={(event) => setShiftForm((current) => ({ ...current, teamId: event.target.value }))} disabled={Boolean(shiftForm.id)}><option value="">{t("organizationScope")}</option>{data.roster.teams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.code ? " · " + team.code : ""} · {t(team.isActive ? "directoryStatus.ACTIVE" : "directoryStatus.INACTIVE")}</option>)}</Select></div>
              <div className="space-y-1.5"><label htmlFor="workforce-shift-timezone" className="text-sm font-medium">{t("timezone")}</label><Input id="workforce-shift-timezone" value={shiftForm.timezone} onChange={(event) => setShiftForm((current) => ({ ...current, timezone: event.target.value }))} placeholder="Asia/Baku" required /></div>
              <div className="space-y-1.5"><label htmlFor="workforce-shift-start" className="text-sm font-medium">{t("shiftStart")}</label><Input id="workforce-shift-start" type="time" value={shiftForm.startTime} onChange={(event) => setShiftForm((current) => ({ ...current, startTime: event.target.value }))} required /></div>
              <div className="space-y-1.5"><label htmlFor="workforce-shift-end" className="text-sm font-medium">{t("shiftEnd")}</label><Input id="workforce-shift-end" type="time" value={shiftForm.endTime} onChange={(event) => setShiftForm((current) => ({ ...current, endTime: event.target.value }))} required /></div>
            </div>
            <fieldset className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-700">
              <legend className="text-sm font-medium">{t("plannedBreaks")}</legend>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("plannedBreaksHint")}</p>
              <div className="mt-4 space-y-3">
                {shiftForm.plannedBreaks.map((plannedBreak, index) => <div key={index} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <div className="space-y-1.5"><label htmlFor={`workforce-shift-break-${index}-start`} className="text-sm font-medium">{t("plannedBreakStart", { value: index + 1 })}</label><Input id={`workforce-shift-break-${index}-start`} type="time" value={plannedBreak.startTime} onChange={(event) => setShiftForm((current) => ({ ...current, plannedBreaks: current.plannedBreaks.map((item, itemIndex) => itemIndex === index ? { ...item, startTime: event.target.value } : item) }))} required /></div>
                  <div className="space-y-1.5"><label htmlFor={`workforce-shift-break-${index}-end`} className="text-sm font-medium">{t("plannedBreakEnd", { value: index + 1 })}</label><Input id={`workforce-shift-break-${index}-end`} type="time" value={plannedBreak.endTime} onChange={(event) => setShiftForm((current) => ({ ...current, plannedBreaks: current.plannedBreaks.map((item, itemIndex) => itemIndex === index ? { ...item, endTime: event.target.value } : item) }))} required /></div>
                  <Button type="button" variant="outline" className="min-h-11" aria-label={t("removePlannedBreak", { value: index + 1 })} onClick={() => setShiftForm((current) => ({ ...current, plannedBreaks: current.plannedBreaks.filter((_, itemIndex) => itemIndex !== index) }))}><X />{t("removePlannedBreak", { value: index + 1 })}</Button>
                </div>)}
              </div>
              <Button type="button" variant="outline" className="mt-4 min-h-11" disabled={shiftForm.plannedBreaks.length >= 8} onClick={() => setShiftForm((current) => ({ ...current, plannedBreaks: [...current.plannedBreaks, { startTime: "", endTime: "" }] }))}><Plus />{t("addPlannedBreak")}</Button>
            </fieldset>
            <fieldset className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-700">
              <legend className="text-sm font-medium">{t("workdays")}</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {weekdays.map((day) => {
                  const selected = shiftForm.daysOfWeek.includes(day.value)
                  return <Button key={day.value} type="button" variant={selected ? "default" : "outline"} className="min-h-11" aria-pressed={selected} onClick={() => setShiftForm((current) => ({ ...current, daysOfWeek: selected ? current.daysOfWeek.filter((value) => value !== day.value) : [...current.daysOfWeek, day.value] }))}>{t("weekdays." + day.key)}</Button>
                })}
              </div>
            </fieldset>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{t("shiftFutureOnlyHint")}</p>
            <Button type="submit" className="mt-5 min-h-12" disabled={savingShift}>{savingShift ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}{shiftForm.id ? t("saveDraft") : t("createDraft")}</Button>
          </form>
          <div className="mt-8 border-t border-zinc-200 dark:border-zinc-700">
            {data.shifts.map((shift) => <article key={shift.id} className="flex flex-col gap-4 py-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{shift.name}</p><Badge variant={shift.status === "ACTIVE" ? "default" : "secondary"}>{shift.status === "ACTIVE" ? t("active") : t("draft")}</Badge><Badge variant="outline">{shift.code}</Badge><Badge variant="outline">{t("version", { value: shift.version })}</Badge>{shift.provenance === "SYSTEM_PROVISIONING" ? <Badge variant="outline">{t("systemDefaultProfile", { version: shift.systemProfileVersion ?? "—" })}</Badge> : null}</div><p className="mt-2 text-sm text-muted-foreground">{shift.teamId ? t("teamScope", { teamId: shift.teamId }) : t("organizationScope")}</p><p className="mt-1 text-sm text-muted-foreground">{t("shiftSummary", { start: shift.definition.startTime, end: shift.definition.endTime, timezone: shift.definition.timezone })}</p>{(shift.definition.plannedBreaks ?? []).map((plannedBreak, index) => <p key={`${plannedBreak.startTime}-${plannedBreak.endTime}-${index}`} className="mt-1 text-sm text-muted-foreground">{t("plannedBreakSummary", { start: plannedBreak.startTime, end: plannedBreak.endTime })}</p>)}</div>
              {shift.status === "DRAFT" ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-12" onClick={() => startShiftEdit(shift)}><Pencil />{t("editDraft")}</Button><Button type="button" className="min-h-12" disabled={activating !== null} onClick={() => void activate("shift", shift.id)}>{activating === "shift:" + shift.id ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Check />}{t("activateShift")}</Button></div> : null}
            </article>)}
            {data.shifts.length === 0 ? <p className="py-8 text-sm text-muted-foreground">{t("noShifts")}</p> : null}
          </div>
        </section>

        <section aria-labelledby="workforce-assignment-configuration" className="border-y border-zinc-200 py-6 dark:border-zinc-700">
          <div className="flex gap-3"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><div><h2 id="workforce-assignment-configuration" className="text-lg font-semibold">{t("assignmentsTitle")}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("assignmentsHint")}</p></div></div>
          <div className="mt-6 grid gap-8 border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:grid-cols-2">
            <form onSubmit={saveAssignment} className="space-y-4" aria-labelledby="workforce-individual-assignment-title">
              <div><h3 id="workforce-individual-assignment-title" className="font-medium">{t("scheduleIndividualAssignment")}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("individualAssignmentHint")}</p></div>
              <Select id="workforce-assignment-employee" label={t("employee")} value={assignmentForm.agentId} onChange={(event) => setAssignmentForm((current) => ({ ...current, agentId: event.target.value }))} required>
                <option value="">{t("selectEmployee")}</option>
                {data.roster.employees.map((employee) => <option key={employee.id} value={employee.id}>{employeeLabel(employee)}</option>)}
              </Select>
              <Select id="workforce-assignment-template" label={t("shiftTemplate")} value={assignmentForm.templateId} onChange={(event) => setAssignmentForm((current) => ({ ...current, templateId: event.target.value }))} required>
                <option value="">{t("selectShiftTemplate")}</option>
                {data.roster.shiftTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.code}</option>)}
              </Select>
              <div className="space-y-1.5"><label htmlFor="workforce-assignment-effective-from" className="text-sm font-medium">{t("effectiveFrom")}</label><Input id="workforce-assignment-effective-from" type="date" value={assignmentForm.effectiveFrom} onChange={(event) => setAssignmentForm((current) => ({ ...current, effectiveFrom: event.target.value }))} required /></div>
              <Button type="submit" className="min-h-12" disabled={savingAssignment || data.roster.employees.length === 0 || data.roster.shiftTemplates.length === 0}>{savingAssignment ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <CalendarClock />}{t("scheduleIndividualAssignment")}</Button>
              {data.roster.employees.length === 0 || data.roster.shiftTemplates.length === 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("assignmentRosterUnavailable")}</p> : null}
            </form>
            <form onSubmit={(event) => { event.preventDefault(); void previewAssignmentsForDate() }} className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0" aria-labelledby="workforce-assignment-preview-title">
              <div><h3 id="workforce-assignment-preview-title" className="font-medium">{t("assignmentPreviewTitle")}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("assignmentPreviewHint")}</p></div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1 space-y-1.5"><label htmlFor="workforce-assignment-preview-date" className="text-sm font-medium">{t("assignmentPreviewDate")}</label><Input id="workforce-assignment-preview-date" type="date" value={assignmentPreviewDate} onChange={(event) => setAssignmentPreviewDate(event.target.value)} /></div><Button type="submit" variant="outline" className="min-h-11" disabled={previewingAssignments}>{previewingAssignments ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}{t("showPreview")}</Button></div>
              {assignmentPreview !== null ? <div className="border-t border-zinc-200 dark:border-zinc-700" aria-live="polite">{assignmentPreview.map((assignment) => <p key={assignment.id} className="py-3 text-sm"><span className="font-medium">{assignment.agent.name || assignment.agent.email || assignment.agent.externalCode || t("unnamedEmployee")}</span><span className="text-muted-foreground"> · {assignment.template.name} · {t("effectiveRange", { start: asDateKey(assignment.effectiveFrom), end: assignment.effectiveTo ? asDateKey(assignment.effectiveTo) : t("openEnded") })}</span></p>)}{assignmentPreview.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t("noAssignmentsForPreview")}</p> : null}</div> : null}
            </form>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void previewBulkAssignments() }} className="mt-8 space-y-5 border-t border-zinc-200 pt-6 dark:border-zinc-700" aria-labelledby="workforce-bulk-assignment-preview-title">
            <div><h3 id="workforce-bulk-assignment-preview-title" className="font-medium">{t("bulkAssignmentPreviewTitle")}</h3><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("bulkAssignmentPreviewHint")}</p></div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Select id="workforce-bulk-assignment-template" label={t("shiftTemplate")} value={bulkAssignmentDraft.templateId} onChange={(event) => updateBulkAssignmentDraft((current) => ({ ...current, templateId: event.target.value }))} required>
                <option value="">{t("selectShiftTemplate")}</option>
                {data.roster.shiftTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.code}</option>)}
              </Select>
              <div className="space-y-1.5"><label htmlFor="workforce-bulk-assignment-effective-from" className="text-sm font-medium">{t("effectiveFrom")}</label><Input id="workforce-bulk-assignment-effective-from" type="date" value={bulkAssignmentDraft.effectiveFrom} onChange={(event) => updateBulkAssignmentDraft((current) => ({ ...current, effectiveFrom: event.target.value }))} required /></div>
              <div className="flex flex-wrap items-end gap-3"><Button type="submit" variant="outline" className="min-h-11" disabled={previewingBulkAssignments || data.roster.employees.length === 0 || data.roster.shiftTemplates.length === 0}>{previewingBulkAssignments ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}{t("reviewBulkAssignmentDraft")}</Button><Button type="button" variant="ghost" className="min-h-11" onClick={() => { setBulkAssignmentDraft(emptyBulkAssignmentDraft()); setBulkAssignmentPreview(null) }} disabled={previewingBulkAssignments || (bulkAssignmentDraft.agentIds.length === 0 && !bulkAssignmentDraft.templateId && !bulkAssignmentDraft.effectiveFrom)}>{t("discardBulkAssignmentDraft")}</Button></div>
            </div>
            <fieldset className="border-y border-zinc-200 py-4 dark:border-zinc-700" aria-describedby="workforce-bulk-assignment-employees-hint"><legend className="px-1 text-sm font-medium">{t("bulkAssignmentEmployees", { selected: bulkAssignmentDraft.agentIds.length, maximum: 200 })}</legend><p id="workforce-bulk-assignment-employees-hint" className="mt-1 px-1 text-sm leading-6 text-muted-foreground">{t("bulkAssignmentEmployeesHint")}</p><div className="mt-4 grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3" role="group" aria-label={t("bulkAssignmentEmployees", { selected: bulkAssignmentDraft.agentIds.length, maximum: 200 })}>{data.roster.employees.map((employee) => { const selected = bulkAssignmentDraft.agentIds.includes(employee.id); const maximumReached = bulkAssignmentDraft.agentIds.length >= 200; return <label key={employee.id} className="flex min-h-11 items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"><input id={"workforce-bulk-assignment-employee-" + employee.id} type="checkbox" checked={selected} disabled={!selected && maximumReached} onChange={() => toggleBulkAssignmentEmployee(employee.id)} className="h-4 w-4 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" /><span>{employeeLabel(employee)}</span></label> })}{data.roster.employees.length === 0 ? <p className="text-sm text-muted-foreground">{t("assignmentRosterUnavailable")}</p> : null}</div></fieldset>
            {bulkAssignmentPreview !== null ? <div className="border-y border-zinc-200 py-4 dark:border-zinc-700"><p role="status" aria-live="polite" aria-atomic="true" className="text-sm font-medium">{t("bulkAssignmentSummary", { ready: bulkAssignmentPreview.summary.READY, unchanged: bulkAssignmentPreview.summary.NO_CHANGE, unavailable: bulkAssignmentPreview.summary.EMPLOYEE_UNAVAILABLE, mismatch: bulkAssignmentPreview.summary.TEMPLATE_TEAM_MISMATCH, conflicts: bulkAssignmentPreview.summary.CONFLICT })}</p><div className="mt-3 flex flex-wrap gap-2">{(["READY", "NO_CHANGE", "EMPLOYEE_UNAVAILABLE", "TEMPLATE_TEAM_MISMATCH", "CONFLICT"] as const).map((outcome) => <Badge key={outcome} variant={outcome === "CONFLICT" || outcome === "EMPLOYEE_UNAVAILABLE" ? "destructive" : "outline"}>{t("bulkAssignmentOutcome." + outcome)}: {bulkAssignmentPreview.summary[outcome]}</Badge>)}</div><p className="mt-3 text-sm leading-6 text-muted-foreground">{t("bulkAssignmentReviewOnlyHint")}</p><ul className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">{bulkAssignmentPreview.items.map((item) => <li key={item.agentId} className="py-3 text-sm"><span className="font-medium">{bulkAssignmentEmployeeLabel(item.agentId)}</span><span className="text-muted-foreground"> · {t("bulkAssignmentOutcome." + item.outcome)}</span></li>)}</ul></div> : null}
          </form>
          <div className="mt-8 grid gap-8 border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:grid-cols-2">
            <div><h3 className="font-medium">{t("assignmentTimelineTitle")}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("assignmentTimelineHint")}</p><div className="mt-4 border-t border-zinc-200 dark:border-zinc-700">{data.assignments.map((assignment) => <article key={assignment.id} className="py-4"><p className="font-medium">{assignment.agent.name || assignment.agent.email || assignment.agent.externalCode || t("unnamedEmployee")}</p><p className="mt-1 text-sm text-muted-foreground">{assignment.template.name} · {assignment.template.code} · {t("effectiveRange", { start: asDateKey(assignment.effectiveFrom), end: assignment.effectiveTo ? asDateKey(assignment.effectiveTo) : t("openEnded") })}</p></article>)}{data.assignments.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t("noAssignments")}</p> : null}</div></div>
            <div className="border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0"><form onSubmit={saveDefaultAssignment} className="space-y-4" aria-labelledby="workforce-default-assignment-title"><div><h3 id="workforce-default-assignment-title" className="font-medium">{t("scheduleDefaultAssignment")}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("defaultAssignmentHint")}</p></div><Select id="workforce-default-assignment-template" label={t("shiftTemplate")} value={defaultAssignmentForm.templateId} onChange={(event) => setDefaultAssignmentForm((current) => ({ ...current, templateId: event.target.value }))} required><option value="">{t("selectOrganizationShiftTemplate")}</option>{data.roster.shiftTemplates.filter((template) => template.teamId === null).map((template) => <option key={template.id} value={template.id}>{template.name} · {template.code}</option>)}</Select><div className="space-y-1.5"><label htmlFor="workforce-default-assignment-effective-from" className="text-sm font-medium">{t("effectiveFrom")}</label><Input id="workforce-default-assignment-effective-from" type="date" value={defaultAssignmentForm.effectiveFrom} onChange={(event) => setDefaultAssignmentForm((current) => ({ ...current, effectiveFrom: event.target.value }))} required /></div><Button type="submit" variant="outline" className="min-h-12" disabled={savingDefaultAssignment || !data.roster.shiftTemplates.some((template) => template.teamId === null)}>{savingDefaultAssignment ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <CalendarClock />}{t("scheduleDefaultAssignment")}</Button></form><div className="mt-6 border-t border-zinc-200 dark:border-zinc-700"><h3 className="pt-5 font-medium">{t("defaultTimelineTitle")}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("defaultTimelineHint")}</p>{data.defaultAssignments.map((assignment) => <article key={assignment.id} className="py-4"><p className="font-medium">{assignment.template.name} · {assignment.template.code}</p><p className="mt-1 text-sm text-muted-foreground">{t("effectiveRange", { start: asDateKey(assignment.effectiveFrom), end: assignment.effectiveTo ? asDateKey(assignment.effectiveTo) : t("openEnded") })}</p></article>)}{data.defaultAssignments.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t("noDefaultAssignments")}</p> : null}</div></div>
          </div>
        </section>
        <section aria-labelledby="workforce-site-assignment-configuration" className="border-y border-zinc-200 py-6 dark:border-zinc-700">
          <div className="flex flex-col gap-1">
            <h2 id="workforce-site-assignment-configuration" className="text-lg font-semibold">{t("siteAssignmentsTitle")}</h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("siteAssignmentsHint")}</p>
          </div>
          <div className="mt-6 grid gap-8 border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:grid-cols-2">
            <form onSubmit={saveSiteAssignment} className="space-y-4" aria-labelledby="workforce-site-assignment-form">
              <div><h3 id="workforce-site-assignment-form" className="font-medium">{t("scheduleSiteAssignment")}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("siteAssignmentFutureOnlyHint")}</p></div>
              <Select id="workforce-site-assignment-employee" label={t("employee")} value={siteAssignmentForm.agentId} onChange={(event) => setSiteAssignmentForm((current) => ({ ...current, agentId: event.target.value }))} required>
                <option value="">{t("selectEmployee")}</option>
                {data.roster.employees.map((employee) => <option key={employee.id} value={employee.id}>{employeeLabel(employee)}</option>)}
              </Select>
              <Select id="workforce-site-assignment-site" label={t("sitePicker")} value={siteAssignmentForm.siteId} onChange={(event) => setSiteAssignmentForm((current) => ({ ...current, siteId: event.target.value }))} required>
                <option value="">{t("selectSite")}</option>
                {data.sites.filter((site) => site.status === "ACTIVE").map((site) => <option key={site.id} value={site.id}>{siteLabel(site)}</option>)}
              </Select>
              <Select id="workforce-site-assignment-kind" label={t("siteAssignmentKind")} value={siteAssignmentForm.kind} onChange={(event) => setSiteAssignmentForm((current) => ({ ...current, kind: event.target.value as SiteAssignmentForm["kind"] }))}>
                <option value="PRIMARY">{t("siteAssignmentKinds.PRIMARY")}</option>
                <option value="SECONDARY">{t("siteAssignmentKinds.SECONDARY")}</option>
                <option value="TEMPORARY">{t("siteAssignmentKinds.TEMPORARY")}</option>
              </Select>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><label htmlFor="workforce-site-assignment-effective-from" className="text-sm font-medium">{t("effectiveFrom")}</label><Input id="workforce-site-assignment-effective-from" type="date" value={siteAssignmentForm.effectiveFrom} onChange={(event) => setSiteAssignmentForm((current) => ({ ...current, effectiveFrom: event.target.value }))} required /></div>
                <div className="space-y-1.5"><label htmlFor="workforce-site-assignment-effective-to" className="text-sm font-medium">{t("effectiveTo")}</label><Input id="workforce-site-assignment-effective-to" type="date" min={siteAssignmentForm.effectiveFrom || undefined} value={siteAssignmentForm.effectiveTo} onChange={(event) => setSiteAssignmentForm((current) => ({ ...current, effectiveTo: event.target.value }))} required={siteAssignmentForm.kind === "TEMPORARY"} /></div>
              </div>
              <Button type="submit" className="min-h-12" disabled={savingSiteAssignment || data.roster.employees.length === 0 || !data.sites.some((site) => site.status === "ACTIVE")}>{savingSiteAssignment ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <CalendarClock />}{t("scheduleSiteAssignment")}</Button>
              {data.roster.employees.length === 0 || !data.sites.some((site) => site.status === "ACTIVE") ? <p className="text-sm leading-6 text-muted-foreground">{t("siteAssignmentPickerUnavailable")}</p> : null}
            </form>
            <div className="border-t border-zinc-200 pt-6 dark:border-zinc-700 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
              <h3 className="font-medium">{t("siteAssignmentTimelineTitle")}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("siteAssignmentTimelineHint")}</p>
              <div className="mt-4 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                {data.siteAssignments.map((assignment) => {
                  const employee = data.directoryEmployees.find((item) => item.id === assignment.agentId)
                  const site = data.sites.find((item) => item.id === assignment.siteId)
                  return <article key={assignment.id} className="py-4"><p className="font-medium">{employee ? employeeLabel(employee) : t("unavailableEmployee")}</p><p className="mt-1 text-sm text-muted-foreground">{site ? siteLabel(site) : t("unavailableSite")} · {t("siteAssignmentKinds." + assignment.kind)} · {t("effectiveRange", { start: asDateKey(assignment.effectiveFrom), end: assignment.effectiveTo ? asDateKey(assignment.effectiveTo) : t("openEnded") })}</p></article>
                })}
                {data.siteAssignments.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t("noSiteAssignments")}</p> : null}
              </div>
            </div>
          </div>
        </section>
      </> : null}
    </div>
  )
}

function NumberInput({
  id,
  label,
  value,
  onChange,
  optional = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  optional?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <Input id={id} type="number" min="0" step="1" value={value} onChange={(event) => onChange(event.target.value)} required={!optional} />
    </div>
  )
}
