import { createHash, randomBytes } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { MtmWorkdayEventInput } from "@/lib/mtm/workday"
import {
  verifyWorkforceAttendanceQr,
  verifyWorkforceDeviceSignature,
  workforceAttendanceQrNonceFingerprint,
  workforceDeviceAttendanceChallenge,
  WorkforceAttendanceSecurityError,
} from "@/lib/workforce/attendance-security"
import {
  workforceAttendanceRequirements,
  type WorkforceAttendanceAction,
  type WorkforceAttendanceRequirements,
} from "@/lib/workforce/attendance-policy"
import {
  resolveCurrentWorkforcePolicy,
  WorkforcePolicyResolutionError,
} from "@/lib/workforce/policy-resolution"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"

export type WorkforceAttendanceCapabilities = {
  qrEnabled: boolean
  deviceTrustEnabled: boolean
}

// QR is an online proof. A client event time may have modest clock drift, but
// it must remain tied to the current QR window rather than a historical day.
const QR_EVENT_CLOCK_SKEW_MS = 60 * 1000

/** Uses the same commercial entitlement evaluator as mobile token hydration. */
export function workforceAttendanceCapabilitiesFromTenant(fields: {
  plan?: string | null
  addons?: unknown
  features?: unknown
  modules?: unknown
}): WorkforceAttendanceCapabilities {
  return {
    qrEnabled: isTenantCapabilityEnabled("attendance-qr", fields),
    deviceTrustEnabled: isTenantCapabilityEnabled("attendance-device-trust", fields),
  }
}

export type WorkforceAttendancePrincipal = "mobile" | "web"

export type WorkforceAttendanceEvidence = {
  qrToken?: string
  device?: {
    enrollmentId: string
    signature: string
  }
}

export type WorkforceAttendanceWorkday = {
  workDate: Date
  startedAt: Date
}

type AttendanceTrustDb = Pick<
  Prisma.TransactionClient,
  | "mtmAgent"
  | "workforcePolicy"
  | "workforceAttendanceQrStation"
  | "workforceAttendanceDeviceEnrollment"
  | "workforceAttendanceVerification"
  | "$queryRaw"
>

type PreparedVerificationFact = {
  method: "QR" | "DEVICE_KEY"
  stationId?: string
  deviceEnrollmentId?: string
  nonceFingerprint?: string
  proofFingerprint?: string
}

export type PreparedWorkforceAttendanceVerification = {
  organizationId: string
  agentId: string
  policyId: string
  policyVersion: number
  policyDefinitionHash: string
  facts: PreparedVerificationFact[]
}

export class WorkforceAttendanceTrustError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_ATTENDANCE_POLICY_INVALID"
      | "WORKFORCE_ATTENDANCE_CAPABILITY_DISABLED"
      | "WORKFORCE_ATTENDANCE_QR_REQUIRED"
      | "WORKFORCE_ATTENDANCE_QR_EVENT_TIME_INVALID"
      | "WORKFORCE_ATTENDANCE_QR_CONTEXT_INVALID"
      | "WORKFORCE_ATTENDANCE_QR_STATION_UNAVAILABLE"
      | "WORKFORCE_ATTENDANCE_DEVICE_REQUIRED"
      | "WORKFORCE_ATTENDANCE_DEVICE_UNAVAILABLE"
      | "WORKFORCE_ATTENDANCE_DEVICE_SIGNATURE_INVALID"
      | "WORKFORCE_ATTENDANCE_PROOF_REPLAY"
      | "WORKFORCE_ATTENDANCE_BIOMETRIC_MOBILE_REQUIRED",
    message: string = code,
  ) {
    super(message)
  }
}

function dateKey(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new WorkforceAttendanceTrustError(
      "WORKFORCE_ATTENDANCE_POLICY_INVALID",
      "Workday policy context is invalid",
    )
  }
  return value.toISOString().slice(0, 10)
}

function nonEmpty(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength
}

function normalizedEvidence(value: WorkforceAttendanceEvidence | undefined): WorkforceAttendanceEvidence {
  const qrToken = nonEmpty(value?.qrToken, 4096) ? value!.qrToken!.trim() : undefined
  const device = value?.device
  return {
    ...(qrToken ? { qrToken } : {}),
    ...(device && nonEmpty(device.enrollmentId, 100) && nonEmpty(device.signature, 8192)
      ? { device: { enrollmentId: device.enrollmentId.trim(), signature: device.signature.trim() } }
      : {}),
  }
}

function required(requirements: WorkforceAttendanceRequirements, action: WorkforceAttendanceAction) {
  return {
    qr: requirements.qrRequiredActions.has(action),
    device: requirements.deviceTrustRequiredActions.has(action),
    biometric: requirements.biometricRequiredActions.has(action),
  }
}

