import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import {
  mintWorkforceAttendanceQr,
  validateWorkforceDevicePublicKey,
  verifyWorkforceDeviceSignature,
  workforceDeviceEnrollmentChallenge,
  workforceDeviceEnrollmentChallengeFingerprint,
} from "@/lib/workforce/attendance-security"
import { WorkforceAttendanceActionSchema, type WorkforceAttendanceAction } from "@/lib/workforce/attendance-policy"
import { newWorkforceAttendanceEnrollmentChallenge } from "@/lib/workforce/attendance-trust"

const IDENTIFIER = /^[A-Za-z0-9_-]{1,100}$/
const ENROLLMENT_CHALLENGE_TTL_MS = 5 * 60 * 1000

/** Audit context belongs to the authenticated human administrator, never an
 * API-key creator or mobile payload. It intentionally excludes QR tokens and
 * public-key material. */
export type WorkforceAttendanceAuditContext = {
  actorUserId: string
  ipAddress?: string | null
  userAgent?: string | null
}

function attendanceAuditData(input: {
  id: string
  agentId?: string | null
  code?: string
  name?: string
  deviceLabel?: string
  publicKeyFingerprint?: string
  status: string
  rotationSeconds?: number
  siteId?: string | null
  geofenceRevisionId?: string | null
  areaLabel?: string | null
  effectiveFrom?: Date | null
  effectiveTo?: Date | null
  replacesEnrollmentId?: string | null
}, audit: WorkforceAttendanceAuditContext): Prisma.InputJsonObject {
  return {
    actorUserId: audit.actorUserId,
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    ...(input.code === undefined ? {} : { code: input.code }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.deviceLabel === undefined ? {} : { deviceLabel: input.deviceLabel }),
    ...(input.publicKeyFingerprint === undefined ? {} : { publicKeyFingerprint: input.publicKeyFingerprint }),
    ...(input.rotationSeconds === undefined ? {} : { rotationSeconds: input.rotationSeconds }),
    ...(input.siteId === undefined ? {} : { siteId: input.siteId }),
    ...(input.geofenceRevisionId === undefined ? {} : { geofenceRevisionId: input.geofenceRevisionId }),
    ...(input.areaLabel === undefined ? {} : { areaLabel: input.areaLabel }),
    ...(input.effectiveFrom === undefined ? {} : { effectiveFrom: input.effectiveFrom?.toISOString() ?? null }),
    ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo?.toISOString() ?? null }),
    ...(input.replacesEnrollmentId === undefined ? {} : { replacesEnrollmentId: input.replacesEnrollmentId }),
    status: input.status,
  }
}

export const WorkforceAttendanceStationCreateSchema = z.object({
  code: z.string().trim().min(1).max(64).regex(IDENTIFIER, "Station code must use letters, numbers, _ or -"),
  name: z.string().trim().min(1).max(120),
  rotationSeconds: z.number().int().min(30).max(300).optional(),
  siteId: z.string().trim().regex(IDENTIFIER),
  /** Named sub-area is Workforce-local descriptive context, not geometry. */
  areaLabel: z.string().trim().min(1).max(120).nullable().optional(),
  geofenceRevisionId: z.string().trim().regex(IDENTIFIER),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (Number.isNaN(value.effectiveFrom.getTime())) {
    context.addIssue({ code: "custom", path: ["effectiveFrom"], message: "effectiveFrom must be a valid timestamp" })
  }
  if (value.effectiveTo != null && Number.isNaN(value.effectiveTo.getTime())) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must be a valid timestamp" })
  }
  if (value.effectiveTo != null && value.effectiveTo <= value.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must be after effectiveFrom" })
  }
})

export const WorkforceAttendanceEnrollmentCreateSchema = z.object({
  deviceLabel: z.string().trim().min(1).max(120),
  publicKeySpki: z.string().trim().min(1).max(8192),
  replacesEnrollmentId: z.string().trim().regex(IDENTIFIER).optional(),
}).strict()

export const WorkforceAttendanceEnrollmentProofSchema = z.object({
  challenge: z.string().regex(/^[A-Za-z0-9_-]{24,256}$/),
  signature: z.string().trim().min(1).max(8192),
}).strict()

