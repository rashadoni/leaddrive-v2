import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Bounded retention is deliberately tenant-first. At the planned 100-tenant
 * scale, one backlogged tenant must not turn the rebuildable v2 journal/cache
 * cleanup into an unbounded transaction or delay every other tenant.
 */
export const MTM_MOBILE_SYNC_V2_RETENTION_TENANT_BATCH_SIZE = 10
export const MTM_MOBILE_SYNC_V2_RETENTION_CHANGE_ROWS_PER_TENANT = 100
export const MTM_MOBILE_SYNC_V2_RETENTION_SNAPSHOT_PARENTS_PER_TENANT = 20
export const MTM_MOBILE_SYNC_V2_RETENTION_SNAPSHOT_ITEMS_PER_TENANT = 250
export const MTM_MOBILE_SYNC_V2_RETENTION_LEASES_PER_TENANT = 100

const RETENTION_TRANSACTION_TIMEOUT_MS = 10_000

type RetentionJobName = "changes" | "snapshots" | "leases"
type RetentionCursorLockRow = { lastOrganizationId: string | null }
type SnapshotParentLockRow = { id: string }

type RetentionJobRun<T> =
  | { cursorBusy: true; tenantsScanned: 0; morePending: false }
  | { cursorBusy: false; tenantsScanned: number; morePending: boolean; value: T }

type ChangeRetentionResult = {
  deletedChanges: number
  retentionFloorsAdvanced: number
}

type SnapshotRetentionResult = {
  deletedSnapshots: number
  deletedSnapshotItems: number
}

type LeaseRetentionResult = {
  deletedSnapshotLeases: number
}

export type MtmMobileSyncV2RetentionResult = ChangeRetentionResult & SnapshotRetentionResult & LeaseRetentionResult & {
  changesTenantsScanned: number
  snapshotsTenantsScanned: number
  snapshotLeasesTenantsScanned: number
  changesCursorBusy: boolean
  snapshotsCursorBusy: boolean
  snapshotLeasesCursorBusy: boolean
  changesMorePending: boolean
  snapshotsMorePending: boolean
  snapshotLeasesMorePending: boolean
}

type TenantScan = { organizationIds: string[]; morePending: boolean }

async function scanTenantsRoundRobin(
  tx: Prisma.TransactionClient,
  lastOrganizationId: string | null,
): Promise<TenantScan> {
  const select = {
    select: { id: true },
    orderBy: { id: "asc" as const },
  }
  const after = await tx.organization.findMany({
    ...select,
    where: lastOrganizationId ? { id: { gt: lastOrganizationId } } : undefined,
    take: MTM_MOBILE_SYNC_V2_RETENTION_TENANT_BATCH_SIZE + 1,
  })

  if (!lastOrganizationId || after.length > MTM_MOBILE_SYNC_V2_RETENTION_TENANT_BATCH_SIZE) {
    return {
      organizationIds: after
        .slice(0, MTM_MOBILE_SYNC_V2_RETENTION_TENANT_BATCH_SIZE)
        .map((organization) => organization.id),
      morePending: after.length > MTM_MOBILE_SYNC_V2_RETENTION_TENANT_BATCH_SIZE,
    }
  }

  // Continue at the start in the same bounded pass when the cursor reaches
  // the lexical end. De-duplicate so a small installation is never visited
  // twice in one retention transaction.
  const remaining = MTM_MOBILE_SYNC_V2_RETENTION_TENANT_BATCH_SIZE - after.length
  const wrapped = remaining > 0
    ? await tx.organization.findMany({
      ...select,
      where: { id: { lte: lastOrganizationId } },
      take: remaining + 1,
    })
    : []
  const organizationIds = Array.from(new Set([
    ...after.map((organization) => organization.id),
    ...wrapped.slice(0, remaining).map((organization) => organization.id),
  ]))
  return {
    organizationIds,
    morePending: wrapped.length > remaining,
  }
}

/**
 * Lock one bypass-only cursor row for the short, capped job transaction. A
 * concurrent direct invocation receives a harmless busy result; the cron
 * entrypoint additionally holds the global SystemJobLease for the entire
 * mtm-cleanup pass and records its heartbeat/skip state.
 */
