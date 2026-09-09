/**
 * G (Creatio 10X roadmap — MTM Offline PWA) — web sync push.
 *
 * The web PWA's offline outbox flushes queued visit mutations here when it comes
 * back online. Session-authed (the mobile app uses the device-token engine at
 * /mtm/mobile/sync/push); shares the SAME `MtmSyncOperation` idempotency table
 * so a retry after a flaky connection never double-applies. Each op carries a
 * client operationId; a duplicate replays the stored result.
 *
 * This slice handles visit CHECK-OUT (reuses the extracted completeMtmVisit
 * helper). The op switch is the extension point for check-in / survey answers.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma, MtmRouteAssignmentRole } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  completeMtmVisit,
  createVisitRequirementSnapshot,
  lockAndVerifyMtmRoutePointForCheckIn,
  lockMtmActiveVisitSlot,
} from "@/lib/mtm/visit-requirements"
import { calculateDistance } from "@/lib/geo-utils"
import { MTM_CHECK_IN_ERROR } from "@/lib/mtm/check-in-errors"
import { hasMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { mutableVisitWhere } from "@/lib/mtm/visit-scope"
import {
  contactMutationScopeForActor,
  customerMutationScopeForActor,
} from "@/lib/mtm/field-scope"
import { VisitActionResultSchema } from "@/lib/mtm-validators"
import { getMtmSettings } from "@/lib/mtm-settings"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { canApplyMobileTaskTransition, type MobileTaskStatus } from "@/lib/mtm/mobile-task"
import {
  lockMtmTaskRecurrenceSeriesInTransaction,
  spawnNextMtmTaskRecurrenceInTransaction,
} from "@/lib/mtm/task-recurrence"
import { mtmAlertMessage } from "@/lib/mtm/alert-messages"

// Mirror the mobile engine's coordinate/geofence helpers (local there, not exported).
function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
}
function geofenceRadius(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 25 && parsed <= 10_000 ? parsed : 100
}

type OptionalCoordinatePair =
  | { ok: true; latitude: number | null; longitude: number | null }
  | { ok: false }

function optionalCoordinatePair(latitude: unknown, longitude: unknown): OptionalCoordinatePair {
  const hasLatitude = latitude !== undefined && latitude !== null
  const hasLongitude = longitude !== undefined && longitude !== null
  if (!hasLatitude && !hasLongitude) return { ok: true, latitude: null, longitude: null }
  if (!hasLatitude || !hasLongitude) return { ok: false }
  if (!validCoordinate(latitude, -90, 90) || !validCoordinate(longitude, -180, 180)) return { ok: false }
  return { ok: true, latitude, longitude }
}

function optionalDate(value: unknown): { ok: true; date: Date | undefined } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, date: undefined }
  if (typeof value !== "string") return { ok: false }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? { ok: false } : { ok: true, date }
}

const opSchema = z.object({
  operationId: z.string().uuid(),
  entity: z.enum(["visits", "tasks"]),
  op: z.enum(["create", "update"]),
  data: z.record(z.string(), z.unknown()),
  clientTimestamp: z.string().optional(),
})
const bodySchema = z.object({ operations: z.array(opSchema).min(1).max(100) })

const taskExecutionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().min(1),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  result: z.string().trim().max(5_000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.status === undefined && value.progress === undefined && value.result === undefined) {
    ctx.addIssue({ code: "custom", message: "Task update has no execution changes" })
  }
})

type SyncStatus = "ok" | "conflict" | "error"
type ApplyResult = { status: SyncStatus; result: unknown }

/** Map completeMtmVisit's outcome to a sync status the outbox understands. */
function checkoutStatus(completion: { status: string }): SyncStatus {
  switch (completion.status) {
    case "completed":
      return "ok" // includes the idempotent "already checked out" case
    case "not_found":
    case "invalid_status":
    case "missing_requirements":
      return "conflict" // business-rule rejection — client refetches / surfaces it
    default:
      return "error"
  }
}

