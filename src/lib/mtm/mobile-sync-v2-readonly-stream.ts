import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import type { MobileAuthResult } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import type { MtmMobileTenantModule } from "@/lib/mtm/mobile-capability-manifest"
import {
  MobileSyncV2CursorError,
  MobileSyncV2ResnapshotRequiredError,
  MTM_MOBILE_SYNC_V2_SNAPSHOT_TTL_MS,
  nextMobileSyncV2DeltaCursor,
  nextMobileSyncV2SnapshotCursor,
  parseMobileSyncV2DeviceId,
  parseMobileSyncV2PageSize,
  readMobileSyncV2Cursor,
  type MtmMobileSyncV2Horizon,
  type MtmMobileSyncV2Stream,
  type MobileSyncV2CursorContext,
} from "@/lib/mtm/mobile-sync-v2"
import { recordMtmMobileSyncPullTelemetry, type MtmMobileSyncResultClass } from "@/lib/mtm/mobile-sync-telemetry"
import { consumeMtmMobileSyncV2RateLimit } from "@/lib/mtm/mobile-sync-v2-rate-guard"
import { isValidTimezone } from "@/lib/timezone"

/**
 * Shared durable pull machinery for the post-routes read-only pilots. It is
 * intentionally separate from the frozen routes handler: adopting a second
 * stream cannot alter an already piloted cursor/snapshot path. The caller
 * supplies only a PII-free projection and server-side audience predicate.
 */

const SNAPSHOT_WRITE_CHUNK_SIZE = 250
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000
const DEFAULT_RECOMMENDED_REDUCED_PAGE_SIZE = 100
const SNAPSHOT_LEASE_MS = 60_000

// `src/lib/prisma` wraps the client in a runtime RLS proxy whose generic type
// is intentionally erased. This is only a compile-time view of that exact
// proxy, not a second client: all calls still keep the active RLS context.
const mobileSyncDatabase = prisma as unknown as PrismaClient

type JsonProjection = Record<string, unknown>

export type MtmMobileSyncV2ReadonlyStreamConfig<TSource, TProjection extends JsonProjection> = {
  stream: MtmMobileSyncV2Stream
  entityType: string
  endpoint: string
  module: Exclude<MtmMobileTenantModule, "commercial">
  horizon: (timezone: string, now: Date) => MtmMobileSyncV2Horizon
  /** Deterministic id-keyset snapshot reader. It must return at most `take`. */
  readSnapshotChunk: (input: {
    tx: Prisma.TransactionClient
    organizationId: string
    agentId: string
    timezone: string
    now: Date
    afterId: string | null
    take: number
  }) => Promise<readonly TSource[]>
  sourceId: (source: TSource) => string
  project: (source: TSource) => TProjection
  /**
   * Re-reads only addressed UPSERT ids with the exact current server scope
   * and horizon. Missing ids intentionally become no-op deltas: their
   * trigger must have emitted a tombstone when cache removal is required.
   */
  readDeltaProjections: (input: {
    tx: Prisma.TransactionClient
    organizationId: string
    agentId: string
    timezone: string
    now: Date
    entityIds: readonly string[]
  }) => Promise<ReadonlyMap<string, TProjection>>
  maxResponseBytes?: number
  recommendedReducedPageSize?: number
}

type LockedAgentScope = { scopeRevision: bigint }
type SnapshotLeaseClaim = { leaseToken: string }

type StreamItem<TProjection extends JsonProjection> = {
  entityType: string
  id: string
  // Snapshot rows use their immutable boundary revision; delta rows use the
  // journal revision. A v2 item is never unversioned.
  revision: string
  data: TProjection
}

class MobileSyncV2ReadonlySnapshotLeaseBusyError extends Error {
  constructor() {
    super("MOBILE_SYNC_V2_SNAPSHOT_LEASE_BUSY")
    this.name = "MobileSyncV2ReadonlySnapshotLeaseBusyError"
  }
}

