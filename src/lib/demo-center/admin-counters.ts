import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { shouldExpireGrant } from "./session"

/**
 * The three numbers at the top of Demo Center.
 *
 * «Completed» used to count only grants in status COMPLETED — which only the
 * module player ever sets. A guided scenario reports its end as a
 * `journey.completed` event and keeps its grant open for the summary, so every
 * prospect who walked the whole story counted as not finished.
 *
 * «Active» used to count status ACTIVE, and a grant only leaves ACTIVE when
 * the prospect's browser next touches a demo route (expiry is lazy), so a tab
 * closed yesterday stayed «active». It is judged here by the same clock the
 * access routes use.
 */
export async function demoCenterCounters(now: Date = new Date()) {
  return runWithRlsBypass(async () => {
    const [awaitingReview, active, completed] = await Promise.all([
      prisma.demoRequest.count({ where: { status: "SUBMITTED" } }),
      prisma.demoGrant.findMany({
        where: { status: "ACTIVE" },
        select: {
          status: true,
          linkExpiresAt: true,
          verificationExpiresAt: true,
          sessionStartedAt: true,
          sessionLastSeenAt: true,
          sessionExpiresAt: true,
          inactivityMinutes: true,
        },
      }),
      prisma.demoGrant.count({
        where: { OR: [{ status: "COMPLETED" }, { events: { some: { eventType: "journey.completed" } } }] },
      }),
    ])
    return {
      awaitingReview,
      activeSessions: active.filter((grant) => !shouldExpireGrant(grant, now)).length,
      completed,
    }
  })
}
