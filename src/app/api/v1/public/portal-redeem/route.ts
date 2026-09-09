/**
 * D8 Loyalty — member self-serve redeem (portal Phase 3).
 *
 * POST /api/v1/public/portal-redeem  body: { rewardId }
 *
 * A portal member spends `reward.pointsCost` redeemable points to claim a
 * LoyaltyReward. Identity (contactId) comes ONLY from the portal-token JWT —
 * NEVER the body — so a member can only redeem against their own account
 * (no impersonation). Reuses the slice-1 `redeemPoints` CAS (same as the admin
 * redeem): debits `points` only, never lifetime/tier; CAS-retries against a
 * concurrent redeem. Enforces `stockLimit` inside the txn, writes a
 * `LoyaltyRedemption` (the tenant's fulfilment record) + a 'redeem' txn.
 */
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getPortalUser } from "@/lib/portal-auth"
import { redeemPoints } from "@/lib/loyalty/points-engine"

/** Org.features is a JSON string OR native string[] — normalize. */
function parseFeatures(raw: unknown): string[] {
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw || "[]")
      return Array.isArray(v) ? (v as string[]) : []
    } catch {
      return []
    }
  }
  return Array.isArray(raw) ? (raw as string[]) : []
}

const MAX_RETRIES = 3

export async function POST(req: Request) {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = user.organizationId
  const contactId = user.contactId

  let body: { rewardId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof body.rewardId !== "string" || !body.rewardId) {
    return NextResponse.json({ error: "`rewardId` is required" }, { status: 400 })
  }
  const rewardId = body.rewardId

  return runWithTenant(orgId, async () => {
    // member portal must be enabled for this tenant
    const org = await prisma.organization.findFirst({
      where: { id: orgId },
      select: { features: true },
    })
    if (!parseFeatures(org?.features).includes("loyalty_portal")) {
      return NextResponse.json({ error: "Loyalty portal not enabled" }, { status: 403 })
    }

    const reward = await prisma.loyaltyReward.findFirst({
      where: { id: rewardId, organizationId: orgId, isActive: true },
      select: { id: true, name: true, pointsCost: true, stockLimit: true },
    })
    if (!reward) {
      return NextResponse.json({ error: "Reward not found or inactive" }, { status: 404 })
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const account = await prisma.loyaltyAccount.findFirst({
        where: { organizationId: orgId, contactId },
        select: { id: true, points: true, lifetimePoints: true },
      })
      if (!account) {
        return NextResponse.json(
          { error: "insufficient_points", available: 0, needed: reward.pointsCost },
          { status: 400 },
        )
      }

      const result = redeemPoints({
        current: { points: account.points, lifetimePoints: account.lifetimePoints },
        points: reward.pointsCost,
      })
      if (!result.ok) {
        return NextResponse.json(
          { error: "insufficient_points", available: account.points, needed: reward.pointsCost },
          { status: 400 },
        )
      }

      try {
        const out = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // Serialize concurrent redeems of the SAME reward: lock its row for the
          // txn so the stockLimit count→insert below is atomic per reward. Without
          // it, two racing redeems can both read used < limit and both insert,
          // overshooting the cap by one. Only matters when stockLimit is set.
          if (reward.stockLimit !== null) {
            await tx.$queryRaw`SELECT 1 FROM "loyalty_rewards" WHERE "id" = ${reward.id} AND "organizationId" = ${orgId} FOR UPDATE`
            const used = await tx.loyaltyRedemption.count({
              where: { organizationId: orgId, loyaltyRewardId: reward.id },
            })
            if (used >= reward.stockLimit) return { soldOut: true as const }
          }
          const cas = await tx.loyaltyAccount.updateMany({
            where: {
              id: account.id,
              organizationId: orgId,
              points: account.points,
              lifetimePoints: account.lifetimePoints,
            },
            data: {
              points: { increment: result.delta }, // result.delta is negative
              lifetimePoints: { increment: result.lifetimeDelta }, // 0
            },
          })
          if (cas.count === 0) return { lostCas: true as const }
          const txn = await tx.loyaltyTransaction.create({
            data: {
              organizationId: orgId,
              loyaltyAccountId: account.id,
              type: result.type,
              delta: result.delta,
              lifetimeDelta: result.lifetimeDelta,
              reason: `Redeemed: ${reward.name}`.slice(0, 500),
            },
            select: { id: true },
          })
          const redemption = await tx.loyaltyRedemption.create({
            data: {
              organizationId: orgId,
              contactId,
              loyaltyRewardId: reward.id,
              pointsSpent: reward.pointsCost,
              status: "fulfilled",
              transactionId: txn.id,
            },
            select: { id: true },
          })
          return { redemptionId: redemption.id, nextPoints: result.next.points }
        })

        if ("soldOut" in out) {
          return NextResponse.json({ error: "out_of_stock" }, { status: 400 })
        }
        if ("lostCas" in out) continue // retry
        return NextResponse.json({
          success: true,
          redemptionId: out.redemptionId,
          remainingPoints: out.nextPoints,
          reward: { name: reward.name, pointsSpent: reward.pointsCost },
        })
      } catch (err) {
        console.error("[portal-redeem] error:", err)
        return NextResponse.json({ error: "Failed to redeem" }, { status: 500 })
      }
    }

    return NextResponse.json({ error: "Concurrent modification — try again" }, { status: 409 })
  })
}