class MobileSyncV2ReadonlyInitialSnapshotGuardError extends Error {
  constructor(
    public readonly unavailable: boolean,
    public readonly retryAfterSeconds: number,
  ) {
    super(unavailable ? "MOBILE_SYNC_V2_UNAVAILABLE" : "MOBILE_SYNC_V2_RATE_LIMITED")
    this.name = "MobileSyncV2ReadonlyInitialSnapshotGuardError"
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, { ...init, headers })
}

function jsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8")
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function rateLimitRetryAfter(seconds: number): string {
  return String(Math.max(1, Math.min(60, Number.isFinite(seconds) ? Math.ceil(seconds) : 60)))
}

function streamItem<TProjection extends JsonProjection>(
  config: Pick<MtmMobileSyncV2ReadonlyStreamConfig<unknown, TProjection>, "entityType">,
  projection: TProjection,
  revision: string,
): StreamItem<TProjection> {
  const id = projection.id
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("MOBILE_SYNC_V2_PROJECTION_ID_INVALID")
  }
  return { entityType: config.entityType, id, revision, data: projection }
}

async function ensureStreamState(organizationId: string, stream: MtmMobileSyncV2Stream): Promise<void> {
  await mobileSyncDatabase.$executeRaw`
    INSERT INTO "mtm_mobile_sync_streams" (
      "organizationId", "stream", "revision", "retentionFloorRevision", "createdAt", "updatedAt"
    ) VALUES (
      ${organizationId}, ${stream}, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "stream") DO NOTHING
  `
}

async function ensureAgentScope(input: {
  organizationId: string
  agentId: string
  stream: MtmMobileSyncV2Stream
}): Promise<void> {
  await mobileSyncDatabase.$executeRaw`
    INSERT INTO "mtm_mobile_sync_agent_scopes" (
      "organizationId", "stream", "agentId", "scopeRevision", "createdAt", "updatedAt"
    ) VALUES (
      ${input.organizationId}, ${input.stream}, ${input.agentId}, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "stream", "agentId") DO NOTHING
  `
}

async function ensureStreamAnchor(input: {
  organizationId: string
  agentId: string
  stream: MtmMobileSyncV2Stream
}): Promise<void> {
  // The scope's composite FK needs its parent stream before the independent
  // actor row. Do not turn this into Promise.all: a first-use tenant must be
  // deterministic even under two concurrently booting devices.
  await ensureStreamState(input.organizationId, input.stream)
  await ensureAgentScope(input)
}

async function lockAgentScope(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { organizationId: string; agentId: string; stream: MtmMobileSyncV2Stream },
): Promise<bigint> {
  const rows = await tx.$queryRaw<LockedAgentScope[]>(Prisma.sql`
    SELECT "scopeRevision"
    FROM "mtm_mobile_sync_agent_scopes"
    WHERE "organizationId" = ${input.organizationId}
      AND "stream" = ${input.stream}
      AND "agentId" = ${input.agentId}
    FOR UPDATE
  `)
  const row = rows[0]
  if (!row) throw new Error("MOBILE_SYNC_V2_AGENT_SCOPE_MISSING")
  return row.scopeRevision
}

async function acquireSnapshotLease(input: {
  organizationId: string
  agentId: string
  deviceId: string
  stream: MtmMobileSyncV2Stream
  horizonKey: string
}): Promise<string | null> {
  const leaseToken = randomUUID()
  const rows = await mobileSyncDatabase.$queryRaw<SnapshotLeaseClaim[]>(Prisma.sql`
    INSERT INTO "mtm_mobile_sync_snapshot_leases" (
      "organizationId", "stream", "agentId", "deviceId", "horizonKey",
      "leaseToken", "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      ${input.organizationId}, ${input.stream}, ${input.agentId}, ${input.deviceId}, ${input.horizonKey},
      ${leaseToken}, CURRENT_TIMESTAMP + (${SNAPSHOT_LEASE_MS} * INTERVAL '1 millisecond'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "stream", "agentId", "deviceId", "horizonKey")
    DO UPDATE SET
      "leaseToken" = EXCLUDED."leaseToken",
      "expiresAt" = EXCLUDED."expiresAt",
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "mtm_mobile_sync_snapshot_leases"."expiresAt" <= CURRENT_TIMESTAMP
    RETURNING "leaseToken"
  `)
  return rows.length > 0 ? leaseToken : null
}

