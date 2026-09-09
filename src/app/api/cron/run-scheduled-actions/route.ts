import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runScheduledAction } from "@/lib/workflow-engine"
import { runWithRlsBypass } from "@/lib/rls-context"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

/**
 * Scheduled-actions runner cron.
 *
 * Picks up workflow actions that were deferred via `delayMinutes > 0`
 * (typically missed-call → SMS with 2-min delay per TT §9).
 *
 * Wire to external cron every minute:
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/run-scheduled-actions \
 *        -H "x-cron-secret: $CRON_SECRET"
 *
 * Batches 100 ready rows per tick. Rows that error are kept with their
 * error message and attempts incremented — up to 3 attempts before giving up.
 */

const BATCH_SIZE = 100
const MAX_ATTEMPTS = 3

function asActionRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const now = new Date()

  const ready = await prisma.scheduledAction.findMany({
    where: {
      executedAt: null,
      scheduledAt: { lte: now },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
  })

  let executed = 0
  let failed = 0
  let blocked = 0

  for (const row of ready) {
    const executeRow = async (): Promise<"executed" | "failed"> => {
      try {
        await runScheduledAction(
          row.organizationId,
          row.entityType,
          row.actionType,
          asActionRecord(row.actionConfig),
          asActionRecord(row.entitySnapshot),
        )
        await prisma.scheduledAction.update({
          where: { id: row.id },
          data: { executedAt: new Date(), attempts: { increment: 1 } },
        })
        return "executed"
      } catch (e) {
        await prisma.scheduledAction.update({
          where: { id: row.id },
          data: {
            error: e instanceof Error ? e.message.slice(0, 500) : "Unknown error",
            attempts: { increment: 1 },
          },
        })
        return "failed"
      }
    }

    let outcome: "executed" | "failed"
    if (row.entityType === "social_mention") {
      const fenced = await withSocialMonitoringTenantCollectionFence(
        row.organizationId,
        executeRow,
      )
      if (!fenced.allowed) {
        blocked++
        continue
      }
      outcome = fenced.value
    } else {
      outcome = await executeRow()
    }

    if (outcome === "executed") executed++
    else failed++
  }

  return NextResponse.json({ success: true, picked: ready.length, executed, failed, blocked })
  })
}
