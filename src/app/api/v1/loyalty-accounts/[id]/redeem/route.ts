/**
 * D8 Loyalty — manual redeem (admin / operator).
 *
 * POST /api/v1/loyalty-accounts/[id]/redeem
 * Body: { points: number, reason?: string }
 *
 * Slice-1 `redeemPoints` validates that requested ≤ current.points and
 * that lifetimePoints isn't touched (only `points` decreases). Same
 * CAS pattern as /earn to defend against two concurrent redeems both
 * reading the same balance.
 *
 * NOTE: the UI shows a confirmation dialog for points >= 1000 (see
 * LARGE_OP_THRESHOLD on the detail page). That is a *fat-finger UI
 * guard*, NOT a security boundary — a direct API caller can POST any
 * positive integer (up to the account balance) without confirmation.
 * If high-value debits ever need a hard server-side gate, add a
 * `requireConfirmation` boolean to the body and have the page set it
 * for large ops, then 403 here when missing.
 */
import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { redeemPoints } from "@/lib/loyalty/points-engine"
import { createNotification } from "@/lib/notifications"

interface AccountRow {
  id: string
  organizationId: string
  contactId: string
  points: number
  lifetimePoints: number
}

const MAX_RETRIES = 3

export const POST = withRlsAuth("loyalty", "write", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  // requireAuth (not getOrgId) so we capture userId for the audit trail.
  const orgId = auth.orgId
  const actorUserId = auth.userId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing account id" }, { status: 400 })
  }

  let body: { points?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (typeof body.points !== "number" || !Number.isInteger(body.points) || body.points <= 0) {
    return NextResponse.json(
      { error: "Invalid `points` — must be positive integer" },
      { status: 400 },
    )
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const account = (await prisma.loyaltyAccount.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        contactId: true,
        points: true,
        lifetimePoints: true,
      },
    })) as AccountRow | null
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    const result = redeemPoints({
      current: { points: account.points, lifetimePoints: account.lifetimePoints },
      points: body.points,
    })
    if (!result.ok) {
      // Most likely "insufficient balance" — surface to the operator
      // with the actual remaining balance for context.
      return NextResponse.json(
        { error: result.error, available: account.points },
        { status: 400 },
      )
    }

    try {
      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const cas = await tx.loyaltyAccount.updateMany({
          where: {
            id: account.id,
            organizationId: orgId,
            points: account.points,
            lifetimePoints: account.lifetimePoints,
          },
          data: {
            // `result.delta` is signed negative for redeem; increment
            // by a negative IS a decrement.
            points: { increment: result.delta },
            // redeem never touches lifetimePoints; result.lifetimeDelta === 0.
            lifetimePoints: { increment: result.lifetimeDelta },
          },
        })
        if (cas.count === 0) return null

        const txn = await tx.loyaltyTransaction.create({
          data: {
            organizationId: orgId,
            loyaltyAccountId: account.id,
            type: result.type,
            delta: result.delta,
            lifetimeDelta: result.lifetimeDelta,
            reason,
            createdBy: actorUserId,
          },
          select: { id: true, createdAt: true },
        })
        return { txn, nextPoints: result.next }
      })

      if (!updated) {
        continue // lost CAS — retry
      }

      // Phase 2c notification — notable event (manual redemption by operator).
      // Org-wide in-app only (no specific recipient userId readily available).
      // Best-effort: .catch() so it never blocks the redeem response.
      createNotification({
        organizationId: orgId,
        type: "info",
        title: "Loyalty points redeemed",
        message: `${Math.abs(result.delta)} points redeemed from account`,
        entityType: "loyalty",
        entityId: account.id,
        kind: "loyalty.redeemed",
      }).catch(() => {})

      return NextResponse.json({
        ok: true,
        accountId: account.id,
        transactionId: updated.txn.id,
        delta: result.delta,
        lifetimeDelta: result.lifetimeDelta,
        next: updated.nextPoints,
      })
    } catch (err) {
      console.error("[loyalty-accounts/redeem] write error:", err)
      return NextResponse.json(
        { error: "Failed to redeem points" },
        { status: 500 },
      )
    }
  }

  return NextResponse.json(
    { error: "Concurrent modification — try again" },
    { status: 409 },
  )
})
