import { prisma } from "@/lib/prisma"

/**
 * Check if a journey goal has been reached for an enrollment.
 */
export async function checkGoal(
  enrollment: { id: string; contactId: string | null; leadId: string | null; enrolledAt: Date },
  journey: { goalType: string | null; goalConditions: any },
  orgId: string,
): Promise<boolean> {
  if (!journey.goalType || !journey.goalConditions) return false

  const conditions = journey.goalConditions as Record<string, any>

  switch (journey.goalType) {
    case "deal_created": {
      if (!enrollment.contactId) return false
      const dealCount = await prisma.deal.count({
        where: {
          organizationId: orgId,
          contactId: enrollment.contactId,
          createdAt: { gte: enrollment.enrolledAt },
        },
      })
      return dealCount > 0
    }

    case "status_change": {
      if (enrollment.leadId) {
        const lead = await prisma.lead.findFirst({
          where: { id: enrollment.leadId, organizationId: orgId },
        })
        return lead?.status === conditions.value
      }
      return false
    }

    case "ticket_resolved": {
      if (!enrollment.contactId) return false
      const resolved = await prisma.ticket.count({
        where: {
          organizationId: orgId,
          contactId: enrollment.contactId,
          status: "resolved",
          updatedAt: { gte: enrollment.enrolledAt },
        },
      })
      return resolved > 0
    }

    default:
      return false
  }
}
