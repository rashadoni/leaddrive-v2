type UnknownRecord = Record<string, unknown>
const WORKDAY_ACTIONS = new Set(["START", "PAUSE", "RESUME", "FINISH"])
const TASK_ATTENTION_VALUES = new Set(["OVERDUE", "RETURNED", "ACTIVE"])

export type OperationalWeekTaskAttention = "OVERDUE" | "RETURNED" | "ACTIVE"

export const OPERATIONAL_WEEK_REQUEST_TIMEOUT_MS = 20_000

export class OperationalWeekRequestTimeoutError extends Error {
  constructor() {
    super("Operational week request timed out")
    this.name = "OperationalWeekRequestTimeoutError"
  }
}

/**
 * Bounded JSON request that keeps the deadline active through body parsing.
 * This prevents a response that supplied headers but stalled its body from
 * leaving refresh/mutation state permanently in flight.
 */
export async function fetchOperationalWeekJsonWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = OPERATIONAL_WEEK_REQUEST_TIMEOUT_MS,
): Promise<{ response: Response; body: unknown }> {
  const controller = new AbortController()
  const parentSignal = init.signal
  let timedOut = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  let rejectParentAbort: ((reason?: unknown) => void) | null = null
  const abortFromParent = () => {
    controller.abort()
    rejectParentAbort?.(new DOMException("Aborted", "AbortError"))
  }
  const parentAbort = new Promise<never>((_resolve, reject) => {
    rejectParentAbort = reject
    if (parentSignal?.aborted) abortFromParent()
    else parentSignal?.addEventListener("abort", abortFromParent, { once: true })
  })
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new OperationalWeekRequestTimeoutError())
    }, Math.max(1, timeoutMs))
  })
  try {
    const request = (async () => {
      const response = await fetch(input, { ...init, signal: controller.signal })
      let body: unknown = {}
      try {
        body = await response.json()
      } catch (error) {
        if (timedOut) throw new OperationalWeekRequestTimeoutError()
        if (controller.signal.aborted) throw error
      }
      return { response, body }
    })()
    return await Promise.race([request, deadline, parentAbort])
  } catch (error) {
    if (timedOut) throw new OperationalWeekRequestTimeoutError()
    throw error
  } finally {
    if (timeout !== null) clearTimeout(timeout)
    parentSignal?.removeEventListener("abort", abortFromParent)
    rejectParentAbort = null
  }
}

function object(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function dateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function selectedEmployee(value: unknown): boolean {
  const row = object(value)
  return Boolean(row && typeof row.id === "string" && row.id && typeof row.name === "string" && row.name)
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string"
}

function finiteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value)
}

function nullableFiniteNumber(value: unknown): boolean {
  return value === null || finiteNumber(value)
}

function cachedSelectedEmployee(value: unknown): boolean {
  const row = object(value)
  return Boolean(row && selectedEmployee(row) &&
    nullableString(row.regionId) && nullableString(row.teamId) && nullableString(row.role) &&
    nullableString(row.regionName) && nullableString(row.teamName))
}

function weekDays(value: unknown): boolean {
  return Array.isArray(value) && (value.length === 1 || value.length === 5 || value.length === 7) && value.every((item) => {
    const day = object(item)
    return Boolean(day && dateKey(day.date) && Array.isArray(day.routes) && Array.isArray(day.unplannedVisits) && Array.isArray(day.tasks))
  })
}

function cachedTask(value: unknown): boolean {
  const task = object(value)
  return Boolean(task && typeof task.id === "string" && typeof task.title === "string" && typeof task.status === "string" &&
    nullableString(task.priority) && nullableString(task.scheduledStartAt) && nullableString(task.dueAt) &&
    nullableString(task.returnReason) && nullableFiniteNumber(task.version) &&
    typeof task.attention === "string" && TASK_ATTENTION_VALUES.has(task.attention) && nullableString(task.routePointId))
}

function cachedPoint(value: unknown): boolean {
  const point = object(value)
  return Boolean(point && typeof point.id === "string" && finiteNumber(point.order) && typeof point.status === "string" &&
    nullableString(point.routeId) && nullableString(point.visitId) &&
    nullableString(point.organizationId) && nullableString(point.organizationName) && nullableString(point.organizationType) &&
    nullableString(point.contactId) && nullableString(point.contactName) && nullableString(point.contactType) &&
    nullableString(point.specialtyName) && nullableString(point.address) && nullableString(point.plannedAt) &&
    nullableString(point.actualAt) && nullableString(point.cancellationReason) && nullableString(point.cancellationSource))
}

