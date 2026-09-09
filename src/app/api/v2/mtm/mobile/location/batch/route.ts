import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { parseMobileSyncV2DeviceId } from "@/lib/mtm/mobile-sync-v2"
import { readMtmMobileGpsBatchPilot } from "@/lib/mtm/mobile-gps-guard"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { mtmMobileLocationPayloadSha256 } from "@/lib/mtm/mobile-location-idempotency"
import { advanceMtmAgentLatestLocation } from "@/lib/mtm/mobile-location-latest"
import { recordMtmMobileGpsTelemetry, type MtmMobileGpsResult } from "@/lib/mtm/mobile-gps-telemetry"

export const runtime = "nodejs"
export const maxDuration = 30

const MAX_BATCH_POINTS = 50
const MAX_BATCH_BYTES = 256 * 1024
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
const MAX_OFFLINE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000
const RETRY_AFTER_MAX_SECONDS = 60

const GPS_BATCH_RATE_LIMITS = {
  tenant: { maxRequests: 120, windowSeconds: 60 },
  user: { maxRequests: 12, windowSeconds: 60 },
  device: { maxRequests: 6, windowSeconds: 60 },
} as const

type ParsedPoint = {
  clientLocationId: string
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  altitude: number | null
  battery: number | null
  isMoving: boolean
  recordedAt: Date
  payloadSha256: string
}

type WorkdayWindow = {
  id: string
  status: "STARTED" | "PAUSED" | "COMPLETED"
  startedAt: Date
  completedAt: Date | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
}

function validOptionalMetric(value: unknown, min: number, max: number): boolean {
  return value == null || finiteInRange(value, min, max)
}

function parseRecordedAt(value: unknown, now: Date): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) return null
  if (parsed.getTime() < now.getTime() - MAX_OFFLINE_HORIZON_MS) return null
  return parsed
}

function isRecordedInsideWorkday(recordedAt: Date, workday: WorkdayWindow): boolean {
  if (recordedAt < workday.startedAt) return false
  if (workday.status !== "COMPLETED") return true
  return workday.completedAt !== null && recordedAt <= workday.completedAt
}

type PointErrorMetadata = {
  /**
   * Opaque client-generated identifier only. Never attach a point payload or
   * coordinates to an error response.
   */
  clientLocationId: string
}

function error(
  code: string,
  message: string,
  status = 400,
  retryAfter?: number,
  point?: PointErrorMetadata,
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      code,
      ...(point ? { clientLocationId: point.clientLocationId } : {}),
    },
    {
      status,
      headers: retryAfter ? { "Retry-After": String(Math.max(1, Math.min(RETRY_AFTER_MAX_SECONDS, Math.ceil(retryAfter)))) } : undefined,
    },
  )
}

function parseBatch(body: unknown, now: Date):
  | { ok: true; workdayId: string | null; points: ParsedPoint[] }
  | { ok: false; response: NextResponse } {
  const record = asRecord(body)
  if (!record || !Array.isArray(record.points)) {
    return { ok: false, response: error("MTM_LOCATION_BATCH_INVALID", "points must be an array") }
  }
  if (record.points.length < 1 || record.points.length > MAX_BATCH_POINTS) {
    return { ok: false, response: error("MTM_LOCATION_BATCH_SIZE_INVALID", `points must contain 1..${MAX_BATCH_POINTS} items`) }
  }
  const workdayId = record.workdayId == null ? null : typeof record.workdayId === "string" ? record.workdayId.trim() : ""
  if (workdayId !== null && (workdayId.length < 1 || workdayId.length > 128)) {
    return { ok: false, response: error("MTM_LOCATION_WORKDAY_INVALID", "workdayId must be a non-empty identifier") }
  }

  const ids = new Set<string>()
  const points: ParsedPoint[] = []
  for (const item of record.points) {
    const point = asRecord(item)
    if (!point) return { ok: false, response: error("MTM_LOCATION_BATCH_INVALID", "each point must be an object") }
    const clientLocationId = typeof point.clientLocationId === "string" ? point.clientLocationId.trim() : ""
    if (clientLocationId.length < 1 || clientLocationId.length > 100) {
      return { ok: false, response: error("MTM_LOCATION_CLIENT_ID_INVALID", "each point needs clientLocationId (1..100 characters)") }
    }
    if (ids.has(clientLocationId)) {
      return { ok: false, response: error("MTM_LOCATION_CLIENT_ID_DUPLICATE", "clientLocationId must be unique inside a batch") }
    }
    ids.add(clientLocationId)
    const latitude = point.latitude
    const longitude = point.longitude
    if (!finiteInRange(latitude, -90, 90) || !finiteInRange(longitude, -180, 180)) {
      return {
        ok: false,
        response: error(
          "MTM_LOCATION_COORDINATES_INVALID",
          "latitude/longitude are out of range",
          400,
          undefined,
          { clientLocationId },
        ),
      }
    }
    if (!validOptionalMetric(point.accuracy, 0, 100_000)
      || !validOptionalMetric(point.speed, 0, 500)
      || !validOptionalMetric(point.heading, 0, 360)
      || !validOptionalMetric(point.altitude, -1_000, 100_000)
      || !validOptionalMetric(point.battery, 0, 100)) {
      return {
        ok: false,
        response: error(
          "MTM_LOCATION_METRICS_INVALID",
          "invalid location telemetry",
          400,
          undefined,
          { clientLocationId },
        ),
      }
    }
    const recordedAt = parseRecordedAt(point.recordedAt, now)
    if (!recordedAt) {
      return { ok: false, response: error(
        "MTM_LOCATION_OFFLINE_HORIZON_EXCEEDED",
        "recordedAt must be valid, no more than 7 days old, and not in the future",
        400,
        undefined,
        { clientLocationId },
      ) }
    }
    const accuracy = point.accuracy == null ? null : point.accuracy as number
    const speed = point.speed == null ? null : point.speed as number
    const heading = point.heading == null ? null : point.heading as number
    const altitude = point.altitude == null ? null : point.altitude as number
    const battery = point.battery == null ? null : point.battery as number
    const parsed = {
      clientLocationId,
      latitude,
      longitude,
      accuracy,
      speed,
      heading,
      altitude,
      battery,
      isMoving: (speed ?? 0) > 1,
      recordedAt,
      payloadSha256: "",
    }
    points.push(parsed)
  }
  return { ok: true, workdayId, points: points.sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime()) }
}

