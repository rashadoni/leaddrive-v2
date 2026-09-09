/**
 * POS award — give a member N points for a counter purchase.
 *
 * POST /api/v1/loyalty-accounts/award  body: { contactId, points, reason? }
 *
 * Staff-only (withRlsAuth "loyalty" "write"). The companion to /resolve: after
 * scanning a member's QR card the cashier awards points. Find-OR-CREATEs the
 * loyalty account HERE — on the real award (a points event), NEVER on a bare
 * scan — so a member is enrolled exactly when they first earn (no spurious 0/0
 * orphans). CAS-safe earn + tier recalc + audit txn, the same engine as the
 * manual `[id]/earn`.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { earnPoints } from "@/lib/loyalty/points-engine"
import { newTierCache, resolveTier } from "@/lib/loyalty/tier-resolver"
import { createNotification } from "@/lib/notifications"

const SELECT = { id: true, points: true, lifetimePoints: true, tier: true } as const
const MAX_RETRIES = 4 // +1 over [id]/earn to absorb the first-touch create race

export const POST = withRlsAuth("loyalty", "write", async (req, auth) => {
  const orgId = auth.orgId
  const actorUserId = auth.userId

  let body: { contactId?: unknown; points?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : ""
  if (!contactId) return NextResponse.json({ error: "`contactId` is required" }, { status: 400 })
  if (typeof body.points !== "number" || !Number.isInteger(body.points) || body.points <= 0) {
    return NextResponse.json({ error: "Invalid `points` — must be a positive integer" }, { status: 400 })
  }
  const points = body.points
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.slice(0, 500) : "POS award"

  // Member must exist in this org (contactId comes from the client / a prior scan).
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: orgId },
    select: { id: true },
  })
  if (!contact) return NextResponse.json({ error: "Member not found" }, { status: 404 })

  const tierCache = newTierCache()

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // find-or-create the account — create ONLY here (the real award), with a
    // P2002 race re-read. A no-account member is enrolled by their first award.
    let account = await prisma.loyaltyAccount.findFirst({
      where: { organizationId: orgId, contactId },
      select: SELECT,
    })
    if (!account) {
      try {
        account = await prisma.loyaltyAccount.create({
          data: { organizationId: orgId, contactId, points: 0, lifetimePoints: 0, tier: null },
          select: SELECT,
        })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue
        console.error("[loyalty-accounts/award] create failed:", e)
        return NextResponse.json({ error: "Failed to enroll member" }, { status: 500 })
      }
    }

    const result = earnPoints({
      current: { points: account.points, lifetimePoints: account.lifetimePoints },
      points,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

    const resolved = await resolveTier(tierCache, prisma, orgId, result.next.lifetimePoints)
    const tierChanged = resolved.tier !== account.tier

    try {
      const written = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const cas = await tx.loyaltyAccount.updateMany({
          where: {
            id: account!.id,
            organizationId: orgId,
            points: account!.points,
            lifetimePoints: account!.lifetimePoints,
            tier: account!.tier,
          },
          data: {
            points: { increment: result.delta },
            lifetimePoints: { increment: result.lifetimeDelta },
            ...(tierChanged ? { tier: resolved.tier, tierUpgradedAt: new Date() } : {}),
          },
        })
        if (cas.count === 0) return null
        await tx.loyaltyTransaction.create({
          data: {
            organizationId: orgId,
            loyaltyAccountId: account!.id,
            type: result.type,
            delta: result.delta,
            lifetimeDelta: result.lifetimeDelta,
            reason,
            createdBy: actorUserId,
          },
        })
        return { nextPoints: result.next.points }
      })
      if (!written) continue // lost CAS → retry

      if (tierChanged) {
        createNotification({
          organizationId: orgId,
          type: "success",
          title: "Loyalty tier changed",
          message: `Account promoted to ${resolved.tier ?? "new tier"}`,
          entityType: "loyalty",
          entityId: account.id,
          kind: "loyalty.tier_changed",
        }).catch(() => {})
      }

      return NextResponse.json({
        success: true,
        accountId: account.id,
        awarded: points,
        points: written.nextPoints,
        tier: resolved.tier,
        tierChanged,
      })
    } catch (e) {
      console.error("[loyalty-accounts/award] write failed:", e)
      return NextResponse.json({ error: "Failed to award points" }, { status: 500 })
    }
  }

  return NextResponse.json({ error: "Concurrent modification — try again" }, { status: 409 })
})
