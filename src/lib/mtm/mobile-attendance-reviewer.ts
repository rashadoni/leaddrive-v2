import { prisma } from "@/lib/prisma"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"

/**
 * A manager on the phone decides Personnel requests as the CRM user his card
 * is linked to (owner, 2026-10-17: leave requests never reached the manager's
 * «Təsdiqlər» — that section was read only behind the withdrawn Workforce HRM
 * module). The mobile token proves the card; the card names its web login,
 * and every check after this — active user, write right on MTM, Personnel on,
 * the employee in his scope — is the browser's own (resolveAttendanceReviewerScope).
 * A card with no linked login cannot decide: null.
 */
export async function mobileAttendanceReviewer(auth: { orgId: string; agentId: string }): Promise<AttendanceReviewer | null> {
  const card = await prisma.mtmAgent.findFirst({ where: { id: auth.agentId, organizationId: auth.orgId, status: "ACTIVE" }, select: { userId: true } })
  return card?.userId ? { organizationId: auth.orgId, userId: card.userId, principalType: "session" } : null
}