async function releaseSnapshotLease(input: {
  organizationId: string
  agentId: string
  deviceId: string
  stream: MtmMobileSyncV2Stream
  horizonKey: string
  leaseToken: string
}): Promise<void> {
  await mobileSyncDatabase.mtmMobileSyncSnapshotLease.deleteMany({
    where: {
      organizationId: input.organizationId,
      stream: input.stream,
      agentId: input.agentId,
      deviceId: input.deviceId,
      horizonKey: input.horizonKey,
      leaseToken: input.leaseToken,
    },
  })
}

async function readReusableSnapshotInTransaction<TSource, TProjection extends JsonProjection>(
  config: MtmMobileSyncV2ReadonlyStreamConfig<TSource, TProjection>,
  tx: Pick<Prisma.TransactionClient, "mtmMobileSyncSnapshot" | "mtmMobileSyncSnapshotItem">,
  input: {
    organizationId: string
    agentId: string
    deviceId: string
    horizonKey: string
    now: Date
    pageSize: number
    scopeRevision: bigint
  },
) {
  const reusable = await tx.mtmMobileSyncSnapshot.findFirst({
    where: {
      organizationId: input.organizationId,
      stream: config.stream,
      agentId: input.agentId,
      deviceId: input.deviceId,
      horizonKey: input.horizonKey,
      scopeRevision: input.scopeRevision,
      expiresAt: { gt: input.now },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, boundaryRevision: true, scopeRevision: true, expiresAt: true },
  })
  if (!reusable) return null

  const rows = await tx.mtmMobileSyncSnapshotItem.findMany({
    where: { organizationId: input.organizationId, snapshotId: reusable.id, ordinal: { gt: 0 } },
    orderBy: { ordinal: "asc" },
    take: input.pageSize + 1,
    select: { payload: true },
  })
  return {
    snapshotId: reusable.id,
    expiresAt: reusable.expiresAt,
    state: { revision: reusable.boundaryRevision, scopeRevision: reusable.scopeRevision },
    firstPage: rows.slice(0, input.pageSize).map((row) => row.payload as unknown as TProjection),
    hasMore: rows.length > input.pageSize,
  }
}

async function readReusableSnapshot<TSource, TProjection extends JsonProjection>(
  config: MtmMobileSyncV2ReadonlyStreamConfig<TSource, TProjection>,
  input: {
    organizationId: string
    agentId: string
    deviceId: string
    horizonKey: string
    now: Date
    pageSize: number
  },
) {
  // Keep the bounded network guard outside this short scope preflight. The
  // durable lease remains held until the builder exits, so the final RR
  // transaction can safely recheck the same cache before it writes anything.
  return mobileSyncDatabase.$transaction(async (tx) => {
    const scopeRevision = await lockAgentScope(tx, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      stream: config.stream,
    })
    return readReusableSnapshotInTransaction(config, tx, { ...input, scopeRevision })
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 5_000,
  })
}

