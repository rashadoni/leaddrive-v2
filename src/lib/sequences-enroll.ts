import { prisma } from "@/lib/prisma"
import { computeNextStepAt } from "@/lib/sequences"
import { Prisma } from "@prisma/client"

export type EnrollOutcome =
  | "created"
  | "reenrolled"
  | "already_enrolled"
  | "not_found"
  // E6 — blocked because the person already has an active/paused enrollment in
  // ANOTHER sequence and the org enforces single-active enrollment.
  | "blocked_other_sequence"

export interface EnrollResult {
  outcome: EnrollOutcome
  enrollment?: unknown
}

/**
 * Enroll one lead/contact into a sequence. Shared by the single-enroll route
 * and the bulk route. MUST be awaited inside an RLS context (withRlsAuth handler).
 *
 * - resolves the touch-queue owner (lead → its assignee, contact → the enroller)
 * - verifies the entity exists in the org (→ not_found)
 * - re-enrolls a stopped/completed row, refuses an active/paused one
 *   (→ already_enrolled), and treats the P2002 unique race the same way
 *
 * The caller is responsible for having already loaded the sequence and confirmed
 * it is active with ≥1 active step, and for passing the first step's delay.
 */
export async function enrollOne(opts: {
  orgId: string
  /** The enroller. null for system/auto-enroll (web-to-lead) — owner then comes
   *  from the lead's assignee only. */
  userId: string | null
  sequenceId: string
  firstStepDelayDays: number
  entityType: "lead" | "contact"
  entityId: string
  workdaysOnly?: boolean
  /** E6 — when true, refuse if the entity is already active/paused in another sequence. */
  singleActiveEnrollment?: boolean
}): Promise<EnrollResult> {
  const { orgId, userId, sequenceId, entityType, entityId } = opts

  // Verify entity exists + resolve owner (lead assignee → user; contact → user)
  let ownerId: string | null = userId
  if (entityType === "lead") {
    const lead = await prisma.lead.findFirst({
      where: { id: entityId, organizationId: orgId },
      select: { assignedTo: true },
    })
    if (!lead) return { outcome: "not_found" }
    ownerId = lead.assignedTo ?? userId
  } else {
    const contact = await prisma.contact.findFirst({
      where: { id: entityId, organizationId: orgId },
      select: { id: true },
    })
    if (!contact) return { outcome: "not_found" }
  }

  const existing = await prisma.sequenceEnrollment.findUnique({
    where: { sequenceId_entityType_entityId: { sequenceId, entityType, entityId } },
  })
  if (existing && (existing.status === "active" || existing.status === "paused")) {
    return { outcome: "already_enrolled", enrollment: existing }
  }

  // E6 — one active enrollment per person: refuse if they're already active or
  // paused in a DIFFERENT sequence. Scoped to org+entity; the sequenceId != this
  // one excludes the row we may be re-enrolling here.
  if (opts.singleActiveEnrollment) {
    const other = await prisma.sequenceEnrollment.findFirst({
      where: {
        organizationId: orgId,
        entityType,
        entityId,
        status: { in: ["active", "paused"] },
        sequenceId: { not: sequenceId },
      },
      select: { id: true, sequenceId: true, sequence: { select: { name: true } } },
    })
    if (other) {
      return { outcome: "blocked_other_sequence", enrollment: other }
    }
  }

  const nextStepAt = computeNextStepAt(new Date(), opts.firstStepDelayDays, { workdaysOnly: opts.workdaysOnly })

  try {
    const enrollment = existing
      ? await prisma.sequenceEnrollment.update({
          where: { id: existing.id },
          data: {
            status: "active", currentStep: 0, nextStepAt,
            enrolledBy: userId, ownerId,
            completedAt: null, stoppedAt: null, repliedAt: null,
            meetingBookedAt: null, lastOutcome: null, exitReason: null,
          },
        })
      : await prisma.sequenceEnrollment.create({
          data: {
            sequenceId, organizationId: orgId, entityType, entityId,
            enrolledBy: userId, ownerId, status: "active", currentStep: 0, nextStepAt,
          },
        })
    return { outcome: existing ? "reenrolled" : "created", enrollment }
  } catch (err) {
    // Concurrent enroll hit the unique index — treat as already enrolled.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { outcome: "already_enrolled" }
    }
    throw err
  }
}