function cachedRoute(value: unknown): boolean {
  const route = object(value)
  return Boolean(route && typeof route.id === "string" && typeof route.name === "string" && typeof route.status === "string" &&
    nullableFiniteNumber(route.publishedVersion) && typeof route.pointsTruncated === "boolean" &&
    Array.isArray(route.points) && route.points.every(cachedPoint))
}

function cachedWorkday(value: unknown): boolean {
  const workday = object(value)
  return Boolean(workday && nullableString(workday.id) && typeof workday.state === "string" &&
    nullableString(workday.startedAt) && nullableString(workday.pausedAt) && nullableString(workday.finishedAt) &&
    nullableString(workday.lastEventAt))
}

function cachedDay(value: unknown): boolean {
  const day = object(value)
  const summary = object(day?.summary)
  return Boolean(day && dateKey(day.date) && typeof day.isToday === "boolean" && nullableString(day.label) && summary &&
    finiteNumber(summary.planned) && finiteNumber(summary.actual) && finiteNumber(summary.cancelled) &&
    cachedWorkday(day.workday) &&
    Array.isArray(day.routes) && day.routes.every(cachedRoute) &&
    Array.isArray(day.unplannedVisits) && day.unplannedVisits.every(cachedPoint) &&
    Array.isArray(day.tasks) && day.tasks.every(cachedTask))
}

function cachedPlanChange(value: unknown): boolean {
  const change = object(value)
  return Boolean(change && typeof change.id === "string" && typeof change.type === "string" && typeof change.status === "string" &&
    nullableString(change.reason) && nullableString(change.routeId) && nullableString(change.pointLabel) &&
    nullableString(change.requestedAt))
}

/** Reject an HTTP-200 body that is not the versioned week/bootstrap contract. */
export function isOperationalWeekApiEnvelope(value: unknown): boolean {
  const envelope = object(value)
  const data = object(envelope?.data)
  if (!envelope || envelope.success !== true || !data) return false
  if (data.protocolVersion !== 1 || !dateKey(data.today) || !object(data.filters)) {
    return false
  }
  if (data.mode === "FILTERS_ONLY") return data.selectionRequired === true && typeof data.timezone === "string"
  const period = object(data.period)
  return data.mode === "WEEK" && typeof period?.timezone === "string" && selectedEmployee(data.selectedAgent) && weekDays(data.days)
}

/** Reject a malformed mutation body even when an intermediary returns HTTP 2xx. */
export function isOperationalWeekWorkdayMutationEnvelope(value: unknown): boolean {
  const envelope = object(value)
  const data = object(envelope?.data)
  const workday = object(data?.workday)
  const event = object(data?.event)
  return Boolean(
    envelope?.success === true &&
    data &&
    workday &&
    event &&
    typeof workday.id === "string" && workday.id &&
    typeof workday.status === "string" && workday.status &&
    typeof event.id === "string" && event.id &&
    typeof event.workdayId === "string" && event.workdayId === workday.id &&
    typeof event.type === "string" && event.type &&
    Array.isArray(data.availableActions) && data.availableActions.every((action) => typeof action === "string" && WORKDAY_ACTIONS.has(action))
  )
}

/**
 * GPS freshness is time-relative. Retained evidence remains useful after a
 * failed request, but only a successful live or actively refreshing response
 * may look ONLINE/DELAYED. Even repeated 429s must age fail-closed.
 */
export function operationalWeekGpsPresentationFreshness(
  freshness: string,
  phase: string,
  evidence?: {
    recordedAt: string | null
    nowMs: number
    onlineSeconds: number
    delayedSeconds: number
  },
): string {
  const livePhase = phase === "ready" || phase === "refreshing"
  if (!livePhase && (freshness === "ONLINE" || freshness === "DELAYED")) return "STALE"
  if (!evidence || (freshness !== "ONLINE" && freshness !== "DELAYED")) return freshness
  const recordedAtMs = evidence.recordedAt ? Date.parse(evidence.recordedAt) : Number.NaN
  if (!Number.isFinite(recordedAtMs)) return "STALE"
  const ageSeconds = Math.max(0, (evidence.nowMs - recordedAtMs) / 1_000)
  const onlineSeconds = Math.max(1, evidence.onlineSeconds)
  const delayedSeconds = Math.max(onlineSeconds, evidence.delayedSeconds)
  const byAge = ageSeconds <= onlineSeconds ? "ONLINE" : ageSeconds <= delayedSeconds ? "DELAYED" : "STALE"
  if (freshness === "DELAYED" && byAge === "ONLINE") return "DELAYED"
  return byAge
}