async function createSnapshot<TSource, TProjection extends JsonProjection>(
  config: MtmMobileSyncV2ReadonlyStreamConfig<TSource, TProjection>,
  input: {
    organizationId: string
    agentId: string
    userId: string
    deviceId: string
    timezone: string
    now: Date
    pageSize: number
  },
) {
  await ensureStreamAnchor({
    organizationId: input.organizationId,
    agentId: input.agentId,
    stream: config.stream,
  })
  const snapshotId = randomUUID()
  const expiresAt = new Date(input.now.getTime() + MTM_MOBILE_SYNC_V2_SNAPSHOT_TTL_MS)
  const horizon = config.horizon(input.timezone, input.now)
  const leaseToken = await acquireSnapshotLease({
    organizationId: input.organizationId,
    agentId: input.agentId,
    deviceId: input.deviceId,
    stream: config.stream,
    horizonKey: horizon.key,
  })
  if (!leaseToken) throw new MobileSyncV2ReadonlySnapshotLeaseBusyError()

  try {
    const reusable = await readReusableSnapshot(config, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      deviceId: input.deviceId,
      horizonKey: horizon.key,
      now: input.now,
      pageSize: input.pageSize,
    })
    if (reusable) return { ...reusable, horizon }

    const initialGuard = await consumeMtmMobileSyncV2RateLimit({
      stream: config.stream,
      phase: "initial-snapshot",
      organizationId: input.organizationId,
      agentId: input.agentId,
      userId: input.userId,
      deviceId: input.deviceId,
    })
    if (!initialGuard.allowed) {
      throw new MobileSyncV2ReadonlyInitialSnapshotGuardError(initialGuard.unavailable, initialGuard.retryAfterSeconds)
    }

    const state = await mobileSyncDatabase.$transaction(async (tx) => {
      const scopeRevision = await lockAgentScope(tx, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        stream: config.stream,
      })
      const currentReusable = await readReusableSnapshotInTransaction(config, tx, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        deviceId: input.deviceId,
        horizonKey: horizon.key,
        now: input.now,
        pageSize: input.pageSize,
        scopeRevision,
      })
      if (currentReusable) return currentReusable

      const streamState = await tx.mtmMobileSyncStream.findUnique({
        where: { organizationId_stream: { organizationId: input.organizationId, stream: config.stream } },
        select: { revision: true, retentionFloorRevision: true },
      })
      if (!streamState) throw new Error("MOBILE_SYNC_V2_STREAM_STATE_MISSING")

      await tx.mtmMobileSyncSnapshot.create({
        data: {
          id: snapshotId,
          organizationId: input.organizationId,
          stream: config.stream,
          agentId: input.agentId,
          deviceId: input.deviceId,
          boundaryRevision: streamState.revision,
          scopeRevision,
          horizonKey: horizon.key,
          expiresAt,
        },
      })

      let sourceCursor: string | null = null
      let ordinal = 0
      const firstPage: TProjection[] = []
      while (true) {
        const sources = await config.readSnapshotChunk({
          tx,
          organizationId: input.organizationId,
          agentId: input.agentId,
          timezone: input.timezone,
          now: input.now,
          afterId: sourceCursor,
          take: SNAPSHOT_WRITE_CHUNK_SIZE,
        })
        if (sources.length === 0) break
        const projections = sources.map((source) => config.project(source))
        const nextCursor = config.sourceId(sources[sources.length - 1]!)
        if (!nextCursor || nextCursor === sourceCursor) {
          throw new Error("MOBILE_SYNC_V2_SNAPSHOT_KEYSET_INVALID")
        }
        const rows = projections.map((projection) => {
          const entityId = projection.id
          if (typeof entityId !== "string" || entityId.length === 0) {
            throw new Error("MOBILE_SYNC_V2_PROJECTION_ID_INVALID")
          }
          ordinal += 1
          if (firstPage.length < input.pageSize) firstPage.push(projection)
          return {
            id: randomUUID(),
            organizationId: input.organizationId,
            snapshotId,
            ordinal,
            entityType: config.entityType,
            entityId,
            payload: projection as Prisma.InputJsonValue,
          }
        })
        await tx.mtmMobileSyncSnapshotItem.createMany({ data: rows })
        sourceCursor = nextCursor
      }

      return {
        snapshotId,
        expiresAt,
        state: { revision: streamState.revision, scopeRevision },
        firstPage,
        hasMore: ordinal > input.pageSize,
      }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30_000,
    })
    return { ...state, horizon }
  } finally {
    await releaseSnapshotLease({
      organizationId: input.organizationId,
      agentId: input.agentId,
      deviceId: input.deviceId,
      stream: config.stream,
      horizonKey: horizon.key,
      leaseToken,
    }).catch(() => {})
  }
}