export const POST = withRouteFieldWebRlsAuth("write", async (req, auth) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sync payload", details: parsed.error.issues[0]?.message }, { status: 400 })
  }
  const { operations } = parsed.data
  const orgId = auth.orgId
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: null,
  })
  if (!actor) {
    return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }
  const principalId = auth.userId

  // Batched idempotency pre-check — replay stored results for already-seen ops.
  const seenRows = (await prisma.mtmSyncOperation.findMany({
    where: { organizationId: orgId, agentId: principalId, operationId: { in: operations.map((o) => o.operationId) } },
    select: { operationId: true, status: true, result: true },
  })) as Array<{ operationId: string; status: string; result: unknown }>
  const seen = new Map(seenRows.map((r) => [r.operationId, r] as const))

  const results: Array<{ operationId: string; status: SyncStatus; result: unknown; replayed?: boolean }> = []

  for (const op of operations) {
    const prior = seen.get(op.operationId)
    if (prior) {
      results.push({ operationId: op.operationId, status: prior.status as SyncStatus, result: prior.result, replayed: true })
      continue
    }

    const applied = await applyOp(orgId, principalId, actor, auth.name, op)
    results.push({ operationId: op.operationId, ...applied })
  }

  return NextResponse.json({ success: true, data: { results } })
})