function policyMissing(error: unknown): boolean {
  return error instanceof WorkforcePolicyResolutionError && error.code === "WORKFORCE_POLICY_MISSING"
}

function proofFingerprint(organizationId: string, signature: string): string {
  // Signatures are public verification artifacts but are still unnecessary
  // long-term data. Retain only a tenant-bound non-reversible fingerprint.
  return createHash("sha256")
    .update(`workforce-attendance-device-proof:v1:${organizationId}:`)
    .update(signature)
    .digest("hex")
}

/**
 * Examines the current explicit Workforce attendance policy only after the
 * canonical workday transition created its immutable event. A throw rolls
 * that surrounding transaction back, so neither a failed QR/device proof nor
 * a duplicate QR nonce can leave a workday mutation behind.
 *
 * A tenant with no applicable Workforce policy (or a policy without the
 * versioned `attendance` block) retains the exact legacy workday behavior.
 */
export async function prepareWorkforceAttendanceVerification(
  db: AttendanceTrustDb,
  input: {
    organizationId: string
    agentId: string
    workday: WorkforceAttendanceWorkday
    event: Pick<MtmWorkdayEventInput, "action" | "workdayId" | "clientEventId" | "occurredAt">
    evidence?: WorkforceAttendanceEvidence
    capabilities: WorkforceAttendanceCapabilities
    principal: WorkforceAttendancePrincipal
    now?: Date
  },
): Promise<PreparedWorkforceAttendanceVerification | null> {
  const now = input.now ?? new Date()
  let policy: Awaited<ReturnType<typeof resolveCurrentWorkforcePolicy>>
  try {
    policy = await resolveCurrentWorkforcePolicy(db, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      workDate: dateKey(input.workday.workDate),
      workdayStartedAt: input.workday.startedAt,
      resolutionAt: now,
    })
  } catch (error) {
    if (policyMissing(error)) return null
    throw error
  }

  let requirements: WorkforceAttendanceRequirements
  try {
    requirements = workforceAttendanceRequirements(policy.definition)
  } catch (error) {
    throw new WorkforceAttendanceTrustError(
      "WORKFORCE_ATTENDANCE_POLICY_INVALID",
      error instanceof Error ? error.message : "Workforce attendance policy is invalid",
    )
  }
  const action = input.event.action as WorkforceAttendanceAction
  const needs = required(requirements, action)
  if (!needs.qr && !needs.device) return null

  if (needs.qr && !input.capabilities.qrEnabled) {
    throw new WorkforceAttendanceTrustError(
      "WORKFORCE_ATTENDANCE_CAPABILITY_DISABLED",
      "Attendance QR is required by policy but disabled for this tenant",
    )
  }
  if (needs.device && !input.capabilities.deviceTrustEnabled) {
    throw new WorkforceAttendanceTrustError(
      "WORKFORCE_ATTENDANCE_CAPABILITY_DISABLED",
      "Attendance device trust is required by policy but disabled for this tenant",
    )
  }
  if (needs.biometric && input.principal !== "mobile") {
    // The server never receives a biometric result. Its only valid first-H5
    // evidence is a device signature produced after the native client locally
    // unlocks its non-exportable key through the system biometric prompt.
    throw new WorkforceAttendanceTrustError(
      "WORKFORCE_ATTENDANCE_BIOMETRIC_MOBILE_REQUIRED",
      "This workday action requires a locally biometric-unlocked mobile device",
    )
  }

  const evidence = normalizedEvidence(input.evidence)
  const facts: PreparedVerificationFact[] = []

  if (needs.qr) {
    if (!evidence.qrToken) {
      throw new WorkforceAttendanceTrustError(
        "WORKFORCE_ATTENDANCE_QR_REQUIRED",
        "A current attendance QR scan is required",
      )
    }
    let qr: ReturnType<typeof verifyWorkforceAttendanceQr>
    try {
      qr = verifyWorkforceAttendanceQr({
        organizationId: input.organizationId,
        token: evidence.qrToken,
        now,
      })
    } catch (error) {
      if (error instanceof WorkforceAttendanceSecurityError) {
        throw new WorkforceAttendanceTrustError(
          "WORKFORCE_ATTENDANCE_QR_REQUIRED",
          "The attendance QR is invalid or expired",
        )
      }
      throw error
    }
    const eventTime = input.event.occurredAt.getTime()
    if (qr.action !== action) {
      throw new WorkforceAttendanceTrustError(
        "WORKFORCE_ATTENDANCE_QR_CONTEXT_INVALID",
        "The attendance QR was issued for a different work-time action",
      )
    }
    if (
      eventTime < qr.issuedAt.getTime() - QR_EVENT_CLOCK_SKEW_MS ||
      eventTime > now.getTime() + QR_EVENT_CLOCK_SKEW_MS ||
      eventTime > qr.expiresAt.getTime() + QR_EVENT_CLOCK_SKEW_MS
    ) {
      throw new WorkforceAttendanceTrustError(
        "WORKFORCE_ATTENDANCE_QR_EVENT_TIME_INVALID",
        "The attendance QR must be used for the current work-time action",
      )
    }
    const station = await db.workforceAttendanceQrStation.findFirst({
      where: {
        id: qr.stationId,
        organizationId: input.organizationId,
        status: "ACTIVE",
        siteId: qr.siteId,
        geofenceRevisionId: qr.geofenceRevisionId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: { id: true },
    })
    if (!station) {
      throw new WorkforceAttendanceTrustError(
        "WORKFORCE_ATTENDANCE_QR_STATION_UNAVAILABLE",
        "The attendance QR station is unavailable",
      )
    }
    facts.push({
      method: "QR",
      stationId: station.id,
      nonceFingerprint: workforceAttendanceQrNonceFingerprint(input.organizationId, qr.nonce),
    })
  }

  if (needs.device) {
    if (!evidence.device) {
      throw new WorkforceAttendanceTrustError(
        "WORKFORCE_ATTENDANCE_DEVICE_REQUIRED",
        "A trusted attendance device signature is required",
      )
    }
    const enrollment = await db.workforceAttendanceDeviceEnrollment.findFirst({
      where: {
        id: evidence.device.enrollmentId,
        organizationId: input.organizationId,
        agentId: input.agentId,
        status: "ACTIVE",
        keyVerifiedAt: { not: null },
      },
      select: { id: true, publicKeySpki: true },
    })
    if (!enrollment) {
      throw new WorkforceAttendanceTrustError(
        "WORKFORCE_ATTENDANCE_DEVICE_UNAVAILABLE",
        "The selected attendance device is not active for this employee",
      )
    }
    const challenge = workforceDeviceAttendanceChallenge({
      organizationId: input.organizationId,
      agentId: input.agentId,
      enrollmentId: enrollment.id,
      clientEventId: input.event.clientEventId,
      action,
      workdayId: input.event.workdayId,
      occurredAt: input.event.occurredAt,
    })
    if (!verifyWorkforceDeviceSignature({
      publicKeySpkiBase64: enrollment.publicKeySpki,
      challenge,
      signatureBase64: evidence.device.signature,
    })) {
      throw new WorkforceAttendanceTrustError(
        "WORKFORCE_ATTENDANCE_DEVICE_SIGNATURE_INVALID",
        "The trusted device signature is invalid",
      )
    }
    facts.push({
      method: "DEVICE_KEY",
      deviceEnrollmentId: enrollment.id,
      proofFingerprint: proofFingerprint(input.organizationId, evidence.device.signature),
    })
  }

  return {
    organizationId: input.organizationId,
    agentId: input.agentId,
    policyId: policy.id,
    policyVersion: policy.version,
    policyDefinitionHash: policy.definitionHash,
    facts,
  }
}

