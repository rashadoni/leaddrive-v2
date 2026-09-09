import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import type { MobileAuthResult } from "@/lib/mobile-auth"
import { parseMobileSyncV2DeviceId } from "@/lib/mtm/mobile-sync-v2"
import { prisma } from "@/lib/prisma"

/** A separate stream avoids changing the meaning of read-only `workforce` v2 sync. */
export const WORKFORCE_MOBILE_WRITE_COHORT_STREAM = "workforce-write"

const WorkforceMobileWriteFenceModeSchema = z.enum(["LEGACY_ALLOWED", "COHORT_ONLY", "FROZEN"])
const WorkforceMobileWriteExpirySchema = z.string().datetime({ offset: true }).optional().nullable()

export const WorkforceMobileWriteFenceUpdateSchema = z.object({
  mode: WorkforceMobileWriteFenceModeSchema,
}).strict()

export const WorkforceMobileWriteCohortUpsertSchema = z.object({
  agentId: z.string().trim().min(1).max(100),
  deviceId: z.string().trim().min(1).max(128),
  expiresAt: WorkforceMobileWriteExpirySchema,
}).strict()

export const WorkforceMobileWriteCohortDisableSchema = z.object({
  agentId: z.string().trim().min(1).max(100),
  deviceId: z.string().trim().min(1).max(128),
}).strict()

export type WorkforceMobileWriteFenceMode = z.infer<typeof WorkforceMobileWriteFenceModeSchema>
export type WorkforceMobileWriteFenceUpdate = z.infer<typeof WorkforceMobileWriteFenceUpdateSchema>
export type WorkforceMobileWriteCohortUpsert = z.infer<typeof WorkforceMobileWriteCohortUpsertSchema>
export type WorkforceMobileWriteCohortDisable = z.infer<typeof WorkforceMobileWriteCohortDisableSchema>

export type WorkforceMobileWriteAccess =
  | { allowed: true; mode: "LEGACY_ALLOWED" | "COHORT_ONLY"; deviceId: string | null; cohortEpoch: string | null }
  | { allowed: false; mode: "COHORT_ONLY" | "FROZEN"; code: string; message: string; deviceId: string | null }

type WorkforceMobileWriteFenceAuditContext = {
  ipAddress?: string | null
  userAgent?: string | null
}

export class WorkforceMobileWriteFenceError extends Error {
  constructor(
    message: string,
    readonly code:
      | "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED"
      | "WORKFORCE_MOBILE_WRITE_FENCE_LAST_COHORT"
      | "WORKFORCE_MOBILE_WRITE_FENCE_AGENT_NOT_FOUND"
      | "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_NOT_FOUND"
      | "WORKFORCE_MOBILE_WRITE_FENCE_DEVICE_INVALID"
      | "WORKFORCE_MOBILE_WRITE_FENCE_EXPIRY_INVALID",
  ) {
    super(message)
  }
}

function isMissingFenceTable(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === "P2021"
}

function activeCohortWhere(input: { organizationId: string; now: Date; agentId?: string }) {
  return {
    organizationId: input.organizationId,
    stream: WORKFORCE_MOBILE_WRITE_COHORT_STREAM,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    enabled: true,
    OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
  }
}

function deviceIdAuditFingerprint(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex")
}

function workforceMobileWriteFenceLockKey(organizationId: string): string {
  return `workforce-mobile-write-fence:${organizationId}`
}

/**
 * An exclusive control-plane lock serializes all tenant posture transitions.
 * Mobile mutations use the matching shared lock below, so a successful
 * FROZEN/cohort transition cannot race a previously permitted write into the
 * database after the transition commits.
 */
async function lockWorkforceMobileWriteFenceControlPlane(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workforceMobileWriteFenceLockKey(organizationId)}))`
}

/**
 * Holds a shared version of the control-plane lock until the mobile mutation
 * transaction finishes. PostgreSQL makes this conflict with the exclusive
 * control-plane lock above while allowing independent mobile writes to proceed
 * concurrently for the same tenant.
 */
async function lockWorkforceMobileWriteFenceMutation(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${workforceMobileWriteFenceLockKey(organizationId)}))`
}

type WorkforceMobileWriteFenceReader = Pick<
  Prisma.TransactionClient,
  "workforceMobileWriteFence" | "mtmMobileSyncCohort"
