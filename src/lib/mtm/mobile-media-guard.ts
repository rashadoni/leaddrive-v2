import { NextResponse } from "next/server"
import type { MobileAuthResult } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import {
  acquirePublicConcurrencySlot,
  consumePublicRateLimit,
  releasePublicConcurrencySlot,
  type PublicConcurrencyReservation,
} from "@/lib/public-abuse-guard"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { parseMobileSyncV2DeviceId } from "@/lib/mtm/mobile-sync-v2"

const RETRY_AFTER_MAX_SECONDS = 60
export const MTM_MOBILE_MEDIA_COHORT_STREAM = "media"

// Media is deliberately budgeted separately from the business-mutation
// pipeline. Values are conservative until the S6 load baseline is available:
// a single device cannot occupy a worker with parallel HEIC/document work,
// while one tenant cannot turn a burst of uploads into a host-wide outage.
const MOBILE_MEDIA_RATE_LIMITS = {
  tenant: { maxRequests: 120, windowSeconds: 60 },
  user: { maxRequests: 30, windowSeconds: 60 },
  device: { maxRequests: 20, windowSeconds: 60 },
} as const

const MOBILE_MEDIA_CONCURRENCY_LIMITS = {
  // Multipart parsing currently has to materialize the bounded request and
  // the handler then makes a byte buffer for validation/digesting. Until M3
  // moves intake to streaming/object storage, two global uploads and one per
  // tenant are the safe envelope. This prevents an otherwise fair 25 MiB
  // document burst from becoming a host-wide memory outage.
  global: { maxConcurrent: 2, leaseSeconds: 300 },
  tenant: { maxConcurrent: 1, leaseSeconds: 300 },
  user: { maxConcurrent: 1, leaseSeconds: 300 },
  device: { maxConcurrent: 1, leaseSeconds: 300 },
} as const

type MobileMediaAuth = Pick<MobileAuthResult, "orgId" | "agentId" | "userId" | "role" | "tenantCapabilities">

export type MobileMediaConcurrencyReservation = {
  reservations: PublicConcurrencyReservation[]
}

export type MtmMobileMediaUploadReservation =
  | { allowed: false; response: NextResponse }
  | { allowed: true; reservation: MobileMediaConcurrencyReservation }

/**
 * The media supervisor is an additive rollout. The server, not an APK header,
 * decides whether a device has entered the protected contract. Legacy APKs
 * keep their v1 route semantics until the named cohort is enabled; a cohort
 * member cannot opt out by omitting or spoofing a request header.
 */
export type MtmMobileMediaUploadPolicy = {
  contractVersion: 1 | 2
  deviceId: string | null
  isolated: boolean
  /**
   * An active cohort exists for this authenticated agent, but this request
   * did not present that exact enrolled device. It must not fall back to the
   * legacy limiter, because a mutable header would then opt an enrolled APK
   * out of server-side protection.
   */
  requiresDeviceCohort: boolean
  cohortEpoch: string | null
}

function boundedRetryAfter(seconds: number): string {
  return String(Math.max(1, Math.min(RETRY_AFTER_MAX_SECONDS, Math.ceil(seconds))))
}

function retryResponse(input: { unavailable: boolean; retryAfterSeconds: number }) {
  const retryAfter = boundedRetryAfter(input.retryAfterSeconds)
  return NextResponse.json(
    {
      error: input.unavailable
        ? "Upload protection is temporarily unavailable. Please retry."
        : "Too many uploads. Please retry later.",
      code: input.unavailable ? "MTM_MOBILE_MEDIA_GUARD_UNAVAILABLE" : "MTM_MOBILE_MEDIA_RATE_LIMITED",
    },
    {
      status: input.unavailable ? 503 : 429,
      headers: { "Retry-After": retryAfter },
    },
  )
}

/**
 * Fail closed once media rollout is enabled for an agent. The header remains
 * only a device selector (mobile JWTs predate device binding), never a switch
 * that can return an enrolled caller to the legacy upload path.
 */
export function mtmMobileMediaDeviceCohortRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "This device is not enrolled for the current Field media rollout.",
      code: "MTM_MOBILE_MEDIA_DEVICE_COHORT_REQUIRED",
    },
    { status: 403 },
  )
}

/**
 * Mobile media has the same server-side capability fence as Field mutations.
 * Keeping it explicit prevents a caller from bypassing bootstrap's manifest by
 * calling a legacy multipart endpoint directly. Web/API-key callers use their
 * existing RBAC branch and are intentionally not passed through this helper.
 */
export async function requireMtmMobileMediaAccess(auth: MobileMediaAuth): Promise<NextResponse | null> {
  const roleForbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
  if (roleForbidden) return roleForbidden
  // withMobileRls resolves this snapshot alongside credential revocation. A
  // second Organization lookup here could see a different entitlement and
  // make the shared mobile boundary disagree with the handler that follows.
  if (auth.tenantCapabilities.routeField) return null
  return NextResponse.json({
    success: false,
    error: "Route & Field is not enabled for this tenant.",
    code: "TENANT_CAPABILITY_DISABLED",
    capabilityId: "route-field",
    capabilityLabel: "Route & Field",
    capabilityStatus: "disabled",
  }, { status: 403 })
}

