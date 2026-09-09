import { DecryptError, decryptToken, encryptToken } from "@/lib/secure-token"
import { prisma } from "@/lib/prisma"
import { advanceMtmAgentLatestLocation } from "@/lib/mtm/mobile-location-latest"

export const MTM_LATEST_LOCATION_RECONCILIATION_MAX_AGENTS = 25
export const MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_TTL_MS = 15 * 60 * 1_000
export const MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_MAX_LENGTH = 4_096

const GPS_RAW_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
const CURSOR_PURPOSE = "mtm-latest-location-reconciliation-cursor"

type MtmLatestLocationReconciliationCursor = {
  v: 1
  organizationId: string
  afterAgentId: string
  exp: number
}

export class MtmLatestLocationReconciliationCursorError extends Error {
  constructor(
    public readonly code:
      | "MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_INVALID"
      | "MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_EXPIRED",
  ) {
    super(code)
  }
}

export type MtmLatestLocationReconciliationResult = {
  processedAgents: number
  reconciledLocations: number
  missingRawLocations: number
  morePending: boolean
  nextAfterAgentId: string | null
  retryableFailure: boolean
}

function nonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 191 && !/[\r\n\t\f\v]/.test(value)
}

function parseCursor(value: unknown, nowMs: number): MtmLatestLocationReconciliationCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MtmLatestLocationReconciliationCursorError("MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_INVALID")
  }
  const cursor = value as Record<string, unknown>
  if (
    cursor.v !== 1 ||
    !nonEmptyId(cursor.organizationId) ||
    !nonEmptyId(cursor.afterAgentId) ||
    typeof cursor.exp !== "number" ||
    !Number.isSafeInteger(cursor.exp)
  ) {
    throw new MtmLatestLocationReconciliationCursorError("MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_INVALID")
  }
  if (cursor.exp <= nowMs) {
    throw new MtmLatestLocationReconciliationCursorError("MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_EXPIRED")
  }
  return cursor as MtmLatestLocationReconciliationCursor
}

/**
 * The repair continuation is opaque and tenant-bound. It contains no GPS
 * coordinates or raw IDs and is not a mobile sync cursor.
 */
export function issueMtmLatestLocationReconciliationCursor(input: {
  organizationId: string
  afterAgentId: string
  nowMs?: number
}): string {
  return encryptToken(JSON.stringify({
    v: 1,
    organizationId: input.organizationId,
    afterAgentId: input.afterAgentId,
    exp: (input.nowMs ?? Date.now()) + MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_TTL_MS,
  } satisfies MtmLatestLocationReconciliationCursor), CURSOR_PURPOSE)
}

export function readMtmLatestLocationReconciliationCursor(
  token: string,
  nowMs = Date.now(),
): MtmLatestLocationReconciliationCursor {
  const payload = token.slice(3)
  if (
    token.length === 0 ||
    token.length > MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_MAX_LENGTH ||
    !token.startsWith("v1:") ||
    !/^[A-Za-z0-9_-]+$/.test(payload) ||
    // Node's permissive base64 decoder can otherwise silently discard a
    // trailing non-canonical sextet. Reject it before AES-GCM verification so
    // a cursor has exactly one accepted wire representation.
    payload.length % 4 === 1
  ) {
    throw new MtmLatestLocationReconciliationCursorError("MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_INVALID")
  }

  let decrypted: string
  try {
    decrypted = decryptToken(token, CURSOR_PURPOSE)
  } catch (error) {
    if (error instanceof DecryptError) {
      throw new MtmLatestLocationReconciliationCursorError("MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_INVALID")
    }
    throw error
  }

  try {
    return parseCursor(JSON.parse(decrypted), nowMs)
  } catch (error) {
    if (error instanceof MtmLatestLocationReconciliationCursorError) throw error
    throw new MtmLatestLocationReconciliationCursorError("MTM_LATEST_LOCATION_RECONCILIATION_CURSOR_INVALID")
  }
}