async function allowBatchRate(input: { organizationId: string; agentId: string; userId: string; deviceId: string | null }) {
  const identifiers = {
    tenant: input.organizationId,
    user: `${input.organizationId}:${input.userId || input.agentId}`,
    device: `${input.organizationId}:${input.agentId}:${input.deviceId ?? "legacy-device"}`,
  }
  for (const [scope, identifier] of Object.entries(identifiers) as Array<[keyof typeof identifiers, string]>) {
    const decision = await consumePublicRateLimit(`mtm-mobile-gps-batch:${scope}`, identifier, GPS_BATCH_RATE_LIMITS[scope])
    if (!decision.allowed) {
      return error(
        decision.unavailable ? "MTM_LOCATION_BATCH_GUARD_UNAVAILABLE" : "MTM_LOCATION_BATCH_RATE_LIMITED",
        decision.unavailable ? "GPS upload protection is temporarily unavailable" : "Too many GPS upload batches",
        decision.unavailable ? 503 : 429,
        decision.retryAfterSeconds,
      )
    }
  }
  return null
}

async function resolveWorkday(input: { organizationId: string; agentId: string; workdayId: string | null }) {
  return prisma.mtmAgentWorkday.findFirst({
    where: input.workdayId
      ? { id: input.workdayId, organizationId: input.organizationId, agentId: input.agentId }
      : { organizationId: input.organizationId, agentId: input.agentId, status: { in: ["STARTED", "PAUSED"] } },
    orderBy: input.workdayId ? undefined : { startedAt: "desc" },
    select: { id: true, status: true, startedAt: true, completedAt: true },
  })
}

type ExistingRow = { clientLocationId: string | null; payloadSha256: string | null }

async function classifyExisting(input: { organizationId: string; agentId: string; points: ParsedPoint[] }) {
  const rows = await prisma.mtmAgentLocation.findMany({
    where: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      clientLocationId: { in: input.points.map((point) => point.clientLocationId) },
    },
    select: { clientLocationId: true, payloadSha256: true },
  }) as ExistingRow[]
  const byId = new Map<string, ExistingRow>()
  for (const row of rows) {
    if (row.clientLocationId) byId.set(row.clientLocationId, row)
  }
  const conflict = input.points.find((point) => {
    const existing = byId.get(point.clientLocationId)
    return existing && existing.payloadSha256 !== point.payloadSha256
  })
  return {
    conflict,
    newPoints: input.points.filter((point) => !byId.has(point.clientLocationId)),
    replayedClientLocationIds: input.points.filter((point) => byId.has(point.clientLocationId)).map((point) => point.clientLocationId),
  }
}

class MobileLocationActorUnavailableError extends Error {}

class MobileLocationWorkdayUnavailableError extends Error {
  constructor(readonly clientLocationId?: string) {
    super()
  }
}