async function readSnapshotPage<TSource, TProjection extends JsonProjection>(
  config: MtmMobileSyncV2ReadonlyStreamConfig<TSource, TProjection>,
  input: {
    organizationId: string
    agentId: string
    deviceId: string
    snapshotId: string
    ordinal: number
    pageSize: number
    now: Date
    expectedScopeRevision?: bigint
  },
) {
  await ensureStreamAnchor({
    organizationId: input.organizationId,
    agentId: input.agentId,
    stream: config.stream,
  })
  return mobileSyncDatabase.$transaction(async (tx) => {
    const currentScopeRevision = await lockAgentScope(tx, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      stream: config.stream,
    })
    if (input.expectedScopeRevision != null && currentScopeRevision !== input.expectedScopeRevision) {
      throw new MobileSyncV2ResnapshotRequiredError("SCOPE_CHANGED")
    }
    const snapshot = await tx.mtmMobileSyncSnapshot.findFirst({
      where: {
        id: input.snapshotId,
        organizationId: input.organizationId,
        stream: config.stream,
        agentId: input.agentId,
        deviceId: input.deviceId,
        expiresAt: { gt: input.now },
      },
      select: { id: true, boundaryRevision: true, scopeRevision: true, expiresAt: true },
    })
    if (!snapshot) throw new MobileSyncV2ResnapshotRequiredError("SNAPSHOT_EXPIRED")
    if (snapshot.scopeRevision !== currentScopeRevision) {
      throw new MobileSyncV2ResnapshotRequiredError("SCOPE_CHANGED")
    }
    const rows = await tx.mtmMobileSyncSnapshotItem.findMany({
      where: { organizationId: input.organizationId, snapshotId: snapshot.id, ordinal: { gt: input.ordinal } },
      orderBy: { ordinal: "asc" },
      take: input.pageSize + 1,
      select: { ordinal: true, payload: true },
    })
    const page = rows.slice(0, input.pageSize)
    return {
      snapshot,
      page: page.map((row) => streamItem(config, row.payload as unknown as TProjection, snapshot.boundaryRevision.toString())),
      hasMore: rows.length > input.pageSize,
      lastOrdinal: page[page.length - 1]?.ordinal ?? input.ordinal,
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 30_000,
  })
}

async function readDeltaPage<TSource, TProjection extends JsonProjection>(
  config: MtmMobileSyncV2ReadonlyStreamConfig<TSource, TProjection>,
  input: {
    organizationId: string
    agentId: string
    timezone: string
    now: Date
    revision: bigint
    expectedScopeRevision: bigint
    pageSize: number
  },
) {
  const horizon = config.horizon(input.timezone, input.now)
  await ensureStreamAnchor({
    organizationId: input.organizationId,
    agentId: input.agentId,
    stream: config.stream,
  })
  return mobileSyncDatabase.$transaction(async (tx) => {
    const scopeRevision = await lockAgentScope(tx, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      stream: config.stream,
    })
    if (scopeRevision !== input.expectedScopeRevision) {
      throw new MobileSyncV2ResnapshotRequiredError("SCOPE_CHANGED")
    }
    const streamState = await tx.mtmMobileSyncStream.findUnique({
      where: { organizationId_stream: { organizationId: input.organizationId, stream: config.stream } },
      select: { revision: true, retentionFloorRevision: true },
    })
    if (!streamState) throw new Error("MOBILE_SYNC_V2_STREAM_STATE_MISSING")
    if (input.revision > streamState.revision) {
      throw new MobileSyncV2ResnapshotRequiredError("STREAM_REWOUND")
    }
    if (input.revision < streamState.retentionFloorRevision) {
      throw new MobileSyncV2ResnapshotRequiredError("RETENTION_EXPIRED")
    }
    const headRevision = streamState.revision
    const changes = await tx.mtmMobileSyncChange.findMany({
      where: {
        organizationId: input.organizationId,
        stream: config.stream,
        revision: { gt: input.revision, lte: headRevision },
        audienceAgentId: input.agentId,
      },
      orderBy: { revision: "asc" },
      take: input.pageSize + 1,
      select: {
        revision: true,
        changeType: true,
        entityType: true,
        entityId: true,
        audienceAgentId: true,
        tombstoneReason: true,
      },
    })
    const page = changes.slice(0, input.pageSize)
    const hasMore = changes.length > input.pageSize
    const entityIds = [...new Set(page
      .filter((change) => change.changeType === "UPSERT" && change.entityType === config.entityType)
      .map((change) => change.entityId))]
    const projections = entityIds.length
      ? await config.readDeltaProjections({
          tx,
          organizationId: input.organizationId,
          agentId: input.agentId,
          timezone: input.timezone,
          now: input.now,
          entityIds,
        })
      : new Map<string, TProjection>()

    const items: StreamItem<TProjection>[] = []
    const tombstones: Array<{ entityType: string; id: string; revision: string; reason: string | null }> = []
    for (const change of page) {
      if (change.audienceAgentId !== input.agentId) continue
      // A stream is one public projection contract. The trigger migration
      // currently writes only this entity type, but refusing a future stray
      // journal entity avoids leaking an unreviewed tombstone shape to an
      // already-enrolled APK.
      if (change.entityType !== config.entityType) continue
      if (change.changeType === "TOMBSTONE") {
        tombstones.push({
          entityType: change.entityType,
          id: change.entityId,
          revision: change.revision.toString(),
          reason: change.tombstoneReason,
        })
        continue
      }
      const projection = projections.get(change.entityId)
      if (projection) items.push(streamItem(config, projection, change.revision.toString()))
    }
    return {
      horizon,
      items,
      tombstones,
      hasMore,
      scopeRevision,
      lastRevision: hasMore ? (page[page.length - 1]?.revision ?? input.revision) : headRevision,
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 30_000,
  })
}

