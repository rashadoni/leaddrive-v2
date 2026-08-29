import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceCompatAuth } from "@/lib/with-workforce-compat-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import {
  applyMtmWorkdayEvent,
  lockMtmWorkdayTransitions,
  mtmWorkdayReplayMatches,
  parseMtmWorkdayEvent,
} from "@/lib/mtm/workday"
import { availableWorkdayActions } from "@/lib/mtm/operational-week"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  prepareWorkforceAttendanceVerification,
  recordWorkforceAttendanceVerification,
  workforceAttendanceCapabilitiesFromTenant,
  WorkforceAttendanceTrustError,
  type WorkforceAttendanceCapabilities,
} from "@/lib/workforce/attendance-trust"
import {
  evaluateWorkforceMobileWriteAccess,
  workforceMobileWriteFenceResponse,
} from "@/lib/workforce/mobile-write-fence"
import { writeWorkforceSnapshotsIfReadyInTransaction } from "@/lib/workforce/snapshot-writer"

const MAX_WEB_WORKDAY_EVENT_AGE_MS = 5 * 60 * 1000

const replaySelect = {
  id: true,
  workdayId: true,
  clientEventId: true,
  type: true,
  occurredAt: true,
  latitude: true,
  longitude: true,
  accuracy: true,
  note: true,
  requestHash: true,
  createdAt: true,
  workday: {
    select: {
      id: true,
      workDate: true,
      status: true,
      startedAt: true,
      pausedAt: true,
      completedAt: true,
      totalPausedSeconds: true,
      startLatitude: true,
      startLongitude: true,
      endLatitude: true,
      endLongitude: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const

type Replay = Prisma.MtmAgentWorkdayEventGetPayload<{ select: typeof replaySelect }>

function validClientEventId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100
}

function responseForReplay(replay: Replay) {
  return NextResponse.json({
    success: true,
    idempotent: true,
    data: {
      workday: replay.workday,
      event: {
        id: replay.id,
        workdayId: replay.workdayId,
        clientEventId: replay.clientEventId,
        type: replay.type,
        occurredAt: replay.occurredAt,
        latitude: replay.latitude,
        longitude: replay.longitude,
        accuracy: replay.accuracy,
        note: replay.note,
        createdAt: replay.createdAt,
      },
      availableActions: availableWorkdayActions(replay.workday.status),
    },
  })
}

function replayMismatch() {
  return NextResponse.json({
    error: "clientEventId was already used for a different workday operation",
    code: "MTM_WEEK_WORKDAY_IDEMPOTENCY_MISMATCH",
  }, { status: 409 })
}

function workdayAuditSummary(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { exists: false }
  const row = value as Record<string, unknown>
  return {
    exists: true,
    id: row.id ?? null,
    workDate: row.workDate ?? null,
    status: row.status ?? null,
    startedAt: row.startedAt ?? null,
    pausedAt: row.pausedAt ?? null,
    completedAt: row.completedAt ?? null,
    totalPausedSeconds: row.totalPausedSeconds ?? 0,
  }
}

async function attendanceCapabilitiesForRequest(auth: {
  orgId: string
  principal: "web" | "mobile"
  attendanceQr: boolean
  attendanceDeviceTrust: boolean
}): Promise<WorkforceAttendanceCapabilities> {
  if (auth.principal === "mobile") {
    return {
      qrEnabled: auth.attendanceQr,
      deviceTrustEnabled: auth.attendanceDeviceTrust,
    }
  }
  const organization = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { plan: true, addons: true, features: true, modules: true },
  })
  return organization
    ? workforceAttendanceCapabilitiesFromTenant(organization)
    : { qrEnabled: false, deviceTrustEnabled: false }
}

/**
 * POST /api/v1/mtm/week/workday
 *
 * An AGENT may transition only their own workday. Manager, supervisor and
 * admin week views are deliberately read-only. clientEventId is the replay
 * key; both the state transition and immutable event are written in one
 * transaction through the shared mobile state machine.
 */
