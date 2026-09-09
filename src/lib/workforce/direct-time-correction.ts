import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import { isAgentInWorkforceScope, type WorkforceActor } from "@/lib/workforce/actor"
import {
  replayWorkforceWorkdayFacts,
  workforceReplayMatchesWorkdayCorrectionFacts,
  WorkforceWorkdayFactsReplayError,
} from "@/lib/workforce/workday-facts-replay"
import {
  workforceWorkdayCorrectionFacts,
  type WorkforceWorkdayCorrectionFacts,
} from "@/lib/workforce/workday-correction-facts"

const WorkforceDirectCorrectionTimestamp = z.string().datetime({ offset: true })

/** A manager corrects the complete boundary of an already closed shift. */
export const WorkforceDirectTimeCorrectionSchema = z.object({
  operationId: z.string().trim().min(8).max(128),
  expectedUpdatedAt: WorkforceDirectCorrectionTimestamp,
  startedAt: WorkforceDirectCorrectionTimestamp,
  completedAt: WorkforceDirectCorrectionTimestamp,
  reason: z.string().trim().min(1).max(1000),
}).strict().superRefine((value, context) => {
  if (new Date(value.completedAt).getTime() <= new Date(value.startedAt).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["completedAt"],
      message: "Corrected finish time must be after the corrected start time",
    })
  }
})

export type WorkforceDirectTimeCorrectionInput = z.infer<typeof WorkforceDirectTimeCorrectionSchema>

type DirectCorrectionAuditContext = {
  ipAddress?: string | null
  userAgent?: string | null
}

type DirectCorrectionContext = {
  organizationId: string
  userId: string
  actor: WorkforceActor
  workdayId: string
  input: WorkforceDirectTimeCorrectionInput
  audit?: DirectCorrectionAuditContext
}

export type WorkforceDirectTimeCorrectionResult =
  | { kind: "success"; data: { correctionId: string; workday: WorkforceWorkdayCorrectionFacts }; idempotent: boolean }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "conflict"; code: string; message: string; currentWorkday?: WorkforceWorkdayCorrectionFacts }

class DirectCorrectionProblem extends Error {
  constructor(
    readonly result: Exclude<WorkforceDirectTimeCorrectionResult, { kind: "success" } | { kind: "forbidden" }>,
  ) {
    super(result.kind === "conflict" ? result.message : "Workday not found")
  }
}

const directCorrectionWorkdaySelect = {
  id: true,
  organizationId: true,
  agentId: true,
  workDate: true,
  status: true,
  startedAt: true,
  pausedAt: true,
  completedAt: true,
  totalPausedSeconds: true,
  updatedAt: true,
  agent: { select: { userId: true } },
} satisfies Prisma.MtmAgentWorkdaySelect