function snapshotResponse<TSource, TProjection extends JsonProjection>(
  config: MtmMobileSyncV2ReadonlyStreamConfig<TSource, TProjection>,
  input: {
    context: MobileSyncV2CursorContext
    snapshotId: string
    boundaryRevision: bigint
    scopeRevision: bigint
    horizonKey: string
    expiresAt: Date
    items: StreamItem<TProjection>[]
    lastOrdinal: number
    hasMore: boolean
  },
) {
  const boundary = nextMobileSyncV2DeltaCursor({
    context: input.context,
    revision: input.boundaryRevision,
    scopeRevision: input.scopeRevision,
    horizonKey: input.horizonKey,
  })
  return {
    success: true,
    protocolVersion: 2,
    stream: config.stream,
    snapshotId: input.snapshotId,
    boundary,
    items: input.items,
    tombstones: [],
    nextPage: input.hasMore
      ? nextMobileSyncV2SnapshotCursor({
          context: input.context,
          snapshotId: input.snapshotId,
          ordinal: input.lastOrdinal,
          scopeRevision: input.scopeRevision,
          horizonKey: input.horizonKey,
          expiresAt: input.expiresAt,
        })
      : null,
    complete: !input.hasMore,
    nextCursor: input.hasMore ? null : boundary,
  }
}

/**
 * Execute an additive, exact-cohort v2 pull. The caller still wraps this in
 * `withMobileRls`, preserving the route handler's authenticated RLS boundary.
 */