export class WorkforceAttendanceManagementError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_ATTENDANCE_STATION_NOT_FOUND"
      | "WORKFORCE_ATTENDANCE_STATION_DISABLED"
      | "WORKFORCE_ATTENDANCE_STATION_CODE_DUPLICATE"
      | "WORKFORCE_ATTENDANCE_STATION_SITE_INVALID"
      | "WORKFORCE_ATTENDANCE_STATION_GEOFENCE_INVALID"
      | "WORKFORCE_ATTENDANCE_STATION_NOT_EFFECTIVE"
      | "WORKFORCE_ATTENDANCE_ENROLLMENT_NOT_FOUND"
      | "WORKFORCE_ATTENDANCE_ENROLLMENT_REPLACEMENT_INVALID"
      | "WORKFORCE_ATTENDANCE_ENROLLMENT_DUPLICATE_KEY"
      | "WORKFORCE_ATTENDANCE_ENROLLMENT_KEY_INVALID"
      | "WORKFORCE_ATTENDANCE_ENROLLMENT_PROOF_INVALID"
      | "WORKFORCE_ATTENDANCE_ENROLLMENT_CHALLENGE_INVALID"
      | "WORKFORCE_ATTENDANCE_ENROLLMENT_APPROVAL_INVALID"
      | "WORKFORCE_ATTENDANCE_ENROLLMENT_REVOKE_INVALID",
    message: string = code,
  ) {
    super(message)
  }
}

function uniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002"
}

export async function createWorkforceAttendanceQrStation(
  db: PrismaClient,
  input: {
    organizationId: string
    createdByUserId: string
    audit: WorkforceAttendanceAuditContext
    code: string
    name: string
    rotationSeconds?: number
    siteId: string
    areaLabel?: string | null
    geofenceRevisionId: string
    effectiveFrom: Date
    effectiveTo?: Date | null
  },
) {
  try {
    return await db.$transaction(async (tx) => {
      const site = await tx.workforceSite.findFirst({
        where: { id: input.siteId, organizationId: input.organizationId, status: "ACTIVE" },
        select: { id: true },
      })
      if (!site) {
        throw new WorkforceAttendanceManagementError(
          "WORKFORCE_ATTENDANCE_STATION_SITE_INVALID",
          "The Workforce site is unavailable for this QR station",
        )
      }
      const geofence = await tx.workforceSiteGeofenceRevision.findFirst({
        where: {
          id: input.geofenceRevisionId,
          organizationId: input.organizationId,
          siteId: input.siteId,
          effectiveFrom: { lte: input.effectiveFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.effectiveFrom } }],
        },
        select: { id: true },
      })
      if (!geofence) {
        throw new WorkforceAttendanceManagementError(
          "WORKFORCE_ATTENDANCE_STATION_GEOFENCE_INVALID",
          "The selected site geofence revision is unavailable for this QR station",
        )
      }
      const station = await tx.workforceAttendanceQrStation.create({
        data: {
          organizationId: input.organizationId,
          createdByUserId: input.createdByUserId,
          code: input.code,
          name: input.name,
          rotationSeconds: input.rotationSeconds ?? 60,
          siteId: input.siteId,
          areaLabel: input.areaLabel ?? null,
          geofenceRevisionId: input.geofenceRevisionId,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
        },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          rotationSeconds: true,
          siteId: true,
          areaLabel: true,
          geofenceRevisionId: true,
          effectiveFrom: true,
          effectiveTo: true,
          createdAt: true,
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: null,
          action: "WORKFORCE_ATTENDANCE_QR_STATION_CREATED",
          entity: "workforce_attendance_qr_station",
          entityId: station.id,
          metadataKind: "workforce_attendance_security",
          newData: attendanceAuditData(station, input.audit),
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return station
    })
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_STATION_CODE_DUPLICATE",
        "This attendance QR station code already exists",
      )
    }
    throw error
  }
}