async function persistNewPoints(input: {
  organizationId: string
  agentId: string
  workday: WorkdayWindow
  points: ParsedPoint[]
  now: Date
}) {
  return prisma.$transaction(async (tx) => {
    const currentWorkday = await tx.mtmAgentWorkday.findFirst({
      where: { id: input.workday.id, organizationId: input.organizationId, agentId: input.agentId },
      select: { id: true, status: true, startedAt: true, completedAt: true },
    }) as WorkdayWindow | null
    if (!currentWorkday) {
      throw new MobileLocationWorkdayUnavailableError()
    }
    const pointOutsideWorkday = input.points.find((point) => !isRecordedInsideWorkday(point.recordedAt, currentWorkday))
    if (pointOutsideWorkday) {
      throw new MobileLocationWorkdayUnavailableError(pointOutsideWorkday.clientLocationId)
    }
    const updatedAgent = await tx.mtmAgent.updateMany({
      where: { id: input.agentId, organizationId: input.organizationId, status: "ACTIVE" },
      data: { isOnline: true, lastSeenAt: input.now },
    })
    if (updatedAgent.count !== 1) throw new MobileLocationActorUnavailableError()

    const appliedClientLocationIds: string[] = []
    for (const point of input.points) {
      const created = await tx.mtmAgentLocation.create({
        data: {
          organizationId: input.organizationId,
          agentId: input.agentId,
          workdayId: currentWorkday.id,
          clientLocationId: point.clientLocationId,
          payloadSha256: point.payloadSha256,
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: point.accuracy,
          speed: point.speed,
          heading: point.heading,
          altitude: point.altitude,
          battery: point.battery,
          isMoving: point.isMoving,
          recordedAt: point.recordedAt,
        },
      })
      await advanceMtmAgentLatestLocation(tx, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        sourceLocationId: created.id,
        payloadSha256: point.payloadSha256,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        speed: point.speed,
        heading: point.heading,
        altitude: point.altitude,
        battery: point.battery,
        isMoving: point.isMoving,
        recordedAt: point.recordedAt,
        receivedAt: input.now,
      })
      appliedClientLocationIds.push(point.clientLocationId)
    }
    return appliedClientLocationIds
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 30_000,
  })
}

/**
 * POST /api/v2/mtm/mobile/location/batch
 *
 * Additive, server-first GPS ingest. It intentionally skips route-deviation
 * analysis and notifications; those are expensive derived work and must not
 * sit on the high-volume append path.
 */
