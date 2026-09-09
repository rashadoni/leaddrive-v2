import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import {
  MobileSyncV2CursorError,
  MobileSyncV2ResnapshotRequiredError,
  MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
  MTM_MOBILE_SYNC_V2_SNAPSHOT_TTL_MS,
  mobileSyncV2RouteHorizon,
  mobileSyncV2RoutePilotWhere,
  nextMobileSyncV2DeltaCursor,
  nextMobileSyncV2SnapshotCursor,
  parseMobileSyncV2DeviceId,
  parseMobileSyncV2PageSize,
  projectMtmMobileSyncV2Route,
  readMobileSyncV2Cursor,
  type MobileSyncV2CursorContext,
} from "@/lib/mtm/mobile-sync-v2"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { consumeMtmMobileSyncV2RateLimit } from "@/lib/mtm/mobile-sync-v2-rate-guard"
import { recordMtmMobileSyncPullTelemetry, type MtmMobileSyncResultClass } from "@/lib/mtm/mobile-sync-telemetry"

/**
 * GET /api/v2/mtm/mobile/sync/routes
 *
 * Server-first, read-only v2 routes pilot. The v1 timestamp/offset pull is
 * intentionally left untouched for installed APKs. A caller has to pass all
 * three fences before any data query: mobile permission, tenant module and
 * exact agent/device cohort.
 */

const SNAPSHOT_WRITE_CHUNK_SIZE = 250
const MAX_ROUTE_SYNC_RESPONSE_BYTES = 1_500_000
const RECOMMENDED_REDUCED_PAGE_SIZE = 100
// The immutable snapshot transaction times out at 30 seconds below. Keep the
// durable builder lease longer than that to tolerate client/process cleanup,
// but short enough that a killed request recovers without operator action.
const ROUTE_SNAPSHOT_LEASE_MS = 60_000

// The exported prisma client is an RLS proxy with erased generics. Keep the
// runtime proxy (and therefore its tenant context) while restoring Prisma's
// compile-time contract for this safety-critical read path.
const mobileSyncDatabase = prisma as unknown as PrismaClient

