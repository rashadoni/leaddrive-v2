import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { enrollOne, type EnrollOutcome } from "@/lib/sequences-enroll"
import { readSingleActiveEnrollment } from "@/lib/sequence-enrollment-policy"
import { withRlsAuth } from "@/lib/with-rls"

const bodySchema = z.object({
  entityType: z.enum(["lead", "contact"]),
  entityIds: z.array(z.string().min(1)).min(1).max(500),
})

/**
 * POST /api/v1/sequences/[id]/enroll-bulk — enroll many leads/contacts at once
 * (from a list's bulk-selection). Returns a per-outcome summary. Enrollments run
 * sequentially to keep the RLS-scoped transaction footprint small and predictable.
 */
export const POST = withRlsAuth(undefined, undefined, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id: sequenceId } = await params

  const sequence = await prisma.salesSequence.findFirst({
    where: { id: sequenceId, organizationId: auth.orgId, isActive: true },
    include: { steps: { where: { isActive: true }, orderBy: { stepOrder: "asc" } } },
  })
  if (!sequence) return NextResponse.json({ error: "Sequence not found or inactive" }, { status: 404 })
  if (sequence.steps.length === 0) {
    return NextResponse.json({ error: "Sequence has no active steps" }, { status: 422 })
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 400 })
  }
  const { entityType, entityIds } = parsed.data
  const firstStepDelayDays = sequence.steps[0].delayDays

  // E6 — read the single-active-enrollment policy ONCE for the whole batch.
  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  const singleActiveEnrollment = readSingleActiveEnrollment(org?.settings)

  const summary: Record<EnrollOutcome, number> = { created: 0, reenrolled: 0, already_enrolled: 0, not_found: 0, blocked_other_sequence: 0 }
  // Dedup so a repeated id isn't double-counted / double-written.
  for (const entityId of [...new Set(entityIds)]) {
    const r = await enrollOne({ orgId: auth.orgId, userId: auth.userId, sequenceId, firstStepDelayDays, entityType, entityId, workdaysOnly: sequence.workdaysOnly, singleActiveEnrollment })
    summary[r.outcome] += 1
  }

  return NextResponse.json({ success: true, data: summary }, { status: 201 })
})