async function runRetentionJob<T extends object>(
  jobName: RetentionJobName,
  now: Date,
  work: (tx: Prisma.TransactionClient, organizationIds: string[]) => Promise<{ value: T; morePending: boolean }>,
): Promise<RetentionJobRun<T>> {
  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<RetentionCursorLockRow[]>(Prisma.sql`
      SELECT "lastOrganizationId"
      FROM "mtm_mobile_sync_retention_cursors"
      WHERE "jobName" = ${jobName}
      FOR UPDATE SKIP LOCKED
    `)
    const cursor = lockedRows[0]
    if (!cursor) {
      // SKIP LOCKED returns no row both for a busy cursor and for a schema/code
      // mismatch. A plain read distinguishes them without waiting for the row
      // lock; missing state must never fall back to a global delete.
      const exists = await tx.mtmMobileSyncRetentionCursor.findUnique({
        where: { jobName },
        select: { jobName: true },
      })
      if (!exists) throw new Error(`MOBILE_SYNC_V2_RETENTION_CURSOR_MISSING:${jobName}`)
      return { cursorBusy: true, tenantsScanned: 0, morePending: false }
    }

    const tenantScan = await scanTenantsRoundRobin(tx, cursor.lastOrganizationId)
    const result = await work(tx, tenantScan.organizationIds)
    const lastOrganizationId = tenantScan.organizationIds.at(-1)
    if (lastOrganizationId) {
      await tx.mtmMobileSyncRetentionCursor.update({
        where: { jobName },
        data: { lastOrganizationId },
      })
    }
    return {
      cursorBusy: false,
      tenantsScanned: tenantScan.organizationIds.length,
      morePending: tenantScan.morePending || result.morePending,
      value: result.value,
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: RETENTION_TRANSACTION_TIMEOUT_MS,
  }) as Promise<RetentionJobRun<T>>
}

async function pruneExpiredChanges(
  tx: Prisma.TransactionClient,
  organizationIds: string[],
  now: Date,
): Promise<{ value: ChangeRetentionResult; morePending: boolean }> {
  let deletedChanges = 0
  let retentionFloorsAdvanced = 0
  let morePending = false

  for (const organizationId of organizationIds) {
    const selected = await tx.mtmMobileSyncChange.findMany({
      where: { organizationId, expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { stream: "asc" }, { revision: "asc" }, { id: "asc" }],
      take: MTM_MOBILE_SYNC_V2_RETENTION_CHANGE_ROWS_PER_TENANT,
      select: { id: true, stream: true, revision: true },
    })
    if (selected.length === MTM_MOBILE_SYNC_V2_RETENTION_CHANGE_ROWS_PER_TENANT) morePending = true

    const byStream = new Map<string, Array<{ id: string; revision: bigint }>>()
    for (const change of selected) {
      const rows = byStream.get(change.stream) ?? []
      rows.push({ id: change.id, revision: change.revision })
      byStream.set(change.stream, rows)
    }

    for (const [stream, rows] of byStream) {
      const revision = rows.reduce((maximum, row) => row.revision > maximum ? row.revision : maximum, rows[0]!.revision)
      // Floor advancement and exact-ID deletion commit together. A cursor
      // below the new floor is forced to resnapshot; no client can silently
      // skip a tombstone even when another cleaner overlaps this capped set.
      const floor = await tx.mtmMobileSyncStream.updateMany({
        where: {
          organizationId,
          stream,
          retentionFloorRevision: { lt: revision },
        },
        data: { retentionFloorRevision: revision },
      })
      retentionFloorsAdvanced += floor.count

      const deleted = await tx.mtmMobileSyncChange.deleteMany({
        where: {
          organizationId,
          stream,
          id: { in: rows.map((row) => row.id) },
          expiresAt: { lte: now },
        },
      })
      deletedChanges += deleted.count
    }
  }

  return { value: { deletedChanges, retentionFloorsAdvanced }, morePending }
}