const routeProjectionSelect = {
  id: true,
  agentId: true,
  date: true,
  name: true,
  status: true,
  version: true,
  publishedVersion: true,
  totalPoints: true,
  visitedPoints: true,
  updatedAt: true,
  assignments: {
    where: { removedAt: null, role: { not: "OBSERVER" } },
    select: { agentId: true, role: true, assignedAt: true },
    orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
  },
  points: {
    where: { deletedAt: null },
    select: {
      id: true,
      customerId: true,
      contactId: true,
      orderIndex: true,
      status: true,
      plannedTime: true,
      visitedAt: true,
    },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.MtmRouteSelect

type RouteProjection = ReturnType<typeof projectMtmMobileSyncV2Route>

type LockedAgentScope = {
  scopeRevision: bigint
}

type SnapshotLeaseClaim = {
  leaseToken: string
}

class MobileSyncV2SnapshotLeaseBusyError extends Error {
  constructor() {
    super("MOBILE_SYNC_V2_SNAPSHOT_LEASE_BUSY")
    this.name = "MobileSyncV2SnapshotLeaseBusyError"
  }
}

class MobileSyncV2InitialSnapshotGuardError extends Error {
  constructor(
    public readonly unavailable: boolean,
    public readonly retryAfterSeconds: number,
  ) {
    super(unavailable ? "MOBILE_SYNC_V2_UNAVAILABLE" : "MOBILE_SYNC_V2_RATE_LIMITED")
    this.name = "MobileSyncV2InitialSnapshotGuardError"
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, {
    ...init,
    headers,
  })
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

function routeItem(projection: RouteProjection, revision: string | null) {
  return {
    entityType: "route" as const,
    id: projection.id,
    revision,
    data: projection,
  }
}

async function ensureRouteStreamState(organizationId: string): Promise<void> {
  // Use an explicit database no-op conflict path. It makes the read-path
  // anchor intent unambiguous and keeps stream creation race-safe without
  // advancing any business revision.
  await mobileSyncDatabase.$executeRaw`
    INSERT INTO "mtm_mobile_sync_streams" (
      "organizationId", "stream", "revision", "retentionFloorRevision", "createdAt", "updatedAt"
    ) VALUES (
      ${organizationId}, ${MTM_MOBILE_SYNC_V2_ROUTE_STREAM}, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "stream") DO NOTHING
  `
}

async function ensureRouteAgentScope(input: {
  organizationId: string
  agentId: string
}): Promise<void> {
  // The parent stream anchor is inserted first. Like the stream path, use an
  // explicit no-op conflict rather than an @updatedAt upsert: polling must not
  // lock/write this actor fence unless a business membership transaction
  // actually advances its revision.
  await mobileSyncDatabase.$executeRaw`
    INSERT INTO "mtm_mobile_sync_agent_scopes" (
      "organizationId", "stream", "agentId", "scopeRevision", "createdAt", "updatedAt"
    ) VALUES (
      ${input.organizationId}, ${MTM_MOBILE_SYNC_V2_ROUTE_STREAM}, ${input.agentId}, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("organizationId", "stream", "agentId") DO NOTHING
  `
}

async function lockRouteAgentScope(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { organizationId: string; agentId: string },
): Promise<bigint> {
  // This lock uses the exact row that membership triggers update. It gives a
  // snapshot/delta page a linear authorization point: a revoke committed
  // before this lock is observed; one that begins afterwards waits until this
  // page has finished its authorized read.
  const rows = await tx.$queryRaw<LockedAgentScope[]>(Prisma.sql`
    SELECT "scopeRevision"
    FROM "mtm_mobile_sync_agent_scopes"
    WHERE "organizationId" = ${input.organizationId}
      AND "stream" = ${MTM_MOBILE_SYNC_V2_ROUTE_STREAM}
      AND "agentId" = ${input.agentId}
    FOR UPDATE
  `)
  const row = rows[0]
  if (!row) throw new Error("MOBILE_SYNC_V2_AGENT_SCOPE_MISSING")
  return row.scopeRevision
}

async function acquireRouteSnapshotLease(
  input: { organizationId: string; agentId: string; deviceId: string; horizonKey: string },
): Promise<string | null> {
  // This is deliberately a short Read Committed, atomic upsert before the
  // Repeatable Read snapshot transaction. The Prisma RLS wrapper sends
  // `set_config` before interactive callbacks, which would itself establish
  // an older RR snapshot while a blocking lock waits. A durable lease lets a
  // competing initial request return Retry-After instead; once it retries it
  // starts a fresh RR transaction and sees the leader's committed snapshot.
  const leaseToken = randomUUID()
  const rows = await mobileSyncDatabase.$queryRaw<SnapshotLeaseClaim[]>(Prisma.sql`
    INSERT INTO "mtm_mobile_sync_snapshot_leases" (
      "organizationId", "stream", "agentId", "deviceId", "horizonKey",
      "leaseToken", "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      ${input.organizationId}, ${MTM_MOBILE_SYNC_V2_ROUTE_STREAM}, ${input.agentId}, ${input.deviceId}, ${input.horizonKey},
      ${leaseToken}, CURRENT_TIMESTAMP + (${ROUTE_SNAPSHOT_LEASE_MS} * INTERVAL '1 millisecond'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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

async function releaseRouteSnapshotLease(input: {
  organizationId: string
  agentId: string
  deviceId: string
  horizonKey: string
  leaseToken: string
}): Promise<void> {
  await mobileSyncDatabase.mtmMobileSyncSnapshotLease.deleteMany({
    where: {
      organizationId: input.organizationId,
      stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      agentId: input.agentId,
      deviceId: input.deviceId,
      horizonKey: input.horizonKey,
      leaseToken: input.leaseToken,
    },
  })
}

async function readReusableRouteSnapshotInTransaction(
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
      stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      agentId: input.agentId,
      deviceId: input.deviceId,
      horizonKey: input.horizonKey,
      scopeRevision: input.scopeRevision,
      expiresAt: { gt: input.now },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      boundaryRevision: true,
      scopeRevision: true,
      expiresAt: true,
    },
  })
  if (!reusable) return null

  const rows = await tx.mtmMobileSyncSnapshotItem.findMany({
    where: {
      organizationId: input.organizationId,
      snapshotId: reusable.id,
      ordinal: { gt: 0 },
    },
    orderBy: { ordinal: "asc" },
    take: input.pageSize + 1,
    select: { payload: true },
  })
  const page = rows.slice(0, input.pageSize)
  return {
    snapshotId: reusable.id,
    expiresAt: reusable.expiresAt,
    state: {
      revision: reusable.boundaryRevision,
      scopeRevision: reusable.scopeRevision,
    },
    firstPage: page.map((row) => row.payload as RouteProjection),
    hasMore: rows.length > input.pageSize,
  }
}

async function readReusableRouteSnapshot(input: {
  organizationId: string
  agentId: string
  deviceId: string
  horizonKey: string
  now: Date
  pageSize: number
}) {
  // This short preflight owns only the actor scope lock. Keep the Redis rate
  // guard outside it: a network timeout must never hold a Repeatable Read
  // transaction or delay a scope revoke. The durable device/horizon lease
  // remains held across preflight and build, so no second builder can create a
  // competing snapshot in the gap.
  return mobileSyncDatabase.$transaction(async (tx) => {
    const scopeRevision = await lockRouteAgentScope(tx, {
      organizationId: input.organizationId,
      agentId: input.agentId,
    })
    return readReusableRouteSnapshotInTransaction(tx, { ...input, scopeRevision })
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 5_000,
  })
}

async function createRouteSnapshot(input: {
  organizationId: string
  agentId: string
  userId: string
  deviceId: string
  timezone: string
  now: Date
  pageSize: number
}) {
  // Ensure the anchor exists before opening the repeatable-read transaction.
  // Its first read and all route projection reads then see the same committed
  // database snapshot. A concurrent business write either appears together
  // with its trigger-appended revision, or appears in the next delta — never
  // as a shifted page under this initial snapshot.
  // The scope row has a composite FK to the stream state. Do this in order,
  // never a Promise.all race where a new tenant scope can arrive before its
  // parent anchor is inserted.
  await ensureRouteStreamState(input.organizationId)
  await ensureRouteAgentScope({ organizationId: input.organizationId, agentId: input.agentId })

  const snapshotId = randomUUID()
  const expiresAt = new Date(input.now.getTime() + MTM_MOBILE_SYNC_V2_SNAPSHOT_TTL_MS)
  const horizon = mobileSyncV2RouteHorizon(input.timezone, input.now)
  const pilotWhere = mobileSyncV2RoutePilotWhere({
    organizationId: input.organizationId,
    agentId: input.agentId,
    timezone: input.timezone,
    now: input.now,
  })

  const leaseToken = await acquireRouteSnapshotLease({
    organizationId: input.organizationId,
    agentId: input.agentId,
    deviceId: input.deviceId,
    horizonKey: horizon.key,
  })
  if (!leaseToken) throw new MobileSyncV2SnapshotLeaseBusyError()

  try {
    const reusable = await readReusableRouteSnapshot({
      organizationId: input.organizationId,
      agentId: input.agentId,
      deviceId: input.deviceId,
      horizonKey: horizon.key,
      now: input.now,
      pageSize: input.pageSize,
    })
    if (reusable) return { ...reusable, horizon }

    // The preflight found no reusable snapshot while the durable lease was
    // held. Do the bounded shared-Redis request before the final RR snapshot
    // transaction so a guard timeout cannot hold an actor-scope lock.
    const initialGuard = await consumeMtmMobileSyncV2RateLimit({
      stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      phase: "initial-snapshot",
      organizationId: input.organizationId,
      agentId: input.agentId,
      userId: input.userId,
      deviceId: input.deviceId,
    })
    if (!initialGuard.allowed) {
      throw new MobileSyncV2InitialSnapshotGuardError(initialGuard.unavailable, initialGuard.retryAfterSeconds)
    }

    const state = await mobileSyncDatabase.$transaction(async (tx) => {
      const scopeRevision = await lockRouteAgentScope(tx, {
        organizationId: input.organizationId,
        agentId: input.agentId,
      })

      // Recheck under the final RR authorization fence. A scope change in the
      // preflight-to-build gap cannot produce a snapshot with the old scope,
      // and an already materialised compatible cache still wins over a write.
      const currentReusable = await readReusableRouteSnapshotInTransaction(tx, {
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
        where: {
          organizationId_stream: {
            organizationId: input.organizationId,
            stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
          },
        },
        select: {
          revision: true,
          retentionFloorRevision: true,
        },
      })
      if (!streamState) throw new Error("MOBILE_SYNC_V2_STREAM_STATE_MISSING")

      await tx.mtmMobileSyncSnapshot.create({
        data: {
          id: snapshotId,
          organizationId: input.organizationId,
          stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
          agentId: input.agentId,
          deviceId: input.deviceId,
          boundaryRevision: streamState.revision,
          scopeRevision,
          horizonKey: horizon.key,
          expiresAt,
        },
      })

      let routeCursor: string | undefined
      let ordinal = 0
      const firstPage: RouteProjection[] = []
      while (true) {
        const routes = await tx.mtmRoute.findMany({
          where: pilotWhere,
          orderBy: [{ date: "asc" }, { id: "asc" }],
          take: SNAPSHOT_WRITE_CHUNK_SIZE,
          ...(routeCursor ? { cursor: { id: routeCursor }, skip: 1 } : {}),
          select: routeProjectionSelect,
        })
        if (routes.length === 0) break

        const items = routes.map((route) => {
          const projection = projectMtmMobileSyncV2Route(route)
          ordinal += 1
          if (firstPage.length < input.pageSize) firstPage.push(projection)
          return {
            id: randomUUID(),
            organizationId: input.organizationId,
            snapshotId,
            ordinal,
            entityType: "route",
            entityId: projection.id,
            payload: projection,
          }
        })
        await tx.mtmMobileSyncSnapshotItem.createMany({ data: items })
        routeCursor = routes[routes.length - 1]?.id
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
    // A failure to release is safe: expiry allows a later retry to claim the
    // lease. Never replace a successful snapshot response with cleanup noise.
    await releaseRouteSnapshotLease({
      organizationId: input.organizationId,
      agentId: input.agentId,
      deviceId: input.deviceId,
      horizonKey: horizon.key,
      leaseToken,
    }).catch(() => {})
  }
}

async function readSnapshotPage(input: {
  organizationId: string
  agentId: string
  deviceId: string
  snapshotId: string
  ordinal: number
  pageSize: number
  now: Date
  expectedScopeRevision?: bigint
}) {
  await ensureRouteStreamState(input.organizationId)
  await ensureRouteAgentScope({ organizationId: input.organizationId, agentId: input.agentId })
  return mobileSyncDatabase.$transaction(async (tx) => {
    const currentScopeRevision = await lockRouteAgentScope(tx, {
      organizationId: input.organizationId,
      agentId: input.agentId,
    })
    if (
      input.expectedScopeRevision != null
      && currentScopeRevision !== input.expectedScopeRevision
    ) {
      throw new MobileSyncV2ResnapshotRequiredError("SCOPE_CHANGED")
    }

    const snapshot = await tx.mtmMobileSyncSnapshot.findFirst({
      where: {
        id: input.snapshotId,
        organizationId: input.organizationId,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
        agentId: input.agentId,
        deviceId: input.deviceId,
        expiresAt: { gt: input.now },
      },
      select: {
        id: true,
        boundaryRevision: true,
        scopeRevision: true,
        expiresAt: true,
      },
    })
    if (!snapshot) throw new MobileSyncV2ResnapshotRequiredError("SNAPSHOT_EXPIRED")
    if (snapshot.scopeRevision !== currentScopeRevision) {
      throw new MobileSyncV2ResnapshotRequiredError("SCOPE_CHANGED")
    }

    const rows = await tx.mtmMobileSyncSnapshotItem.findMany({
      where: {
        organizationId: input.organizationId,
        snapshotId: snapshot.id,
        ordinal: { gt: input.ordinal },
      },
      orderBy: { ordinal: "asc" },
      take: input.pageSize + 1,
      select: { ordinal: true, payload: true },
    })
    const page = rows.slice(0, input.pageSize)
    const hasMore = rows.length > input.pageSize
    const lastOrdinal = page[page.length - 1]?.ordinal ?? input.ordinal

    return {
      snapshot,
      page: page.map((row) => routeItem(row.payload as RouteProjection, snapshot.boundaryRevision.toString())),
      hasMore,
      lastOrdinal,
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 30_000,
  })
}

function snapshotResponse(input: {
  context: MobileSyncV2CursorContext
  snapshotId: string
  boundaryRevision: bigint
  scopeRevision: bigint
  horizonKey: string
  expiresAt: Date
  items: ReturnType<typeof routeItem>[]
  lastOrdinal: number
  hasMore: boolean
}) {
  const nextPage = input.hasMore
    ? nextMobileSyncV2SnapshotCursor({
        context: input.context,
        snapshotId: input.snapshotId,
        ordinal: input.lastOrdinal,
        scopeRevision: input.scopeRevision,
        horizonKey: input.horizonKey,
        expiresAt: input.expiresAt,
      })
    : null
  const nextCursor = input.hasMore
    ? null
    : nextMobileSyncV2DeltaCursor({
        context: input.context,
        revision: input.boundaryRevision,
        scopeRevision: input.scopeRevision,
        horizonKey: input.horizonKey,
      })
  return {
    success: true,
    protocolVersion: 2,
    stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
    snapshotId: input.snapshotId,
    boundary: nextMobileSyncV2DeltaCursor({
      context: input.context,
      revision: input.boundaryRevision,
      scopeRevision: input.scopeRevision,
      horizonKey: input.horizonKey,
    }),
    items: input.items,
    tombstones: [],
    nextPage,
    complete: !input.hasMore,
    nextCursor,
  }
}

async function readDeltaPage(input: {
  organizationId: string
  agentId: string
  timezone: string
  now: Date
  revision: bigint
  expectedScopeRevision: bigint
  pageSize: number
}) {
  const horizon = mobileSyncV2RouteHorizon(input.timezone, input.now)
  await ensureRouteStreamState(input.organizationId)
  await ensureRouteAgentScope({ organizationId: input.organizationId, agentId: input.agentId })

  return mobileSyncDatabase.$transaction(async (tx) => {
    const scopeRevision = await lockRouteAgentScope(tx, {
      organizationId: input.organizationId,
      agentId: input.agentId,
    })
    if (scopeRevision !== input.expectedScopeRevision) {
      throw new MobileSyncV2ResnapshotRequiredError("SCOPE_CHANGED")
    }

    const streamState = await tx.mtmMobileSyncStream.findUnique({
      where: {
        organizationId_stream: {
          organizationId: input.organizationId,
          stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
        },
      },
      select: { revision: true, retentionFloorRevision: true },
    })
    if (!streamState) throw new Error("MOBILE_SYNC_V2_STREAM_STATE_MISSING")
    if (input.revision > streamState.revision) {
      // A point-in-time restore can legitimately roll a durable journal back.
      // Never issue a cursor that moves backward into an ambiguous history.
      throw new MobileSyncV2ResnapshotRequiredError("STREAM_REWOUND")
    }
    if (input.revision < streamState.retentionFloorRevision) {
      throw new MobileSyncV2ResnapshotRequiredError("RETENTION_EXPIRED")
    }

    // Revisions are tenant-wide, but every journal row is actor-addressed at
    // write time. This keeps a device from draining unrelated route/point
    // churn just to advance its own cursor. When this is the final actor page,
    // advance to the sampled stream head so irrelevant revisions cannot
    // strand a cursor forever.
    const headRevision = streamState.revision
    const changes = await tx.mtmMobileSyncChange.findMany({
      where: {
        organizationId: input.organizationId,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
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
    const routeIds = [...new Set(page
      .filter((change) => change.changeType === "UPSERT" && change.entityType === "route")
      .map((change) => change.entityId))]
    const routes = routeIds.length
      ? await tx.mtmRoute.findMany({
          where: {
            ...mobileSyncV2RoutePilotWhere({
              organizationId: input.organizationId,
              agentId: input.agentId,
              timezone: input.timezone,
              now: input.now,
            }),
            id: { in: routeIds },
          },
          select: routeProjectionSelect,
        })
      : []
    const routeById = new Map(routes.map((route) => [route.id, projectMtmMobileSyncV2Route(route)]))

    const items: ReturnType<typeof routeItem>[] = []
    const tombstones: Array<{
      entityType: string
      id: string
      revision: string
      reason: string | null
    }> = []
    for (const change of page) {
      // The database predicate is authoritative; retain this output guard for
      // defence in depth against a future maintenance/query regression.
      if (change.audienceAgentId !== input.agentId) continue
      if (change.changeType === "TOMBSTONE") {
        tombstones.push({
          entityType: change.entityType,
          id: change.entityId,
          revision: change.revision.toString(),
          reason: change.tombstoneReason,
        })
        continue
      }
      const projection = routeById.get(change.entityId)
      // Scope and horizon are reapplied at read time. A route may have moved
      // outside this actor's horizon after its addressed UPSERT was written.
      if (projection) items.push(routeItem(projection, change.revision.toString()))
    }

    return {
      horizon,
      items,
      tombstones,
      hasMore,
      scopeRevision,
      lastRevision: hasMore
        ? (page[page.length - 1]?.revision ?? input.revision)
        : headRevision,
    }
  }, {
    // A single MVCC snapshot covers the floor, stream head, journal rows and
    // route projections. Retention cleanup moves the floor and deletes rows
    // atomically, so this sees either the complete pre-prune journal or the
    // new floor that demands a controlled rebuild — never a silent gap.
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 30_000,
  })
}

export const GET = withMobileRls(async (req, auth) => {
  const startedAt = Date.now()
  const apkVersion = req.headers.get("x-field-apk-version")
  const respond = (body: unknown, init: ResponseInit | undefined, result: MtmMobileSyncResultClass) => {
    if (result === "ok" && jsonByteLength(body) > MAX_ROUTE_SYNC_RESPONSE_BYTES) {
      const limited = {
        error: "Route sync page is too large; retry with a smaller limit",
        code: "MOBILE_SYNC_V2_PAYLOAD_TOO_LARGE",
        recommendedPageSize: RECOMMENDED_REDUCED_PAGE_SIZE,
      }
      recordMtmMobileSyncPullTelemetry({
        organizationId: auth.orgId,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
        endpoint: "GET /api/v2/mtm/mobile/sync/routes",
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
      stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      endpoint: "GET /api/v2/mtm/mobile/sync/routes",
      contractVersion: 2,
      apkVersion,
      result,
      durationMs: Date.now() - startedAt,
      response: body,
    })
    return noStoreJson(body, init)
  }
  try {
    const forbidden = requireMobilePermission(auth, "ROUTE_EXECUTE")
    if (forbidden) {
      recordMtmMobileSyncPullTelemetry({
        organizationId: auth.orgId,
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
        endpoint: "GET /api/v2/mtm/mobile/sync/routes",
        contractVersion: 2,
        apkVersion,
        result: "forbidden",
        durationMs: Date.now() - startedAt,
        response: { code: "MTM_MOBILE_PERMISSION_REQUIRED" },
      })
      forbidden.headers.set("Cache-Control", "no-store")
      return forbidden
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
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
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
      stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      phase: "pull",
      organizationId: auth.orgId,
      agentId: auth.agentId,
      userId: auth.userId,
      deviceId,
    })
    if (!pullGuard.allowed) {
      return respond(
        pullGuard.unavailable
          ? { error: "Route sync protection is temporarily unavailable", code: "MOBILE_SYNC_V2_UNAVAILABLE" }
          : { error: "Route sync is temporarily rate limited", code: "MOBILE_SYNC_V2_RATE_LIMITED" },
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
      stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
    }

    if (!cursorRaw) {
      const snapshot = await createRouteSnapshot({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        userId: auth.userId,
        deviceId,
        timezone,
        now,
        pageSize,
      })
      return respond(snapshotResponse({
          context,
          snapshotId: snapshot.snapshotId,
          boundaryRevision: snapshot.state.revision,
          scopeRevision: snapshot.state.scopeRevision,
          horizonKey: snapshot.horizon.key,
          expiresAt: snapshot.expiresAt,
          items: snapshot.firstPage.map((projection) => routeItem(projection, snapshot.state.revision.toString())),
          lastOrdinal: snapshot.firstPage.length,
          hasMore: snapshot.hasMore,
        }), undefined, "ok")
    }

    const cursor = readMobileSyncV2Cursor(cursorRaw, context, now.getTime())
    const horizon = mobileSyncV2RouteHorizon(timezone, now)
    if (cursor.horizonKey !== horizon.key) {
      throw new MobileSyncV2ResnapshotRequiredError("HORIZON_CHANGED")
    }

    if (cursor.kind === "snapshot") {
      const page = await readSnapshotPage({
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
        stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
        snapshotId: page.snapshot.id,
        items: page.page,
        tombstones: [],
        nextPage,
        complete: !page.hasMore,
        nextCursor,
      }, undefined, "ok")
    }

    const page = await readDeltaPage({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      timezone,
      now,
      revision: BigInt(cursor.revision),
      expectedScopeRevision: BigInt(cursor.scopeRevision),
      pageSize,
    })
    const nextCursor = nextMobileSyncV2DeltaCursor({
      context,
      revision: page.lastRevision,
      scopeRevision: page.scopeRevision,
      horizonKey: page.horizon.key,
    })
    return respond({
      success: true,
      protocolVersion: 2,
      stream: MTM_MOBILE_SYNC_V2_ROUTE_STREAM,
      items: page.items,
      tombstones: page.tombstones,
      nextPage: null,
      complete: !page.hasMore,
      nextCursor,
    }, undefined, "ok")
  } catch (error) {
    if (error instanceof MobileSyncV2SnapshotLeaseBusyError) {
      return respond(
        { error: "A route snapshot is already being prepared; retry shortly", code: error.message },
        { status: 429, headers: { "Retry-After": "2" } },
        "rate_limited",
      )
    }
    if (error instanceof MobileSyncV2InitialSnapshotGuardError) {
      return respond(
        error.unavailable
          ? { error: "Route sync protection is temporarily unavailable", code: error.message }
          : { error: "Route snapshot creation is temporarily rate limited", code: error.message },
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
    // Deliberately do not include cursor, route data, device id or coordinates
    // in diagnostics. The retry directive lets an APK recover without turning a
    // transient server error into a terminal outbox failure.
    console.error("[MTM/mobile-sync-v2 routes GET]", error)
    return respond(
      { error: "Route sync is temporarily unavailable", code: "MOBILE_SYNC_V2_UNAVAILABLE" },
      { status: 503, headers: { "Retry-After": "5" } },
      "unavailable",
    )
  }
}, { requiredCapability: "route-field" })
