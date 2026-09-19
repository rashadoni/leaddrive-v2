import { prisma } from "@/lib/prisma"
import { shouldExpireGrant } from "@/lib/demo-center/session"

export interface DemoGrantForExpiry {
  id: string
  status: string
  linkExpiresAt: Date
  verificationExpiresAt: Date | null
  sessionStartedAt: Date | null
  sessionLastSeenAt: Date | null
  sessionExpiresAt: Date | null
  inactivityMinutes: number
}

const EXPIRABLE_STATUSES = ["ISSUING", "SENT", "OTP_SENT", "OTP_VERIFIED", "ACTIVE", "DELIVERY_FAILED"]

export async function expireDemoGrantIfNeeded(grant: DemoGrantForExpiry, now = new Date()): Promise<boolean> {
  if (!shouldExpireGrant(grant, now)) return false

  const expired = await prisma.$transaction(async (tx) => {
    // Re-evaluate the timeout in the UPDATE predicate. A request may be using
    // an older snapshot while another accepted event refreshes lastSeenAt.
    const result = grant.sessionStartedAt
      ? await tx.demoGrant.updateMany({
        where: {
          id: grant.id,
          status: { in: EXPIRABLE_STATUSES },
          sessionStartedAt: { not: null },
          inactivityMinutes: grant.inactivityMinutes,
          OR: [
            { sessionExpiresAt: null },
            { sessionExpiresAt: { lte: now } },
            { sessionLastSeenAt: null },
            { sessionLastSeenAt: { lte: new Date(now.getTime() - grant.inactivityMinutes * 60_000) } },
          ],
        },
        data: {
          status: "EXPIRED",
          verificationHash: null,
          verificationExpiresAt: null,
          sessionHash: null,
        },
      })
      : await tx.demoGrant.updateMany({
        where: {
          id: grant.id,
          status: { in: EXPIRABLE_STATUSES },
          sessionStartedAt: null,
          linkExpiresAt: { lte: now },
        },
        data: {
          status: "EXPIRED",
          verificationHash: null,
          verificationExpiresAt: null,
          sessionHash: null,
        },
      })

    if (!result.count) return false
    await tx.demoAccessEvent.create({
      data: {
        grantId: grant.id,
        eventType: "EXPIRED",
        metadata: { reason: grant.sessionStartedAt ? "session_timeout" : "link_timeout" },
      },
    })
    return true
  })

  if (expired) return true

  // A compare-and-set loss means the row changed after the caller read it.
  // Refresh the mutable snapshot so downstream status checks cannot continue
  // with a stale ACTIVE/SENT value.
  const latest = await prisma.demoGrant.findUnique({ where: { id: grant.id } })
  if (latest) Object.assign(grant, latest)
  return latest?.status === "EXPIRED"
}

export function noStoreHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
  }
}

export function validRawDemoToken(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value)
}