function isMissingCohortTable(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === "P2021"
}

/**
 * Read the rollout decision from the authenticated tenant/agent/device row.
 * This lookup intentionally treats an absent v2 table as legacy during a
 * schema-first rolling deploy. Any other database error is surfaced: silently
 * treating it as legacy would turn a control-plane failure into a guard bypass.
 */
export async function readMtmMobileMediaUploadPolicy(input: {
  auth: Pick<MobileAuthResult, "orgId" | "agentId">
  deviceId: string | null
  now?: Date
}): Promise<MtmMobileMediaUploadPolicy> {
  const deviceId = parseMobileSyncV2DeviceId(input.deviceId)
  const now = input.now ?? new Date()
  const activeCohortWhere = {
    organizationId: input.auth.orgId,
    stream: MTM_MOBILE_MEDIA_COHORT_STREAM,
    agentId: input.auth.agentId,
    enabled: true,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }

  try {
    // Resolve the exact row first. This preserves the ordinary fast path
    // while allowing the second query to distinguish "no cohort exists" from
    // "a cohort exists but a request omitted/spoofed its device selector".
    const exact = deviceId ? await prisma.mtmMobileSyncCohort.findFirst({
      where: { ...activeCohortWhere, deviceId },
      select: { updatedAt: true },
    }) : null
    if (exact) {
      return {
        contractVersion: 2,
        deviceId,
        isolated: true,
        requiresDeviceCohort: false,
        cohortEpoch: exact.updatedAt.toISOString(),
      }
    }

    const enrolledForAgent = await prisma.mtmMobileSyncCohort.findFirst({
      where: activeCohortWhere,
      select: { updatedAt: true },
    })
    if (enrolledForAgent) {
      return {
        contractVersion: 2,
        deviceId,
        isolated: false,
        requiresDeviceCohort: true,
        cohortEpoch: enrolledForAgent.updatedAt.toISOString(),
      }
    }

    return { contractVersion: 1, deviceId, isolated: false, requiresDeviceCohort: false, cohortEpoch: null }
  } catch (error) {
    if (isMissingCohortTable(error)) {
      return { contractVersion: 1, deviceId, isolated: false, requiresDeviceCohort: false, cohortEpoch: null }
    }
    throw error
  }
}

function safeDeviceId(value: string | null): string {
  // A v2 cohort requires the strict parser above. Keep the legacy fallback
  // only for direct callers/tests of this guard, never as a rollout decision.
  if (value && /^[A-Za-z0-9._:-]{1,128}$/.test(value)) return value
  return "legacy-device"
}

async function allowRate(scope: string, identifier: string, policy: { maxRequests: number; windowSeconds: number }) {
  return consumePublicRateLimit(scope, identifier, policy)
}

async function releaseReservations(reservations: PublicConcurrencyReservation[]) {
  await Promise.allSettled(reservations.map((reservation) => releasePublicConcurrencySlot(reservation)))
}

/**
 * Acquire mobile-only rate and concurrency budgets. All identities are hashed
 * inside public-abuse-guard; neither raw device IDs nor user IDs enter logs.
 * A Redis outage fails this optional media path closed with 503 + Retry-After,
 * rather than silently dropping back to an unbounded process-local limiter.
 */
export async function reserveMtmMobileMediaUpload(input: {
  auth: MobileMediaAuth
  deviceId: string | null
}): Promise<MtmMobileMediaUploadReservation> {
  const deviceId = safeDeviceId(input.deviceId)
  const rateIds = {
    tenant: input.auth.orgId,
    user: `${input.auth.orgId}:${input.auth.userId || input.auth.agentId}`,
    device: `${input.auth.orgId}:${input.auth.agentId}:${deviceId}`,
  }
  const concurrencyIds = {
    global: "all",
    ...rateIds,
  }

  for (const [name, identifier] of Object.entries(rateIds) as Array<[keyof typeof rateIds, string]>) {
    const decision = await allowRate(
      `mtm-mobile-media:${name}`,
      identifier,
      MOBILE_MEDIA_RATE_LIMITS[name],
    )
    if (!decision.allowed) return { allowed: false, response: retryResponse(decision) }
  }

  const reservations: PublicConcurrencyReservation[] = []
  for (const [name, identifier] of Object.entries(concurrencyIds) as Array<[keyof typeof concurrencyIds, string]>) {
    const reservation = await acquirePublicConcurrencySlot(
      `mtm-mobile-media:${name}`,
      identifier,
      MOBILE_MEDIA_CONCURRENCY_LIMITS[name],
    )
    if (!reservation.allowed) {
      await releaseReservations(reservations)
      return { allowed: false, response: retryResponse(reservation) }
    }
    reservations.push(reservation)
  }

  return { allowed: true, reservation: { reservations } }
}

/** Release every acquired slot; safe to call from a handler finally block. */
export async function releaseMtmMobileMediaUpload(
  reservation: MobileMediaConcurrencyReservation | null | undefined,
): Promise<void> {
  if (!reservation) return
  await releaseReservations(reservation.reservations)
}
