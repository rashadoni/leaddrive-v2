import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { pruneMtmMobileRouteCommandReceipts } from "@/lib/mtm/mobile-route-command-retention"
import { pruneMtmMobileSyncV2Retention } from "@/lib/mtm/mobile-sync-v2-retention"

const GPS_RAW_RETENTION_DAYS = 30
const MAX_GPS_RETENTION_DELETES_PER_RUN = 5_000
const MAX_ALERT_RETENTION_DELETES_PER_RUN = 5_000
const MTM_CLEANUP_LEASE_MS = 60_000

async function executeMtmCleanup(now = new Date()) {
  const cutoff = new Date(now.getTime() - GPS_RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const staleLocationIds = await prisma.mtmAgentLocation.findMany({
    where: { recordedAt: { lt: cutoff } },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    take: MAX_GPS_RETENTION_DELETES_PER_RUN,
    select: { id: true },
  })
  const locResult = staleLocationIds.length
    ? await prisma.mtmAgentLocation.deleteMany({ where: { id: { in: staleLocationIds.map((row) => row.id) } } })
    : { count: 0 }
  const staleLatestIds = await prisma.mtmAgentLatestLocation.findMany({
    where: { recordedAt: { lt: cutoff } },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    take: MAX_GPS_RETENTION_DELETES_PER_RUN,
    select: { id: true },
  })
  const latestResult = staleLatestIds.length
    ? await prisma.mtmAgentLatestLocation.deleteMany({ where: { id: { in: staleLatestIds.map((row) => row.id) } } })
    : { count: 0 }

  // Also prune resolved alerts older than twice the fixed GPS retention window
  // (60 days). The audit log retains the trail; alerts are user-facing noise.
  const alertCutoff = new Date(now.getTime() - GPS_RAW_RETENTION_DAYS * 2 * 24 * 60 * 60 * 1000)
  const staleAlertIds = await prisma.mtmAlert.findMany({
    where: { isResolved: true, createdAt: { lt: alertCutoff } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_ALERT_RETENTION_DELETES_PER_RUN,
    select: { id: true },
  })
  const alertResult = staleAlertIds.length
    ? await prisma.mtmAlert.deleteMany({ where: { id: { in: staleAlertIds.map((row) => row.id) } } })
    : { count: 0 }

  // v2 snapshots/change-log rows are rebuildable pull caches. Their bounded
  // tenant-first cleanup advances a retention floor with exact change deletion
  // and never touches the Field mutation outbox or legacy v1 idempotency rows.
  // Retention domains have independent bounded transactions. Complete both
  // before surfacing a failed cron run so an unhealthy rebuildable v2 cache
  // cannot indefinitely retain Route Field command receipts (and vice versa).
  let syncV2: Awaited<ReturnType<typeof pruneMtmMobileSyncV2Retention>> | null = null
  let routeCommands: Awaited<ReturnType<typeof pruneMtmMobileRouteCommandReceipts>> | null = null
  const retentionFailures: string[] = []
  try {
    syncV2 = await pruneMtmMobileSyncV2Retention(now)
  } catch (error) {
    retentionFailures.push("sync-v2")
    console.error("[CRON/mtm-cleanup] sync-v2 retention failed", error instanceof Error ? error.name : "unknown")
  }
  try {
    routeCommands = await pruneMtmMobileRouteCommandReceipts(now)
  } catch (error) {
    retentionFailures.push("route-commands")
    console.error("[CRON/mtm-cleanup] route-command retention failed", error instanceof Error ? error.name : "unknown")
  }
  if (retentionFailures.length > 0) {
    throw new Error(`MTM_RETENTION_FAILED:${retentionFailures.join(",")}`)
  }
  if (!syncV2 || !routeCommands) throw new Error("MTM_RETENTION_RESULT_MISSING")

  return {
    cutoff: cutoff.toISOString(),
    deletedLocations: locResult.count,
    deletedLatestLocations: latestResult.count,
    gpsRetentionMorePending: staleLocationIds.length === MAX_GPS_RETENTION_DELETES_PER_RUN
      || staleLatestIds.length === MAX_GPS_RETENTION_DELETES_PER_RUN,
    deletedResolvedAlerts: alertResult.count,
    alertsRetentionMorePending: staleAlertIds.length === MAX_ALERT_RETENTION_DELETES_PER_RUN,
    deletedSyncV2Changes: syncV2.deletedChanges,
    deletedSyncV2Snapshots: syncV2.deletedSnapshots,
    deletedSyncV2SnapshotItems: syncV2.deletedSnapshotItems,
    deletedSyncV2SnapshotLeases: syncV2.deletedSnapshotLeases,
    syncV2RetentionFloorsAdvanced: syncV2.retentionFloorsAdvanced,
    syncV2ChangesTenantsScanned: syncV2.changesTenantsScanned,
    syncV2SnapshotsTenantsScanned: syncV2.snapshotsTenantsScanned,
    syncV2SnapshotLeasesTenantsScanned: syncV2.snapshotLeasesTenantsScanned,
    syncV2ChangesMorePending: syncV2.changesMorePending,
    syncV2SnapshotsMorePending: syncV2.snapshotsMorePending,
    syncV2SnapshotLeasesMorePending: syncV2.snapshotLeasesMorePending,
    syncV2ChangesCursorBusy: syncV2.changesCursorBusy,
    syncV2SnapshotsCursorBusy: syncV2.snapshotsCursorBusy,
    syncV2SnapshotLeasesCursorBusy: syncV2.snapshotLeasesCursorBusy,
    deletedMobileRouteCommandReceipts: routeCommands.deletedReceipts,
    mobileRouteCommandReceiptTenantsScanned: routeCommands.tenantsScanned,
    mobileRouteCommandReceiptMorePending: routeCommands.morePending,
    mobileRouteCommandReceiptCursorBusy: routeCommands.cursorBusy,
  }
}

// POST /api/cron/mtm-cleanup
// F-10: prune old MtmAgentLocation rows. With gpsInterval=30s × 10h/day × N
// agents, the table grows by ~1200 rows/day/agent without bounded cleanup.
// A production scheduler must call this CRON_SECRET-protected endpoint; the
// durable lease makes an overlapping tick a successful no-op with telemetry.
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  return runWithRlsBypass(async () => {
    try {
      const lease = await withJobLease(
        { name: "mtm-cleanup", ttlMs: MTM_CLEANUP_LEASE_MS },
        () => executeMtmCleanup(),
      )
      if (lease.status === "skipped") {
        return NextResponse.json({ success: true, data: { skipped: lease.reason } })
      }
      return NextResponse.json({ success: true, data: lease.value })
    } catch (error) {
      console.error("[CRON/mtm-cleanup]", error instanceof Error ? error.name : "unknown")
      return NextResponse.json({ error: "Cleanup failed" }, { status: 500 })
    }
  })
}