/** Persist the prepared facts only after the canonical workday event exists. */
export async function recordWorkforceAttendanceVerification(
  db: Pick<Prisma.TransactionClient, "workforceAttendanceVerification">,
  prepared: PreparedWorkforceAttendanceVerification,
  workdayEventId: string,
): Promise<void> {
  for (const fact of prepared.facts) {
    try {
      await db.workforceAttendanceVerification.create({
        data: {
          organizationId: prepared.organizationId,
          agentId: prepared.agentId,
          workdayEventId,
          policyId: prepared.policyId,
          policyVersion: prepared.policyVersion,
          policyDefinitionHash: prepared.policyDefinitionHash,
          method: fact.method,
          ...(fact.stationId ? { stationId: fact.stationId } : {}),
          ...(fact.deviceEnrollmentId ? { deviceEnrollmentId: fact.deviceEnrollmentId } : {}),
          ...(fact.nonceFingerprint ? { nonceFingerprint: fact.nonceFingerprint } : {}),
          ...(fact.proofFingerprint ? { proofFingerprint: fact.proofFingerprint } : {}),
        },
      })
    } catch (error) {
      if ((error as { code?: unknown })?.code === "P2002") {
        throw new WorkforceAttendanceTrustError(
          "WORKFORCE_ATTENDANCE_PROOF_REPLAY",
          "This attendance proof was already used",
        )
      }
      throw error
    }
  }
}

export function newWorkforceAttendanceEnrollmentChallenge(): string {
  return randomBytes(32).toString("base64url")
}