export const POST = withWorkforceCompatAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || actor.role !== "AGENT" || !actor.agentId) {
    return NextResponse.json({
      error: "Managers have read-only access to employee workdays",
      code: "MTM_WEEK_WORKDAY_SELF_ONLY",
    }, { status: 403 })
  }

  // Browser-based Workforce corrections keep their independent, audited
  // session path. The H6 fence is only for mobile mutations, including this
  // compatibility transport used by older Android clients.
  if (auth.principal === "mobile") {
    try {
      const access = await evaluateWorkforceMobileWriteAccess({
        auth: { orgId: auth.orgId, agentId: actor.agentId },
        deviceId: req.headers.get("x-field-device-id"),
      })
      if (!access.allowed) return workforceMobileWriteFenceResponse(access)
    } catch (error) {
      console.error("[MTM/week/workday] Workforce mobile write fence unavailable", error)
      return NextResponse.json({
        error: "Unable to verify the Workforce mobile write fence. Please retry.",
        code: "WORKFORCE_MOBILE_WRITE_FENCE_UNAVAILABLE",
      }, { status: 503 })
    }
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "JSON object required", code: "MTM_WEEK_WORKDAY_INVALID" }, { status: 400 })
  }
  const data = body as Record<string, unknown>
  if (data.agentId != null && data.agentId !== actor.agentId) {
    return NextResponse.json({ error: "Workday mutation is self-only", code: "MTM_WEEK_WORKDAY_SELF_ONLY" }, { status: 403 })
  }
  if (!validClientEventId(data.clientEventId)) {
    return NextResponse.json({
      error: "clientEventId is required and must be at most 100 characters",
      code: "MTM_WEEK_WORKDAY_INVALID",
    }, { status: 400 })
  }
  const clientEventId = data.clientEventId.trim()
  const settings = await getMtmSettings(auth.orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const serverReceivedAt = new Date()
  const parsed = parseMtmWorkdayEvent(data, clientEventId, timezone, serverReceivedAt)
  const input = parsed.input
  if (!input) {
    return NextResponse.json({
      error: parsed.error ?? "Invalid workday event",
      code: "MTM_WEEK_WORKDAY_INVALID",
    }, { status: 400 })
  }

  const replayWhere = {
    organizationId: auth.orgId,
    agentId: actor.agentId,
    clientEventId,
  }
  const existing = await prisma.mtmAgentWorkdayEvent.findFirst({
    where: replayWhere,
    select: replaySelect,
  }) as Replay | null
  if (existing) {
    return mtmWorkdayReplayMatches(existing, input, {
      organizationId: auth.orgId,
      agentId: actor.agentId,
    }) ? responseForReplay(existing) : replayMismatch()
  }

  // This endpoint is an online web transport. Offline/mobile events have a
  // separate authenticated sync contract; accepting a brand-new historical
  // timestamp here would let a caller fabricate an old shift. Preserve true
  // idempotent replays above, but require every new web transition to be near
  // server time.
  if (input.claimedAt.getTime() < input.serverReceivedAt.getTime() - MAX_WEB_WORKDAY_EVENT_AGE_MS) {
    return NextResponse.json({
      error: "Workday event time is too far in the past for web submission",
      code: "MTM_WEEK_WORKDAY_INVALID",
    }, { status: 400 })
  }

  // A capability alone does not impose a policy. Once a policy publishes an
  // H5 requirement, however, it is always evaluated: disabling its add-on
  // must fail closed rather than silently bypass attendance enforcement.
  const attendanceCapabilities = await attendanceCapabilitiesForRequest(auth)

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-check inside the write transaction. The preflight above keeps
      // malformed/frozen mobile calls cheap, but only this shared tenant lock
      // makes an allowed workday transition linearizable with an exclusive
      // control-plane freeze or cohort change.
      if (auth.principal === "mobile") {
        try {
          const access = await evaluateWorkforceMobileWriteAccess({
            auth: { orgId: auth.orgId, agentId: actor.agentId! },
            deviceId: req.headers.get("x-field-device-id"),
            tx,
          })
          if (!access.allowed) return { kind: "workforce-fence-denied" as const, access }
        } catch (error) {
          console.error("[MTM/week/workday] Workforce mobile write fence unavailable in transaction", error)
          return { kind: "workforce-fence-unavailable" as const }
        }
      }
      // All state transitions for one agent serialize on the same
      // transaction-scoped PostgreSQL lock, including distinct replay keys.
      // This closes START-vs-START and PAUSE/RESUME/FINISH write races before
      // the shared state machine reads the current workday status.
      await lockMtmWorkdayTransitions(tx, {
        organizationId: auth.orgId,
        agentId: actor.agentId!,
      })
      const replay = await tx.mtmAgentWorkdayEvent.findFirst({
        where: replayWhere,
        select: replaySelect,
      }) as Replay | null
      if (replay) {
        return mtmWorkdayReplayMatches(replay, input, {
          organizationId: auth.orgId,
          agentId: actor.agentId!,
        })
          ? { kind: "replay" as const, replay }
          : { kind: "mismatch" as const }
      }
      const before = input.action === "START"
        ? null
        : await tx.mtmAgentWorkday.findFirst({
            where: {
              id: input.workdayId,
              organizationId: auth.orgId,
              agentId: actor.agentId!,
            },
            select: {
              id: true,
              workDate: true,
              status: true,
              startedAt: true,
              pausedAt: true,
              completedAt: true,
              totalPausedSeconds: true,
            },
          })
      const applied = await applyMtmWorkdayEvent(tx, {
        organizationId: auth.orgId,
        agentId: actor.agentId!,
      }, input, {
        afterEvent: async ({ workday, event }) => {
          const prepared = await prepareWorkforceAttendanceVerification(tx, {
            organizationId: auth.orgId,
            agentId: actor.agentId!,
            workday,
            event: input,
            evidence: input.attendance,
            capabilities: attendanceCapabilities,
            principal: auth.principal,
          })
          if (prepared) {
            await recordWorkforceAttendanceVerification(tx, prepared, event.id)
          }
          if (input.action === "START") {
            await writeWorkforceSnapshotsIfReadyInTransaction(tx, {
              organizationId: auth.orgId,
              workdayId: workday.id,
              workday,
              resolutionAt: new Date(),
            })
          }
        },
      })
      return { kind: "applied" as const, applied, before }
    })

    if (result.kind === "workforce-fence-denied") return workforceMobileWriteFenceResponse(result.access)
    if (result.kind === "workforce-fence-unavailable") {
      return NextResponse.json({
        error: "Unable to verify the Workforce mobile write fence. Please retry.",
        code: "WORKFORCE_MOBILE_WRITE_FENCE_UNAVAILABLE",
      }, { status: 503 })
    }
    if (result.kind === "replay") return responseForReplay(result.replay)
    if (result.kind === "mismatch") return replayMismatch()
    if (result.applied.status === "conflict") {
      return NextResponse.json({
        error: result.applied.message,
        code: result.applied.code,
        data: {
          workday: result.applied.workday ?? null,
          availableActions: availableWorkdayActions(
            typeof result.applied.workday?.status === "string" ? result.applied.workday.status : null,
          ),
        },
      }, { status: 409 })
    }

    if (!result.applied.idempotent) {
      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: actor.agentId,
        action: `WORKDAY_${input.action}`,
        entity: "workday",
        entityId: String(result.applied.workday.id),
        metadataKind: "workday_transition",
        oldData: workdayAuditSummary(result.before),
        newData: {
          clientEventId,
          action: input.action,
          occurredAt: input.occurredAt.toISOString(),
          workday: workdayAuditSummary(result.applied.workday),
        },
        req,
      }).catch((error) => console.warn("[MTM/week/workday] audit failed", error))
    }

    return NextResponse.json({
      success: true,
      idempotent: result.applied.idempotent,
      data: {
        workday: result.applied.workday,
        event: result.applied.event,
        availableActions: availableWorkdayActions(
          typeof result.applied.workday.status === "string" ? result.applied.workday.status : null,
        ),
      },
    })
  } catch (error) {
    if (error instanceof WorkforceAttendanceTrustError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    }
    // A concurrent duplicate can lose the unique-key race after the first
    // preflight. Replay the committed event instead of surfacing a retryable
    // 500. Any unrelated error remains visible and does not claim success.
    const replay = await prisma.mtmAgentWorkdayEvent.findFirst({
      where: replayWhere,
      select: replaySelect,
    }).catch(() => null) as Replay | null
    if (replay) {
      return mtmWorkdayReplayMatches(replay, input, {
        organizationId: auth.orgId,
        agentId: actor.agentId,
      }) ? responseForReplay(replay) : replayMismatch()
    }
    console.error("[MTM/week/workday POST]", error)
    return NextResponse.json({ error: "Failed to update workday", code: "MTM_WEEK_WORKDAY_FAILED" }, { status: 500 })
  }
})