>

async function readWorkforceMobileWriteAccess(
  db: WorkforceMobileWriteFenceReader,
  input: {
    auth: Pick<MobileAuthResult, "orgId" | "agentId">
    deviceId: string | null
    now?: Date
  },
): Promise<WorkforceMobileWriteAccess> {
  const now = input.now ?? new Date()
  const deviceId = parseMobileSyncV2DeviceId(input.deviceId)
  let fence: { mode: WorkforceMobileWriteFenceMode } | null
  try {
    fence = await db.workforceMobileWriteFence.findUnique({
      where: { organizationId: input.auth.orgId },
      select: { mode: true },
    })
  } catch (error) {
    if (isMissingFenceTable(error)) {
      return { allowed: true, mode: "LEGACY_ALLOWED", deviceId, cohortEpoch: null }
    }
    throw error
  }

  if (!fence || fence.mode === "LEGACY_ALLOWED") {
    return { allowed: true, mode: "LEGACY_ALLOWED", deviceId, cohortEpoch: null }
  }
  if (fence.mode === "FROZEN") {
    return {
      allowed: false,
      mode: "FROZEN",
      code: "WORKFORCE_MOBILE_WRITE_FENCE_FROZEN",
      message: "Mobile Workforce writes are temporarily frozen for this tenant.",
      deviceId,
    }
  }

  const cohort = deviceId ? await db.mtmMobileSyncCohort.findFirst({
    where: { ...activeCohortWhere({ organizationId: input.auth.orgId, agentId: input.auth.agentId, now }), deviceId },
    select: { updatedAt: true },
  }) : null
  if (!cohort) {
    return {
      allowed: false,
      mode: "COHORT_ONLY",
      code: "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED",
      message: "This device is not enrolled for the current Workforce mobile write cohort.",
      deviceId,
    }
  }
  return {
    allowed: true,
    mode: "COHORT_ONLY",
    deviceId,
    cohortEpoch: cohort.updatedAt.toISOString(),
  }
}

/**
 * Reads the server-owned fence. An absent additive table/row means legacy is
 * allowed, so schema-first rollout cannot lock out existing mobile clients.
 * When called with the current mutation transaction, it first holds the shared
 * tenant lock through commit; this makes the permission decision linearizable
 * with an exclusive control-plane freeze or cohort change. Once a row is
 * `COHORT_ONLY` or `FROZEN`, any control-plane read error is propagated to the
 * caller and must fail the mutation closed.
 */
export async function evaluateWorkforceMobileWriteAccess(input: {
  auth: Pick<MobileAuthResult, "orgId" | "agentId">
  deviceId: string | null
  now?: Date
  tx?: Prisma.TransactionClient
}): Promise<WorkforceMobileWriteAccess> {
  if (input.tx) {
    await lockWorkforceMobileWriteFenceMutation(input.tx, input.auth.orgId)
  }
  return readWorkforceMobileWriteAccess(input.tx ?? prisma, input)
}

export function workforceMobileWriteFenceResponse(access: Exclude<WorkforceMobileWriteAccess, { allowed: true }>): NextResponse {
  return NextResponse.json({
    error: access.message,
    code: access.code,
    mode: access.mode,
  }, { status: 403 })
}

function activeCohortCount(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; now: Date; exceptId?: string },
) {
  return tx.mtmMobileSyncCohort.count({
    where: {
      ...activeCohortWhere(input),
      ...(input.exceptId ? { id: { not: input.exceptId } } : {}),
    },
  })
}