/**
 * Task due dates are time-relative even when the last usable week response is
 * coming from local cache. Match the server's overdue-first classifier: any
 * non-overdue task, including returned work, ages after the strict boundary.
 */
export function operationalWeekTaskPresentationAttention(
  attention: OperationalWeekTaskAttention,
  dueAt: string | null,
  nowMs: number,
): OperationalWeekTaskAttention {
  if (attention === "OVERDUE") return attention
  const dueAtMs = dueAt ? Date.parse(dueAt) : Number.NaN
  return Number.isFinite(dueAtMs) && Number.isFinite(nowMs) && nowMs > dueAtMs
    ? "OVERDUE"
    : attention
}

/** Return the first millisecond at which a non-overdue task must be re-presented. */
export function nextOperationalWeekTaskAttentionBoundary(
  tasks: ReadonlyArray<{ attention: OperationalWeekTaskAttention; dueAt: string | null }>,
  nowMs: number,
): number | null {
  if (!Number.isFinite(nowMs)) return null
  const boundaries = tasks
    .filter((task) => task.attention !== "OVERDUE")
    .map((task) => task.dueAt ? Date.parse(task.dueAt) + 1 : Number.NaN)
    .filter((boundary) => Number.isFinite(boundary) && boundary > nowMs)
    .sort((left, right) => left - right)
  return boundaries[0] ?? null
}

/** Guard localStorage data before the UI dereferences identity-sensitive facts. */
export function isOperationalWeekCachedFacts(value: unknown): boolean {
  const facts = object(value)
  const gps = object(facts?.gps)
  const summary = object(facts?.summary)
  const contract = object(facts?.contract)
  const capability = object(facts?.workdayCapability)
  if (!facts || !cachedSelectedEmployee(facts.selectedAgent) || !Array.isArray(facts.days) ||
      (facts.days.length !== 1 && facts.days.length !== 5 && facts.days.length !== 7) || !facts.days.every(cachedDay)) return false
  return typeof facts.timezone === "string" && dateKey(facts.today) &&
    nullableString(facts.generatedAt) && nullableString(facts.snapshotId) && nullableString(facts.lastSourceAt) && nullableString(facts.scopeRole) &&
    Boolean(gps && typeof gps.freshness === "string" &&
      nullableString(gps.recordedAt) && nullableFiniteNumber(gps.accuracy) && nullableFiniteNumber(gps.battery) && nullableString(gps.reason) &&
      typeof gps.onlineSeconds === "number" && Number.isFinite(gps.onlineSeconds) && gps.onlineSeconds > 0 &&
      typeof gps.delayedSeconds === "number" && Number.isFinite(gps.delayedSeconds) && gps.delayedSeconds >= gps.onlineSeconds) &&
    Boolean(summary && finiteNumber(summary.planned) && finiteNumber(summary.actual) && finiteNumber(summary.cancelled) &&
      nullableFiniteNumber(summary.percentage) && nullableFiniteNumber(summary.numerator) && nullableFiniteNumber(summary.denominator) &&
      nullableString(summary.formula)) &&
    Array.isArray(facts.tasks) && facts.tasks.every(cachedTask) &&
    Array.isArray(facts.planChanges) && facts.planChanges.every(cachedPlanChange) &&
    Array.isArray(facts.pendingPlanChanges) && facts.pendingPlanChanges.every(cachedPlanChange) &&
    Boolean(contract && typeof contract.completeness === "string" &&
      Array.isArray(contract.reasons) && contract.reasons.every((reason) => typeof reason === "string") &&
      Array.isArray(contract.limits) && contract.limits.every((limit) => typeof limit === "string")) &&
    Boolean(capability && typeof capability.enabled === "boolean" &&
      typeof capability.canMutateSelf === "boolean" && typeof capability.endpoint === "string" &&
      Array.isArray(capability.availableActions) && capability.availableActions.every((action) => typeof action === "string" && WORKDAY_ACTIONS.has(action)) &&
      nullableString(capability.workdayId) && nullableString(capability.date) && typeof capability.requiresPriorDayClosure === "boolean" &&
      nullableString(capability.activeState) && nullableString(capability.activeStartedAt) && typeof capability.outsideSelectedWindow === "boolean")
}