export async function disableWorkforceAttendanceQrStation(
  db: PrismaClient,
  input: {
    organizationId: string
    stationId: string
    disabledByUserId: string
    audit: WorkforceAttendanceAuditContext
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    const station = await tx.workforceAttendanceQrStation.findFirst({
      where: { id: input.stationId, organizationId: input.organizationId },
      select: { id: true, code: true, name: true, status: true, rotationSeconds: true },
    })
    if (!station) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_STATION_NOT_FOUND",
        "Attendance QR station was not found",
      )
    }
    if (station.status !== "ACTIVE") {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_STATION_DISABLED",
        "Attendance QR station is already disabled",
      )
    }
    const changed = await tx.workforceAttendanceQrStation.updateMany({
      where: { id: input.stationId, organizationId: input.organizationId, status: "ACTIVE" },
      data: { status: "DISABLED", disabledByUserId: input.disabledByUserId, disabledAt: now },
    })
    if (changed.count !== 1) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_STATION_DISABLED",
        "Attendance QR station changed concurrently",
      )
    }
    await tx.mtmAuditLog.create({
      data: {
        organizationId: input.organizationId,
        agentId: null,
        action: "WORKFORCE_ATTENDANCE_QR_STATION_DISABLED",
        entity: "workforce_attendance_qr_station",
        entityId: station.id,
        metadataKind: "workforce_attendance_security",
        oldData: attendanceAuditData(station, input.audit),
        newData: attendanceAuditData({ ...station, status: "DISABLED" }, input.audit),
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      },
    })
  })
}

