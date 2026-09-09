/**
 * C5 Account Engagement — Phase 6: ABM journey auto-enrollment.
 *
 * When an account's tier/stage changes (or it's promoted/recomputed), enroll it
 * into every ACTIVE AbmJourney whose targeting matches: targetIcpTiers (empty =
 * any) AND targetStages (empty = any). Idempotent — the DB
 * @@unique([journeyId, marketingAccountId]) plus createMany skipDuplicates means
 * re-running never double-enrolls. Pure matcher + injectable-client enroller.
 */

import { prisma as defaultPrisma } from "@/lib/prisma"

/** The journey fields the matcher needs (subset of AbmJourney). */
export interface EligibleJourney {
  id: string
  status: string
  targetIcpTiers: string[]
  targetStages: string[]
}

export interface AccountTargeting {
  icpTier: string
  lifecycleStage: string
}

/**
 * Pure: which of `journeys` an account is eligible for. A journey matches when
 * it's active AND (no tier filter OR includes the account's tier) AND (no stage
 * filter OR includes the account's stage).
 */
export function selectEligibleJourneys(
  account: AccountTargeting,
  journeys: readonly EligibleJourney[],
): EligibleJourney[] {
  return journeys.filter(
    (j) =>
      j.status === "active" &&
      (j.targetIcpTiers.length === 0 || j.targetIcpTiers.includes(account.icpTier)) &&
      (j.targetStages.length === 0 || j.targetStages.includes(account.lifecycleStage)),
  )
}

type EnrollClient = {
  abmJourney: {
    findMany(args: {
      where: { organizationId: string; status: string }
      select: { id: true; status: true; targetIcpTiers: true; targetStages: true }
    }): Promise<EligibleJourney[]>
  }
  abmJourneyEnrollment: {
    findMany(args: {
      where: { marketingAccountId: string; journeyId: { in: string[] } }
      select: { journeyId: true }
    }): Promise<{ journeyId: string }[]>
    createMany(args: {
      data: Array<{
        organizationId: string
        journeyId: string
        marketingAccountId: string
        status: string
      }>
      skipDuplicates?: boolean
    }): Promise<{ count: number }>
  }
}

export interface EnrollResult {
  eligible: number
  enrolled: number
  alreadyEnrolled: number
}

/**
 * Enroll one account into all matching active journeys. Best-effort caller
 * (the stage-transition route swallows errors). Returns a tally.
 */
export async function enrollAccountInJourneys(
  orgId: string,
  accountId: string,
  account: AccountTargeting,
  client: EnrollClient = defaultPrisma as unknown as EnrollClient,
): Promise<EnrollResult> {
  const journeys = await client.abmJourney.findMany({
    where: { organizationId: orgId, status: "active" },
    select: { id: true, status: true, targetIcpTiers: true, targetStages: true },
  })
  const eligible = selectEligibleJourneys(account, journeys)
  if (eligible.length === 0) return { eligible: 0, enrolled: 0, alreadyEnrolled: 0 }

  const eligibleIds = eligible.map((j) => j.id)
  const existing = await client.abmJourneyEnrollment.findMany({
    where: { marketingAccountId: accountId, journeyId: { in: eligibleIds } },
    select: { journeyId: true },
  })
  const enrolledSet = new Set(existing.map((e) => e.journeyId))
  const toEnroll = eligible.filter((j) => !enrolledSet.has(j.id))
  if (toEnroll.length === 0) {
    return { eligible: eligible.length, enrolled: 0, alreadyEnrolled: eligible.length }
  }

  const created = await client.abmJourneyEnrollment.createMany({
    data: toEnroll.map((j) => ({
      organizationId: orgId,
      journeyId: j.id,
      marketingAccountId: accountId,
      status: "enrolled",
    })),
    skipDuplicates: true, // belt + the @@unique guards a concurrent enroll
  })

  return {
    eligible: eligible.length,
    enrolled: created.count,
    alreadyEnrolled: eligible.length - created.count,
  }
}