function requestHash(params: {
  workdayId: string
  actorUserId: string
  input: WorkforceDirectTimeCorrectionInput
}): string {
  const payload = {
    version: 1,
    workdayId: params.workdayId,
    actorUserId: params.actorUserId,
    operationId: params.input.operationId,
    expectedUpdatedAt: new Date(params.input.expectedUpdatedAt).toISOString(),
    startedAt: new Date(params.input.startedAt).toISOString(),
    completedAt: new Date(params.input.completedAt).toISOString(),
    reason: params.input.reason,
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

function historyConflict(message: string, currentWorkday?: WorkforceWorkdayCorrectionFacts): DirectCorrectionProblem {
  return new DirectCorrectionProblem({
    kind: "conflict",
    code: "WORKFORCE_TIME_CORRECTION_HISTORY_INVALID",
    message,
    ...(currentWorkday ? { currentWorkday } : {}),
  })
}

/**
 * Appends an immutable, idempotent manager correction to a closed workday.
 * The legacy event enum has no correction event, so the ledger is the only
 * correction fact; replayer validation proves it can still reproduce the
 * canonical journal plus every prior correction before the projection moves.
 */
export async function correctWorkforceTimeDirectly(
  context: DirectCorrectionContext,
): Promise<WorkforceDirectTimeCorrectionResult> {
  const { organizationId, userId, actor, workdayId, input, audit } = context
  if (actor.role === "AGENT") return { kind: "forbidden" }

  const initial = await prisma.mtmAgentWorkday.findFirst({
    where: { id: workdayId, organizationId },
    select: { id: true, agentId: true, agent: { select: { userId: true } } },
  })
  if (!initial) return { kind: "not_found" }
  // A manager's own time remains subject to the employee request path; this
  // endpoint is an auditable supervisor correction, not a self-edit bypass.
  // Web admins normally resolve without an agentId, so compare the target
  // employee's linked user as well as the actor's MTM-agent identity.
  if (
    actor.agentId === initial.agentId
    || initial.agent.userId === userId
    || !isAgentInWorkforceScope(actor, initial.agentId)
  ) {
    return { kind: "forbidden" }
  }

  const desiredStartedAt = new Date(input.startedAt)
  const desiredCompletedAt = new Date(input.completedAt)
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt)
  const immutableRequestHash = requestHash({ workdayId, actorUserId: userId, input })

  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Keep timestamp-without-time-zone legacy fields deterministic while
      // checking and persisting their canonical UTC ledger representation.
      await tx.$executeRaw`SELECT set_config('TimeZone', 'UTC', true)`
      // The operation key has tenant scope in the database uniqueness rule.
      // This second fence turns the unique constraint into deterministic replay
      // semantics even when two different employees receive the same key.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-direct-correction:${organizationId}:${input.operationId}`}))`

      const existing = await tx.workforceTimeCorrection.findFirst({
        where: { organizationId, operationId: input.operationId },
        select: {
          id: true,
          workdayId: true,
          agentId: true,
          source: true,
          actorUserId: true,
          requestHash: true,
        },
      })
      if (existing) {
        if (
          existing.source !== "DIRECT_MANAGER"
          || existing.workdayId !== workdayId
          || existing.agentId !== initial.agentId
          || existing.actorUserId !== userId
          || existing.requestHash !== immutableRequestHash
        ) {
          throw new DirectCorrectionProblem({
            kind: "conflict",
            code: "WORKFORCE_TIME_CORRECTION_IDEMPOTENCY_MISMATCH",
            message: "operationId was already used for a different manager time correction",
          })
        }
        await lockMtmWorkdayTransitions(tx, { organizationId, agentId: initial.agentId })
        const current = await tx.mtmAgentWorkday.findFirst({
          where: { id: workdayId, organizationId, agentId: initial.agentId },
          select: directCorrectionWorkdaySelect,
        })
        if (!current) throw new DirectCorrectionProblem({ kind: "not_found" })
        // Repeat the ownership check under the same transaction that returns
        // an idempotent result. A target employee may be linked to a user
        // after the non-locking preflight, and an admin must never turn that
        // small race into a self-edit acknowledgement.
        if (current.agent.userId === userId) return { kind: "forbidden" as const }
        return {
          kind: "success" as const,
          data: { correctionId: existing.id, workday: workforceWorkdayCorrectionFacts(current) },
          idempotent: true,
        }
      }

      await lockMtmWorkdayTransitions(tx, { organizationId, agentId: initial.agentId })
      const workday = await tx.mtmAgentWorkday.findFirst({
        where: { id: workdayId, organizationId, agentId: initial.agentId },
        select: directCorrectionWorkdaySelect,
      })
      if (!workday) throw new DirectCorrectionProblem({ kind: "not_found" })
      // Preflight covers the usual path; this locked read covers a concurrent
      // employee-user linkage change before the immutable fact is appended.
      if (workday.agent.userId === userId) return { kind: "forbidden" as const }

      const beforeWorkday = workforceWorkdayCorrectionFacts(workday)
      if (workday.status !== "COMPLETED" || !workday.completedAt) {
        throw new DirectCorrectionProblem({
          kind: "conflict",
          code: "WORKFORCE_TIME_CORRECTION_REQUIRES_COMPLETED_WORKDAY",
          message: "Direct manager correction is available only for a completed workday",
          currentWorkday: beforeWorkday,
        })
      }
      if (workday.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new DirectCorrectionProblem({
          kind: "conflict",
          code: "WORKFORCE_TIME_CORRECTION_VERSION_CONFLICT",
          message: "Workday changed since it was opened for correction",
          currentWorkday: beforeWorkday,
        })
      }
      if (
        workday.startedAt.getTime() === desiredStartedAt.getTime()
        && workday.completedAt.getTime() === desiredCompletedAt.getTime()
      ) {
        throw new DirectCorrectionProblem({
          kind: "conflict",
          code: "WORKFORCE_TIME_CORRECTION_NO_CHANGE",
          message: "Corrected times are identical to the completed workday",
          currentWorkday: beforeWorkday,
        })
      }

      const [events, corrections] = await Promise.all([
        tx.mtmAgentWorkdayEvent.findMany({
          where: { organizationId, agentId: initial.agentId, workdayId },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          select: { id: true, type: true, occurredAt: true },
        }),
        tx.workforceTimeCorrection.findMany({
          where: { organizationId, agentId: initial.agentId, workdayId },
          select: { id: true, beforeFacts: true, afterFacts: true },
        }),
      ])

      let replayed
      try {
        replayed = replayWorkforceWorkdayFacts({
          workdayId,
          events: events.map((event) => ({
            id: event.id,
            type: event.type as "START" | "PAUSE" | "RESUME" | "FINISH",
            occurredAt: event.occurredAt.toISOString(),
          })),
          corrections,
        })
      } catch (error) {
        if (error instanceof WorkforceWorkdayFactsReplayError) {
          throw historyConflict(error.message, beforeWorkday)
        }
        throw error
      }
      if (!workforceReplayMatchesWorkdayCorrectionFacts(replayed, beforeWorkday)) {
        throw historyConflict("Immutable workday journal does not match its current projection", beforeWorkday)
      }

      const afterWorkday: WorkforceWorkdayCorrectionFacts = {
        ...beforeWorkday,
        status: "COMPLETED",
        startedAt: desiredStartedAt.toISOString(),
        pausedAt: null,
        completedAt: desiredCompletedAt.toISOString(),
      }
      try {
        replayWorkforceWorkdayFacts({
          workdayId,
          events: events.map((event) => ({
            id: event.id,
            type: event.type as "START" | "PAUSE" | "RESUME" | "FINISH",
            occurredAt: event.occurredAt.toISOString(),
          })),
          corrections: [...corrections, {
            id: "pending-direct-correction",
            beforeFacts: beforeWorkday,
            afterFacts: afterWorkday,
          }],
        })
      } catch (error) {
        if (error instanceof WorkforceWorkdayFactsReplayError) {
          throw historyConflict(error.message, beforeWorkday)
        }
        throw error
      }

      const correction = await tx.workforceTimeCorrection.create({
        select: { id: true },
        data: {
          organizationId,
          workdayId,
          agentId: initial.agentId,
          source: "DIRECT_MANAGER",
          operationId: input.operationId,
          requestHash: immutableRequestHash,
          actorUserId: userId,
          reason: input.reason,
          beforeFacts: beforeWorkday,
          afterFacts: afterWorkday,
          occurredAt: new Date(),
        },
      })
      await tx.$executeRaw`SELECT set_config('app.workforce_correction_id', ${correction.id}, true)`
      await tx.mtmAgentWorkday.update({
        where: { id: workdayId },
        data: {
          startedAt: desiredStartedAt,
          completedAt: desiredCompletedAt,
        },
      })
      // This audit record is deliberately in the same transaction as the
      // immutable ledger and mutable projection. A successful correction can
      // never exist without its actor, reason and before/after evidence.
      await tx.mtmAuditLog.create({
        data: {
          organizationId,
          agentId: initial.agentId,
          action: "WORKFORCE_TIME_CORRECTION_APPLIED",
          entity: "workday",
          entityId: workdayId,
          metadataKind: "workforce_time_correction",
          oldData: { workday: beforeWorkday },
          newData: {
            workday: afterWorkday,
            actorUserId: userId,
            operationId: input.operationId,
            reason: input.reason,
            source: "DIRECT_MANAGER",
          },
          ipAddress: audit?.ipAddress ?? null,
          userAgent: audit?.userAgent ?? null,
        },
      })

      return {
        kind: "success" as const,
        data: { correctionId: correction.id, workday: afterWorkday },
        idempotent: false,
      }
    })
  } catch (error) {
    if (error instanceof DirectCorrectionProblem) return error.result
    throw error
  }
}
