import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { processEnrollmentStep } from "@/lib/journey-engine"
import { PAGE_SIZE } from "@/lib/constants"
import { withJobLease } from "@/lib/cron/job-lease"

/**
 * POST /api/v1/journeys/process
 * Process all pending journey enrollments where nextActionAt <= now.
 * Requires Authorization: Bearer <CRON_SECRET> header for security.
 */
async function processPendingJourneyEnrollments() {
  const now = new Date()
  const batchSize = PAGE_SIZE.DEFAULT

  // Fetch a bounded look-ahead window, then give each tenant a deterministic
  // fair-share pass before filling spare capacity from the global due order.
  // This keeps one tenant's deep backlog from monopolizing every cron batch.
  const discoveredEnrollments = await prisma.journeyEnrollment.findMany({
    where: {
      status: "active",
      nextActionAt: { lte: now },
      currentStepId: { not: null },
      OR: [
        { processingLeaseUntil: null },
        { processingLeaseUntil: { lte: now } },
      ],
    },
    orderBy: [
      { nextActionAt: "asc" },
      { enrolledAt: "asc" },
      { id: "asc" },
    ],
    take: batchSize * 4,
  })

  const fairShare = Math.max(1, Math.ceil(batchSize / 5))
  const perOrganization = new Map<string, number>()
  const priority: typeof discoveredEnrollments = []
  const overflow: typeof discoveredEnrollments = []
  for (const enrollment of discoveredEnrollments) {
    const count = perOrganization.get(enrollment.organizationId) ?? 0
    if (count < fairShare) {
      priority.push(enrollment)
      perOrganization.set(enrollment.organizationId, count + 1)
    } else {
      overflow.push(enrollment)
    }
  }
  const pendingEnrollments = [...priority, ...overflow].slice(0, batchSize)

  const results = []
  for (const discoveredEnrollment of pendingEnrollments) {
    // The global scan needs bypass, but processing user data does not. Re-enter
    // the owning tenant and re-read the row so every action is protected by RLS
    // as well as explicit organizationId predicates.
    try {
      const rowResult = await runWithTenant(discoveredEnrollment.organizationId, async () => {
        const enrollment = await prisma.journeyEnrollment.findFirst({
          where: {
            id: discoveredEnrollment.id,
            organizationId: discoveredEnrollment.organizationId,
            status: "active",
            nextActionAt: { lte: now },
          },
        })
        if (!enrollment) {
          return { enrollmentId: discoveredEnrollment.id, status: "skipped" }
        }

        // Tenant suspension is a terminal condition. Clear scheduling state so
        // disabled tenants cannot consume every deterministic batch forever.
        const activeOrganization = await prisma.organization.findFirst({
          where: { id: enrollment.organizationId, isActive: true },
          select: { id: true },
        })
        if (!activeOrganization) {
          const failed = await prisma.journeyEnrollment.updateMany({
            where: { id: enrollment.id, organizationId: enrollment.organizationId, status: "active" },
            data: {
              status: "failed",
              exitReason: "inactive_organization",
              completedAt: new Date(),
              currentStepId: null,
              nextActionAt: null,
              processingToken: null,
              processingLeaseUntil: null,
            },
          })
          if (failed.count === 1) {
            await prisma.journey.updateMany({
              where: { id: enrollment.journeyId, organizationId: enrollment.organizationId },
              data: { activeCount: { decrement: 1 } },
            })
          }
          return { enrollmentId: enrollment.id, journeyId: enrollment.journeyId, status: "inactive_organization" }
        }

        // Goal/max-age and journey/target validity are evaluated inside the
        // engine after its per-enrollment CAS claim.
        const result = await processEnrollmentStep(enrollment.id, enrollment.organizationId)
        return {
          enrollmentId: enrollment.id,
          journeyId: enrollment.journeyId,
          leadId: enrollment.leadId,
          contactId: enrollment.contactId,
          ...result,
        }
      })
      results.push(rowResult)
    } catch (error) {
      // One malformed/transient row must not abort the rest of the global batch.
      console.error(`[Journey Process Row Error] enrollment=${discoveredEnrollment.id}`, error)
      results.push({ enrollmentId: discoveredEnrollment.id, status: "error" })
    }
  }

  return NextResponse.json({
    success: true,
    processed: results.length,
    results,
  })
}

export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    return await runWithRlsBypass(async () => {
      const lease = await withJobLease(
        { name: "journeys-process", ttlMs: 5 * 60_000 },
        processPendingJourneyEnrollments,
      )
      if (lease.status === "skipped") {
        return NextResponse.json({ success: true, skipped: true, reason: lease.reason })
      }
      return lease.value
    })
  } catch (e) {
    console.error("[Journey Process Error]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