export async function setWorkforceMobileWriteFence(input: {
  organizationId: string
  actorUserId: string
  update: WorkforceMobileWriteFenceUpdate
  audit?: WorkforceMobileWriteFenceAuditContext
}): Promise<{ mode: WorkforceMobileWriteFenceMode; updatedAt: Date }> {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    await lockWorkforceMobileWriteFenceControlPlane(tx, input.organizationId)
    const existing = await tx.workforceMobileWriteFence.findUnique({
      where: { organizationId: input.organizationId },
      select: { mode: true },
    })
    if (input.update.mode === "COHORT_ONLY") {
      const count = await activeCohortCount(tx, { organizationId: input.organizationId, now })
      if (count === 0) {
        throw new WorkforceMobileWriteFenceError(
          "At least one active Workforce write cohort is required before cohort-only mode can be enabled",
          "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_REQUIRED",
        )
      }
    }
    const saved = existing
      ? await tx.workforceMobileWriteFence.update({
          where: { organizationId: input.organizationId },
          data: { mode: input.update.mode, updatedByUserId: input.actorUserId },
          select: { mode: true, updatedAt: true },
        })
      : await tx.workforceMobileWriteFence.create({
          data: {
            organizationId: input.organizationId,
            mode: input.update.mode,
            updatedByUserId: input.actorUserId,
          },
          select: { mode: true, updatedAt: true },
        })
    await tx.mtmAuditLog.create({
      data: {
        organizationId: input.organizationId,
        agentId: null,
        action: "WORKFORCE_MOBILE_WRITE_FENCE_SET",
        entity: "workforce_mobile_write_fence",
        entityId: input.organizationId,
        metadataKind: "workforce_mobile_write_fence",
        ...(existing ? { oldData: { mode: existing.mode } } : {}),
        newData: { mode: saved.mode, actorUserId: input.actorUserId },
        ipAddress: input.audit?.ipAddress ?? null,
        userAgent: input.audit?.userAgent ?? null,
      },
    })
    return saved
  })
}

function parseCohortExpiry(value: string | null | undefined, now: Date): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
    throw new WorkforceMobileWriteFenceError(
      "Cohort expiration must be a future timestamp",
      "WORKFORCE_MOBILE_WRITE_FENCE_EXPIRY_INVALID",
    )
  }
  return parsed
}