/**
 * Repair pre-projection raw GPS rows for one tenant in a deliberately small,
 * resumable page. This is an operator primitive, not a global scheduler: an
 * external caller must round-robin tenants instead of letting one noisy tenant
 * monopolize a maintenance cycle.
 *
 * It never writes or deletes raw GPS, v1 idempotency, a mutation outbox or a
 * sync change log. Replaying the same continuation is safe because the
 * projection update is monotonic by recordedAt.
 */
export async function reconcileMtmLatestLocations(input: {
  organizationId: string
  afterAgentId?: string | null
  now?: Date
  maxAgents?: number
}): Promise<MtmLatestLocationReconciliationResult> {
  const requestedMaxAgents = Number.isSafeInteger(input.maxAgents)
    ? input.maxAgents as number
    : MTM_LATEST_LOCATION_RECONCILIATION_MAX_AGENTS
  const maxAgents = Math.min(
    MTM_LATEST_LOCATION_RECONCILIATION_MAX_AGENTS,
    Math.max(1, requestedMaxAgents),
  )
  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - GPS_RAW_RETENTION_MS)
  const afterAgentId = input.afterAgentId ?? null
  const candidates = await prisma.mtmAgent.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      ...(afterAgentId ? { id: { gt: afterAgentId } } : {}),
      locations: {
        some: {
          organizationId: input.organizationId,
          recordedAt: { gte: cutoff },
          latitude: { gte: -90, lte: 90 },
          longitude: { gte: -180, lte: 180 },
        },
      },
    },
    orderBy: { id: "asc" },
    take: maxAgents + 1,
    select: { id: true },
  })

  let processedAgents = 0
  let reconciledLocations = 0
  let missingRawLocations = 0
  let nextAfterAgentId = afterAgentId
  for (const candidate of candidates.slice(0, maxAgents)) {
    try {
      // The tenant predicate is repeated on the raw lookup even though the
      // selected agent was tenant-scoped. This keeps the repair safe if a
      // caller ever changes the candidate query or an agent relationship.
      const location = await prisma.mtmAgentLocation.findFirst({
        where: {
          organizationId: input.organizationId,
          agentId: candidate.id,
          recordedAt: { gte: cutoff },
          latitude: { gte: -90, lte: 90 },
          longitude: { gte: -180, lte: 180 },
        },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          payloadSha256: true,
          latitude: true,
          longitude: true,
          accuracy: true,
          speed: true,
          heading: true,
          altitude: true,
          battery: true,
          isMoving: true,
          recordedAt: true,
        },
      })
      if (!location) {
        missingRawLocations += 1
        processedAgents += 1
        nextAfterAgentId = candidate.id
        continue
      }

      await prisma.$transaction(async (tx) => {
        await advanceMtmAgentLatestLocation(tx, {
          organizationId: input.organizationId,
          agentId: candidate.id,
          sourceLocationId: location.id,
          payloadSha256: location.payloadSha256,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          speed: location.speed,
          heading: location.heading,
          altitude: location.altitude,
          battery: location.battery,
          isMoving: location.isMoving,
          recordedAt: location.recordedAt,
          // A legacy raw row has no server-receipt timestamp. Use the durable
          // point timestamp so repeating this repair cannot produce a new
          // authoritative value or make a live marker move backwards.
          receivedAt: location.recordedAt,
        })
      })
      reconciledLocations += 1
      processedAgents += 1
      nextAfterAgentId = candidate.id
    } catch {
      // Do not skip an agent after a transient DB/projection failure. The
      // continuation remains at the last completed agent and the cron route
      // returns a retryable response, so a replay is idempotent and lossless.
      return {
        processedAgents,
        reconciledLocations,
        missingRawLocations,
        morePending: true,
        nextAfterAgentId,
        retryableFailure: true,
      }
    }
  }

  return {
    processedAgents,
    reconciledLocations,
    missingRawLocations,
    morePending: candidates.length > maxAgents,
    nextAfterAgentId: candidates.length > 0 ? nextAfterAgentId : null,
    retryableFailure: false,
  }
}
