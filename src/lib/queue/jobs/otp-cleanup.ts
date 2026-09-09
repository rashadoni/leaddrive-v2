/**
 * OTP cleanup job — extracted from `src/app/api/cron/otp-cleanup/route.ts`
 * so it can be invoked either via HTTP cron (transition path) or via
 * a BullMQ worker (Q4 target).
 *
 * Pure function: takes a Prisma client, returns counts. No HTTP, no env,
 * no auth — those are the caller's responsibility.
 */
import type { PrismaClient } from "@prisma/client"

export interface OtpCleanupResult {
  deletedExpired: number
  deletedUsedOld: number
  auditWindowDays: number
}

/**
 * Delete OTP records that are either:
 *   - past their `expiresAt` (never verified, now stale), OR
 *   - already used (`usedAt != null`) and older than 7 days (keep recent for audit)
 *
 * Idempotent — safe to retry.
 */
export async function runOtpCleanup(
  prisma: Pick<PrismaClient, "otpCode">,
  now: Date = new Date(),
  auditWindowDays: number = 7
): Promise<OtpCleanupResult> {
  const auditCutoff = new Date(now.getTime() - auditWindowDays * 24 * 60 * 60 * 1000)

  const [expired, usedOld] = await Promise.all([
    prisma.otpCode.deleteMany({
      where: { expiresAt: { lt: now }, usedAt: null },
    }),
    prisma.otpCode.deleteMany({
      where: { usedAt: { not: null, lt: auditCutoff } },
    }),
  ])

  return {
    deletedExpired: expired.count,
    deletedUsedOld: usedOld.count,
    auditWindowDays,
  }
}