export async function upsertWorkforceMobileWriteCohort(input: {
  organizationId: string
  actorUserId: string
  cohort: WorkforceMobileWriteCohortUpsert
  audit?: WorkforceMobileWriteFenceAuditContext
}): Promise<{ id: string; agentId: string; deviceId: string; enabled: boolean; expiresAt: Date | null; updatedAt: Date }> {
  const deviceId = parseMobileSyncV2DeviceId(input.cohort.deviceId)
  if (!deviceId) {
    throw new WorkforceMobileWriteFenceError(
      "deviceId must be a stable Field device identifier",
      "WORKFORCE_MOBILE_WRITE_FENCE_DEVICE_INVALID",
    )
  }
  const now = new Date()
  const expiresAt = parseCohortExpiry(input.cohort.expiresAt, now)
  return prisma.$transaction(async (tx) => {
    await lockWorkforceMobileWriteFenceControlPlane(tx, input.organizationId)
    const employee = await tx.mtmAgent.findFirst({
      where: { id: input.cohort.agentId, organizationId: input.organizationId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!employee) {
      throw new WorkforceMobileWriteFenceError(
        "Active Workforce employee was not found",
        "WORKFORCE_MOBILE_WRITE_FENCE_AGENT_NOT_FOUND",
      )
    }
    const existing = await tx.mtmMobileSyncCohort.findFirst({
      where: {
        organizationId: input.organizationId,
        stream: WORKFORCE_MOBILE_WRITE_COHORT_STREAM,
        agentId: employee.id,
        deviceId,
      },
      select: { id: true, enabled: true, expiresAt: true },
    })
    const saved = existing
      ? await tx.mtmMobileSyncCohort.update({
          where: { id: existing.id },
          data: { enabled: true, expiresAt },
          select: { id: true, agentId: true, deviceId: true, enabled: true, expiresAt: true, updatedAt: true },
        })
      : await tx.mtmMobileSyncCohort.create({
          data: {
            organizationId: input.organizationId,
            stream: WORKFORCE_MOBILE_WRITE_COHORT_STREAM,
            agentId: employee.id,
            deviceId,
            enabled: true,
            expiresAt,
          },
          select: { id: true, agentId: true, deviceId: true, enabled: true, expiresAt: true, updatedAt: true },
        })
    await tx.mtmAuditLog.create({
      data: {
        organizationId: input.organizationId,
        agentId: employee.id,
        action: "WORKFORCE_MOBILE_WRITE_COHORT_ENABLED",
        entity: "workforce_mobile_write_cohort",
        entityId: saved.id,
        metadataKind: "workforce_mobile_write_cohort",
        ...(existing ? {
          oldData: {
            enabled: existing.enabled,
            expiresAt: existing.expiresAt?.toISOString() ?? null,
          },
        } : {}),
        newData: {
          enabled: true,
          expiresAt: saved.expiresAt?.toISOString() ?? null,
          deviceIdHash: deviceIdAuditFingerprint(deviceId),
          actorUserId: input.actorUserId,
        },
        ipAddress: input.audit?.ipAddress ?? null,
        userAgent: input.audit?.userAgent ?? null,
      },
    })
    return saved
  })
}

export async function disableWorkforceMobileWriteCohort(input: {
  organizationId: string
  actorUserId: string
  cohort: WorkforceMobileWriteCohortDisable
  audit?: WorkforceMobileWriteFenceAuditContext
}): Promise<{ id: string; agentId: string; deviceId: string; enabled: boolean; expiresAt: Date | null; updatedAt: Date }> {
  const deviceId = parseMobileSyncV2DeviceId(input.cohort.deviceId)
  if (!deviceId) {
    throw new WorkforceMobileWriteFenceError(
      "deviceId must be a stable Field device identifier",
      "WORKFORCE_MOBILE_WRITE_FENCE_DEVICE_INVALID",
    )
  }
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    await lockWorkforceMobileWriteFenceControlPlane(tx, input.organizationId)
    const existing = await tx.mtmMobileSyncCohort.findFirst({
      where: {
        organizationId: input.organizationId,
        stream: WORKFORCE_MOBILE_WRITE_COHORT_STREAM,
        agentId: input.cohort.agentId,
        deviceId,
      },
      select: { id: true, agentId: true, deviceId: true, enabled: true, expiresAt: true },
    })
    if (!existing) {
      throw new WorkforceMobileWriteFenceError(
        "Workforce mobile write cohort was not found",
        "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_NOT_FOUND",
      )
    }
    const fence = await tx.workforceMobileWriteFence.findUnique({
      where: { organizationId: input.organizationId },
      select: { mode: true },
    })
    const targetActive = existing.enabled && (!existing.expiresAt || existing.expiresAt > now)
    if (fence?.mode === "COHORT_ONLY" && targetActive) {
      const others = await activeCohortCount(tx, {
        organizationId: input.organizationId,
        now,
        exceptId: existing.id,
      })
      if (others === 0) {
        throw new WorkforceMobileWriteFenceError(
          "Switch the tenant to legacy-allowed or frozen mode before disabling its final active Workforce write cohort",
          "WORKFORCE_MOBILE_WRITE_FENCE_LAST_COHORT",
        )
      }
    }
    const saved = await tx.mtmMobileSyncCohort.update({
      where: { id: existing.id },
      data: { enabled: false },
      select: { id: true, agentId: true, deviceId: true, enabled: true, expiresAt: true, updatedAt: true },
    })
    await tx.mtmAuditLog.create({
      data: {
        organizationId: input.organizationId,
        agentId: existing.agentId,
        action: "WORKFORCE_MOBILE_WRITE_COHORT_DISABLED",
        entity: "workforce_mobile_write_cohort",
        entityId: existing.id,
        metadataKind: "workforce_mobile_write_cohort",
        oldData: { enabled: existing.enabled, expiresAt: existing.expiresAt?.toISOString() ?? null },
        newData: { enabled: false, deviceIdHash: deviceIdAuditFingerprint(deviceId), actorUserId: input.actorUserId },
        ipAddress: input.audit?.ipAddress ?? null,
        userAgent: input.audit?.userAgent ?? null,
      },
    })
    return saved
  })
}

/** Session-admin read model; device IDs never enter generic audit metadata. */
export async function getWorkforceMobileWriteFenceConfiguration(organizationId: string) {
  const [fence, cohorts] = await Promise.all([
    prisma.workforceMobileWriteFence.findUnique({
      where: { organizationId },
      select: { mode: true, updatedByUserId: true, createdAt: true, updatedAt: true },
    }),
    prisma.mtmMobileSyncCohort.findMany({
      where: { organizationId, stream: WORKFORCE_MOBILE_WRITE_COHORT_STREAM },
      orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
      take: 200,
      select: { id: true, agentId: true, deviceId: true, enabled: true, expiresAt: true, updatedAt: true },
    }),
  ])
  return {
    fence: fence ?? { mode: "LEGACY_ALLOWED" as const, updatedByUserId: null, createdAt: null, updatedAt: null },
    cohorts,
    cohortLimit: 200,
  }
}
