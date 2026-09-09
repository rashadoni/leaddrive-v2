import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

// PATCH — pause, resume, cancel enrollment
export const PATCH = withRlsAuth("journeys", "write", async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const { action } = await req.json()
  if (!["pause", "resume", "cancel"].includes(action)) {
    return NextResponse.json({ error: "Invalid action. Use: pause, resume, cancel" }, { status: 400 })
  }

  try {
    const enrollment = await prisma.journeyEnrollment.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!enrollment) {
      return NextResponse.json({ error: "Enrollment not found" }, { status: 404 })
    }

    const permitted =
      action === "pause" ? enrollment.status === "active"
      : action === "resume" ? enrollment.status === "paused"
      : enrollment.status === "active" || enrollment.status === "paused"
    if (!permitted) {
      return NextResponse.json(
        { error: `Cannot ${action} an enrollment with status ${enrollment.status}` },
        { status: 409 },
      )
    }

    const now = new Date()
    const hasLiveProcessingLease = Boolean(
      enrollment.processingToken
      && enrollment.processingLeaseUntil
      && enrollment.processingLeaseUntil > now,
    )
    if (hasLiveProcessingLease) {
      return NextResponse.json(
        { error: "Enrollment is currently processing; retry after the lease expires" },
        { status: 409 },
      )
    }

    const data = action === "pause"
      ? {
          status: "paused",
          nextActionAt: null,
          processingToken: null,
          processingLeaseUntil: null,
        }
      : action === "resume"
        ? {
            status: "active",
            nextActionAt: now,
            processingToken: null,
            processingLeaseUntil: null,
          }
        : {
            status: "completed",
            exitReason: "manual",
            completedAt: now,
            currentStepId: null,
            nextActionAt: null,
            processingToken: null,
            processingLeaseUntil: null,
          }

    const transition = {
      where: {
        id,
        organizationId: orgId,
        status: enrollment.status,
        OR: [
          { processingToken: null },
          { processingLeaseUntil: null },
          { processingLeaseUntil: { lte: now } },
        ],
      },
      data,
    }

    // Exact-state CAS prevents two lifecycle requests (or a processor state
    // change) from both reporting success for the same transition. Cancel also
    // moves aggregate counters in the same transaction: either both changes
    // commit, or neither does.
    const transitioned = action === "cancel"
      ? await prisma.$transaction(async (tx) => {
          const result = await tx.journeyEnrollment.updateMany(transition)
          if (result.count !== 1) return result

          const counters = await tx.journey.updateMany({
            where: { id: enrollment.journeyId, organizationId: orgId },
            data: { activeCount: { decrement: 1 }, completedCount: { increment: 1 } },
          })
          if (counters.count !== 1) {
            throw new Error("Journey counter update failed after enrollment cancellation")
          }
          return result
        })
      : await prisma.journeyEnrollment.updateMany(transition)

    if (transitioned.count !== 1) {
      return NextResponse.json({ error: "Enrollment changed concurrently" }, { status: 409 })
    }

    return NextResponse.json({ success: true, action })
  } catch (e) {
    console.error("Enrollment PATCH error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
