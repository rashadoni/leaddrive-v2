import { NextRequest, NextResponse } from "next/server"
import {
  assertTenantWorkforceRetentionClear,
  purgeScheduledTenants,
  WorkforceRetentionBlockedError,
} from "@/lib/tenant-provisioning"
import { exportTenantData } from "@/lib/tenant-export"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"

// POST /api/cron/purge-tenants — Purge tenants past their deletion date
// Secured by cron secret (same pattern as other cron endpoints)
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  // Find overdue tenants
  const overdue = await prisma.organization.findMany({
    where: { deletionScheduledAt: { lte: new Date() } },
    select: { id: true, name: true, slug: true },
  })

  if (overdue.length === 0) {
    return NextResponse.json({ message: "No tenants to purge", purged: 0 })
  }

  // A retention-blocked tenant is not eligible for the deletion export either:
  // it remains live in storage and an extra sensitive copy would be misleading.
  // hardDeleteTenant repeats the final check under a parent lock to close the
  // gap between this eligibility pass and the later cascade.
  const retentionBlocked: string[] = []
  const eligibleTenantIds: string[] = []
  for (const org of overdue) {
    try {
      await assertTenantWorkforceRetentionClear(org.id)
    } catch (err) {
      if (err instanceof WorkforceRetentionBlockedError) {
        retentionBlocked.push(org.slug)
        console.warn(`[CRON] Skipped retention-blocked tenant "${org.name}" (${org.slug})`)
        continue
      }
      console.error(`[CRON] Workforce retention preflight failed for "${org.name}":`, err)
      continue
    }

    try {
      const exportResult = await exportTenantData(org.id)
      console.log(`[CRON] Exported "${org.name}" data before purge: ${exportResult.filename}`)
    } catch (err) {
      console.error(`[CRON] Export failed for "${org.name}" before purge:`, err)
    }
    eligibleTenantIds.push(org.id)
  }

  // Purge only tenants that passed the pre-export retention preflight. The
  // per-tenant hard delete repeats its locked check in case facts arrive later.
  const result = eligibleTenantIds.length > 0
    ? await purgeScheduledTenants(eligibleTenantIds)
    : { purged: [], errors: [] }

  console.log(`[CRON] Purge complete: ${result.purged.length} deleted, ${result.errors.length} errors`)

  return NextResponse.json({
    message: `Purged ${result.purged.length} tenant(s)`,
    purged: result.purged,
    errors: [
      ...result.errors,
      ...retentionBlocked.map((slug) => `${slug}: WORKFORCE_RETENTION_BLOCKED`),
    ],
    retentionBlocked,
  })
  })
}