export const POST = withMobileRls(async (req, auth) => {
  const startedAt = Date.now()
  let result: MtmMobileGpsResult = "failed"
  let pointCount = 0
  const finish = () => recordMtmMobileGpsTelemetry({
    organizationId: auth.orgId,
    endpoint: "location_batch",
    apkVersion: req.headers.get("x-field-apk-version"),
    result,
    pointCount,
    durationMs: Date.now() - startedAt,
  })

  try {
    const roleForbidden = requireMobileCapability(auth, "FIELD_TRACK")
    if (roleForbidden) {
      result = "forbidden"
      return roleForbidden
    }
    const deviceId = parseMobileSyncV2DeviceId(req.headers.get("x-field-device-id"))
    if (!deviceId) {
      result = "invalid_request"
      return error("MOBILE_GPS_BATCH_DEVICE_REQUIRED", "a valid x-field-device-id header is required")
    }
    const gpsBatchPilot = await readMtmMobileGpsBatchPilot({
      auth,
      deviceId,
    })
    if (!gpsBatchPilot.enrolled) {
      result = "forbidden"
      return error(
        "MOBILE_GPS_BATCH_COHORT_DISABLED",
        "this device is not enrolled in the mobile GPS batch pilot",
        403,
      )
    }
    const parsedBody = await readJsonRequestWithinLimit(req, MAX_BATCH_BYTES)
    if (!parsedBody.ok) {
      result = "invalid_request"
      return error(
        parsedBody.reason === "too_large" ? "MTM_LOCATION_BATCH_PAYLOAD_TOO_LARGE" : "MTM_LOCATION_BATCH_INVALID",
        parsedBody.reason === "too_large" ? "GPS batch payload too large" : "invalid JSON body",
        parsedBody.reason === "too_large" ? 413 : 400,
      )
    }
    const parsed = parseBatch(parsedBody.value, new Date())
    if (!parsed.ok) {
      result = "invalid_request"
      return parsed.response
    }
    pointCount = parsed.points.length

    const rateLimited = await allowBatchRate({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      userId: auth.userId,
      deviceId,
    })
    if (rateLimited) {
      result = rateLimited.status === 503 ? "unavailable" : "rate_limited"
      return rateLimited
    }

    const workday = await resolveWorkday({ organizationId: auth.orgId, agentId: auth.agentId, workdayId: parsed.workdayId }) as WorkdayWindow | null
    if (!workday) {
      result = "conflict"
      return error("MTM_LOCATION_WORKDAY_REQUIRED", "an active or explicitly supplied workday is required", 409)
    }
    const pointOutsideWorkday = parsed.points.find((point) => !isRecordedInsideWorkday(point.recordedAt, workday))
    if (pointOutsideWorkday) {
      result = "conflict"
      return error(
        "MTM_LOCATION_OUTSIDE_WORKDAY",
        "a point is outside the supplied workday",
        409,
        undefined,
        { clientLocationId: pointOutsideWorkday.clientLocationId },
      )
    }
    // Bind the idempotency digest to the authoritative workday selected above,
    // rather than a client omission that merely asked the server to choose it.
    const points = parsed.points.map((point) => ({
      ...point,
      payloadSha256: mtmMobileLocationPayloadSha256({ ...point, workdayId: workday.id }),
    }))

    let classified = await classifyExisting({ organizationId: auth.orgId, agentId: auth.agentId, points })
    if (classified.conflict) {
      result = "conflict"
      return error(
        "MTM_LOCATION_ID_CONFLICT",
        "clientLocationId was already used with different location data",
        409,
        undefined,
        { clientLocationId: classified.conflict.clientLocationId },
      )
    }
    if (classified.newPoints.length === 0) {
      result = "ok"
      return NextResponse.json({
        success: true,
        data: { appliedClientLocationIds: [], replayedClientLocationIds: classified.replayedClientLocationIds },
      })
    }

    let appliedClientLocationIds: string[]
    try {
      appliedClientLocationIds = await persistNewPoints({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        workday,
        points: classified.newPoints,
        now: new Date(),
      })
    } catch (writeError) {
      if (!(writeError instanceof Prisma.PrismaClientKnownRequestError) || writeError.code !== "P2002") throw writeError
      // One concurrent retry won the same durable ID. Re-read once; either
      // return exact replays or write only the still-missing points. Never
      // spin indefinitely on a hot device/network retry storm.
      classified = await classifyExisting({ organizationId: auth.orgId, agentId: auth.agentId, points })
      if (classified.conflict) {
        result = "conflict"
        return error(
          "MTM_LOCATION_ID_CONFLICT",
          "clientLocationId was already used with different location data",
          409,
          undefined,
          { clientLocationId: classified.conflict.clientLocationId },
        )
      }
      if (classified.newPoints.length === 0) {
        result = "ok"
        return NextResponse.json({
          success: true,
          data: { appliedClientLocationIds: [], replayedClientLocationIds: classified.replayedClientLocationIds },
        })
      }
      try {
        appliedClientLocationIds = await persistNewPoints({
          organizationId: auth.orgId,
          agentId: auth.agentId,
          workday,
          points: classified.newPoints,
          now: new Date(),
        })
      } catch (retryError) {
        if (retryError instanceof Prisma.PrismaClientKnownRequestError && retryError.code === "P2002") {
          result = "unavailable"
          return error("MTM_LOCATION_BATCH_CONCURRENT_RETRY", "concurrent GPS retry; retry this batch", 503, 1)
        }
        throw retryError
      }
    }

    result = "ok"
    return NextResponse.json({
      success: true,
      data: {
        appliedClientLocationIds,
        replayedClientLocationIds: classified.replayedClientLocationIds,
      },
    }, { status: 201 })
  } catch (caught) {
    if (caught instanceof MobileLocationActorUnavailableError) {
      result = "forbidden"
      return error("MTM_LOCATION_ACTOR_UNAVAILABLE", "mobile actor is no longer active", 401)
    }
    if (caught instanceof MobileLocationWorkdayUnavailableError) {
      result = "conflict"
      return error(
        "MTM_LOCATION_OUTSIDE_WORKDAY",
        "the workday changed before this batch was stored",
        409,
        undefined,
        caught.clientLocationId ? { clientLocationId: caught.clientLocationId } : undefined,
      )
    }
    // Do not log a thrown value wholesale here: validation/database wrappers
    // may embed request context, and raw coordinates must never enter logs.
    console.error("[MTM/mobile/location/batch POST] failed", caught instanceof Error ? caught.name : "unknown")
    result = "failed"
    return error("MTM_LOCATION_BATCH_FAILED", "failed to save GPS batch", 500)
  } finally {
    finish()
  }
}, { requiredCapability: "route-field" })
