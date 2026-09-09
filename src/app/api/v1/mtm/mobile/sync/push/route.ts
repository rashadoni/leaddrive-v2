import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import {
  hasMobileCapability,
  hasMobilePermission,
  requireMobileCapability,
} from "@/lib/mtm/mobile-capabilities"
import type { MobileAuthResult } from "@/lib/mobile-auth"
import {
  completeMtmVisit,
  createVisitRequirementSnapshot,
  lockMtmActiveVisitSlot,
} from "@/lib/mtm/visit-requirements"
import { calculateDistance } from "@/lib/geo-utils"
import { MTM_CHECK_IN_ERROR, checkInConflict, type MtmCheckInErrorCode, type MtmCheckInErrorDetails } from "@/lib/mtm/check-in-errors"
import { hasMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { getMtmSettings } from "@/lib/mtm-settings"
import { BrandPotentialCreateSchema, BrandPotentialEndSchema, VisitActionResultSchema } from "@/lib/mtm-validators"
import { brandPotentialRequestHash, utcBrandPotentialDate } from "@/lib/mtm/brand-potential"
import {
  professionalGlossaryIsGoverned,
  professionalGlossaryProvenance,
} from "@/lib/mtm/professional-glossary"
import {
  contactMutationScopeForActor,
  contactScopeForActor,
  customerMutationScopeForActor,
} from "@/lib/mtm/field-scope"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import {
  applyMtmWorkdayEvent,
  parseMtmWorkdayEvent,
  type MtmWorkdayEventInput,
} from "@/lib/mtm/workday"
import {
  prepareWorkforceAttendanceVerification,
  recordWorkforceAttendanceVerification,
  WorkforceAttendanceTrustError,
} from "@/lib/workforce/attendance-trust"
import { writeWorkforceSnapshotsIfReadyInTransaction } from "@/lib/workforce/snapshot-writer"
import {
  canApplyMobileTaskTransition,
  parseMobileTaskCreate,
  parseMobileTaskEvent,
  parseMobileTaskUpdate,
  taskEventTypeForUpdate,
  type MobileTaskCreateInput,
  type MobileTaskEventInput,
  type MobileTaskStatus,
  type MobileTaskUpdateInput,
} from "@/lib/mtm/mobile-task"
import {
  lockMtmTaskRecurrenceSeriesInTransaction,
  spawnNextMtmTaskRecurrenceInTransaction,
} from "@/lib/mtm/task-recurrence"
import {
  commitmentOutcomeError,
  parseMobileCommitmentCreate,
  parseMobileCommitmentFulfill,
  type MobileCommitmentCreateInput,
  type MobileCommitmentFulfillInput,
} from "@/lib/mtm/mobile-commitment"
import {
  directMessageThreadKey,
  parseMobileMessageCreate,
  parseMobileMessageReceipt,
  type MobileMessageCreateInput,
  type MobileMessageReceiptInput,
} from "@/lib/mtm/mobile-message"
import {
  parseMobileDocumentState,
  type MobileDocumentStateInput,
} from "@/lib/mtm/mobile-document"
import {
  parseMobileHrmRequestCancel,
  parseMobileHrmRequestCreate,
  type MobileHrmRequestCancelInput,
  type MobileHrmRequestCreateInput,
} from "@/lib/mtm/mobile-hrm"
import { recordMtmMobileV1SyncActivity } from "@/lib/mtm/mobile-sync-telemetry"
import { evaluateWorkforceMobileWriteAccess } from "@/lib/workforce/mobile-write-fence"
import { mtmAlertMessage } from "@/lib/mtm/alert-messages"

/**
 * POST /api/v1/mtm/mobile/sync/push
 *
 * Batch push of offline-created / offline-updated records (M2-1b).
 * ok/conflict results are idempotent — duplicate pushes replay the stored
 * result. "error" results are not pinned (may be transient) — duplicates
 * reprocess.
 *
 * Atomicity: each operation's entity write and its idempotency record are
 * committed in ONE interactive transaction, so a concurrent duplicate push
 * of the same operationId cannot double-apply — the loser's transaction
 * rolls back on the (organizationId, operationId) unique constraint (P2002)
 * and the winner's stored result is replayed instead. Replays are scoped to
 * the authenticated agent: another agent's operationId never replays here.
 *
 * Request body:
 * {
 *   clientId: string,  // stable device UUID for logging
 *   operations: [{
 *     operationId: string,     // UUIDv4 — idempotency key
 *     op: "create" | "update",
 *     entity: "visits" | "visitActions" | "tasks" | "taskEvents" | "workdays" |
 *             "commitments" | "commitmentFulfillments" | "messages" |
 *             "messageReceipts" | "documentStates" | "hrmRequests" |
 *             "brandPotentials",
 *     data: object,            // entity payload; `id` = client-generated cuid
 *     clientTimestamp: number, // epoch ms
 *   }]
 * }
 *
 * Response:
 * {
 *   success: true,
 *   results: [{
 *     operationId: string,
 *     status: "ok" | "conflict" | "error",
 *     serverId?: string,
 *     serverData?: object,
 *     error?: string,
 *   }]
 * }
 */

type OpResult = { serverId?: string; serverData?: object; error?: string }
type OpOutcome =
  | { kind: "written"; opStatus: "ok" | "conflict"; result: OpResult }
  | {
    kind: "workforce-fence-denied"
    access: Exclude<Awaited<ReturnType<typeof evaluateWorkforceMobileWriteAccess>>, { allowed: true }>
  }
  | { kind: "workforce-fence-unavailable" }
type StoredOp = { entity: string; status: string; result: unknown }
type MobileSyncOperationEnvelope = {
  operationId: string
  opType: string
  entity: string
  data: Record<string, unknown>
  clientTimestamp: unknown
}

const TASK_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"])
const VISIT_STATUSES = new Set(["CHECKED_IN", "CHECKED_OUT", "CANCELLED"])
const VISIT_OUTCOMES = new Set(["SUCCESSFUL", "PARTIAL", "NO_CONTACT", "RESCHEDULE"])
const VISIT_POTENTIALS = new Set(["HIGH", "MEDIUM", "LOW", "UNKNOWN"])
const FORCE_CHECK_IN_ROLES = new Set(["ADMIN", "MANAGER", "SUPERVISOR"])

/**
 * Which routes a queued check-in may still attach to.
 *
 * Starting a route is a separate, explicit action after the workday has begun,
 * so a check-in must never implicitly turn a saved plan into an active route —
 * that is why PLANNED is absent. INCOMPLETE is admitted only for a route that
 * had actually started: the day-close job retires yesterday's open routes a few
 * hours after midnight, and a phone that was offline can push a real check-in
 * long after that. Refusing it would destroy the only record of a visit that
 * happened, and the agent has no way to enter it again.
 */
const CHECK_IN_ROUTE_STATUS_WHERE = {
  OR: [
    { status: "IN_PROGRESS" as const },
    { status: "INCOMPLETE" as const, startedAt: { not: null } },
  ],
}
const WORKFORCE_SYNC_ENTITIES = new Set(["workdays", "hrmRequests"])

/**
 * A Route-only tenant may use the canonical workday state machine as a
 * minimal field-session boundary: its own START/FINISH plus GPS association.
 * It never unlocks HRM requests, attendance add-ons, snapshots, timesheets,
 * or workforce sync. When Workforce is enabled, retain that module's stricter
 * tenant write fence for the shared workday record.
 */
function isRouteFieldSessionOperation(
  auth: Pick<MobileAuthResult, "tenantCapabilities">,
  entity: string,
): boolean {
  return entity === "workdays" &&
    auth.tenantCapabilities?.routeField === true &&
    auth.tenantCapabilities?.workforceHrm !== true
}

function needsWorkforceMobileWriteFence(
  auth: Pick<MobileAuthResult, "tenantCapabilities">,
  entity: string,
): boolean {
  return WORKFORCE_SYNC_ENTITIES.has(entity) && !isRouteFieldSessionOperation(auth, entity)
}

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
}

function geofenceRadius(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 25 && parsed <= 10_000 ? parsed : 100
}

function operationDate(value: unknown): Date {
  const parsed = typeof value === "number" || typeof value === "string"
    ? new Date(value)
    : new Date()
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function boundedTaskClientDate(value: unknown, receivedAt: Date): Date | null {
  const parsed = typeof value === "number" || typeof value === "string" ? new Date(value) : null
  if (!parsed || Number.isNaN(parsed.getTime())) return null
  const maxClockSkewMs = 7 * 24 * 60 * 60 * 1_000
  return Math.abs(parsed.getTime() - receivedAt.getTime()) <= maxClockSkewMs ? parsed : null
}

function effectiveTaskDueDate(value: string | null | undefined, current: Date | null): Date | null {
  if (value === undefined) return current
  return value === null ? null : new Date(value)
}

type NextActionInput = {
  title: string
  dueDate: Date
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
}

function parseNextActionEvidence(evidence: unknown): NextActionInput | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null
  const input = evidence as Record<string, unknown>
  const title = typeof input.title === "string" ? input.title.trim() : ""
  const dueDate = typeof input.dueDate === "string" ? new Date(input.dueDate) : new Date(Number.NaN)
  const priority = typeof input.priority === "string" && TASK_PRIORITIES.has(input.priority)
    ? input.priority as NextActionInput["priority"]
    : "MEDIUM"
  if (!title || title.length > 200 || Number.isNaN(dueDate.getTime())) return null
  return { title, dueDate, priority }
}

const isValidOpId = (id: unknown): id is string => typeof id === "string" && id.length > 0

function syncCapabilityError(
  operationId: string,
  capabilityId: "route-field" | "workforce-hrm",
) {
  const label = capabilityId === "workforce-hrm" ? "Workforce HRM" : "Route & Field"
  return {
    operationId,
    status: "error" as const,
    error: `${label} is not enabled for this tenant.`,
    serverData: { code: "TENANT_CAPABILITY_DISABLED", capabilityId },
  }
}

function syncPermissionError(operationId: string, permission: string) {
  return {
    operationId,
    status: "error" as const,
    error: "Forbidden",
    serverData: { code: "MTM_MOBILE_PERMISSION_REQUIRED", permission },
  }
}

function syncOperationIdMismatchError(operationId: string) {
  return {
    operationId,
    status: "error" as const,
    error: "This operation ID belongs to a different sync entity.",
    serverData: { code: "MTM_SYNC_OPERATION_ID_MISMATCH" },
  }
}

function syncWorkforceMobileWriteFenceError(
  operationId: string,
  access: { code: string; message: string; mode: string },
) {
  return {
    operationId,
    status: "error" as const,
    error: access.message,
    serverData: { code: access.code, mode: access.mode },
  }
}

function syncWorkforceMobileWriteFenceUnavailableError(operationId: string) {
  return {
    operationId,
    status: "error" as const,
    error: "Unable to verify the Workforce mobile write fence. Please retry.",
    serverData: { code: "WORKFORCE_MOBILE_WRITE_FENCE_UNAVAILABLE" },
  }
}

function hasSyncCapability(
  auth: Pick<MobileAuthResult, "tenantCapabilities">,
  capabilityId: "route-field" | "workforce-hrm",
): boolean {
  if (!auth.tenantCapabilities) return false
  return capabilityId === "workforce-hrm"
    ? auth.tenantCapabilities.workforceHrm
    : auth.tenantCapabilities.routeField
}

function capabilityForSyncEntity(
  auth: Pick<MobileAuthResult, "tenantCapabilities">,
  entity: string,
): "route-field" | "workforce-hrm" {
  return isRouteFieldSessionOperation(auth, entity)
    ? "route-field"
    : WORKFORCE_SYNC_ENTITIES.has(entity)
      ? "workforce-hrm"
      : "route-field"
}

function canMutateRouteSyncOperation(auth: { role: string }, entity: string, opType: string, data: Record<string, unknown>): boolean {
  return hasMobileCapability(auth.role, "FIELD_EXECUTE") || (
    FORCE_CHECK_IN_ROLES.has(auth.role)
    && entity === "visits"
    && opType === "create"
    && data.force === true
  )
}

