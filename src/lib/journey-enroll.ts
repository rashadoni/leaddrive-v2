import { prisma } from "@/lib/prisma"

/**
 * Enrolls a contact in a journey the way the enroll API does
 * (src/app/api/v1/journeys/enroll/route.ts): on the journey's first step, due
 * now, with the journey's and the step's counters moved. The journey engine
 * picks up only an enrollment that names its current step and is due
 * (processEnrollmentStep, src/lib/journey-engine.ts).
 *
 * Returns the new enrollment's id, or null when the journey has no steps or
 * the contact is already in it (active or paused).
 *
 * The AI payment reminder (api/cron/ai-auto-actions) used to write its own
 * enrollment with `currentStepIndex: 0` — a column the model does not have —
 * so Prisma refused the write, and the step it would have needed was never set.
 */
export async function enrollContactInJourney(opts: {
  organizationId: string
  journeyId: string
  contactId: string
  now?: Date
}): Promise<string | null> {
  const { organizationId, journeyId, contactId } = opts
  const journey = await prisma.journey.findFirst({
    where: { id: journeyId, organizationId },
    include: { steps: { orderBy: { stepOrder: "asc" }, take: 1 } },
  })
  const firstStep = journey?.steps?.[0]
  if (!firstStep) return null

  const existing = await prisma.journeyEnrollment.findFirst({
    where: { organizationId, journeyId, contactId, status: { in: ["active", "paused"] } },
    select: { id: true },
  })
  if (existing) return null

  const enrollment = await prisma.journeyEnrollment.create({
    data: {
      organizationId,
      journeyId,
      contactId,
      currentStepId: firstStep.id,
      status: "active",
      nextActionAt: opts.now ?? new Date(),
    },
  })
  await prisma.journey.updateMany({
    where: { id: journeyId, organizationId },
    data: { entryCount: { increment: 1 }, activeCount: { increment: 1 } },
  })
  await prisma.journeyStep.update({
    where: { id: firstStep.id },
    data: { statsEntered: { increment: 1 } },
  })
  return enrollment.id
}