export async function issueWorkforceAttendanceQr(
  db: PrismaClient,
  input: { organizationId: string; stationId: string; action: WorkforceAttendanceAction; now?: Date },
) {
  const now = input.now ?? new Date()
  if (!WorkforceAttendanceActionSchema.safeParse(input.action).success) {
    throw new WorkforceAttendanceManagementError(
      "WORKFORCE_ATTENDANCE_STATION_NOT_EFFECTIVE",
      "Attendance QR action is invalid",
    )
  }
  const station = await db.workforceAttendanceQrStation.findFirst({
    where: {
      id: input.stationId,
      organizationId: input.organizationId,
      siteId: { not: null },
      geofenceRevisionId: { not: null },
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      rotationSeconds: true,
      siteId: true,
      areaLabel: true,
      geofenceRevisionId: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  })
  if (!station) {
    throw new WorkforceAttendanceManagementError(
      "WORKFORCE_ATTENDANCE_STATION_NOT_FOUND",
      "Attendance QR station was not found",
    )
  }
  if (station.status !== "ACTIVE") {
    throw new WorkforceAttendanceManagementError(
      "WORKFORCE_ATTENDANCE_STATION_DISABLED",
      "Attendance QR station is disabled",
    )
  }
  if (station.siteId == null || station.geofenceRevisionId == null) {
    throw new WorkforceAttendanceManagementError(
      "WORKFORCE_ATTENDANCE_STATION_NOT_EFFECTIVE",
      "Attendance QR station is not bound to an active site revision",
    )
  }
  const expiresAt = new Date(now.getTime() + station.rotationSeconds * 1000)
  return {
    station: {
      id: station.id,
      code: station.code,
      name: station.name,
      rotationSeconds: station.rotationSeconds,
      siteId: station.siteId,
      areaLabel: station.areaLabel,
      geofenceRevisionId: station.geofenceRevisionId,
      effectiveFrom: station.effectiveFrom,
      effectiveTo: station.effectiveTo,
    },
    token: mintWorkforceAttendanceQr({
      organizationId: input.organizationId,
      stationId: station.id,
      siteId: station.siteId,
      geofenceRevisionId: station.geofenceRevisionId,
      action: input.action,
      now,
      expiresAt,
    }),
    expiresAt,
  }
}

export async function beginWorkforceAttendanceDeviceEnrollment(
  db: PrismaClient,
  input: {
    organizationId: string
    agentId: string
    deviceLabel: string
    publicKeySpki: string
    replacesEnrollmentId?: string
    now?: Date
  },
) {
  let key: ReturnType<typeof validateWorkforceDevicePublicKey>
  try {
    key = validateWorkforceDevicePublicKey(input.publicKeySpki)
  } catch {
    throw new WorkforceAttendanceManagementError(
      "WORKFORCE_ATTENDANCE_ENROLLMENT_KEY_INVALID",
      "The device public key must be a P-256 SPKI key",
    )
  }
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + ENROLLMENT_CHALLENGE_TTL_MS)
  const enrollmentId = randomUUID()
  const challenge = newWorkforceAttendanceEnrollmentChallenge()
  const challengeFingerprint = workforceDeviceEnrollmentChallengeFingerprint(input.organizationId, challenge)

  try {
    return await db.$transaction(async (tx) => {
      // The database uniqueness rule remains the final backstop, but serialize
      // same-key retries before the resumable lookup. Otherwise two lost mobile
      // responses can both observe no pending row and leave one caller with a
      // duplicate-key error instead of the fresh challenge it needs to resume.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-attendance-enrollment:${input.organizationId}:${key.fingerprint}`}))`
      if (input.replacesEnrollmentId) {
        const replaced = await tx.workforceAttendanceDeviceEnrollment.findFirst({
          where: {
            id: input.replacesEnrollmentId,
            organizationId: input.organizationId,
            agentId: input.agentId,
            status: "ACTIVE",
          },
          select: { id: true },
        })
        if (!replaced) {
          throw new WorkforceAttendanceManagementError(
            "WORKFORCE_ATTENDANCE_ENROLLMENT_REPLACEMENT_INVALID",
            "The device selected for replacement is not active for this employee",
          )
        }
      }

      // A mobile network can drop after the enrollment row commits but before
      // the caller receives its id/challenge. Reuse only the same employee's
      // still-unverified pending key, invalidate its old one-time challenge,
      // and issue a fresh proof challenge. This never promotes a device or
      // changes a requested replacement target.
      const resumable = await tx.workforceAttendanceDeviceEnrollment.findFirst({
        where: {
          organizationId: input.organizationId,
          agentId: input.agentId,
          publicKeyFingerprint: key.fingerprint,
          status: "PENDING",
          keyVerifiedAt: null,
          replacesEnrollmentId: input.replacesEnrollmentId ?? null,
        },
        select: {
          id: true,
          deviceLabel: true,
          publicKeyFingerprint: true,
          status: true,
          createdAt: true,
        },
      })
      if (resumable) {
        await tx.workforceAttendanceDeviceEnrollmentChallenge.updateMany({
          where: {
            organizationId: input.organizationId,
            enrollmentId: resumable.id,
            consumedAt: null,
            expiresAt: { gt: now },
          },
          // Challenge records are immutable except for their one-way
          // consumedAt marker. Consume a still-live old challenge instead of
          // rewriting its expiry, then issue the fresh one below.
          data: { consumedAt: now },
        })
        await tx.workforceAttendanceDeviceEnrollmentChallenge.create({
          data: {
            organizationId: input.organizationId,
            enrollmentId: resumable.id,
            challengeFingerprint,
            expiresAt,
          },
        })
        return { enrollment: resumable, challenge, expiresAt, resumed: true }
      }

      const enrollment = await tx.workforceAttendanceDeviceEnrollment.create({
        data: {
          id: enrollmentId,
          organizationId: input.organizationId,
          agentId: input.agentId,
          deviceLabel: input.deviceLabel,
          publicKeySpki: input.publicKeySpki,
          publicKeyFingerprint: key.fingerprint,
          ...(input.replacesEnrollmentId ? { replacesEnrollmentId: input.replacesEnrollmentId } : {}),
        },
        select: {
          id: true,
          deviceLabel: true,
          publicKeyFingerprint: true,
          status: true,
          createdAt: true,
        },
      })
      await tx.workforceAttendanceDeviceEnrollmentChallenge.create({
        data: {
          organizationId: input.organizationId,
          enrollmentId,
          challengeFingerprint,
          expiresAt,
        },
      })
      return { enrollment, challenge, expiresAt, resumed: false }
    })
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_ENROLLMENT_DUPLICATE_KEY",
        "This device key is already registered for the tenant",
      )
    }
    throw error
  }
}