export async function handleMtmMobileSyncV2ReadonlyStream<TSource, TProjection extends JsonProjection>(
  req: NextRequest,
  auth: MobileAuthResult,
  config: MtmMobileSyncV2ReadonlyStreamConfig<TSource, TProjection>,
): Promise<NextResponse> {
  const startedAt = Date.now()
  const apkVersion = req.headers.get("x-field-apk-version")
  const maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const recommendedReducedPageSize = config.recommendedReducedPageSize ?? DEFAULT_RECOMMENDED_REDUCED_PAGE_SIZE
  const respond = (body: unknown, init: ResponseInit | undefined, result: MtmMobileSyncResultClass) => {
    if (result === "ok" && jsonByteLength(body) > maxResponseBytes) {
      const limited = {
        error: "Sync page is too large; retry with a smaller limit",
        code: "MOBILE_SYNC_V2_PAYLOAD_TOO_LARGE",
        recommendedPageSize: recommendedReducedPageSize,
      }
      recordMtmMobileSyncPullTelemetry({
        organizationId: auth.orgId,
        stream: config.stream,
        endpoint: config.endpoint,
        contractVersion: 2,
        apkVersion,
        result: "payload_too_large",
        durationMs: Date.now() - startedAt,
        response: limited,
      })
      return noStoreJson(limited, { status: 413 })
    }
    recordMtmMobileSyncPullTelemetry({
      organizationId: auth.orgId,
      stream: config.stream,
      endpoint: config.endpoint,
      contractVersion: 2,
      apkVersion,
      result,
      durationMs: Date.now() - startedAt,
      response: body,
    })
    return noStoreJson(body, init)
  }

  try {
    const permission = config.module === "workforceHrm" ? "WORKTIME_SELF_READ" : "ROUTE_EXECUTE"
    const forbidden = requireMobilePermission(auth, permission)
    if (forbidden) {
      forbidden.headers.set("Cache-Control", "no-store")
      const body = await forbidden.clone().json().catch(() => ({ code: "MTM_MOBILE_PERMISSION_REQUIRED" }))
      return respond(body, { status: forbidden.status, headers: forbidden.headers }, "forbidden")
    }

    const { searchParams } = new URL(req.url)
    const cursorRaw = searchParams.get("cursor")
    const deviceId = parseMobileSyncV2DeviceId(req.headers.get("x-field-device-id"))
    if (!deviceId) {
      return respond(
        { error: "A valid x-field-device-id header is required", code: "MOBILE_SYNC_V2_DEVICE_REQUIRED" },
        { status: 400 },
        "invalid_request",
      )
    }
    const now = new Date()
    const cohort = await mobileSyncDatabase.mtmMobileSyncCohort.findFirst({
      where: {
        organizationId: auth.orgId,
        stream: config.stream,
        agentId: auth.agentId,
        deviceId,
        enabled: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    })
    if (!cohort) {
      return respond(
        { error: "This device is not enrolled in the mobile sync v2 pilot", code: "MOBILE_SYNC_V2_COHORT_DISABLED" },
        { status: 403 },
        "cohort_disabled",
      )
    }
    const pullGuard = await consumeMtmMobileSyncV2RateLimit({
      stream: config.stream,
      phase: "pull",
      organizationId: auth.orgId,
      agentId: auth.agentId,
      userId: auth.userId,
      deviceId,
    })
    if (!pullGuard.allowed) {
      return respond(
        pullGuard.unavailable
          ? { error: "Sync protection is temporarily unavailable", code: "MOBILE_SYNC_V2_UNAVAILABLE" }
          : { error: "Sync is temporarily rate limited", code: "MOBILE_SYNC_V2_RATE_LIMITED" },
        pullGuard.unavailable
          ? { status: 503, headers: { "Retry-After": "5" } }
          : { status: 429, headers: { "Retry-After": rateLimitRetryAfter(pullGuard.retryAfterSeconds) } },
        pullGuard.unavailable ? "unavailable" : "rate_limited",
      )
    }

    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const pageSize = parseMobileSyncV2PageSize(searchParams.get("limit"))
    const context: MobileSyncV2CursorContext = {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      deviceId,
      stream: config.stream,
    }

    if (!cursorRaw) {
      const snapshot = await createSnapshot(config, {
        organizationId: auth.orgId,
        agentId: auth.agentId,
        userId: auth.userId,
        deviceId,
        timezone,
        now,
        pageSize,
      })
      return respond(snapshotResponse(config, {
        context,
        snapshotId: snapshot.snapshotId,
        boundaryRevision: snapshot.state.revision,
        scopeRevision: snapshot.state.scopeRevision,
        horizonKey: snapshot.horizon.key,
        expiresAt: snapshot.expiresAt,
        items: snapshot.firstPage.map((projection) => streamItem(config, projection, snapshot.state.revision.toString())),
        lastOrdinal: snapshot.firstPage.length,
        hasMore: snapshot.hasMore,
      }), undefined, "ok")
    }

    const cursor = readMobileSyncV2Cursor(cursorRaw, context, now.getTime())
    const horizon = config.horizon(timezone, now)
    if (cursor.horizonKey !== horizon.key) {
      throw new MobileSyncV2ResnapshotRequiredError("HORIZON_CHANGED")
    }
    if (cursor.kind === "snapshot") {
      const page = await readSnapshotPage(config, {
        organizationId: auth.orgId,
        agentId: auth.agentId,
        deviceId,
        snapshotId: cursor.snapshotId,
        ordinal: cursor.ordinal,
        pageSize,
        now,
        expectedScopeRevision: BigInt(cursor.scopeRevision),
      })
      const nextPage = page.hasMore
        ? nextMobileSyncV2SnapshotCursor({
            context,
            snapshotId: page.snapshot.id,
            ordinal: page.lastOrdinal,
            scopeRevision: page.snapshot.scopeRevision,
            horizonKey: horizon.key,
            expiresAt: page.snapshot.expiresAt,
          })
        : null
      const nextCursor = page.hasMore
        ? null
        : nextMobileSyncV2DeltaCursor({
            context,
            revision: page.snapshot.boundaryRevision,
            scopeRevision: page.snapshot.scopeRevision,
            horizonKey: horizon.key,
          })
      return respond({
        success: true,
        protocolVersion: 2,
        stream: config.stream,
        snapshotId: page.snapshot.id,
        items: page.page,
        tombstones: [],
        nextPage,
        complete: !page.hasMore,
        nextCursor,
      }, undefined, "ok")
    }

    const page = await readDeltaPage(config, {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      timezone,
      now,
      revision: BigInt(cursor.revision),
      expectedScopeRevision: BigInt(cursor.scopeRevision),
      pageSize,
    })
    return respond({
      success: true,
      protocolVersion: 2,
      stream: config.stream,
      items: page.items,
      tombstones: page.tombstones,
      nextPage: null,
      complete: !page.hasMore,
      nextCursor: nextMobileSyncV2DeltaCursor({
        context,
        revision: page.lastRevision,
        scopeRevision: page.scopeRevision,
        horizonKey: page.horizon.key,
      }),
    }, undefined, "ok")
  } catch (error) {
    if (error instanceof MobileSyncV2ReadonlySnapshotLeaseBusyError) {
      return respond(
        { error: "A sync snapshot is already being prepared; retry shortly", code: error.message },
        { status: 429, headers: { "Retry-After": "2" } },
        "rate_limited",
      )
    }
    if (error instanceof MobileSyncV2ReadonlyInitialSnapshotGuardError) {
      return respond(
        error.unavailable
          ? { error: "Sync protection is temporarily unavailable", code: error.message }
          : { error: "Snapshot creation is temporarily rate limited", code: error.message },
        error.unavailable
          ? { status: 503, headers: { "Retry-After": "5" } }
          : { status: 429, headers: { "Retry-After": rateLimitRetryAfter(error.retryAfterSeconds) } },
        error.unavailable ? "unavailable" : "rate_limited",
      )
    }
    if (error instanceof MobileSyncV2CursorError) {
      if (error.code === "MOBILE_SYNC_V2_CURSOR_EXPIRED") {
        return respond({
          error: "The sync cursor expired; rebuild this stream",
          code: "MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED",
          reason: "CURSOR_EXPIRED",
          resnapshotRequired: true,
        }, { status: 409 }, "resnapshot_required")
      }
      return respond({ error: "Invalid sync cursor", code: error.code }, { status: 400 }, "invalid_cursor")
    }
    if (error instanceof MobileSyncV2ResnapshotRequiredError) {
      return respond({
        error: "This stream must be rebuilt before it can continue",
        code: "MOBILE_SYNC_V2_RESNAPSHOT_REQUIRED",
        reason: error.reason,
        resnapshotRequired: true,
      }, { status: 409 }, "resnapshot_required")
    }
    // Never include request cursor, device selector, projection, GPS, or
    // free-form task/visit data in the response. The internal error object is
    // retained only for server diagnosis, matching the existing routes pilot.
    console.error(`[MTM/mobile-sync-v2 ${config.stream} GET]`, error)
    return respond(
      { error: "Sync is temporarily unavailable", code: "MOBILE_SYNC_V2_UNAVAILABLE" },
      { status: 503, headers: { "Retry-After": "5" } },
      "unavailable",
    )
  }
}
