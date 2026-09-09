import { randomUUID } from "node:crypto"
import { hashCanonicalJson } from "./canonical-json"
import { ProjectionControlConflictError } from "./errors"

export type ProjectionBuildMode = "live" | "shadow" | "replay"
export type ProjectionBuildStatus =
  | "pending"
  | "running"
  | "verifying"
  | "ready"
  | "promoted"
  | "failed"
  | "abandoned"

type JsonRecord = Record<string, unknown>

interface ProjectionControlTransaction {
  projectionBuild: {
    findUnique(args: Record<string, unknown>): Promise<JsonRecord | null>
    create(args: Record<string, unknown>): Promise<JsonRecord>
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>
  }
  projectionActivation: {
    findUnique(args: Record<string, unknown>): Promise<JsonRecord | null>
    create(args: Record<string, unknown>): Promise<JsonRecord>
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>
  }
  projectionPromotionEvent: {
    findUnique(args: Record<string, unknown>): Promise<JsonRecord | null>
    create(args: Record<string, unknown>): Promise<JsonRecord>
  }
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

export interface CreateProjectionBuildInput {
  organizationId: string
  projectionName: string
  projectionVersion: number
  buildKey: string
  codeSha: string
  mode: ProjectionBuildMode
  replayFrom?: Date
  replayTo?: Date
}

export async function createProjectionBuild(
  tx: ProjectionControlTransaction,
  input: CreateProjectionBuildInput,
): Promise<JsonRecord> {
  if (!input.organizationId || !input.projectionName || !input.buildKey) {
    throw new TypeError("projection build identity is required")
  }
  if (!Number.isInteger(input.projectionVersion) || input.projectionVersion < 1) {
    throw new RangeError("projectionVersion must be a positive integer")
  }
  if (!/^[0-9a-f]{40}$/.test(input.codeSha)) throw new TypeError("codeSha must be a full lowercase Git SHA")
  if (input.replayFrom && input.replayTo && input.replayTo < input.replayFrom) {
    throw new RangeError("replayTo cannot precede replayFrom")
  }
  if (input.mode === "live" && (input.replayFrom || input.replayTo)) {
    throw new TypeError("live projection builds cannot declare a replay range")
  }

  return tx.projectionBuild.create({
    data: {
      id: randomUUID(),
      ...input,
      effectsFenced: input.mode !== "live",
      status: "pending",
      evidence: {},
    },
  })
}

const TRANSITIONS: Record<ProjectionBuildStatus, readonly ProjectionBuildStatus[]> = {
  pending: ["running", "failed", "abandoned"],
  running: ["verifying", "failed", "abandoned"],
  verifying: ["ready", "failed", "abandoned"],
  ready: ["promoted", "failed", "abandoned"],
  promoted: [],
  failed: [],
  abandoned: [],
}

export async function transitionProjectionBuild(
  tx: ProjectionControlTransaction,
  input: {
    organizationId: string
    buildId: string
    from: ProjectionBuildStatus
    to: ProjectionBuildStatus
    evidence?: JsonRecord
    now?: Date
  },
): Promise<void> {
  if (!TRANSITIONS[input.from].includes(input.to)) {
    throw new ProjectionControlConflictError(`Invalid projection transition ${input.from} -> ${input.to}`)
  }
  if (input.to === "promoted") {
    throw new ProjectionControlConflictError("Use promoteProjectionBuild for atomic pointer promotion")
  }

  const now = input.now ?? new Date()
  const data: JsonRecord = { status: input.to }
  if (input.to === "running") data.startedAt = now
  if (input.to === "ready") data.completedAt = now
  if (input.evidence) data.evidence = input.evidence

  const changed = await tx.projectionBuild.updateMany({
    where: { id: input.buildId, organizationId: input.organizationId, status: input.from },
    data,
  })
  if (changed.count !== 1) throw new ProjectionControlConflictError()
}

export async function recordProjectionCheckpoint(
  tx: ProjectionControlTransaction,
  input: {
    organizationId: string
    buildId: string
    sourceTopic: string
    sourcePartition: number
    sourceOffset: bigint
    lastEventId?: string
  },
): Promise<void> {
  if (!input.sourceTopic) throw new TypeError("sourceTopic is required")
  if (!Number.isInteger(input.sourcePartition) || input.sourcePartition < 0 || input.sourceOffset < 0n) {
    throw new RangeError("projection checkpoint position cannot be negative")
  }

  const changed = await tx.$executeRawUnsafe(
    `INSERT INTO "projection_checkpoints"
       ("id", "organizationId", "buildId", "sourceTopic", "sourcePartition", "sourceOffset", "lastEventId", "updatedAt")
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::uuid, CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId", "buildId", "sourceTopic", "sourcePartition")
     DO UPDATE SET "sourceOffset" = EXCLUDED."sourceOffset",
                   "lastEventId" = EXCLUDED."lastEventId",
                   "updatedAt" = CURRENT_TIMESTAMP
       WHERE "projection_checkpoints"."sourceOffset" < EXCLUDED."sourceOffset"
          OR ("projection_checkpoints"."sourceOffset" = EXCLUDED."sourceOffset"
              AND "projection_checkpoints"."lastEventId" IS NOT DISTINCT FROM EXCLUDED."lastEventId")`,
    randomUUID(),
    input.organizationId,
    input.buildId,
    input.sourceTopic,
    input.sourcePartition,
    input.sourceOffset,
    input.lastEventId ?? null,
  )
  if (changed !== 1) throw new ProjectionControlConflictError("Projection checkpoint cannot move backward or change event identity")
}

export async function promoteProjectionBuild(
  tx: ProjectionControlTransaction,
  input: {
    organizationId: string
    projectionName: string
    targetBuildId: string
    requestKey: string
    requestedBy: string
    approvedBy: string
    evidence: JsonRecord
    action?: "promote" | "rollback"
    now?: Date
  },
): Promise<{ duplicate: boolean; pointerVersion: bigint }> {
  if (!input.requestKey || !input.requestedBy || !input.approvedBy) throw new TypeError("promotion identity is required")
  if (input.requestedBy === input.approvedBy) {
    throw new ProjectionControlConflictError("Projection promotion requires a different approver")
  }
  const action = input.action ?? "promote"
  const evidenceHash = hashCanonicalJson({
    action,
    organizationId: input.organizationId,
    projectionName: input.projectionName,
    targetBuildId: input.targetBuildId,
    requestKey: input.requestKey,
    requestedBy: input.requestedBy,
    approvedBy: input.approvedBy,
    evidence: input.evidence,
  })

  const duplicate = await tx.projectionPromotionEvent.findUnique({
    where: {
      organizationId_projectionName_requestKey: {
        organizationId: input.organizationId,
        projectionName: input.projectionName,
        requestKey: input.requestKey,
      },
    },
  })
  if (duplicate) {
    if (duplicate.evidenceHash !== evidenceHash || duplicate.targetBuildId !== input.targetBuildId) {
      throw new ProjectionControlConflictError("Projection promotion request key was reused with different evidence")
    }
    return { duplicate: true, pointerVersion: BigInt(duplicate.resultingPointerVersion as bigint | number | string) }
  }

  const target = await tx.projectionBuild.findUnique({
    where: { organizationId_id: { organizationId: input.organizationId, id: input.targetBuildId } },
  })
  if (!target || target.projectionName !== input.projectionName || target.effectsFenced !== true) {
    throw new ProjectionControlConflictError("Target build is not an effect-fenced build of this projection")
  }

  const now = input.now ?? new Date()
  if (action === "promote") {
    const promoted = await tx.projectionBuild.updateMany({
      where: { id: input.targetBuildId, organizationId: input.organizationId, status: "ready", effectsFenced: true },
      data: { status: "promoted", promotedAt: now },
    })
    if (promoted.count !== 1) throw new ProjectionControlConflictError("Only a ready build can be promoted")
  } else if (target.status !== "promoted") {
    throw new ProjectionControlConflictError("Rollback target must be a previously promoted build")
  }

  const pointer = await tx.projectionActivation.findUnique({
    where: {
      organizationId_projectionName: {
        organizationId: input.organizationId,
        projectionName: input.projectionName,
      },
    },
  })
  const previousBuildId = typeof pointer?.activeBuildId === "string" ? pointer.activeBuildId : null
  if (previousBuildId === input.targetBuildId) throw new ProjectionControlConflictError("Target build is already active")
  const pointerVersion = pointer ? BigInt(pointer.activationVersion as bigint | number | string) + 1n : 1n

  await tx.projectionPromotionEvent.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      projectionName: input.projectionName,
      targetBuildId: input.targetBuildId,
      previousBuildId,
      action,
      requestKey: input.requestKey,
      requestedBy: input.requestedBy,
      approvedBy: input.approvedBy,
      evidenceHash,
      evidence: input.evidence,
      resultingPointerVersion: pointerVersion,
    },
  })

  if (!pointer) {
    await tx.projectionActivation.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        projectionName: input.projectionName,
        activeBuildId: input.targetBuildId,
        activationVersion: pointerVersion,
        activatedAt: now,
      },
    })
  } else {
    const changed = await tx.projectionActivation.updateMany({
      where: {
        id: pointer.id,
        organizationId: input.organizationId,
        projectionName: input.projectionName,
        activeBuildId: previousBuildId,
        activationVersion: pointer.activationVersion,
      },
      data: { activeBuildId: input.targetBuildId, activationVersion: pointerVersion, activatedAt: now },
    })
    if (changed.count !== 1) throw new ProjectionControlConflictError("Projection pointer changed concurrently")
  }

  return { duplicate: false, pointerVersion }
}