async function applyOp(
  orgId: string,
  principalId: string,
  actor: MtmRouteActor,
  actorName: string,
  op: z.infer<typeof opSchema>,
): Promise<ApplyResult & { replayed?: boolean }> {
  const kind = typeof op.data.kind === "string" ? op.data.kind : ""
  const d = op.data

  // ── visits / create / checkin ───────────────────────────────────────────
  // The fresh route actor supplies the server-owned field-agent identity. A
  // client cannot select another agent by changing the queued payload.
  // NOTE: this reuses the extracted requirement-snapshot helper but intentionally
  // DEFERS the mobile engine's geofence out-of-zone alert, participant fan-out and
  // route PLANNED→IN_PROGRESS transition to a later slice — they're enhancements,
  // not correctness; the visit itself is created faithfully.
  if (op.entity === "visits" && op.op === "create" && kind === "checkin") {
    const customerId = typeof d.customerId === "string" ? d.customerId : ""
    if (!customerId) return recordStandalone(orgId, principalId, op, "error", { error: "customerId required" })
    const coordinates = optionalCoordinatePair(d.checkInLat, d.checkInLng)
    if (!coordinates.ok) {
      return recordStandalone(orgId, principalId, op, "error", { error: "valid checkInLat/checkInLng are required together" })
    }
    const parsedCheckInAt = optionalDate(d.checkInAt)
    if (!parsedCheckInAt.ok) {
      return recordStandalone(orgId, principalId, op, "error", { error: "checkInAt must be a valid ISO date" })
    }
    const checkInAt = parsedCheckInAt.date ?? new Date()
    try {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const pin = (status: SyncStatus, result: Record<string, unknown>) =>
          tx.mtmSyncOperation.create({ data: { organizationId: orgId, agentId: principalId, operationId: op.operationId, entity: "visits", opType: "create", status, result: result as Prisma.InputJsonValue } })

        if (!actor.agentId) { const r = { status: "not_an_agent" }; await pin("conflict", r); return { status: "conflict" as const, result: r } }
        const fieldAgentId = actor.agentId
        const contactId = typeof d.contactId === "string" ? d.contactId : null
        const routeId = typeof d.routeId === "string" ? d.routeId : null
        const routePointId = typeof d.routePointId === "string" ? d.routePointId : null

        // Resolve + authorize a planned route point when the check-in targets one
        // (mirrors the mobile engine: PENDING point on the agent's own route).
        const requestedRouteTarget = Boolean(routeId || routePointId)
        const routePoint = requestedRouteTarget
          ? await tx.mtmRoutePoint.findFirst({
              where: {
                ...(routePointId ? { id: routePointId } : {}),
                ...(routeId ? { routeId } : {}),
                customerId, ...(contactId !== null ? { contactId } : {}),
                deletedAt: null, status: "PENDING",
                route: {
                  organizationId: orgId,
                  // INCOMPLETE: a check-in queued offline can arrive after the
                  // day-close job has retired the route. The visit happened.
                  status: { in: ["PLANNED", "IN_PROGRESS", "INCOMPLETE"] }, deletedAt: null,
                  OR: [{ agentId: fieldAgentId }, { assignments: { some: { agentId: fieldAgentId, removedAt: null, role: { not: "OBSERVER" } } } }],
                },
              },
              select: { id: true, routeId: true, customerId: true, contactId: true, route: { select: { status: true, assignments: { where: { removedAt: null }, select: { agentId: true, role: true } } } } },
            })
          : null
        // Conflict results keep this route's `status` words and additionally carry
        // the shared check-in `code` (src/lib/mtm/check-in-errors.ts), so the
        // PWA can branch on the same vocabulary as the native app.
        if (requestedRouteTarget && !routePoint) { const r = { status: "route_point_unavailable", code: MTM_CHECK_IN_ERROR.ROUTE_POINT_NOT_AVAILABLE }; await pin("conflict", r); return { status: "conflict" as const, result: r } }

        const resolvedCustomerId = routePoint?.customerId ?? customerId
        const customer = await tx.mtmCustomer.findFirst({
          where: {
            id: resolvedCustomerId,
            organizationId: orgId,
            deletedAt: null,
            AND: [customerMutationScopeForActor(actor, checkInAt)],
          },
          select: { id: true, latitude: true, longitude: true, geofenceRadius: true },
        })
        if (!customer) { const r = { status: "customer_not_found", code: MTM_CHECK_IN_ERROR.CUSTOMER_MISSING }; await pin("conflict", r); return { status: "conflict" as const, result: r } }
        // Owner decision 2 (field UX audit 2026-09-05): no coordinates, no
        // check-in, on every entry point.
        if (!hasMtmCoordinates(customer)) {
          const r = { status: "customer_no_coordinates", code: MTM_CHECK_IN_ERROR.NO_COORDINATES, customerId: resolvedCustomerId }
          await pin("conflict", r)
          return { status: "conflict" as const, result: r }
        }

        // Ad-hoc contact ids are caller input. Route-point contacts were
        // resolved by the scoped route-point query above; all other contacts
        // must be active tenant records with a current workplace at customer.
        if (contactId && !routePoint) {
          const contact = await tx.mtmContact.findFirst({
            where: {
              id: contactId,
              organizationId: orgId,
              deletedAt: null,
              status: { not: "INACTIVE" },
              AND: [
                contactMutationScopeForActor(actor, checkInAt),
                {
                  workplaces: {
                    some: {
                      organizationId: orgId,
                      customerId: resolvedCustomerId,
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
          if (!contact) { const r = { status: "contact_not_found", code: MTM_CHECK_IN_ERROR.CONTACT_MISSING }; await pin("conflict", r); return { status: "conflict" as const, result: r } }
        }

        // One open visit per agent.
        await lockMtmActiveVisitSlot(tx, { organizationId: orgId, agentId: fieldAgentId })
        const active = await tx.mtmVisit.findFirst({ where: { organizationId: orgId, agentId: fieldAgentId, status: "CHECKED_IN", deletedAt: null }, select: { id: true } })
        if (active) { const r = { status: "already_checked_in", code: MTM_CHECK_IN_ERROR.ACTIVE_VISIT, visitId: active.id }; await pin("conflict", r); return { status: "conflict" as const, result: r } }

        const checkInLat = coordinates.latitude
        const checkInLng = coordinates.longitude

        // Geofence: an out-of-zone check-in is rejected with an alert, no visit
        // (same rule as the native engine — protects field-data integrity offline).
        if (validCoordinate(checkInLat, -90, 90) && validCoordinate(checkInLng, -180, 180)) {
          let radius = customer.geofenceRadius
          if (radius == null) {
            const setting = await tx.mtmSetting.findFirst({ where: { organizationId: orgId, key: "geofenceRadius" }, select: { value: true } })
            radius = geofenceRadius(setting?.value)
          }
          const distanceMeters = calculateDistance(checkInLat, checkInLng, customer.latitude, customer.longitude)
          const allowedRadius = geofenceRadius(radius)
          if (distanceMeters > allowedRadius) {
            const roundedDistance = Math.round(distanceMeters)
            await tx.mtmAlert.create({
              data: {
                organizationId: orgId, agentId: fieldAgentId, type: "OUT_OF_ZONE", category: "WARNING",
                title: "Out of zone check-in",
                description: `Agent attempted check-in ${roundedDistance}m away (max ${allowedRadius}m)`,
                metadata: {
                  customerId: resolvedCustomerId, routeId: routePoint?.routeId ?? null, routePointId: routePoint?.id ?? null,
                  distanceMeters: roundedDistance, geofenceRadius: allowedRadius,
                  ...mtmAlertMessage("outOfZoneCheckIn", { distanceMeters: roundedDistance, geofenceRadius: allowedRadius }),
                },
              },
            })
            const r = { status: "out_of_zone", code: MTM_CHECK_IN_ERROR.TOO_FAR, distanceMeters: roundedDistance, geofenceRadius: allowedRadius }
            await pin("conflict", r)
            return { status: "conflict" as const, result: r }
          }
        }

        if (routePoint) {
          // Re-evaluate the point, route state, and current assignment after a
          // transaction advisory lock. This preserves the race fence without a
          // no-op UPDATE that would manufacture an R6 point sync delta.
          const pointAvailable = await lockAndVerifyMtmRoutePointForCheckIn(tx, {
            organizationId: orgId,
            agentId: fieldAgentId,
            routePointId: routePoint.id,
            routeId: routePoint.routeId,
            customerId: resolvedCustomerId,
            contactId: routePoint.contactId,
          })
          if (!pointAvailable) { const r = { status: "route_point_unavailable", code: MTM_CHECK_IN_ERROR.ROUTE_POINT_NOT_AVAILABLE }; await pin("conflict", r); return { status: "conflict" as const, result: r } }
          const activePointVisit = await tx.mtmVisit.findFirst({
            where: { organizationId: orgId, routePointId: routePoint.id, status: "CHECKED_IN", deletedAt: null },
            select: { id: true },
          })
          if (activePointVisit) { const r = { status: "route_point_in_use", code: MTM_CHECK_IN_ERROR.ROUTE_POINT_ALREADY_ACTIVE, visitId: activePointVisit.id }; await pin("conflict", r); return { status: "conflict" as const, result: r } }
        }

        const visit = await tx.mtmVisit.create({
          data: {
            ...(typeof d.visitId === "string" ? { id: d.visitId } : {}),
            organizationId: orgId, agentId: fieldAgentId, customerId: resolvedCustomerId,
            contactId: routePoint?.contactId ?? contactId,
            routeId: routePoint?.routeId ?? null, routePointId: routePoint?.id ?? null,
            status: "CHECKED_IN", checkInAt, checkInLat, checkInLng,
            notes: typeof d.notes === "string" ? d.notes : null,
          },
          select: { id: true, status: true, checkInAt: true, customerId: true },
        })
        await createVisitRequirementSnapshot(tx, { organizationId: orgId, visitId: visit.id, agentId: fieldAgentId, customerId: resolvedCustomerId, visitType: typeof d.visitType === "string" ? d.visitType : undefined, at: checkInAt })

        // Route-point visit: fan out participants (other assigned agents) + advance the route.
        if (routePoint) {
          const others = routePoint.route.assignments.filter((a: { agentId: string }) => a.agentId !== fieldAgentId)
          if (others.length > 0) {
            await tx.mtmVisitParticipant.createMany({
              data: others.map((a: { agentId: string; role: MtmRouteAssignmentRole }) => ({
                organizationId: orgId,
                visitId: visit.id,
                agentId: a.agentId,
                role: a.role,
                joinedAt: checkInAt,
              })),
              skipDuplicates: true,
            })
          }
          if (routePoint.route.status === "PLANNED") {
            await tx.mtmRoute.updateMany({
              where: {
                id: routePoint.routeId,
                organizationId: orgId,
                status: "PLANNED",
                deletedAt: null,
                OR: [
                  { agentId: fieldAgentId },
                  { assignments: { some: { agentId: fieldAgentId, removedAt: null, role: { not: "OBSERVER" } } } },
                ],
              },
              data: { status: "IN_PROGRESS", startedAt: checkInAt },
            })
          }
        }

        const r = { status: "checked_in", visit }
        await pin("ok", r)
        return { status: "ok" as const, result: r }
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const rec = await prisma.mtmSyncOperation.findFirst({ where: { organizationId: orgId, agentId: principalId, operationId: op.operationId }, select: { status: true, result: true } })
        if (rec) return { status: rec.status as SyncStatus, result: rec.result, replayed: true }
      }
      console.error("[mtm/sync/push] checkin apply failed:", e)
      return { status: "error", result: { error: "apply_failed" } }
    }
  }

  // ── visits / update / checkout ──────────────────────────────────────────
  if (op.entity === "visits" && op.op === "update" && kind === "checkout") {
    const visitId = typeof op.data.visitId === "string" ? op.data.visitId : ""
    if (!visitId) return recordStandalone(orgId, principalId, op, "error", { error: "visitId required" })
    const coordinates = optionalCoordinatePair(op.data.checkOutLat, op.data.checkOutLng)
    if (!coordinates.ok) {
      return recordStandalone(orgId, principalId, op, "error", { error: "valid checkOutLat/checkOutLng are required together" })
    }
    const parsedCheckOutAt = optionalDate(op.data.checkOutAt)
    if (!parsedCheckOutAt.ok) {
      return recordStandalone(orgId, principalId, op, "error", { error: "checkOutAt must be a valid ISO date" })
    }

    try {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const lock = await tx.mtmVisit.updateMany({
          where: mutableVisitWhere(actor, orgId, { id: visitId, status: "CHECKED_IN" }),
          data: { status: "CHECKED_IN" },
        })
        let expectedAgentId: string | undefined
        if (lock.count !== 1) {
          const visible = await tx.mtmVisit.findFirst({
            where: mutableVisitWhere(actor, orgId, { id: visitId }),
            select: { id: true, agentId: true, status: true },
          })
          if (!visible || visible.status !== "CHECKED_OUT") {
            const result = { status: "visit_not_found" }
            await tx.mtmSyncOperation.create({
              data: { organizationId: orgId, agentId: principalId, operationId: op.operationId, entity: "visits", opType: "update", status: "conflict", result: result as Prisma.InputJsonValue },
            })
            return { status: "conflict" as const, result }
          }
          expectedAgentId = visible.agentId
        }
        const completion = await completeMtmVisit(tx, {
          organizationId: orgId,
          visitId,
          ...(expectedAgentId ? { expectedAgentId } : {}),
          checkOutAt: parsedCheckOutAt.date,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        })
        const status = checkoutStatus(completion)
        await tx.mtmSyncOperation.create({
          data: { organizationId: orgId, agentId: principalId, operationId: op.operationId, entity: "visits", opType: "update", status, result: completion as Prisma.InputJsonValue },
        })
        return { status, result: completion }
      })
    } catch (e) {
      // Concurrent duplicate push hit the unique index — replay the winner's row.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const rec = await prisma.mtmSyncOperation.findFirst({
          where: { organizationId: orgId, agentId: principalId, operationId: op.operationId },
          select: { status: true, result: true },
        })
        if (rec) return { status: rec.status as SyncStatus, result: rec.result, replayed: true }
      }
      console.error("[mtm/sync/push] checkout apply failed:", e)
      return { status: "error", result: { error: "apply_failed" } }
    }
  }

  // ── visits / update / visit_action ──────────────────────────────────────
  // Record a survey answer / visit action result captured offline. Reuses the
  // same gate as the online actions route (visit must be CHECKED_IN; the action
  // must be in the requirement snapshot). `evidence` carries the survey payload.
  if (op.entity === "visits" && op.op === "update" && kind === "visit_action") {
    const visitId = typeof d.visitId === "string" ? d.visitId : ""
    const parsedAction = VisitActionResultSchema.safeParse({
      ...(typeof d.resultId === "string" ? { id: d.resultId } : {}),
      actionKey: d.actionKey,
      status: d.status,
      evidence: d.evidence,
    })
    if (!visitId || !parsedAction.success) {
      return recordStandalone(orgId, principalId, op, "error", {
        error: !visitId ? "visitId required" : (parsedAction.error.issues[0]?.message ?? "invalid visit action"),
      })
    }
    const action = parsedAction.data
    try {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const pin = (s: SyncStatus, r: Record<string, unknown>) =>
          tx.mtmSyncOperation.create({ data: { organizationId: orgId, agentId: principalId, operationId: op.operationId, entity: "visits", opType: "update", status: s, result: r as Prisma.InputJsonValue } })

        const lock = await tx.mtmVisit.updateMany({
          where: mutableVisitWhere(actor, orgId, { id: visitId, status: "CHECKED_IN" }),
          data: { status: "CHECKED_IN" },
        })
        if (lock.count !== 1) { const r = { status: "visit_not_found" }; await pin("conflict", r); return { status: "conflict" as const, result: r } }

        const visit = await tx.mtmVisit.findFirst({
          where: mutableVisitWhere(actor, orgId, { id: visitId, status: "CHECKED_IN" }),
          select: {
            id: true,
            agentId: true,
            status: true,
            requirementSnapshot: {
              select: { requirements: { select: { id: true, actionKey: true, mode: true, allowWaiver: true } } },
            },
          },
        })
        if (!visit) { const r = { status: "visit_not_found" }; await pin("conflict", r); return { status: "conflict" as const, result: r } }
        if (visit.status !== "CHECKED_IN") { const r = { status: "visit_not_active" }; await pin("conflict", r); return { status: "conflict" as const, result: r } }
        const requirement = visit.requirementSnapshot?.requirements.find((x: { actionKey: string }) => x.actionKey === action.actionKey)
        if (!requirement || requirement.mode === "HIDDEN") { const r = { status: "action_hidden" }; await pin("conflict", r); return { status: "conflict" as const, result: r } }
        if (action.status === "WAIVED" && !requirement.allowWaiver) { const r = { status: "waiver_forbidden" }; await pin("conflict", r); return { status: "conflict" as const, result: r } }

        const completedByAgentId = actor.agentId ?? visit.agentId
        const result = await tx.mtmVisitActionResult.create({
          data: {
            ...(action.id ? { id: action.id } : {}),
            organizationId: orgId, visitId, requirementId: requirement.id,
            actionKey: action.actionKey,
            status: action.status,
            evidence: action.evidence ? (action.evidence as Prisma.InputJsonValue) : Prisma.JsonNull,
            completedByAgentId, completedAt: new Date(),
          },
          select: { id: true, actionKey: true, status: true },
        })
        const r = { status: "recorded", result }
        await pin("ok", r)
        return { status: "ok" as const, result: r }
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const rec = await prisma.mtmSyncOperation.findFirst({ where: { organizationId: orgId, agentId: principalId, operationId: op.operationId }, select: { status: true, result: true } })
        if (rec) return { status: rec.status as SyncStatus, result: rec.result, replayed: true }
      }
      console.error("[mtm/sync/push] visit_action apply failed:", e)
      return { status: "error", result: { error: "apply_failed" } }
    }
  }

  // ── tasks / update / execution ─────────────────────────────────────────
  // Browser offline execution uses the same durable operation table as visit
  // outbox writes. The authenticated web actor is pinned to their own task;
  // managers use the online review/metadata endpoints instead.
  if (op.entity === "tasks" && op.op === "update" && (kind === "" || kind === "task_update")) {
    const parsedTask = taskExecutionSchema.safeParse(d)
    if (!parsedTask.success) {
      return recordStandalone(orgId, principalId, op, "error", {
        error: parsedTask.error.issues[0]?.message ?? "Invalid task execution update",
      })
    }
    if (!actor.agentId) {
      return recordStandalone(orgId, principalId, op, "conflict", { status: "not_an_agent", code: "MTM_TASK_EXECUTION_DENIED" })
    }
    const input = parsedTask.data
    const settings = await getMtmSettings(orgId)

    try {
      const applied = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const pin = async (status: SyncStatus, result: Record<string, unknown>) => {
          await tx.mtmSyncOperation.create({
            data: {
              organizationId: orgId,
              agentId: principalId,
              operationId: op.operationId,
              entity: "tasks",
              opType: "update",
              status,
              result: result as Prisma.InputJsonValue,
            },
          })
          return { status, result }
        }

        const task = await tx.mtmTask.findFirst({
          where: { id: input.id, organizationId: orgId, agentId: actor.agentId!, deletedAt: null },
        })
        if (!task) return pin("conflict", { status: "task_not_found", code: "MTM_TASK_NOT_FOUND" })
        if (task.version !== input.expectedVersion) {
          return pin("conflict", { status: "version_conflict", code: "MTM_TASK_VERSION_CONFLICT", task })
        }
        if (task.status === "COMPLETED" || task.status === "CANCELLED") {
          return pin("conflict", { status: "task_immutable", code: "MTM_TASK_IMMUTABLE", task })
        }
        if (input.status && !canApplyMobileTaskTransition(task.status as MobileTaskStatus, input.status)) {
          return pin("conflict", { status: "status_conflict", code: "MTM_TASK_STATUS_CONFLICT", task })
        }

        const occurredAt = new Date()
        const firstCompletion = input.status === "COMPLETED" && task.status !== "COMPLETED"
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
            agentId: actor.agentId!,
            status: task.status,
            version: input.expectedVersion,
            deletedAt: null,
          },
          data: {
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.progress !== undefined ? { progress: input.progress } : {}),
            ...(input.result !== undefined ? { result: input.result } : {}),
            ...(input.status === "IN_PROGRESS" && !task.startedAt ? { startedAt: occurredAt } : {}),
            ...(firstCompletion ? { completedAt: occurredAt, progress: 100 } : {}),
            ...(input.status === "PENDING" ? { completedAt: null } : {}),
            version: { increment: 1 },
          },
        })
        if (updated.count !== 1) {
          return pin("conflict", { status: "version_conflict", code: "MTM_TASK_VERSION_CONFLICT" })
        }

        const eventType = firstCompletion
          ? "COMPLETED"
          : input.status === "IN_PROGRESS" && task.status !== "IN_PROGRESS"
            ? "STARTED"
            : input.status === "CANCELLED" && task.status !== "CANCELLED"
              ? "CANCELLED"
              : "EDITED"
        await tx.mtmTaskEvent.create({
          data: {
            organizationId: orgId,
            taskId: task.id,
            agentId: actor.agentId!,
            clientEventId: op.operationId,
            type: eventType,
            occurredAt,
            fromStatus: task.status,
            toStatus: input.status ?? task.status,
            oldDueDate: task.dueDate,
            newDueDate: task.dueDate,
            evidence: {
              kind: "MTM_TASK_EXECUTION",
              actorAgentId: actor.agentId,
              actorRole: actor.role,
              actorName,
              progress: input.progress,
              source: "WEB_OFFLINE_OUTBOX",
              expectedVersion: input.expectedVersion,
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
              title: task.title,
              description: task.description,
              priority: task.priority,
              scheduledStartAt: task.scheduledStartAt,
              dueDate: task.dueDate,
              recurrenceRule: task.recurrenceRule,
              recurrenceInterval: task.recurrenceInterval,
              recurrenceUntil: task.recurrenceUntil,
              recurrenceTimezone: task.recurrenceTimezone,
              recurrenceAnchorScheduledStartAt: task.recurrenceAnchorScheduledStartAt,
              recurrenceAnchorDueDate: task.recurrenceAnchorDueDate,
              recurrenceCursorScheduledStartAt: task.recurrenceCursorScheduledStartAt,
              recurrenceCursorDueDate: task.recurrenceCursorDueDate,
              recurrenceParentId: task.recurrenceParentId,
            },
            tenantTimezone: settings.timezone,
            occurredAt,
          })
        }
        const serverTask = await tx.mtmTask.findFirst({
          where: { id: task.id, organizationId: orgId, agentId: actor.agentId!, deletedAt: null },
        })
        return pin("ok", { status: "updated", task: serverTask })
      })

      if (applied.status === "ok") {
        await writeMtmAudit({
          organizationId: orgId,
          agentId: actor.agentId,
          action: input.status === "COMPLETED" ? "TASK_COMPLETE" : "TASK_UPDATE",
          entity: "task",
          entityId: input.id,
          metadataKind: input.status === "COMPLETED" ? "task_complete" : "task_execution",
          newData: { ...input, source: "WEB_OFFLINE_OUTBOX", operationId: op.operationId },
        }).catch((error) => console.warn("[mtm/sync/push] task audit failed", error))
      }
      return applied
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const record = await prisma.mtmSyncOperation.findFirst({
          where: { organizationId: orgId, agentId: principalId, operationId: op.operationId },
          select: { status: true, result: true },
        })
        if (record) return { status: record.status as SyncStatus, result: record.result, replayed: true }
      }
      console.error("[mtm/sync/push] task apply failed:", error)
      return { status: "error", result: { error: "apply_failed" } }
    }
  }

  // Unsupported op in this slice — pin an error result so a replay is stable.
  return recordStandalone(orgId, principalId, op, "error", { error: `Unsupported op ${op.entity}/${op.op}/${kind}` })
}

/** Record a MtmSyncOperation outside a domain transaction (for validation errors). */
async function recordStandalone(
  orgId: string,
  principalId: string,
  op: z.infer<typeof opSchema>,
  status: SyncStatus,
  result: Record<string, unknown>,
): Promise<ApplyResult> {
  await prisma.mtmSyncOperation
    .create({ data: { organizationId: orgId, agentId: principalId, operationId: op.operationId, entity: op.entity, opType: op.op, status, result: result as Prisma.InputJsonValue } })
    .catch(() => {})
  return { status, result }
}