export const POST = withMobileRls(async (req, auth) => {
  const orgId = auth.orgId
  const agentId = auth.agentId
  const attendanceCapabilities = {
    qrEnabled: auth.tenantCapabilities.attendanceQr === true,
    deviceTrustEnabled: auth.tenantCapabilities.attendanceDeviceTrust === true,
  }

  // Keep legacy activity visible to the S7 census without reading the body or
  // changing any v1 idempotency/outbox behavior. Invalid requests still prove
  // an authenticated old client is active and conservatively block retirement.
  recordMtmMobileV1SyncActivity({
    organizationId: orgId,
    agentId,
    apkVersion: req.headers.get("x-field-apk-version"),
    endpoint: "POST /api/v1/mtm/mobile/sync/push",
  })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const bodyRecord = body && typeof body === "object" && !Array.isArray(body)
    ? body as { operations?: unknown }
    : {}
  const operations = Array.isArray(bodyRecord.operations) ? bodyRecord.operations : []
  if (operations.length === 0) {
    return NextResponse.json({ success: true, results: [] })
  }
  if (operations.length > 100) {
    return NextResponse.json({ error: "Max 100 operations per push" }, { status: 400 })
  }

  // Preserve the status-level contract that old route-only APKs already use
  // to recognize a manager/supervisor without field execution.  A batch that
  // also contains an HRM event deliberately does *not* take this shortcut:
  // its operations are split below so the workday event is never starved by
  // an unrelated route mutation.
  const containsWorkforceOperation = operations.some((operation) => (
    operation != null &&
    typeof operation === "object" &&
    !Array.isArray(operation) &&
    needsWorkforceMobileWriteFence(auth, (operation as { entity?: unknown }).entity as string)
  ))
  const privilegedForceOnly = FORCE_CHECK_IN_ROLES.has(auth.role)
    && operations.length > 0
    && operations.every((operation) => (
      operation?.entity === "visits"
      && operation?.op === "create"
      && operation?.data?.force === true
    ))
  const legacyFieldDenied = requireMobileCapability(auth, "FIELD_EXECUTE")
  if (!containsWorkforceOperation && legacyFieldDenied && !privilegedForceOnly) {
    return legacyFieldDenied
  }

  let workdayTimezone = "UTC"
  let taskSelfCreate = false
  let taskSelfRecurring = false
  let brandPotentialPerAgent = true
  let brandPotentialAsOf = new Date()
  if (operations.some((operation) => (
    operation != null &&
    typeof operation === "object" &&
    !Array.isArray(operation) &&
    (
      (operation as { entity?: unknown }).entity === "workdays" ||
      (operation as { entity?: unknown }).entity === "tasks" ||
      (operation as { entity?: unknown }).entity === "brandPotentials"
    )
  ))) {
    try {
      const settings = await getMtmSettings(orgId)
      workdayTimezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
      taskSelfCreate = settings.taskSelfCreate
      taskSelfRecurring = settings.taskSelfRecurring
      brandPotentialPerAgent = settings.brandPotentialPerAgentEnabled
      brandPotentialAsOf = utcBrandPotentialDate(currentDateKey(new Date(), workdayTimezone))
    } catch (error) {
      console.error("[MTM/sync/push] failed to load mobile settings", error)
      return NextResponse.json({ error: "Failed to load mobile settings" }, { status: 500 })
    }
  }

  const results: {
    operationId: string
    status: "ok" | "conflict" | "error"
    serverId?: string
    serverData?: object
    error?: string
  }[] = []

  // ── Batched idempotency pre-check ─────────────────────────────────
  // One findMany for the whole batch instead of a findUnique per op. This is
  // an optimization only: correctness is enforced by the atomic pin inside
  // each op's transaction, so a pre-check failure degrades gracefully — any
  // duplicate the Map misses is caught by P2002 on the pin and replayed.
  const validIds = [...new Set(operations.map((o) => o?.operationId).filter(isValidOpId))]
  const known = new Map<string, StoredOp>()
  if (validIds.length > 0) {
    try {
      // agentId in the filter: an operationId pinned by ANOTHER agent must not
      // replay its stored result (with that agent's serverData) to this one.
      const rows = await prisma.mtmSyncOperation.findMany({
        where: { organizationId: orgId, agentId, operationId: { in: validIds } },
        select: { operationId: true, entity: true, status: true, result: true },
      })
      for (const r of rows) known.set(r.operationId, r)
    } catch (e) {
      console.error("[MTM/sync/push] idempotency pre-check failed, degrading to tx-level dedup", e)
    }
  }

  const replayOf = (operationId: string, rec: StoredOp) => {
    const prev = rec.result && typeof rec.result === "object" ? rec.result as Partial<OpResult> : {}
    return {
      operationId,
      status: rec.status as "ok" | "conflict" | "error",
      serverId: prev?.serverId,
      serverData: prev?.serverData,
      ...(prev?.error ? { error: prev.error } : {}),
    }
  }

  // This release gate is deliberately independent of the read-only sync-v2
  // `workforce` cohort. This preflight protects stored replays and cheaply
  // splits a mixed v1 batch without starving an unrelated Route operation.
  // Every new Workforce mutation is re-evaluated under the tenant fence lock
  // inside its write transaction below. Include stored entities as well: an
  // old workday operation ID cannot be relabelled as `visits` to replay around
  // the fence.
  const workforceMobileWriteFenceNeeded = containsWorkforceOperation
    || [...known.values()].some((operation) => needsWorkforceMobileWriteFence(auth, operation.entity))
  let workforceMobileWriteAccess: Awaited<ReturnType<typeof evaluateWorkforceMobileWriteAccess>> | null = null
  let workforceMobileWriteFenceUnavailable = false
  if (workforceMobileWriteFenceNeeded) {
    try {
      workforceMobileWriteAccess = await evaluateWorkforceMobileWriteAccess({
        auth,
        deviceId: req.headers.get("x-field-device-id"),
      })
    } catch (error) {
      // A configured control plane must never silently degrade to legacy. The
      // per-operation error below keeps a mixed v1 batch isolated and retryable.
      console.error("[MTM/sync/push] Workforce mobile write fence unavailable", error)
      workforceMobileWriteFenceUnavailable = true
    }
  }

  for (const op of operations) {
    // `op ?? {}`: a null/undefined array element must fail as a malformed op,
    // not throw on destructuring outside every per-op handler (500ing the batch).
    const envelope = op != null && typeof op === "object" && !Array.isArray(op)
      ? op as Record<string, unknown>
      : {}
    const operationIdCandidate = envelope.operationId
    const opTypeCandidate = envelope.op
    const entityCandidate = envelope.entity
    const dataCandidate = envelope.data
    const clientTimestamp = envelope.clientTimestamp

    // Type-strict guard: a malformed field (e.g. numeric operationId) must
    // fail THIS op only — if it reached the prisma calls below it would throw
    // a validation error outside the per-op try and 500 the whole batch,
    // permanently wedging the client's outbox retry loop.
    if (
      !isValidOpId(operationIdCandidate) ||
      typeof opTypeCandidate !== "string" || !opTypeCandidate ||
      typeof entityCandidate !== "string" || !entityCandidate ||
      typeof dataCandidate !== "object" || dataCandidate === null || Array.isArray(dataCandidate)
    ) {
      results.push({
        operationId: isValidOpId(operationIdCandidate) ? operationIdCandidate : "?",
        status: "error",
        error: "Missing or invalid required fields",
      })
      continue
    }
    const operation: MobileSyncOperationEnvelope = {
      operationId: operationIdCandidate,
      opType: opTypeCandidate,
      entity: entityCandidate,
      data: dataCandidate as Record<string, unknown>,
      clientTimestamp,
    }
    const { operationId, opType, entity, data } = operation

    // ── Replay already-processed operations ──────────────────────────
    // The stored entity is authoritative for replay. An operation id cannot
    // be relabelled by a new envelope to cross a product boundary, and a
    // disabled product cannot use an immutable result as a side-channel for
    // workday/request details.
    //
    // The Map also collects results as this batch progresses, so an
    // intra-batch duplicate operationId replays locally without touching
    // the database.
    const prev = known.get(operationId)
    if (prev) {
      if (prev.entity !== entity) {
        results.push(syncOperationIdMismatchError(operationId))
        continue
      }
      const replayCapability = capabilityForSyncEntity(auth, prev.entity)
      if (!hasSyncCapability(auth, replayCapability)) {
        results.push(syncCapabilityError(operationId, replayCapability))
        continue
      }
      if (needsWorkforceMobileWriteFence(auth, prev.entity)) {
        if (workforceMobileWriteFenceUnavailable || !workforceMobileWriteAccess) {
          results.push(syncWorkforceMobileWriteFenceUnavailableError(operationId))
          continue
        }
        if (!workforceMobileWriteAccess.allowed) {
          results.push(syncWorkforceMobileWriteFenceError(operationId, workforceMobileWriteAccess))
          continue
        }
      }
      results.push(replayOf(operationId, prev))
      continue
    }

    // A mixed legacy batch is split at the operation boundary.  This lets an
    // HRM-only tenant safely deliver a critical workday event even when an old
    // client still has a route operation queued beside it, without allowing
    // that route operation through the commercial boundary.
    if (needsWorkforceMobileWriteFence(auth, entity)) {
      if (!hasSyncCapability(auth, "workforce-hrm")) {
        results.push(syncCapabilityError(operationId, "workforce-hrm"))
        continue
      }
      if (workforceMobileWriteFenceUnavailable || !workforceMobileWriteAccess) {
        results.push(syncWorkforceMobileWriteFenceUnavailableError(operationId))
        continue
      }
      if (!workforceMobileWriteAccess.allowed) {
        results.push(syncWorkforceMobileWriteFenceError(operationId, workforceMobileWriteAccess))
        continue
      }
      if (!hasMobilePermission(auth.role, "WORKTIME_SELF_MUTATE")) {
        results.push(syncPermissionError(operationId, "WORKTIME_SELF_MUTATE"))
        continue
      }
    } else {
      if (!hasSyncCapability(auth, "route-field")) {
        results.push(syncCapabilityError(operationId, "route-field"))
        continue
      }
      if (!canMutateRouteSyncOperation(auth, entity, opType, data)) {
        results.push(syncPermissionError(operationId, "ROUTE_EXECUTE"))
        continue
      }
    }

    // ── Deterministic validation BEFORE the transaction ──────────────
    // These fail the same way on every retry, cost no DB work, and are
    // deliberately not pinned ("error" results are retryable by design).
    let validationError: string | undefined
    let nextAction: NextActionInput | null = null
    let visitActionInput: ReturnType<typeof VisitActionResultSchema.parse> | null = null
    let workdayInput: MtmWorkdayEventInput | null = null
    let taskCreateInput: MobileTaskCreateInput | null = null
    let taskUpdateInput: MobileTaskUpdateInput | null = null
    let taskEventInput: MobileTaskEventInput | null = null
    let commitmentCreateInput: MobileCommitmentCreateInput | null = null
    let commitmentFulfillInput: MobileCommitmentFulfillInput | null = null
    let messageCreateInput: MobileMessageCreateInput | null = null
    let messageReceiptInput: MobileMessageReceiptInput | null = null
    let documentStateInput: MobileDocumentStateInput | null = null
    let hrmRequestCreateInput: MobileHrmRequestCreateInput | null = null
    let hrmRequestCancelInput: MobileHrmRequestCancelInput | null = null
    let brandPotentialCreateInput: ReturnType<typeof BrandPotentialCreateSchema.parse> | null = null
    let brandPotentialEndInput: ReturnType<typeof BrandPotentialEndSchema.parse> | null = null
    const receivedAt = new Date()
    const clientOccurredAt = operationDate(clientTimestamp)
    const taskClientOccurredAt = boundedTaskClientDate(clientTimestamp, receivedAt)
    if (entity === "visits") {
      if (opType !== "create" && opType !== "update") {
        validationError = `Unsupported op "${opType}" for entity "visits"`
      } else if (opType === "create" && typeof data.customerId !== "string") {
        validationError = "data.customerId required for visit create"
      } else if (opType === "update" && !data.id) {
        validationError = "data.id required for visit update"
      } else if (opType === "create" && data.status && data.status !== "CHECKED_IN") {
        validationError = "A visit must be checked in before it can be completed"
      } else if (opType === "update" && data.status != null && !VISIT_STATUSES.has(data.status as string)) {
        validationError = "Invalid visit status"
      } else if (
        (data.checkInLat != null || data.checkInLng != null) &&
        (!validCoordinate(data.checkInLat, -90, 90) || !validCoordinate(data.checkInLng, -180, 180))
      ) {
        validationError = "Valid check-in latitude and longitude are required together"
      } else if (
        (data.checkOutLat != null || data.checkOutLng != null) &&
        (!validCoordinate(data.checkOutLat, -90, 90) || !validCoordinate(data.checkOutLng, -180, 180))
      ) {
        validationError = "Valid check-out latitude and longitude are required together"
      } else if (data.outcome != null && !VISIT_OUTCOMES.has(data.outcome)) {
        validationError = "Invalid visit outcome"
      } else if (data.potential != null && !VISIT_POTENTIALS.has(data.potential)) {
        validationError = "Invalid visit potential"
      }
    } else if (entity === "visitActions") {
      if (opType !== "create") {
        validationError = `Unsupported op "${opType}" for entity "visitActions"`
      } else if (typeof data.visitId !== "string" || !data.visitId) {
        validationError = "visitId is required for visit action"
      } else {
        const parsed = VisitActionResultSchema.safeParse(data)
        if (!parsed.success) {
          validationError = parsed.error.issues[0]?.message ?? "Invalid visit action"
        } else {
          visitActionInput = parsed.data
          if (parsed.data.actionKey === "NEXT_ACTION") {
            nextAction = parseNextActionEvidence(parsed.data.evidence)
            if (!nextAction) validationError = "NEXT_ACTION requires evidence.title and a valid evidence.dueDate"
          }
        }
      }
    } else if (entity === "tasks") {
      if (opType === "create") {
        const parsed = parseMobileTaskCreate(data)
        taskCreateInput = parsed.input
        validationError = parsed.error ?? undefined
        if (!validationError && !taskSelfCreate) {
          validationError = "Self-created tasks are disabled for this organization"
        } else if (!validationError && taskCreateInput?.recurrence && !taskSelfRecurring) {
          validationError = "Recurring tasks are disabled for this organization"
        } else if (
          !validationError
          && taskCreateInput?.recurrence?.until
          && (taskCreateInput.dueDate || taskCreateInput.scheduledStartAt)
        ) {
          const timezone = taskCreateInput.recurrence.timezone ?? workdayTimezone
          const identity = taskCreateInput.dueDate ?? taskCreateInput.scheduledStartAt!
          if (
            dateInputValueInTimezone(taskCreateInput.recurrence.until, timezone)
            < dateInputValueInTimezone(identity, timezone)
          ) {
            validationError = "Recurrence end must not be before the task schedule"
          }
        }
      } else if (opType === "update") {
        const parsed = parseMobileTaskUpdate(data)
        taskUpdateInput = parsed.input
        validationError = parsed.error ?? undefined
      } else {
        validationError = `Unsupported op "${opType}" for entity "tasks"`
      }
    } else if (entity === "taskEvents") {
      if (opType !== "create") {
        validationError = `Unsupported op "${opType}" for entity "taskEvents"`
      } else {
        const parsed = parseMobileTaskEvent(data)
        taskEventInput = parsed.input
        validationError = parsed.error ?? undefined
      }
    } else if (entity === "workdays") {
      if (opType !== "create") {
        validationError = `Unsupported op "${opType}" for entity "workdays"`
      } else {
        const parsed = parseMtmWorkdayEvent(data, operationId, workdayTimezone)
        workdayInput = parsed.input
        validationError = parsed.error ?? undefined
      }
    } else if (entity === "commitments") {
      if (opType !== "create") {
        validationError = `Unsupported op "${opType}" for entity "commitments"`
      } else {
        const parsed = parseMobileCommitmentCreate(data, clientOccurredAt)
        commitmentCreateInput = parsed.input
        validationError = parsed.error ?? undefined
      }
    } else if (entity === "commitmentFulfillments") {
      if (opType !== "create") {
        validationError = `Unsupported op "${opType}" for entity "commitmentFulfillments"`
      } else {
        const parsed = parseMobileCommitmentFulfill(data)
        commitmentFulfillInput = parsed.input
        validationError = parsed.error ?? undefined
      }
    } else if (entity === "messages") {
      if (opType !== "create") {
        validationError = `Unsupported op "${opType}" for entity "messages"`
      } else {
        const parsed = parseMobileMessageCreate(data)
        messageCreateInput = parsed.input
        validationError = parsed.error ?? undefined
      }
    } else if (entity === "messageReceipts") {
      if (opType !== "create") {
        validationError = `Unsupported op "${opType}" for entity "messageReceipts"`
      } else {
        const parsed = parseMobileMessageReceipt(data)
        messageReceiptInput = parsed.input
        validationError = parsed.error ?? undefined
      }
    } else if (entity === "documentStates") {
      if (opType !== "update") {
        validationError = `Unsupported op "${opType}" for entity "documentStates"`
      } else {
        const parsed = parseMobileDocumentState(data)
        documentStateInput = parsed.input
        validationError = parsed.error ?? undefined
      }
    } else if (entity === "hrmRequests") {
      if (opType === "create") {
        const parsed = parseMobileHrmRequestCreate(data)
        hrmRequestCreateInput = parsed.input
        validationError = parsed.error ?? undefined
      } else if (opType === "update") {
        const parsed = parseMobileHrmRequestCancel(data)
        hrmRequestCancelInput = parsed.input
        validationError = parsed.error ?? undefined
      } else {
        validationError = `Unsupported op "${opType}" for entity "hrmRequests"`
      }
    } else if (entity === "brandPotentials") {
      if (opType === "create") {
        if (typeof data.contactId !== "string" || !data.contactId) {
          validationError = "data.contactId required for brand potential create"
        } else {
          const parsed = BrandPotentialCreateSchema.safeParse(data)
          if (parsed.success) brandPotentialCreateInput = parsed.data
          else validationError = parsed.error.issues[0]?.message ?? "Invalid brand potential"
        }
      } else if (opType === "update") {
        if (typeof data.id !== "string" || !data.id) {
          validationError = "data.id required for brand potential update"
        } else {
          const parsed = BrandPotentialEndSchema.safeParse(data)
          if (parsed.success) brandPotentialEndInput = parsed.data
          else validationError = parsed.error.issues[0]?.message ?? "Invalid brand potential period end"
        }
      } else {
        validationError = `Unsupported op "${opType}" for entity "brandPotentials"`
      }
    } else {
      validationError = `Unsupported entity "${entity}"`
    }
    if (validationError) {
      results.push({ operationId, status: "error", error: validationError })
      continue
    }

    // ── Process: entity write + idempotency pin in ONE transaction ───
    // Everything inside the callback must go through `tx.*` — with the RLS
    // context flagged inTx, a stray `prisma.*` call would run on a pool
    // connection without app.org_id and fail closed.
    try {
      const out = await prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<OpOutcome> => {
        // A prior preflight may have allowed this operation just before an
        // administrator freezes the tenant or removes a cohort. Re-read while
        // holding the shared tenant fence lock through commit, so the actual
        // mutation is linearized with those exclusive control-plane changes.
        // Fence failures stay unpinned and retryable like other temporary
        // mobile trust failures.
        if (needsWorkforceMobileWriteFence(auth, entity)) {
          try {
            const access = await evaluateWorkforceMobileWriteAccess({
              auth,
              deviceId: req.headers.get("x-field-device-id"),
              tx,
            })
            if (!access.allowed) return { kind: "workforce-fence-denied", access }
          } catch (error) {
            console.error("[MTM/sync/push] Workforce mobile write fence unavailable in transaction", error)
            return { kind: "workforce-fence-unavailable" }
          }
        }
        let opStatus: "ok" | "conflict" = "ok"
        let serverId: string | undefined
        let serverData: object | undefined
        let errorMsg: string | undefined
        const occurredAt = clientOccurredAt
        // Check-in refusals share one vocabulary with POST /api/v1/mtm/visits
        // (src/lib/mtm/check-in-errors.ts); the app branches on serverData.code.
        const rejectCheckIn = (code: MtmCheckInErrorCode, details: MtmCheckInErrorDetails = {}) => {
          opStatus = "conflict"
          const conflict = checkInConflict(code, details)
          errorMsg = conflict.errorMsg
          serverData = conflict.serverData
        }

        if (entity === "visits" && opType === "create") {
          const visitId = data.id || undefined
          const checkInAt = data.checkInAt ? new Date(data.checkInAt) : new Date()
          const forceRequested = data.force === true
          const forceAuthorized = forceRequested && FORCE_CHECK_IN_ROLES.has(auth.role)
          const requestedRouteTarget = Boolean(data.routeId || data.routePointId)
          const routePoint = requestedRouteTarget
            ? await tx.mtmRoutePoint.findFirst({
                where: {
                  ...(data.routePointId ? { id: data.routePointId } : {}),
                  ...(data.routeId ? { routeId: data.routeId } : {}),
                  customerId: data.customerId,
                  ...(data.contactId !== undefined ? { contactId: data.contactId } : {}),
                  deletedAt: null,
                  status: "PENDING",
                  route: {
                    organizationId: orgId,
                    deletedAt: null,
                    AND: [CHECK_IN_ROUTE_STATUS_WHERE],
                    OR: [
                      { agentId },
                      { assignments: { some: { agentId, removedAt: null, role: { not: "OBSERVER" } } } },
                    ],
                  },
                },
                select: {
                  id: true,
                  routeId: true,
                  customerId: true,
                  contactId: true,
                  route: {
                    select: {
                      status: true,
                      assignments: {
                        where: { removedAt: null },
                        select: { agentId: true, role: true },
                      },
                    },
                  },
                },
              })
            : null

          if (forceRequested && !forceAuthorized) {
            rejectCheckIn(MTM_CHECK_IN_ERROR.FORCE_FORBIDDEN, { actorRole: auth.role })
          } else if (requestedRouteTarget && !routePoint) {
            rejectCheckIn(MTM_CHECK_IN_ERROR.ROUTE_POINT_NOT_AVAILABLE)
          } else if (
            routePoint &&
            (routePoint.customerId !== data.customerId ||
              (data.contactId !== undefined && routePoint.contactId !== data.contactId))
          ) {
            rejectCheckIn(MTM_CHECK_IN_ERROR.ROUTE_TARGET_MISMATCH)
          } else {
            const customerId = routePoint?.customerId ?? data.customerId
            const contactId = routePoint?.contactId ?? data.contactId ?? null
            const visitActor = { agentId, role: "AGENT" as const, scopedAgentIds: [agentId] }
            await lockMtmActiveVisitSlot(tx, { organizationId: orgId, agentId })
            const [customer, activeVisit, contact] = await Promise.all([
              tx.mtmCustomer.findFirst({
                where: {
                  id: customerId,
                  organizationId: orgId,
                  deletedAt: null,
                  AND: [customerMutationScopeForActor(visitActor, checkInAt)],
                },
                select: { id: true, latitude: true, longitude: true, geofenceRadius: true },
              }),
              tx.mtmVisit.findFirst({
                where: { organizationId: orgId, agentId, status: "CHECKED_IN", deletedAt: null },
                select: { id: true, customerId: true, routePointId: true, checkInAt: true },
              }),
              contactId && !routePoint
                ? tx.mtmContact.findFirst({
                    where: {
                      id: contactId,
                      organizationId: orgId,
                      deletedAt: null,
                      status: { not: "INACTIVE" },
                      AND: [
                        contactMutationScopeForActor(visitActor, checkInAt),
                        {
                          workplaces: {
                            some: {
                              organizationId: orgId,
                              customerId,
                              deletedAt: null,
                              AND: [
                                { OR: [{ startedOn: null }, { startedOn: { lte: checkInAt } }] },
                                { OR: [{ endedOn: null }, { endedOn: { gt: checkInAt } }] },
                              ],
                            },
                          },
                        },
                      ],
                    },
                    select: { id: true },
                  })
                : Promise.resolve(contactId ? { id: contactId } : null),
            ])

            if (!customer) {
              rejectCheckIn(MTM_CHECK_IN_ERROR.CUSTOMER_MISSING)
            } else if (contactId && !contact) {
              rejectCheckIn(MTM_CHECK_IN_ERROR.CONTACT_MISSING)
            } else if (activeVisit) {
              rejectCheckIn(MTM_CHECK_IN_ERROR.ACTIVE_VISIT, { activeVisit })
            } else if (!hasMtmCoordinates(customer)) {
              // Owner decision 2 (field UX audit 2026-09-05): a customer without
              // coordinates cannot be visited by anyone, force included. The fix
              // is on the organization card, not in the field.
              rejectCheckIn(MTM_CHECK_IN_ERROR.NO_COORDINATES, { customerId })
            } else {
              let distanceMeters: number | null = null
              let radius = customer.geofenceRadius
              let forceOverrideMeta: { distanceMeters: number; geofenceRadius: number } | null = null
              if (
                validCoordinate(data.checkInLat, -90, 90) &&
                validCoordinate(data.checkInLng, -180, 180)
              ) {
                if (radius == null) {
                  const setting = await tx.mtmSetting.findFirst({
                    where: { organizationId: orgId, key: "geofenceRadius" },
                    select: { value: true },
                  })
                  radius = geofenceRadius(setting?.value)
                }
                distanceMeters = calculateDistance(
                  data.checkInLat,
                  data.checkInLng,
                  customer.latitude,
                  customer.longitude,
                )
              }

              if (distanceMeters != null && distanceMeters > geofenceRadius(radius)) {
                const roundedDistance = Math.round(distanceMeters)
                const allowedRadius = geofenceRadius(radius)
                await tx.mtmAlert.create({
                  data: {
                    organizationId: orgId,
                    agentId,
                    type: "OUT_OF_ZONE",
                    category: "WARNING",
                    title: "Out of zone check-in",
                    description: forceAuthorized
                      ? `Privileged check-in accepted ${roundedDistance}m away (max ${allowedRadius}m)`
                      : `Agent attempted check-in ${roundedDistance}m away (max ${allowedRadius}m)`,
                    metadata: {
                      customerId,
                      routeId: routePoint?.routeId ?? null,
                      routePointId: routePoint?.id ?? null,
                      distanceMeters: roundedDistance,
                      geofenceRadius: allowedRadius,
                      forceOverride: forceAuthorized,
                      actorRole: auth.role,
                      // Two different events, two keys: a refused check-in and
                      // one a privileged actor pushed through read differently
                      // to whoever opens the list.
                      ...mtmAlertMessage(
                        forceAuthorized ? "outOfZoneCheckInForced" : "outOfZoneCheckIn",
                        { distanceMeters: roundedDistance, geofenceRadius: allowedRadius },
                      ),
                    },
                  },
                })
                if (forceAuthorized) {
                  forceOverrideMeta = { distanceMeters: roundedDistance, geofenceRadius: allowedRadius }
                } else {
                  rejectCheckIn(MTM_CHECK_IN_ERROR.TOO_FAR, { distanceMeters: roundedDistance, geofenceRadius: allowedRadius })
                }
              }

              if (opStatus === "ok" && routePoint) {
                const pointFence = await tx.mtmRoutePoint.updateMany({
                  where: {
                    id: routePoint.id,
                    routeId: routePoint.routeId,
                    customerId,
                    contactId,
                    status: "PENDING",
                    deletedAt: null,
                    route: {
                      organizationId: orgId,
                      deletedAt: null,
                      AND: [CHECK_IN_ROUTE_STATUS_WHERE],
                      OR: [
                        { agentId },
                        { assignments: { some: { agentId, removedAt: null, role: { not: "OBSERVER" } } } },
                      ],
                    },
                  },
                  data: { status: "PENDING" },
                })
                if (pointFence.count !== 1) {
                  rejectCheckIn(MTM_CHECK_IN_ERROR.ROUTE_POINT_NOT_AVAILABLE)
                } else {
                  const activePointVisit = await tx.mtmVisit.findFirst({
                    where: { organizationId: orgId, routePointId: routePoint.id, status: "CHECKED_IN", deletedAt: null },
                    select: { id: true },
                  })
                  if (activePointVisit) {
                    rejectCheckIn(MTM_CHECK_IN_ERROR.ROUTE_POINT_ALREADY_ACTIVE, { activeVisit: activePointVisit })
                  }
                }
              }

              if (opStatus === "ok") {
                const visit = await tx.mtmVisit.create({
                  data: {
                    ...(visitId ? { id: visitId } : {}),
                    organizationId: orgId,
                    agentId,
                    customerId,
                    contactId,
                    status: "CHECKED_IN",
                    routeId: routePoint?.routeId ?? null,
                    routePointId: routePoint?.id ?? null,
                    checkInAt,
                    checkInLat: data.checkInLat ?? null,
                    checkInLng: data.checkInLng ?? null,
                    notes: data.notes ?? null,
                  },
                  select: { id: true, status: true, checkInAt: true, customerId: true, contactId: true, routeId: true, routePointId: true },
                })
                await createVisitRequirementSnapshot(tx, {
                  organizationId: orgId,
                  visitId: visit.id,
                  agentId,
                  customerId: visit.customerId,
                  visitType: typeof data.visitType === "string" ? data.visitType : undefined,
                  at: visit.checkInAt,
                })
                if (forceOverrideMeta) {
                  await tx.mtmAuditLog.create({
                    data: {
                      organizationId: orgId,
                      agentId,
                      action: "CHECK_IN_FORCED",
                      entity: "visit",
                      entityId: visit.id,
                      metadataKind: "force_checkin",
                      newData: {
                        customerId,
                        routeId: routePoint?.routeId ?? null,
                        routePointId: routePoint?.id ?? null,
                        actorRole: auth.role,
                        forceOverride: true,
                        ...forceOverrideMeta,
                      },
                    },
                  })
                }
                if (routePoint) {
                  const participants = routePoint.route.assignments.filter((assignment) => assignment.agentId !== agentId)
                  if (participants.length > 0) {
                    await tx.mtmVisitParticipant.createMany({
                      data: participants.map((assignment) => ({
                        organizationId: orgId,
                        visitId: visit.id,
                        agentId: assignment.agentId,
                        role: assignment.role,
                        joinedAt: checkInAt,
                      })),
                      skipDuplicates: true,
                    })
                  }
                }
                serverId = visit.id
                serverData = visit
              }
            }
          }

        } else if (entity === "visits" && opType === "update") {
          // Guard: agent can only update their own active visits (soft-deleted visits return conflict)
          const existing = await tx.mtmVisit.findFirst({
            where: { id: data.id, organizationId: orgId, agentId, deletedAt: null },
          })
          if (!existing) {
            opStatus = "conflict"
            errorMsg = "Visit not found or not owned by agent"
          } else {
            // Block reverting terminal statuses (server wins). A status-less
            // update (e.g. notes synced after checkout) is NOT a revert —
            // field-only edits to a checked-out visit must still apply.
            const terminalStatuses = ["CHECKED_OUT"]
            if (terminalStatuses.includes(existing.status) && data.status && !terminalStatuses.includes(data.status)) {
              opStatus = "conflict"
              errorMsg = "Cannot revert terminal visit status"
              serverData = existing
            } else if (data.status === "CHECKED_OUT") {
              const visitFence = await tx.mtmVisit.updateMany({
                where: {
                  id: data.id,
                  organizationId: orgId,
                  agentId,
                  status: existing.status,
                  deletedAt: null,
                },
                data: {
                  status: existing.status,
                  ...(data.outcome !== undefined ? { outcome: data.outcome } : {}),
                  ...(data.potential !== undefined ? { potential: data.potential } : {}),
                  ...(data.resultNotes !== undefined ? { resultNotes: data.resultNotes } : {}),
                  ...(data.notes !== undefined ? { notes: data.notes } : {}),
                },
              })
              if (visitFence.count !== 1) {
                opStatus = "conflict"
                errorMsg = "Visit changed or is no longer owned by agent"
              } else {
                const completion = await completeMtmVisit(tx, {
                  organizationId: orgId,
                  visitId: data.id,
                  expectedAgentId: agentId,
                  checkOutAt: data.checkOutAt ? new Date(data.checkOutAt) : undefined,
                  latitude: data.checkOutLat,
                  longitude: data.checkOutLng,
                })
                if (completion.status === "missing_requirements") {
                  opStatus = "conflict"
                  errorMsg = "Required visit actions are incomplete"
                  serverData = { code: "MTM_VISIT_REQUIREMENTS_INCOMPLETE", missing: completion.missing }
                } else if (completion.status === "invalid_status") {
                  opStatus = "conflict"
                  errorMsg = "Visit cannot be completed from its current status"
                  serverData = { code: "MTM_VISIT_STATUS_INVALID", status: completion.visitStatus }
                } else if (completion.status === "not_found") {
                  opStatus = "conflict"
                  errorMsg = "Visit not found or not owned by agent"
                } else {
                  serverId = completion.visit.id
                  serverData = completion.visit
                }
              }
            } else {
              const changed = await tx.mtmVisit.updateMany({
                where: {
                  id: data.id,
                  organizationId: orgId,
                  agentId,
                  status: existing.status,
                  deletedAt: null,
                },
                data: {
                  status: (typeof data.status === "string" ? data.status : existing.status) as "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED",
                  ...(data.checkOutAt ? { checkOutAt: new Date(data.checkOutAt) } : {}),
                  ...(data.checkOutLat !== undefined ? { checkOutLat: data.checkOutLat } : {}),
                  ...(data.checkOutLng !== undefined ? { checkOutLng: data.checkOutLng } : {}),
                  ...(data.notes !== undefined ? { notes: data.notes } : {}),
                  ...(data.outcome !== undefined ? { outcome: data.outcome } : {}),
                  ...(data.potential !== undefined ? { potential: data.potential } : {}),
                  ...(data.resultNotes !== undefined ? { resultNotes: data.resultNotes } : {}),
                  ...(data.duration !== undefined ? { duration: data.duration } : {}),
                },
              })
              if (changed.count !== 1) {
                opStatus = "conflict"
                errorMsg = "Visit changed or is no longer owned by agent"
              } else {
                const updated = await tx.mtmVisit.findFirst({
                  where: { id: data.id, organizationId: orgId, agentId, deletedAt: null },
                  select: { id: true, status: true, checkInAt: true, checkOutAt: true },
                })
                if (!updated) {
                  opStatus = "conflict"
                  errorMsg = "Visit changed or is no longer owned by agent"
                } else {
                  serverId = updated.id
                  serverData = updated
                }
              }
            }
          }

        } else if (entity === "visitActions" && opType === "create" && visitActionInput) {
          const visitFence = await tx.mtmVisit.updateMany({
            where: {
              id: data.visitId,
              organizationId: orgId,
              agentId,
              status: "CHECKED_IN",
              deletedAt: null,
            },
            data: { status: "CHECKED_IN" },
          })
          const visit = visitFence.count === 1 ? await tx.mtmVisit.findFirst({
            where: {
              id: data.visitId,
              organizationId: orgId,
              agentId,
              status: "CHECKED_IN",
              deletedAt: null,
            },
            select: {
              id: true,
              customerId: true,
              requirementSnapshot: {
                select: { requirements: { where: { actionKey: visitActionInput.actionKey }, select: { id: true, mode: true, allowWaiver: true } } },
              },
            },
          }) : null
          const requirement = visit?.requirementSnapshot?.requirements[0]
          if (visitFence.count !== 1 || !visit) {
            opStatus = "conflict"
            errorMsg = "Active visit not found or not owned by agent"
          } else if (!requirement || requirement.mode === "HIDDEN") {
            opStatus = "conflict"
            errorMsg = "Action is hidden for this visit"
            serverData = { code: "MTM_VISIT_ACTION_HIDDEN", actionKey: visitActionInput.actionKey }
          } else if (visitActionInput.status === "WAIVED" && !requirement.allowWaiver) {
            opStatus = "conflict"
            errorMsg = "This action cannot be waived"
            serverData = { code: "MTM_VISIT_ACTION_WAIVER_FORBIDDEN", actionKey: visitActionInput.actionKey }
          } else {
            const actionResult = await tx.mtmVisitActionResult.create({
              data: {
                ...(visitActionInput.id ? { id: visitActionInput.id } : {}),
                organizationId: orgId,
                visitId: visit.id,
                requirementId: requirement.id,
                actionKey: visitActionInput.actionKey,
                status: visitActionInput.status,
                evidence: visitActionInput.evidence
                  ? visitActionInput.evidence as Prisma.InputJsonValue
                  : Prisma.JsonNull,
                completedByAgentId: agentId,
                completedAt: new Date(),
              },
              select: { id: true, visitId: true, actionKey: true, status: true, completedAt: true },
            })
            if (visitActionInput.actionKey === "NEXT_ACTION" && nextAction) {
              await tx.mtmVisit.updateMany({
                where: { id: visit.id, organizationId: orgId, agentId, status: "CHECKED_IN", deletedAt: null },
                data: { nextActionDueAt: nextAction.dueDate },
              })
              const sourceKey = `visit-next-action:${visit.id}`
              const existingTask = await tx.mtmTask.findFirst({
                where: { organizationId: orgId, sourceKey },
                select: { id: true, visitId: true, deletedAt: true },
              })
              if (existingTask) {
                if (existingTask.visitId !== visit.id || existingTask.deletedAt !== null) {
                  throw new Error("MTM_VISIT_NEXT_ACTION_TASK_CONFLICT")
                }
                const taskUpdate = await tx.mtmTask.updateMany({
                  where: {
                    id: existingTask.id,
                    organizationId: orgId,
                    visitId: visit.id,
                    sourceKey,
                    deletedAt: null,
                  },
                  data: {
                    agentId,
                    customerId: visit.customerId,
                    visitId: visit.id,
                    title: nextAction.title,
                    dueDate: nextAction.dueDate,
                    priority: nextAction.priority,
                    status: "PENDING",
                    completedAt: null,
                  },
                })
                if (taskUpdate.count !== 1) throw new Error("MTM_VISIT_NEXT_ACTION_TASK_CONFLICT")
              } else {
                await tx.mtmTask.create({
                  data: {
                    organizationId: orgId,
                    agentId,
                    customerId: visit.customerId,
                    visitId: visit.id,
                    sourceKey,
                    title: nextAction.title,
                    dueDate: nextAction.dueDate,
                    priority: nextAction.priority,
                    status: "PENDING",
                  },
                })
              }
            }
            serverId = actionResult.id
            serverData = actionResult
          }

        } else if (entity === "tasks" && opType === "create" && taskCreateInput) {
          const input = taskCreateInput
          const [customer, visit, copiedFrom] = await Promise.all([
            input.customerId
              ? tx.mtmCustomer.findFirst({
                  where: { id: input.customerId, organizationId: orgId, deletedAt: null },
                  select: { id: true },
                })
              : Promise.resolve(null),
            input.visitId
              ? tx.mtmVisit.findFirst({
                  where: { id: input.visitId, organizationId: orgId, agentId, deletedAt: null },
                  select: { id: true, customerId: true },
                })
              : Promise.resolve(null),
            input.copiedFromId
              ? tx.mtmTask.findFirst({
                  where: { id: input.copiedFromId, organizationId: orgId, agentId, deletedAt: null },
                  select: { id: true, taskGroupDictionaryId: true, taskGroupCode: true },
                })
              : Promise.resolve(null),
          ])

          if (input.customerId && !customer) {
            opStatus = "conflict"
            errorMsg = "Customer not found"
            serverData = { code: "MTM_TASK_CUSTOMER_NOT_FOUND" }
          } else if (input.visitId && !visit) {
            opStatus = "conflict"
            errorMsg = "Visit not found or not owned by agent"
            serverData = { code: "MTM_TASK_VISIT_NOT_FOUND" }
          } else if (visit && input.customerId && visit.customerId !== input.customerId) {
            opStatus = "conflict"
            errorMsg = "Task customer does not match the visit"
            serverData = { code: "MTM_TASK_VISIT_CUSTOMER_MISMATCH" }
          } else if (input.copiedFromId && !copiedFrom) {
            opStatus = "conflict"
            errorMsg = "Source task not found or not owned by agent"
            serverData = { code: "MTM_TASK_COPY_SOURCE_NOT_FOUND" }
          } else {
            const task = await tx.mtmTask.create({
              data: {
                id: input.id,
                organizationId: orgId,
                agentId,
                customerId: input.customerId ?? visit?.customerId ?? null,
                visitId: input.visitId ?? null,
                taskGroupDictionaryId: copiedFrom?.taskGroupDictionaryId ?? null,
                taskGroupCode: copiedFrom?.taskGroupCode ?? null,
                sourceKey: `mobile-self:${input.id}`,
                title: input.title,
                description: input.description ?? null,
                status: "PENDING",
                priority: input.priority,
                scheduledStartAt: input.scheduledStartAt ? new Date(input.scheduledStartAt) : null,
                dueDate: input.dueDate ? new Date(input.dueDate) : null,
                copiedFromId: input.copiedFromId ?? null,
                recurrenceRule: input.recurrence?.rule ?? null,
                recurrenceInterval: input.recurrence?.interval ?? null,
                recurrenceUntil: input.recurrence?.until ? new Date(input.recurrence.until) : null,
                recurrenceTimezone: input.recurrence ? input.recurrence.timezone ?? workdayTimezone : null,
                recurrenceAnchorScheduledStartAt: input.recurrence && input.scheduledStartAt
                  ? new Date(input.scheduledStartAt)
                  : null,
                recurrenceAnchorDueDate: input.recurrence && input.dueDate
                  ? new Date(input.dueDate)
                  : null,
                recurrenceCursorScheduledStartAt: input.recurrence && input.scheduledStartAt
                  ? new Date(input.scheduledStartAt)
                  : null,
                recurrenceCursorDueDate: input.recurrence && input.dueDate
                  ? new Date(input.dueDate)
                  : null,
              },
              select: {
                id: true,
                title: true,
                description: true,
                status: true,
                priority: true,
                scheduledStartAt: true,
                dueDate: true,
                version: true,
                customerId: true,
                visitId: true,
                copiedFromId: true,
                recurrenceRule: true,
                recurrenceInterval: true,
                recurrenceUntil: true,
                recurrenceTimezone: true,
                recurrenceAnchorScheduledStartAt: true,
                recurrenceAnchorDueDate: true,
                recurrenceCursorScheduledStartAt: true,
                recurrenceCursorDueDate: true,
                recurrenceParentId: true,
                sourceKey: true,
              },
            })
            await tx.mtmTaskEvent.create({
              data: {
                organizationId: orgId,
                taskId: task.id,
                agentId,
                clientEventId: operationId,
                type: input.copiedFromId ? "COPIED" : "CREATED",
                occurredAt,
                toStatus: "PENDING",
                evidence: {
                  kind: input.copiedFromId ? "MTM_TASK_DUPLICATE" : "MTM_TASK_CREATED",
                  actorAgentId: agentId,
                  source: "MOBILE_SYNC",
                } as Prisma.InputJsonValue,
              },
            })
            serverId = task.id
            serverData = task
          }

        } else if (entity === "tasks" && opType === "update" && taskUpdateInput) {
          const input = taskUpdateInput
          const task = await tx.mtmTask.findFirst({
            where: { id: input.id, organizationId: orgId, agentId, deletedAt: null },
          })
          if (!task) {
            opStatus = "conflict"
            errorMsg = "Task not found or not owned by agent"
            serverData = { code: "MTM_TASK_NOT_FOUND" }
          } else if (input.expectedVersion !== undefined && task.version !== input.expectedVersion) {
            opStatus = "conflict"
            errorMsg = "Task was changed on another device"
            serverData = { code: "MTM_TASK_VERSION_CONFLICT", task }
          } else if (
            task.recurrenceRule
            && !task.scheduledStartAt
            && !effectiveTaskDueDate(input.dueDate, task.dueDate)
          ) {
            opStatus = "conflict"
            errorMsg = "A recurring task requires a scheduled start or due date"
            serverData = { code: "MTM_TASK_RECURRENCE_DATE_REQUIRED", task }
          } else if (
            task.scheduledStartAt
            && effectiveTaskDueDate(input.dueDate, task.dueDate)
            && effectiveTaskDueDate(input.dueDate, task.dueDate)! < task.scheduledStartAt
          ) {
            opStatus = "conflict"
            errorMsg = "Task due date cannot precede scheduled start"
            serverData = { code: "MTM_TASK_TIME_RANGE_INVALID", task }
          } else if (
            task.recurrenceRule
            && task.recurrenceUntil
            && (
              task.recurrenceCursorDueDate
              || task.recurrenceCursorScheduledStartAt
              || task.dueDate
              || task.scheduledStartAt
            )
            && dateInputValueInTimezone(
              task.recurrenceCursorDueDate
                ?? task.recurrenceCursorScheduledStartAt
                ?? task.dueDate
                ?? task.scheduledStartAt!,
              task.recurrenceTimezone ?? workdayTimezone,
            ) > dateInputValueInTimezone(task.recurrenceUntil, task.recurrenceTimezone ?? workdayTimezone)
          ) {
            opStatus = "conflict"
            errorMsg = "Task schedule cannot follow recurrence end"
            serverData = { code: "MTM_TASK_RECURRENCE_RANGE_INVALID", task }
          } else if (task.status === "COMPLETED" || task.status === "CANCELLED") {
            opStatus = "conflict"
            errorMsg = "Completed or cancelled task core is immutable"
            serverData = { code: "MTM_TASK_IMMUTABLE", task }
          } else if (
            input.status &&
            !canApplyMobileTaskTransition(task.status as MobileTaskStatus, input.status)
          ) {
            opStatus = "conflict"
            errorMsg = "Task cannot move from its current status"
            serverData = { code: "MTM_TASK_STATUS_CONFLICT", task }
          } else if (
            (
              input.title !== undefined
              || input.description !== undefined
              || input.priority !== undefined
              || input.dueDate !== undefined
            ) &&
            !task.sourceKey?.startsWith("mobile-self:")
          ) {
            opStatus = "conflict"
            errorMsg = "Only self-created task content can be edited by the agent"
            serverData = { code: "MTM_TASK_CONTENT_READ_ONLY", task }
          } else {
            // Task lifecycle facts are server-received facts. A bounded device
            // timestamp remains explanatory evidence only and never controls
            // completion cycles, recurrence, or database-valid core dates.
            const taskOccurredAt = new Date()
            const targetStatus = input.status ?? task.status
            const firstCompletion = targetStatus === "COMPLETED" && task.status !== "COMPLETED"
            const eventType = taskEventTypeForUpdate(input, {
              status: task.status as MobileTaskStatus,
              dueDate: task.dueDate,
              acceptedAt: task.acceptedAt,
            })
            const expectedVersion = input.expectedVersion ?? task.version
            if (firstCompletion && task.recurrenceRule) {
              await lockMtmTaskRecurrenceSeriesInTransaction(tx, {
                organizationId: orgId,
                rootTaskId: task.recurrenceParentId ?? task.id,
              })
            }
            const updated = await tx.mtmTask.updateMany({
              where: {
                id: input.id,
                organizationId: orgId,
                agentId,
                status: task.status,
                version: expectedVersion,
                deletedAt: null,
              },
              data: {
                ...(input.status ? { status: input.status } : {}),
                ...(input.title !== undefined ? { title: input.title } : {}),
                ...(input.description !== undefined ? { description: input.description } : {}),
                ...(input.priority !== undefined ? { priority: input.priority } : {}),
                ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
                ...(input.dueDate !== undefined
                  && task.recurrenceRule
                  && task.recurrenceCursorScheduledStartAt == null
                  && task.recurrenceCursorDueDate == null
                  ? {
                      recurrenceCursorScheduledStartAt: task.scheduledStartAt,
                      recurrenceCursorDueDate: task.dueDate,
                    }
                  : {}),
                ...(input.result !== undefined ? { result: input.result } : {}),
                ...(input.progress !== undefined ? { progress: input.progress } : {}),
                ...(input.acceptedAt !== undefined && !task.acceptedAt
                  ? { acceptedAt: taskOccurredAt }
                  : {}),
                ...(input.status === "IN_PROGRESS" && !task.startedAt ? { startedAt: taskOccurredAt } : {}),
                ...(firstCompletion ? { completedAt: taskOccurredAt, progress: 100 } : {}),
                ...(input.status === "PENDING" ? { completedAt: null } : {}),
                version: { increment: 1 },
              },
            })
            if (updated.count !== 1) {
              opStatus = "conflict"
              errorMsg = "Task was changed on another device"
              const current = await tx.mtmTask.findFirst({
                where: { id: input.id, organizationId: orgId, agentId, deletedAt: null },
              })
              serverData = { code: "MTM_TASK_VERSION_CONFLICT", task: current }
            } else {
              await tx.mtmTaskEvent.create({
                data: {
                  organizationId: orgId,
                  taskId: task.id,
                  agentId,
                  clientEventId: operationId,
                  type: eventType,
                  occurredAt: taskOccurredAt,
                  fromStatus: task.status,
                  toStatus: targetStatus,
                  oldDueDate: task.dueDate,
                  newDueDate: input.dueDate === undefined
                    ? task.dueDate
                    : input.dueDate ? new Date(input.dueDate) : null,
                  evidence: {
                    kind: "MTM_TASK_EXECUTION",
                    actorAgentId: agentId,
                    progress: input.progress,
                    expectedVersion,
                    source: "MOBILE_SYNC",
                    clientOccurredAt: taskClientOccurredAt?.toISOString() ?? null,
                    clientOccurredAtAccepted: taskClientOccurredAt !== null,
                  } as Prisma.InputJsonValue,
                },
              })

              if (firstCompletion) {
                await spawnNextMtmTaskRecurrenceInTransaction(tx, {
                  organizationId: orgId,
                  sourceTask: {
                    id: task.id,
                    agentId: task.agentId,
                    customerId: task.customerId,
                    taskGroupDictionaryId: task.taskGroupDictionaryId,
                    taskGroupCode: task.taskGroupCode,
                    title: input.title ?? task.title,
                    description: input.description === undefined ? task.description : input.description,
                    priority: input.priority ?? task.priority,
                    scheduledStartAt: task.scheduledStartAt,
                    dueDate: effectiveTaskDueDate(input.dueDate, task.dueDate),
                    recurrenceRule: task.recurrenceRule,
                    recurrenceInterval: task.recurrenceInterval,
                    recurrenceUntil: task.recurrenceUntil,
                    recurrenceTimezone: task.recurrenceTimezone,
                    recurrenceAnchorScheduledStartAt: task.recurrenceAnchorScheduledStartAt,
                    recurrenceAnchorDueDate: task.recurrenceAnchorDueDate,
                    recurrenceCursorScheduledStartAt: task.recurrenceCursorScheduledStartAt ?? task.scheduledStartAt,
                    recurrenceCursorDueDate: task.recurrenceCursorDueDate ?? task.dueDate,
                    recurrenceParentId: task.recurrenceParentId,
                  },
                  tenantTimezone: workdayTimezone,
                  occurredAt: taskOccurredAt,
                })
              }

              const current = await tx.mtmTask.findFirst({
                where: { id: input.id, organizationId: orgId, agentId, deletedAt: null },
                select: {
                  id: true,
                  title: true,
                  description: true,
                  status: true,
                  priority: true,
                  scheduledStartAt: true,
                  dueDate: true,
                  result: true,
                  progress: true,
                  returnReason: true,
                  version: true,
                  acceptedAt: true,
                  startedAt: true,
                  completedAt: true,
                  customerId: true,
                  visitId: true,
                  sourceKey: true,
                  copiedFromId: true,
                  recurrenceRule: true,
                  recurrenceInterval: true,
                  recurrenceUntil: true,
                  recurrenceTimezone: true,
                  recurrenceAnchorScheduledStartAt: true,
                  recurrenceAnchorDueDate: true,
                  recurrenceCursorScheduledStartAt: true,
                  recurrenceCursorDueDate: true,
                  recurrenceParentId: true,
                },
              })
              if (!current) {
                opStatus = "conflict"
                errorMsg = "Task changed or is no longer owned by agent"
                serverData = { code: "MTM_TASK_NOT_FOUND" }
              } else {
                serverId = current.id
                serverData = current
              }
            }
          }

        } else if (entity === "taskEvents" && opType === "create" && taskEventInput) {
          const task = await tx.mtmTask.findFirst({
            where: { id: taskEventInput.taskId, organizationId: orgId, agentId, deletedAt: null },
            select: { id: true, status: true, version: true },
          })
          if (!task) {
            opStatus = "conflict"
            errorMsg = "Task not found or not owned by agent"
            serverData = { code: "MTM_TASK_NOT_FOUND" }
          } else {
            const pinned = await tx.mtmTask.updateMany({
              where: {
                id: task.id,
                organizationId: orgId,
                agentId,
                status: task.status,
                version: task.version,
                deletedAt: null,
              },
              data: { version: { increment: 0 } },
            })
            if (pinned.count !== 1) {
              opStatus = "conflict"
              errorMsg = "Task changed or is no longer owned by agent"
              serverData = { code: "MTM_TASK_SCOPE_CHANGED" }
            } else {
              const event = await tx.mtmTaskEvent.create({
                data: {
                  organizationId: orgId,
                  taskId: task.id,
                  agentId,
                  clientEventId: operationId,
                  type: taskEventInput.type,
                  occurredAt: new Date(taskEventInput.occurredAt),
                  comment: taskEventInput.comment ?? null,
                  evidence: {
                    kind: "MTM_TASK_CLIENT_EVENT",
                    clientKind: taskEventInput.type,
                    source: "MOBILE_SYNC",
                    actorAgentId: agentId,
                    clientEvidence: taskEventInput.evidence ?? null,
                  } as Prisma.InputJsonValue,
                },
                select: {
                  id: true,
                  taskId: true,
                  type: true,
                  occurredAt: true,
                  comment: true,
                  evidence: true,
                },
              })
              serverId = event.id
              serverData = event
            }
          }

        } else if (entity === "commitments" && opType === "create" && commitmentCreateInput) {
          const existing = await tx.mtmCommitment.findFirst({
            where: {
              organizationId: orgId,
              agentId,
              clientCommitmentId: commitmentCreateInput.clientCommitmentId,
            },
            select: {
              id: true,
              clientCommitmentId: true,
              visitId: true,
              customerId: true,
              contactId: true,
              productExternalId: true,
              productName: true,
              brandExternalId: true,
              brandName: true,
              promisedQuantity: true,
              unit: true,
              dueAt: true,
              note: true,
              evidencePhotoId: true,
              submittedAt: true,
            },
          })
          if (existing) {
            serverId = existing.id
            serverData = { ...existing, promisedQuantity: Number(existing.promisedQuantity), idempotent: true }
          } else {
            const visit = await tx.mtmVisit.findFirst({
              where: {
                id: commitmentCreateInput.visitId,
                organizationId: orgId,
                deletedAt: null,
                status: { not: "CANCELLED" },
                OR: [
                  { agentId },
                  { participants: { some: { agentId, leftAt: null, role: { not: "OBSERVER" } } } },
                ],
              },
              select: { id: true, customerId: true, contactId: true },
            })
            if (!visit) {
              opStatus = "conflict"
              errorMsg = "Visit not found or not available to this agent"
              serverData = { code: "MTM_COMMITMENT_VISIT_NOT_FOUND" }
            } else {
              const evidencePhoto = commitmentCreateInput.evidenceClientPhotoId
                ? await tx.mtmPhoto.findFirst({
                    where: {
                      organizationId: orgId,
                      agentId,
                      visitId: visit.id,
                      clientPhotoId: commitmentCreateInput.evidenceClientPhotoId,
                      category: "commitment-promise",
                    },
                    select: { id: true },
                  })
                : null
              if (commitmentCreateInput.evidenceClientPhotoId && !evidencePhoto) {
                opStatus = "conflict"
                errorMsg = "Commitment evidence photo is not available"
                serverData = { code: "MTM_COMMITMENT_EVIDENCE_NOT_FOUND" }
              } else {
                const commitment = await tx.mtmCommitment.create({
                  data: {
                    organizationId: orgId,
                    agentId,
                    visitId: visit.id,
                    customerId: visit.customerId,
                    contactId: visit.contactId,
                    clientCommitmentId: commitmentCreateInput.clientCommitmentId,
                    productExternalId: commitmentCreateInput.productExternalId,
                    productName: commitmentCreateInput.productName,
                    brandExternalId: commitmentCreateInput.brandExternalId,
                    brandName: commitmentCreateInput.brandName,
                    promisedQuantity: new Prisma.Decimal(commitmentCreateInput.promisedQuantity),
                    unit: commitmentCreateInput.unit,
                    dueAt: commitmentCreateInput.dueAt,
                    note: commitmentCreateInput.note,
                    evidencePhotoId: evidencePhoto?.id ?? null,
                    submittedAt: occurredAt,
                  },
                  select: {
                    id: true,
                    clientCommitmentId: true,
                    visitId: true,
                    customerId: true,
                    contactId: true,
                    productExternalId: true,
                    productName: true,
                    brandExternalId: true,
                    brandName: true,
                    promisedQuantity: true,
                    unit: true,
                    dueAt: true,
                    note: true,
                    evidencePhotoId: true,
                    submittedAt: true,
                  },
                })
                serverId = commitment.id
                serverData = { ...commitment, promisedQuantity: Number(commitment.promisedQuantity) }
              }
            }
          }

        } else if (
          entity === "commitmentFulfillments"
          && opType === "create"
          && commitmentFulfillInput
        ) {
          const commitment = await tx.mtmCommitment.findFirst({
            where: {
              id: commitmentFulfillInput.commitmentId,
              organizationId: orgId,
              agentId,
            },
            select: {
              id: true,
              customerId: true,
              promisedQuantity: true,
              fulfillment: {
                select: {
                  id: true,
                  clientFulfillmentId: true,
                  outcome: true,
                  actualQuantity: true,
                  varianceQuantity: true,
                  fulfilledAt: true,
                },
              },
            },
          })
          if (!commitment) {
            opStatus = "conflict"
            errorMsg = "Commitment not found or not owned by agent"
            serverData = { code: "MTM_COMMITMENT_NOT_FOUND" }
          } else if (commitment.fulfillment) {
            if (commitment.fulfillment.clientFulfillmentId === commitmentFulfillInput.clientFulfillmentId) {
              serverId = commitment.fulfillment.id
              serverData = {
                ...commitment.fulfillment,
                actualQuantity: Number(commitment.fulfillment.actualQuantity),
                varianceQuantity: Number(commitment.fulfillment.varianceQuantity),
                idempotent: true,
              }
            } else {
              opStatus = "conflict"
              errorMsg = "Commitment already has a submitted fact"
              serverData = {
                code: "MTM_COMMITMENT_ALREADY_FULFILLED",
                fulfillment: {
                  ...commitment.fulfillment,
                  actualQuantity: Number(commitment.fulfillment.actualQuantity),
                  varianceQuantity: Number(commitment.fulfillment.varianceQuantity),
                },
              }
            }
          } else {
            const promisedQuantity = Number(commitment.promisedQuantity)
            const outcomeError = commitmentOutcomeError({
              promisedQuantity,
              actualQuantity: commitmentFulfillInput.actualQuantity,
              outcome: commitmentFulfillInput.outcome,
            })
            const evidencePhoto = commitmentFulfillInput.evidenceClientPhotoId
              ? await tx.mtmPhoto.findFirst({
                  where: {
                    organizationId: orgId,
                    agentId,
                    clientPhotoId: commitmentFulfillInput.evidenceClientPhotoId,
                    category: "commitment-fulfillment",
                    visit: { customerId: commitment.customerId },
                  },
                  select: { id: true },
                })
              : null
            if (outcomeError) {
              opStatus = "conflict"
              errorMsg = outcomeError
              serverData = { code: "MTM_COMMITMENT_OUTCOME_MISMATCH" }
            } else if (commitmentFulfillInput.evidenceClientPhotoId && !evidencePhoto) {
              opStatus = "conflict"
              errorMsg = "Commitment fulfillment evidence photo is not available"
              serverData = { code: "MTM_COMMITMENT_EVIDENCE_NOT_FOUND" }
            } else {
              const actual = new Prisma.Decimal(commitmentFulfillInput.actualQuantity)
              const fulfillment = await tx.mtmCommitmentFulfillment.create({
                data: {
                  organizationId: orgId,
                  commitmentId: commitment.id,
                  agentId,
                  clientFulfillmentId: commitmentFulfillInput.clientFulfillmentId,
                  outcome: commitmentFulfillInput.outcome,
                  actualQuantity: actual,
                  varianceQuantity: actual.minus(commitment.promisedQuantity),
                  note: commitmentFulfillInput.note,
                  evidencePhotoId: evidencePhoto?.id ?? null,
                  fulfilledAt: occurredAt,
                },
                select: {
                  id: true,
                  commitmentId: true,
                  clientFulfillmentId: true,
                  outcome: true,
                  actualQuantity: true,
                  varianceQuantity: true,
                  note: true,
                  evidencePhotoId: true,
                  fulfilledAt: true,
                },
              })
              serverId = fulfillment.id
              serverData = {
                ...fulfillment,
                actualQuantity: Number(fulfillment.actualQuantity),
                varianceQuantity: Number(fulfillment.varianceQuantity),
              }
            }
          }

        } else if (entity === "messages" && opType === "create" && messageCreateInput) {
          const existingMessage = await tx.mtmMessage.findFirst({
            where: {
              organizationId: orgId,
              senderAgentId: agentId,
              clientMessageId: messageCreateInput.clientMessageId,
            },
            select: {
              id: true,
              threadId: true,
              clientMessageId: true,
              body: true,
              attachmentDocumentId: true,
              sentAt: true,
            },
          })
          if (existingMessage) {
            serverId = existingMessage.id
            serverData = { ...existingMessage, idempotent: true }
          } else {
            let thread: { id: string; type: string; lastMessageAt: Date } | null = null

            if (messageCreateInput.threadId) {
              const membership = await tx.mtmMessageParticipant.findFirst({
                where: {
                  organizationId: orgId,
                  agentId,
                  threadId: messageCreateInput.threadId,
                  archivedAt: null,
                },
                select: {
                  thread: { select: { id: true, type: true, lastMessageAt: true } },
                },
              })
              if (!membership) {
                opStatus = "conflict"
                errorMsg = "Conversation not found or unavailable"
                serverData = { code: "MTM_MESSAGE_THREAD_NOT_FOUND" }
              } else if (membership.thread.type !== "DIRECT") {
                opStatus = "conflict"
                errorMsg = "This conversation is read-only"
                serverData = { code: "MTM_MESSAGE_THREAD_READ_ONLY" }
              } else {
                thread = membership.thread
              }
            } else if (messageCreateInput.recipientAgentId === agentId) {
              opStatus = "conflict"
              errorMsg = "Cannot start a conversation with yourself"
              serverData = { code: "MTM_MESSAGE_RECIPIENT_INVALID" }
            } else if (messageCreateInput.recipientAgentId) {
              const [sender, recipient] = await Promise.all([
                tx.mtmAgent.findFirst({
                  where: { id: agentId, organizationId: orgId, status: "ACTIVE" },
                  select: { id: true, managerId: true, teamId: true },
                }),
                tx.mtmAgent.findFirst({
                  where: { id: messageCreateInput.recipientAgentId, organizationId: orgId, status: "ACTIVE" },
                  select: { id: true, managerId: true, teamId: true },
                }),
              ])
              const allowed = Boolean(
                sender
                && recipient
                && (
                  sender.managerId === recipient.id
                  || recipient.managerId === sender.id
                  || Boolean(sender.teamId && sender.teamId === recipient.teamId)
                ),
              )
              if (!sender || !recipient || !allowed) {
                opStatus = "conflict"
                errorMsg = "Recipient is not available to this agent"
                serverData = { code: "MTM_MESSAGE_RECIPIENT_FORBIDDEN" }
              } else {
                const directKey = directMessageThreadKey(agentId, recipient.id)
                thread = await tx.mtmMessageThread.upsert({
                  where: { organizationId_directKey: { organizationId: orgId, directKey } },
                  update: {},
                  create: {
                    organizationId: orgId,
                    type: "DIRECT",
                    directKey,
                    createdByAgentId: agentId,
                    lastMessageAt: messageCreateInput.sentAt,
                    participants: {
                      create: [
                        { organizationId: orgId, agentId, role: "OWNER" },
                        { organizationId: orgId, agentId: recipient.id, role: "MEMBER" },
                      ],
                    },
                  },
                  select: { id: true, type: true, lastMessageAt: true },
                })
                await tx.mtmMessageParticipant.createMany({
                  data: [
                    { organizationId: orgId, threadId: thread.id, agentId, role: "OWNER" },
                    { organizationId: orgId, threadId: thread.id, agentId: recipient.id, role: "MEMBER" },
                  ],
                  skipDuplicates: true,
                })
              }
            }

            if (thread) {
              const attachment = messageCreateInput.attachmentClientDocumentId
                ? await tx.mtmDocument.findFirst({
                    where: {
                      organizationId: orgId,
                      clientDocumentId: messageCreateInput.attachmentClientDocumentId,
                      uploadedByAgentId: agentId,
                      deletedAt: null,
                    },
                    select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
                  })
                : null
              if (messageCreateInput.attachmentClientDocumentId && !attachment) {
                opStatus = "conflict"
                errorMsg = "Message attachment is not available"
                serverData = { code: "MTM_MESSAGE_ATTACHMENT_NOT_FOUND" }
              } else {
                const message = await tx.mtmMessage.create({
                  data: {
                    organizationId: orgId,
                    threadId: thread.id,
                    senderAgentId: agentId,
                    senderName: auth.name,
                    clientMessageId: messageCreateInput.clientMessageId,
                    body: messageCreateInput.body,
                    attachmentDocumentId: attachment?.id ?? null,
                    sentAt: messageCreateInput.sentAt,
                  },
                  select: {
                    id: true,
                    threadId: true,
                    senderAgentId: true,
                    senderName: true,
                    clientMessageId: true,
                    body: true,
                    sentAt: true,
                    attachmentDocument: {
                      select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
                    },
                  },
                })
                if (messageCreateInput.sentAt > thread.lastMessageAt) {
                  await tx.mtmMessageThread.update({
                    where: { id: thread.id },
                    data: { lastMessageAt: messageCreateInput.sentAt },
                  })
                }
                serverId = message.id
                serverData = message
              }
            }
          }

        } else if (
          entity === "messageReceipts"
          && opType === "create"
          && messageReceiptInput
        ) {
          const existingReceipt = await tx.mtmMessageReceipt.findFirst({
            where: {
              organizationId: orgId,
              agentId,
              clientReceiptId: messageReceiptInput.clientReceiptId,
            },
            select: { id: true, messageId: true, type: true, occurredAt: true },
          })
          if (existingReceipt) {
            if (existingReceipt.messageId === messageReceiptInput.messageId && existingReceipt.type === messageReceiptInput.type) {
              serverId = existingReceipt.id
              serverData = { ...existingReceipt, idempotent: true }
            } else {
              opStatus = "conflict"
              errorMsg = "Receipt id was already used for another message"
              serverData = { code: "MTM_MESSAGE_RECEIPT_ID_CONFLICT" }
            }
          } else {
            const message = await tx.mtmMessage.findFirst({
              where: {
                id: messageReceiptInput.messageId,
                organizationId: orgId,
                thread: { participants: { some: { agentId, archivedAt: null } } },
              },
              select: {
                id: true,
                threadId: true,
                senderAgentId: true,
                acknowledgementRequired: true,
              },
            })
            if (!message) {
              opStatus = "conflict"
              errorMsg = "Message not found or unavailable"
              serverData = { code: "MTM_MESSAGE_NOT_FOUND" }
            } else if (message.senderAgentId === agentId) {
              opStatus = "conflict"
              errorMsg = "A sender cannot acknowledge their own message"
              serverData = { code: "MTM_MESSAGE_OWN_RECEIPT" }
            } else if (messageReceiptInput.type === "ACKNOWLEDGED" && !message.acknowledgementRequired) {
              opStatus = "conflict"
              errorMsg = "This message does not require acknowledgement"
              serverData = { code: "MTM_MESSAGE_ACK_NOT_REQUIRED" }
            } else {
              const receipt = await tx.mtmMessageReceipt.upsert({
                where: {
                  messageId_agentId_type: {
                    messageId: message.id,
                    agentId,
                    type: messageReceiptInput.type,
                  },
                },
                update: {
                  clientReceiptId: messageReceiptInput.clientReceiptId,
                  occurredAt: messageReceiptInput.occurredAt,
                },
                create: {
                  organizationId: orgId,
                  messageId: message.id,
                  agentId,
                  type: messageReceiptInput.type,
                  clientReceiptId: messageReceiptInput.clientReceiptId,
                  occurredAt: messageReceiptInput.occurredAt,
                },
                select: { id: true, messageId: true, type: true, occurredAt: true },
              })
              if (messageReceiptInput.type === "ACKNOWLEDGED") {
                await tx.mtmMessageReceipt.upsert({
                  where: { messageId_agentId_type: { messageId: message.id, agentId, type: "READ" } },
                  update: { occurredAt: messageReceiptInput.occurredAt },
                  create: {
                    organizationId: orgId,
                    messageId: message.id,
                    agentId,
                    type: "READ",
                    occurredAt: messageReceiptInput.occurredAt,
                  },
                })
              }
              await tx.mtmMessageParticipant.updateMany({
                where: {
                  organizationId: orgId,
                  threadId: message.threadId,
                  agentId,
                  OR: [
                    { lastReadAt: null },
                    { lastReadAt: { lt: messageReceiptInput.occurredAt } },
                  ],
                },
                data: { lastReadAt: messageReceiptInput.occurredAt },
              })
              serverId = receipt.id
              serverData = receipt
            }
          }

        } else if (
          entity === "documentStates"
          && opType === "update"
          && documentStateInput
        ) {
          const assignment = await tx.mtmDocumentAssignment.findFirst({
            where: {
              organizationId: orgId,
              documentId: documentStateInput.documentId,
              agentId,
              document: { deletedAt: null },
            },
            select: { id: true, readAt: true, downloadedAt: true },
          })
          if (!assignment) {
            opStatus = "conflict"
            errorMsg = "Assigned document not found"
            serverData = { code: "MTM_DOCUMENT_ASSIGNMENT_NOT_FOUND" }
          } else {
            const updated = await tx.mtmDocumentAssignment.update({
              where: { id: assignment.id },
              data: documentStateInput.state === "READ"
                ? { readAt: documentStateInput.occurredAt }
                : { downloadedAt: documentStateInput.occurredAt },
              select: { id: true, documentId: true, readAt: true, downloadedAt: true },
            })
            serverId = updated.id
            serverData = updated
          }

        } else if (
          entity === "hrmRequests"
          && opType === "create"
          && hrmRequestCreateInput
        ) {
          const existing = await tx.mtmHrmRequest.findFirst({
            where: {
              organizationId: orgId,
              agentId,
              clientRequestId: hrmRequestCreateInput.clientRequestId,
            },
            select: {
              id: true,
              clientRequestId: true,
              type: true,
              status: true,
              startDate: true,
              endDate: true,
              submittedAt: true,
            },
          })
          if (existing) {
            serverId = existing.id
            serverData = { ...existing, idempotent: true }
          } else {
            const correctionWorkday = hrmRequestCreateInput.type === "TIME_CORRECTION"
              ? await tx.mtmAgentWorkday.findFirst({
                  where: {
                    id: hrmRequestCreateInput.correctionWorkdayId ?? undefined,
                    organizationId: orgId,
                    agentId,
                    workDate: hrmRequestCreateInput.startDate,
                  },
                  select: { id: true },
                })
              : null
            const overlap = await tx.mtmHrmRequest.findFirst({
              where: {
                organizationId: orgId,
                agentId,
                status: { in: ["PENDING", "APPROVED"] },
                startDate: { lte: hrmRequestCreateInput.endDate },
                endDate: { gte: hrmRequestCreateInput.startDate },
                ...(hrmRequestCreateInput.type === "TIME_CORRECTION"
                  ? { type: "TIME_CORRECTION", correctionWorkdayId: hrmRequestCreateInput.correctionWorkdayId }
                  : { type: { in: ["LEAVE", "ABSENCE"] } }),
              },
              select: { id: true, type: true, status: true, startDate: true, endDate: true },
            })
            if (hrmRequestCreateInput.type === "TIME_CORRECTION" && !correctionWorkday) {
              opStatus = "conflict"
              errorMsg = "Workday not found for time correction"
              serverData = { code: "MTM_HRM_WORKDAY_NOT_FOUND" }
            } else if (overlap) {
              opStatus = "conflict"
              errorMsg = "An active HRM request already covers these dates"
              serverData = { code: "MTM_HRM_REQUEST_OVERLAP", request: overlap }
            } else {
              const request = await tx.mtmHrmRequest.create({
                data: {
                  id: hrmRequestCreateInput.id,
                  organizationId: orgId,
                  agentId,
                  clientRequestId: hrmRequestCreateInput.clientRequestId,
                  type: hrmRequestCreateInput.type,
                  status: "PENDING",
                  startDate: hrmRequestCreateInput.startDate,
                  endDate: hrmRequestCreateInput.endDate,
                  correctionWorkdayId: hrmRequestCreateInput.correctionWorkdayId,
                  requestedStartAt: hrmRequestCreateInput.requestedStartAt,
                  requestedEndAt: hrmRequestCreateInput.requestedEndAt,
                  reason: hrmRequestCreateInput.reason,
                  submittedAt: hrmRequestCreateInput.submittedAt,
                },
                select: {
                  id: true,
                  clientRequestId: true,
                  type: true,
                  status: true,
                  startDate: true,
                  endDate: true,
                  correctionWorkdayId: true,
                  requestedStartAt: true,
                  requestedEndAt: true,
                  reason: true,
                  submittedAt: true,
                },
              })
              serverId = request.id
              serverData = request
            }
          }

        } else if (
          entity === "hrmRequests"
          && opType === "update"
          && hrmRequestCancelInput
        ) {
          const request = await tx.mtmHrmRequest.findFirst({
            where: { id: hrmRequestCancelInput.id, organizationId: orgId, agentId },
            select: { id: true, status: true, cancelledAt: true },
          })
          if (!request) {
            opStatus = "conflict"
            errorMsg = "HRM request not found"
            serverData = { code: "MTM_HRM_REQUEST_NOT_FOUND" }
          } else if (request.status === "CANCELLED") {
            serverId = request.id
            serverData = { ...request, idempotent: true }
          } else if (request.status !== "PENDING") {
            opStatus = "conflict"
            errorMsg = "A decided HRM request cannot be cancelled"
            serverData = { code: "MTM_HRM_REQUEST_ALREADY_DECIDED", status: request.status }
          } else {
            const cancelled = await tx.mtmHrmRequest.update({
              where: { id: request.id },
              data: { status: "CANCELLED", cancelledAt: hrmRequestCancelInput.cancelledAt },
              select: { id: true, status: true, cancelledAt: true, updatedAt: true },
            })
            serverId = cancelled.id
            serverData = cancelled
          }

        } else if (entity === "brandPotentials" && opType === "create" && brandPotentialCreateInput) {
          const contactId = String(data.contactId)
          const actor = { agentId, role: "AGENT" as const, scopedAgentIds: [agentId] }
          const contact = await tx.mtmContact.findFirst({
            where: {
              id: contactId,
              organizationId: orgId,
              type: "DOCTOR",
              deletedAt: null,
              AND: [contactScopeForActor(actor, brandPotentialAsOf)],
            },
            select: { id: true },
          })
          if (!contact) {
            opStatus = "conflict"
            errorMsg = "Doctor is outside your scope"
            serverData = { code: "MTM_BRAND_POTENTIAL_CONTACT_SCOPE" }
          } else {
            const input = brandPotentialCreateInput
            const requestHash = brandPotentialRequestHash(contactId, input)
            const existing = await tx.mtmFieldPotential.findFirst({
              where: { organizationId: orgId, clientPotentialId: input.clientPotentialId },
              select: { id: true, contactId: true, requestHash: true, status: true, updatedAt: true },
            })
            if (existing) {
              if (existing.contactId !== contactId || existing.requestHash !== requestHash) {
                opStatus = "conflict"
                errorMsg = "Potential retry payload differs"
                serverData = { code: "MTM_BRAND_POTENTIAL_IDEMPOTENCY_CONFLICT", potential: existing }
              } else {
                serverId = existing.id
                serverData = { potential: existing, idempotent: true }
              }
            } else if (brandPotentialPerAgent && input.agentId && input.agentId !== agentId) {
              opStatus = "conflict"
              errorMsg = "Agent is outside your scope"
              serverData = { code: "MTM_BRAND_POTENTIAL_AGENT_SCOPE" }
            } else {
              const candidateAgentId = brandPotentialPerAgent ? agentId : null
              let validRevision = true
              if (input.supersedesPotentialId) {
                const previous = await tx.mtmFieldPotential.findFirst({
                  where: {
                    id: input.supersedesPotentialId,
                    organizationId: orgId,
                    contactId,
                    deletedAt: null,
                    ...(brandPotentialPerAgent ? { agentId } : {}),
                  },
                  select: { id: true },
                })
                validRevision = Boolean(previous)
              }
              const evidence = input.evidenceVisitIds.length === 0
                ? []
                : await tx.mtmVisit.findMany({
                    where: {
                      id: { in: input.evidenceVisitIds },
                      organizationId: orgId,
                      agentId,
                      contactId,
                      deletedAt: null,
                      status: "CHECKED_OUT",
                    },
                    select: { id: true },
                  })
              if (!validRevision) {
                opStatus = "conflict"
                errorMsg = "Previous potential not found"
                serverData = { code: "MTM_BRAND_POTENTIAL_REVISION_INVALID" }
              } else if (evidence.length !== input.evidenceVisitIds.length) {
                opStatus = "conflict"
                errorMsg = "One or more evidence visits are invalid"
                serverData = { code: "MTM_BRAND_POTENTIAL_EVIDENCE_INVALID" }
              } else {
                const glossaryFormula = await tx.mtmDoctorScoringFormula.findFirst({
                  where: { organizationId: orgId, status: "ACTIVE", signedAt: { not: null } },
                  orderBy: { signedAt: "desc" },
                  select: {
                    id: true,
                    version: true,
                    definitionHash: true,
                    glossarySchemaVersion: true,
                    approvalReference: true,
                    sourceSystem: true,
                    sourceReference: true,
                    sourceObservedAt: true,
                  },
                })
                if (!glossaryFormula || !professionalGlossaryIsGoverned(glossaryFormula)) {
                  opStatus = "conflict"
                  errorMsg = "A signed active professional glossary is required"
                  serverData = { code: "MTM_PROFESSIONAL_GLOSSARY_NOT_ACTIVE" }
                } else {
                  const potential = await tx.mtmFieldPotential.create({
                    data: {
                      organizationId: orgId,
                      contactId,
                      customerId: null,
                      agentId: candidateAgentId,
                      enteredByAgentId: agentId,
                      clientPotentialId: input.clientPotentialId,
                      requestHash,
                      brandExternalId: input.brandExternalId,
                      brandName: input.brandName,
                      productExternalId: input.productExternalId ?? null,
                      productName: input.productName ?? null,
                      category: input.category ?? null,
                      categoryLabel: input.categoryLabel ?? null,
                      potentialValue: new Prisma.Decimal(input.potentialValue),
                      coverageValue: new Prisma.Decimal(input.coverageValue),
                      periodStart: utcBrandPotentialDate(input.periodStart),
                      periodEnd: input.periodEnd ? utcBrandPotentialDate(input.periodEnd) : null,
                      source: input.source,
                      formulaVersion: glossaryFormula.version,
                      provenance: {
                        ...input.provenance,
                        ...professionalGlossaryProvenance(glossaryFormula),
                      } as Prisma.InputJsonValue,
                      status: "PENDING",
                      supersedesPotentialId: input.supersedesPotentialId ?? null,
                      evidenceVisits: {
                        create: input.evidenceVisitIds.map((visitId) => ({ organizationId: orgId, visitId })),
                      },
                    },
                    select: { id: true, status: true, contactId: true, agentId: true, updatedAt: true },
                  })
                  await tx.mtmAuditLog.create({
                    data: {
                      organizationId: orgId,
                      agentId,
                      action: "BRAND_POTENTIAL_CREATE",
                      entity: "field_potential",
                      entityId: potential.id,
                      metadataKind: "brand_potential",
                      newData: potential,
                    },
                  })
                  serverId = potential.id
                  serverData = { potential }
                }
              }
            }
          }

        } else if (entity === "brandPotentials" && opType === "update" && brandPotentialEndInput) {
          const actor = { agentId, role: "AGENT" as const, scopedAgentIds: [agentId] }
          const before = await tx.mtmFieldPotential.findFirst({
            where: {
              id: String(data.id),
              organizationId: orgId,
              enteredByAgentId: agentId,
              deletedAt: null,
              contact: { deletedAt: null, AND: [contactScopeForActor(actor, brandPotentialAsOf)] },
            },
          })
          if (!before) {
            opStatus = "conflict"
            errorMsg = "Potential is not available to this agent"
            serverData = { code: "MTM_BRAND_POTENTIAL_END_FORBIDDEN" }
          } else if (before.status === "ENDED") {
            serverId = before.id
            serverData = { potential: before, idempotent: true }
          } else {
            const periodEnd = utcBrandPotentialDate(brandPotentialEndInput.periodEnd)
            if (before.periodStart && periodEnd < before.periodStart) {
              opStatus = "conflict"
              errorMsg = "periodEnd must not precede periodStart"
              serverData = { code: "MTM_BRAND_POTENTIAL_END_DATE" }
            } else {
              const closedAt = new Date()
              const changed = await tx.mtmFieldPotential.updateMany({
                where: { id: before.id, organizationId: orgId, status: { not: "ENDED" }, deletedAt: null },
                data: { status: "ENDED", periodEnd, closedAt, reviewComment: brandPotentialEndInput.reason },
              })
              if (changed.count !== 1) {
                opStatus = "conflict"
                errorMsg = "Potential changed concurrently"
                serverData = { code: "MTM_BRAND_POTENTIAL_CONFLICT" }
              } else {
                const ended = { ...before, status: "ENDED", periodEnd, closedAt, reviewComment: brandPotentialEndInput.reason }
                await tx.mtmAuditLog.create({
                  data: {
                    organizationId: orgId,
                    agentId,
                    action: "BRAND_POTENTIAL_END",
                    entity: "field_potential",
                    entityId: before.id,
                    metadataKind: "brand_potential_period",
                    oldData: before,
                    newData: ended,
                  },
                })
                serverId = before.id
                serverData = { potential: ended }
              }
            }
          }

        } else if (entity === "workdays" && opType === "create" && workdayInput) {
          const workforceWorkday = !isRouteFieldSessionOperation(auth, entity)
          const applied = await applyMtmWorkdayEvent(tx, { organizationId: orgId, agentId }, workdayInput, {
            afterEvent: async ({ workday, event }) => {
              if (!workforceWorkday) return
              const prepared = await prepareWorkforceAttendanceVerification(tx, {
                organizationId: orgId,
                agentId,
                workday,
                event: workdayInput,
                evidence: workdayInput.attendance,
                capabilities: attendanceCapabilities,
                principal: "mobile",
              })
              if (prepared) {
                await recordWorkforceAttendanceVerification(tx, prepared, event.id)
              }
              if (workdayInput.action === "START") {
                await writeWorkforceSnapshotsIfReadyInTransaction(tx, {
                  organizationId: orgId,
                  workdayId: workday.id,
                  workday,
                  resolutionAt: new Date(),
                })
              }
            },
          })
          if (applied.status === "conflict") {
            opStatus = "conflict"
            errorMsg = applied.message
            serverData = {
              code: applied.code,
              ...(applied.workday ? { workday: applied.workday } : {}),
              ...(applied.allowedActions ? { allowedActions: applied.allowedActions } : {}),
            }
          } else {
            serverId = String(applied.workday.id)
            serverData = {
              workday: applied.workday,
              event: applied.event,
              ...(applied.idempotent ? { idempotent: true } : {}),
            }
          }

        } else {
          // Unreachable: the validation ladder above whitelists exactly the
          // combos dispatched here. Fail loud if the two ever drift.
          throw new Error(`Unhandled operation "${entity}/${opType}"`)
        }

        // Pin the result atomically with the write. Only ok/conflict reach
        // this point; a failure here rolls the entity write back too, so
        // "entity applied but unrecorded" can no longer happen.
        const result: OpResult = { serverId, serverData, error: errorMsg }
        await tx.mtmSyncOperation.create({
          data: {
            organizationId: orgId,
            agentId,
            operationId,
            entity,
            opType,
            status: opStatus,
            result,
          },
        })

        return { kind: "written", opStatus, result }
      })

      if (out.kind === "workforce-fence-denied") {
        results.push(syncWorkforceMobileWriteFenceError(operationId, out.access))
        continue
      }
      if (out.kind === "workforce-fence-unavailable") {
        results.push(syncWorkforceMobileWriteFenceUnavailableError(operationId))
        continue
      }

      // One payload, three consumers: the pin above, the in-batch replay map,
      // and the response — fresh and replayed answers are identical by construction.
      const stored: StoredOp = { entity, status: out.opStatus, result: out.result }
      known.set(operationId, stored)
      results.push(replayOf(operationId, stored))
    } catch (e: unknown) {
      if (e instanceof WorkforceAttendanceTrustError) {
        // The proof may be renewed (a new QR or freshly signed action), so do
        // not pin this failed attempt into the offline idempotency ledger.
        results.push({
          operationId,
          status: "error",
          error: e.message,
          serverData: { code: e.code },
        })
        continue
      }
      if ((e as { code?: string })?.code === "P2002") {
        // The transaction rolled back on a unique constraint. Recheck the
        // idempotency table to learn WHICH constraint fired: if a record for
        // this operationId exists, a concurrent duplicate push won the race —
        // replay its stored result. If not, the P2002 came from another
        // unique index (e.g. a client-supplied visit id that already exists).
        try {
          const winner = await prisma.mtmSyncOperation.findFirst({
            where: { organizationId: orgId, agentId, operationId },
            select: { operationId: true, entity: true, status: true, result: true },
          })
          if (winner) {
            known.set(winner.operationId, winner)
            if (winner.entity !== entity) {
              results.push(syncOperationIdMismatchError(operationId))
              continue
            }
            const replayCapability = capabilityForSyncEntity(auth, winner.entity)
            if (!hasSyncCapability(auth, replayCapability)) {
              results.push(syncCapabilityError(operationId, replayCapability))
              continue
            }
            results.push(replayOf(operationId, winner))
            continue
          }
          if (opType === "create" && data.id) {
            // The only other unique on these models today is the primary key,
            // reachable solely via a client-supplied id on create. Pin the
            // conflict so retries of this operationId replay a stable result
            // instead of re-running a doomed transaction.
            const stored: StoredOp = {
              entity,
              status: "conflict",
              result: { error: "Record with this id already exists" },
            }
            try {
              await prisma.mtmSyncOperation.create({
                data: {
                  organizationId: orgId,
                  agentId,
                  operationId,
                  entity,
                  opType,
                  status: "conflict",
                  result: stored.result as object,
                },
              })
            } catch (pe: unknown) {
              if ((pe as { code?: string })?.code !== "P2002") {
                console.error(`[MTM/sync/push] conflict pin failed operationId=${operationId}`, pe)
              }
            }
            known.set(operationId, stored)
            results.push(replayOf(operationId, stored))
            continue
          }
          // P2002 from an unexpected constraint on a non-create path: treat as
          // transient and retryable rather than guessing a conflict cause.
          console.error(`[MTM/sync/push] unexpected P2002 op=${opType} entity=${entity} operationId=${operationId}`, e)
          results.push({ operationId, status: "error", error: "Conflicting write, retry" })
          continue
        } catch (re) {
          console.error(`[MTM/sync/push] idempotency recheck failed operationId=${operationId}`, re)
          results.push({ operationId, status: "error", error: "Idempotency recheck failed, retry" })
          continue
        }
      }
      // Static message: raw e.message can carry Prisma/schema internals and
      // must not reach the device (same rule as the sanitized 500s).
      console.error(`[MTM/sync/push] op=${opType} entity=${entity} operationId=${operationId}`, e)
      results.push({ operationId, status: "error", error: "Internal error, retry" })
    }
  }

  return NextResponse.json({ success: true, results })
})