export async function proveWorkforceAttendanceDeviceEnrollment(
  db: PrismaClient,
  input: {
    organizationId: string
    agentId: string
    enrollmentId: string
    challenge: string
    signature: string
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  const challengeFingerprint = workforceDeviceEnrollmentChallengeFingerprint(input.organizationId, input.challenge)
  return db.$transaction(async (tx) => {
    const pending = await tx.workforceAttendanceDeviceEnrollmentChallenge.findFirst({
      where: {
        organizationId: input.organizationId,
        enrollmentId: input.enrollmentId,
        challengeFingerprint,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        enrollment: {
          select: {
            id: true,
            agentId: true,
            status: true,
            keyVerifiedAt: true,
            publicKeySpki: true,
          },
        },
      },
    })
    if (!pending || pending.enrollment.agentId !== input.agentId || pending.enrollment.status !== "PENDING") {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_ENROLLMENT_CHALLENGE_INVALID",
        "This enrollment challenge is unavailable or expired",
      )
    }
    const signed = workforceDeviceEnrollmentChallenge({
      organizationId: input.organizationId,
      agentId: input.agentId,
      enrollmentId: input.enrollmentId,
      challenge: input.challenge,
    })
    if (!verifyWorkforceDeviceSignature({
      publicKeySpkiBase64: pending.enrollment.publicKeySpki,
      challenge: signed,
      signatureBase64: input.signature,
    })) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_ENROLLMENT_PROOF_INVALID",
        "The device enrollment signature is invalid",
      )
    }
    const consumed = await tx.workforceAttendanceDeviceEnrollmentChallenge.updateMany({
      where: { id: pending.id, organizationId: input.organizationId, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    })
    if (consumed.count !== 1) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_ENROLLMENT_CHALLENGE_INVALID",
        "This enrollment challenge was already used",
      )
    }
    const verified = await tx.workforceAttendanceDeviceEnrollment.updateMany({
      where: {
        id: input.enrollmentId,
        organizationId: input.organizationId,
        agentId: input.agentId,
        status: "PENDING",
        keyVerifiedAt: null,
      },
      data: { keyVerifiedAt: now },
    })
    if (verified.count !== 1) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_ENROLLMENT_CHALLENGE_INVALID",
        "This device enrollment changed concurrently",
      )
    }
    return { enrollmentId: input.enrollmentId, status: "PENDING_MANAGER_APPROVAL" as const }
  })
}

