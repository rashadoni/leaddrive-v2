import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Receipt cleanup is tenant-first and strictly bounded. A tenant that retried
 * many old commands must not make another tenant's retention tick unbounded,
 * and this module never reads or deletes the legacy sync outbox/state.
 */
export const MTM_MOBILE_ROUTE_COMMAND_RETENTION_TENANT_BATCH_SIZE = 10
export const MTM_MOBILE_ROUTE_COMMAND_RETENTION_ROWS_PER_TENANT = 100

const RETENTION_CURSOR_JOB_NAME = "route-commands"
const RETENTION_TRANSACTION_TIMEOUT_MS = 10_000

export interface MtmMobileRouteCommandRetentionResult {
  deletedReceipts: number
  tenantsScanned: number
  morePending: boolean
  cursorBusy: boolean
}

type RetentionCursorLockRow = { lastOrganizationId: string | null }
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
    take: MTM_MOBILE_ROUTE_COMMAND_RETENTION_TENANT_BATCH_SIZE + 1,
  })
  if (!lastOrganizationId || after.length > MTM_MOBILE_ROUTE_COMMAND_RETENTION_TENANT_BATCH_SIZE) {
    return {
      organizationIds: after
        .slice(0, MTM_MOBILE_ROUTE_COMMAND_RETENTION_TENANT_BATCH_SIZE)
        .map((organization) => organization.id),
      morePending: after.length > MTM_MOBILE_ROUTE_COMMAND_RETENTION_TENANT_BATCH_SIZE,
    }
  }

  const remaining = MTM_MOBILE_ROUTE_COMMAND_RETENTION_TENANT_BATCH_SIZE - after.length
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
 * Delete only explicit expired receipt IDs in one short transaction. The
 * bypass-only cursor row is both the fairness checkpoint and a SKIP LOCKED
 * fence: if another cleaner owns it, this caller returns a harmless no-op.
 */
export async function pruneMtmMobileRouteCommandReceipts(
  now = new Date(),
): Promise<MtmMobileRouteCommandRetentionResult> {
  return runWithRlsBypass(() => prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<RetentionCursorLockRow[]>(Prisma.sql`
      SELECT "lastOrganizationId"
      FROM "mtm_mobile_sync_retention_cursors"
      WHERE "jobName" = ${RETENTION_CURSOR_JOB_NAME}
      FOR UPDATE SKIP LOCKED
    `)
    const cursor = lockedRows[0]
    if (!cursor) {
      const exists = await tx.mtmMobileSyncRetentionCursor.findUnique({
        where: { jobName: RETENTION_CURSOR_JOB_NAME },
        select: { jobName: true },
      })
      if (!exists) throw new Error("MOBILE_ROUTE_COMMAND_RETENTION_CURSOR_MISSING")
      return { deletedReceipts: 0, tenantsScanned: 0, morePending: false, cursorBusy: true }
    }

    const tenantScan = await scanTenantsRoundRobin(tx, cursor.lastOrganizationId)
    let deletedReceipts = 0
    let morePending = tenantScan.morePending
    for (const organizationId of tenantScan.organizationIds) {
      const candidates = await tx.mtmMobileRouteCommandReceipt.findMany({
        where: { organizationId, expiresAt: { lte: now } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: MTM_MOBILE_ROUTE_COMMAND_RETENTION_ROWS_PER_TENANT,
        select: { id: true },
      })
      if (candidates.length === MTM_MOBILE_ROUTE_COMMAND_RETENTION_ROWS_PER_TENANT) morePending = true
      if (candidates.length === 0) continue
      const deleted = await tx.mtmMobileRouteCommandReceipt.deleteMany({
        where: {
          organizationId,
          id: { in: candidates.map((candidate) => candidate.id) },
          expiresAt: { lte: now },
        },
      })
      deletedReceipts += deleted.count
    }
    const lastOrganizationId = tenantScan.organizationIds.at(-1)
    if (lastOrganizationId) {
      await tx.mtmMobileSyncRetentionCursor.update({
        where: { jobName: RETENTION_CURSOR_JOB_NAME },
        data: { lastOrganizationId },
      })
    }
    return {
      deletedReceipts,
      tenantsScanned: tenantScan.organizationIds.length,
      morePending,
      cursorBusy: false,
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: RETENTION_TRANSACTION_TIMEOUT_MS,
  }))
}