async function pruneExpiredSnapshots(
  tx: Prisma.TransactionClient,
  organizationIds: string[],
  now: Date,
): Promise<{ value: SnapshotRetentionResult; morePending: boolean }> {
  let deletedSnapshots = 0
  let deletedSnapshotItems = 0
  let morePending = false

  for (const organizationId of organizationIds) {
    const candidates = await tx.mtmMobileSyncSnapshot.findMany({
      where: { organizationId, expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: MTM_MOBILE_SYNC_V2_RETENTION_SNAPSHOT_PARENTS_PER_TENANT,
      select: { id: true },
    })
    if (candidates.length === MTM_MOBILE_SYNC_V2_RETENTION_SNAPSHOT_PARENTS_PER_TENANT) morePending = true
    if (candidates.length === 0) continue

    const candidateSnapshotIds = candidates.map((snapshot) => snapshot.id)
    // Lock the exact, capped parent set before inspecting or reaping children.
    // PostgreSQL makes a new FK child insert take a conflicting KEY SHARE lock,
    // so it cannot appear between the final empty-parent check and DELETE. An
    // insert which began before this lock is visible to the later reads after
    // its transaction releases the row lock. This keeps the item-first reaper
    // bounded without allowing an ON DELETE CASCADE to remove a raced-in item.
    const lockedParents = await tx.$queryRaw<SnapshotParentLockRow[]>(Prisma.sql`
      SELECT "id"
      FROM "mtm_mobile_sync_snapshots"
      WHERE "organizationId" = ${organizationId}
        AND "id" IN (${Prisma.join(candidateSnapshotIds)})
        AND "expiresAt" <= ${now}
      ORDER BY "expiresAt" ASC, "id" ASC
      FOR UPDATE
    `)
    const snapshotIds = lockedParents.map((snapshot) => snapshot.id)
    if (snapshotIds.length === 0) continue

    // Reap items first. Deleting a parent with ON DELETE CASCADE could turn a
    // tiny cleanup tick into an unbounded JSON-cache delete for one device.
    const items = await tx.mtmMobileSyncSnapshotItem.findMany({
      where: { organizationId, snapshotId: { in: snapshotIds } },
      orderBy: [{ snapshotId: "asc" }, { ordinal: "asc" }, { id: "asc" }],
      take: MTM_MOBILE_SYNC_V2_RETENTION_SNAPSHOT_ITEMS_PER_TENANT,
      select: { id: true },
    })
    if (items.length === MTM_MOBILE_SYNC_V2_RETENTION_SNAPSHOT_ITEMS_PER_TENANT) morePending = true
    if (items.length > 0) {
      const deletedItems = await tx.mtmMobileSyncSnapshotItem.deleteMany({
        where: {
          organizationId,
          snapshotId: { in: snapshotIds },
          id: { in: items.map((item) => item.id) },
        },
      })
      deletedSnapshotItems += deletedItems.count
    }

    // A second exact, relation-aware read prevents an accidental cascade if a
    // concurrent writer races to create an item after the capped item reaper.
    const emptySnapshots = await tx.mtmMobileSyncSnapshot.findMany({
      where: {
        organizationId,
        id: { in: snapshotIds },
        expiresAt: { lte: now },
        items: { none: {} },
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: MTM_MOBILE_SYNC_V2_RETENTION_SNAPSHOT_PARENTS_PER_TENANT,
      select: { id: true },
    })
    if (emptySnapshots.length > 0) {
      const deletedParents = await tx.mtmMobileSyncSnapshot.deleteMany({
        where: {
          organizationId,
          id: { in: emptySnapshots.map((snapshot) => snapshot.id) },
          expiresAt: { lte: now },
          items: { none: {} },
        },
      })
      deletedSnapshots += deletedParents.count
    }
  }

  return { value: { deletedSnapshots, deletedSnapshotItems }, morePending }
}

async function pruneExpiredSnapshotLeases(
  tx: Prisma.TransactionClient,
  organizationIds: string[],
  now: Date,
): Promise<{ value: LeaseRetentionResult; morePending: boolean }> {
  let deletedSnapshotLeases = 0
  let morePending = false

  for (const organizationId of organizationIds) {
    const leases = await tx.mtmMobileSyncSnapshotLease.findMany({
      where: { organizationId, expiresAt: { lte: now } },
      orderBy: [
        { expiresAt: "asc" },
        { stream: "asc" },
        { agentId: "asc" },
        { deviceId: "asc" },
        { horizonKey: "asc" },
      ],
      take: MTM_MOBILE_SYNC_V2_RETENTION_LEASES_PER_TENANT,
      select: { stream: true, agentId: true, deviceId: true, horizonKey: true, leaseToken: true, expiresAt: true },
    })
    if (leases.length === MTM_MOBILE_SYNC_V2_RETENTION_LEASES_PER_TENANT) morePending = true
    if (leases.length === 0) continue

    // Include both the observed token and expiry. A newly acquired lease uses
    // the same composite key, so cleanup must not delete it after a stale
    // select merely because the former lease had already expired.
    const deleted = await tx.mtmMobileSyncSnapshotLease.deleteMany({
      where: {
        organizationId,
        OR: leases.map((lease) => ({
          stream: lease.stream,
          agentId: lease.agentId,
          deviceId: lease.deviceId,
          horizonKey: lease.horizonKey,
          leaseToken: lease.leaseToken,
          expiresAt: lease.expiresAt,
        })),
      },
    })
    deletedSnapshotLeases += deleted.count
  }

  return { value: { deletedSnapshotLeases }, morePending }
}

function emptyChanges(): ChangeRetentionResult {
  return { deletedChanges: 0, retentionFloorsAdvanced: 0 }
}

function emptySnapshots(): SnapshotRetentionResult {
  return { deletedSnapshots: 0, deletedSnapshotItems: 0 }
}

function emptyLeases(): LeaseRetentionResult {
  return { deletedSnapshotLeases: 0 }
}

/**
 * Prune only rebuildable v2 pull state. v1 idempotency and the Field mutation
 * outbox are intentionally absent from every query in this module. Each domain
 * has its own bounded transaction so a snapshot/cache problem cannot leave an
 * already-completed change-floor transaction open or roll it back.
 */
export async function pruneMtmMobileSyncV2Retention(now = new Date()): Promise<MtmMobileSyncV2RetentionResult> {
  return runWithRlsBypass(async () => {
    const failures: RetentionJobName[] = []
    let changes: RetentionJobRun<ChangeRetentionResult> | undefined
    let snapshots: RetentionJobRun<SnapshotRetentionResult> | undefined
    let leases: RetentionJobRun<LeaseRetentionResult> | undefined

    try {
      changes = await runRetentionJob("changes", now, (tx, organizationIds) =>
        pruneExpiredChanges(tx, organizationIds, now))
    } catch (error) {
      failures.push("changes")
      console.error("[MTM mobile sync v2 retention] changes domain failed", error instanceof Error ? error.name : "unknown")
    }
    try {
      snapshots = await runRetentionJob("snapshots", now, (tx, organizationIds) =>
        pruneExpiredSnapshots(tx, organizationIds, now))
    } catch (error) {
      failures.push("snapshots")
      console.error("[MTM mobile sync v2 retention] snapshots domain failed", error instanceof Error ? error.name : "unknown")
    }
    try {
      leases = await runRetentionJob("leases", now, (tx, organizationIds) =>
        pruneExpiredSnapshotLeases(tx, organizationIds, now))
    } catch (error) {
      failures.push("leases")
      console.error("[MTM mobile sync v2 retention] leases domain failed", error instanceof Error ? error.name : "unknown")
    }

    // Complete the independent bounded domains first, then fail the outer cron
    // lease so the scheduler retries and SystemJobLease records the failure.
    if (failures.length > 0) throw new Error(`MOBILE_SYNC_V2_RETENTION_FAILED:${failures.join(",")}`)

    const changeValue = changes && !changes.cursorBusy ? changes.value : emptyChanges()
    const snapshotValue = snapshots && !snapshots.cursorBusy ? snapshots.value : emptySnapshots()
    const leaseValue = leases && !leases.cursorBusy ? leases.value : emptyLeases()
    return {
      ...changeValue,
      ...snapshotValue,
      ...leaseValue,
      changesTenantsScanned: changes?.tenantsScanned ?? 0,
      snapshotsTenantsScanned: snapshots?.tenantsScanned ?? 0,
      snapshotLeasesTenantsScanned: leases?.tenantsScanned ?? 0,
      changesCursorBusy: changes?.cursorBusy ?? false,
      snapshotsCursorBusy: snapshots?.cursorBusy ?? false,
      snapshotLeasesCursorBusy: leases?.cursorBusy ?? false,
      changesMorePending: changes?.morePending ?? false,
      snapshotsMorePending: snapshots?.morePending ?? false,
      snapshotLeasesMorePending: leases?.morePending ?? false,
    }
  })
}