export async function approveWorkforceAttendanceDeviceEnrollment(
  db: PrismaClient,
  input: {
    organizationId: string
    enrollmentId: string
    approvedByUserId: string
    audit: WorkforceAttendanceAuditContext
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    const enrollment = await tx.workforceAttendanceDeviceEnrollment.findFirst({
      where: { id: input.enrollmentId, organizationId: input.organizationId },
      select: {
        id: true,
        agentId: true,
        deviceLabel: true,
        publicKeyFingerprint: true,
        status: true,
        keyVerifiedAt: true,
        replacesEnrollmentId: true,
      },
    })
    if (!enrollment) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_ENROLLMENT_NOT_FOUND",
        "Attendance device enrollment was not found",
      )
    }
    if (enrollment.status !== "PENDING" || !enrollment.keyVerifiedAt) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_ENROLLMENT_APPROVAL_INVALID",
        "Only a verified pending device enrollment can be approved",
      )
    }
    if (enrollment.replacesEnrollmentId) {
      const replacement = await tx.workforceAttendanceDeviceEnrollment.findFirst({
        where: {
          id: enrollment.replacesEnrollmentId,
          organizationId: input.organizationId,
          agentId: enrollment.agentId,
          status: "ACTIVE",
        },
        select: {
          id: true,
          agentId: true,
          deviceLabel: true,
          publicKeyFingerprint: true,
          status: true,
          replacesEnrollmentId: true,
        },
      })
      if (!replacement) {
        throw new WorkforceAttendanceManagementError(
          "WORKFORCE_ATTENDANCE_ENROLLMENT_REPLACEMENT_INVALID",
          "The device selected for replacement is no longer active",
        )
      }
      const replaced = await tx.workforceAttendanceDeviceEnrollment.updateMany({
        where: {
          id: replacement.id,
          organizationId: input.organizationId,
          agentId: enrollment.agentId,
          status: "ACTIVE",
        },
        data: { status: "REPLACED", revokedByUserId: input.approvedByUserId, revokedAt: now },
      })
      if (replaced.count !== 1) {
        throw new WorkforceAttendanceManagementError(
          "WORKFORCE_ATTENDANCE_ENROLLMENT_REPLACEMENT_INVALID",
          "The device selected for replacement is no longer active",
        )
      }
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: replacement.agentId,
          action: "WORKFORCE_ATTENDANCE_DEVICE_REPLACED",
          entity: "workforce_attendance_device",
          entityId: replacement.id,
          metadataKind: "workforce_attendance_security",
          oldData: attendanceAuditData(replacement, input.audit),
          newData: attendanceAuditData({ ...replacement, status: "REPLACED" }, input.audit),
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
    }
    const approved = await tx.workforceAttendanceDeviceEnrollment.updateMany({
      where: {
        id: input.enrollmentId,
        organizationId: input.organizationId,
        status: "PENDING",
        keyVerifiedAt: { not: null },
      },
      data: { status: "ACTIVE", approvedByUserId: input.approvedByUserId, approvedAt: now },
    })
    if (approved.count !== 1) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_ENROLLMENT_APPROVAL_INVALID",
        "This device enrollment changed concurrently",
      )
    }
    await tx.mtmAuditLog.create({
      data: {
        organizationId: input.organizationId,
        agentId: enrollment.agentId,
        action: "WORKFORCE_ATTENDANCE_DEVICE_APPROVED",
        entity: "workforce_attendance_device",
        entityId: enrollment.id,
        metadataKind: "workforce_attendance_security",
        oldData: attendanceAuditData(enrollment, input.audit),
        newData: attendanceAuditData({ ...enrollment, status: "ACTIVE" }, input.audit),
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      },
    })
    return { enrollmentId: input.enrollmentId, status: "ACTIVE" as const }
  })
}

export async function revokeWorkforceAttendanceDeviceEnrollment(
  db: PrismaClient,
  input: {
    organizationId: string
    enrollmentId: string
    revokedByUserId: string
    audit: WorkforceAttendanceAuditContext
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    const enrollment = await tx.workforceAttendanceDeviceEnrollment.findFirst({
      where: {
        id: input.enrollmentId,
        organizationId: input.organizationId,
        status: { in: ["PENDING", "ACTIVE"] },
      },
      select: {
        id: true,
        agentId: true,
        deviceLabel: true,
        publicKeyFingerprint: true,
        status: true,
        replacesEnrollmentId: true,
      },
    })
    if (!enrollment) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_ENROLLMENT_REVOKE_INVALID",
        "This device enrollment is unavailable for revocation",
      )
    }
    const revoked = await tx.workforceAttendanceDeviceEnrollment.updateMany({
      where: {
        id: input.enrollmentId,
        organizationId: input.organizationId,
        status: { in: ["PENDING", "ACTIVE"] },
      },
      data: { status: "REVOKED", revokedByUserId: input.revokedByUserId, revokedAt: now },
    })
    if (revoked.count !== 1) {
      throw new WorkforceAttendanceManagementError(
        "WORKFORCE_ATTENDANCE_ENROLLMENT_REVOKE_INVALID",
        "This device enrollment changed concurrently",
      )
    }
    await tx.mtmAuditLog.create({
      data: {
        organizationId: input.organizationId,
        agentId: enrollment.agentId,
        action: "WORKFORCE_ATTENDANCE_DEVICE_REVOKED",
        entity: "workforce_attendance_device",
        entityId: enrollment.id,
        metadataKind: "workforce_attendance_security",
        oldData: attendanceAuditData(enrollment, input.audit),
        newData: attendanceAuditData({ ...enrollment, status: "REVOKED" }, input.audit),
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      },
    })
  })
}
