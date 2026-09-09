/**
 * D8 Loyalty — manual earn (admin / operator).
 *
 * POST /api/v1/loyalty-accounts/[id]/earn
 * Body: { points: number, reason?: string }
 *
 * Slice-1 `earnPoints` helper validates the math; we wrap the write in
 * a Prisma transaction with optimistic compare-and-swap (updateMany
 * with current-value WHERE guard) so two concurrent admin earns can't
 * both apply with a stale snapshot.
 *
 * Phase C: synchronous tier-recalc — after the points + lifetimePoints
 *   write lands, this route re-reads the active LoyaltyTier ladder
 *   (cached per request via newTierCache → resolveTier) and bumps
 *   `LoyaltyAccount.tier` + `tierUpgradedAt` if the new lifetimePoints
 *   crosses a threshold. Same transaction so the audit row + balance +
 *   tier bump all commit atomically. No async cron — per user decision
 *   (sync recalc keeps tier in lock-step with the wallet).
 *
 * For storefront-driven earn (purchase → points with EarnRule) the
 * same race-class applies but with the rate × tier-multiplier rounding
 * path. That lands in Phase D alongside the checkout integration. This
 * manual endpoint is the admin-corrections path and applies points
 * AS-GIVEN (no tier multiplier — operator's number is the final award).
 *
 * NOTE: the UI shows a confirmation dialog for points >= 1000 (see
 * LARGE_OP_THRESHOLD on the detail page). That is a *fat-finger UI
 * guard*, NOT a security boundary — a direct API caller can POST any
 * positive integer without confirmation. If high-value adjustments
 * ever need a hard server-side gate, add a `requireConfirmation`
 * boolean to the body and have the page set it for large ops, then
 * 403 here when missing.
 */
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { earnPoints } from "@/lib/loyalty/points-engine"
import {
  newTierCache,
  resolveTier,
} from "@/lib/loyalty/tier-resolver"
import { createNotification } from "@/lib/notifications"

interface AccountRow {
  id: string
  organizationId: string
  contactId: string
  points: number
  lifetimePoints: number
  tier: string | null
}

const MAX_RETRIES = 3

export const POST = withRlsAuth("loyalty", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  // requireAuth (not getOrgId) so we capture userId for the audit trail
  // — "who issued this manual adjustment" matters for ops review.
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

  // Per-request tier-list cache — one DB read across the entire CAS
  // retry loop + post-write recalc. Without it the storefront path
  // would burn an extra roundtrip per credit.
  const tierCache = newTierCache()

  // Optimistic CAS retry loop. On lost-race (updateMany.count === 0)
  // we re-read and try again. Cap at MAX_RETRIES to avoid spinning.
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const account = (await prisma.loyaltyAccount.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        contactId: true,
        points: true,
        lifetimePoints: true,
        tier: true,
      },
    })) as AccountRow | null
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    const result = earnPoints({
      current: { points: account.points, lifetimePoints: account.lifetimePoints },
      points: body.points,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Recompute tier *outside* the transaction for the new lifetimePoints
    // value. Reads from cache after the first iteration. We pass `prisma`
    // here (not tx) because the tier list itself doesn't change mid-CAS;
    // the only thing the transaction needs is the consistent points
    // write + audit row + (conditional) tier bump.
    const nextLifetime = result.next.lifetimePoints
    const resolved = await resolveTier(tierCache, prisma, orgId, nextLifetime)
    const tierChanged = resolved.tier !== account.tier

    try {
      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // CAS: only update if points + lifetimePoints still match what
        // we just read. Concurrent earn/redeem on the same account
        // bumps these and our updateMany.count returns 0 → caller retries.
        // We also gate on `tier` so a concurrent tier-write doesn't get
        // silently clobbered.
        const cas = await tx.loyaltyAccount.updateMany({
          where: {
            id: account.id,
            organizationId: orgId,
            points: account.points,
            lifetimePoints: account.lifetimePoints,
            tier: account.tier,
          },
          data: {
            points: { increment: result.delta },
            lifetimePoints: { increment: result.lifetimeDelta },
            // Bump tier + timestamp only when the threshold actually
            // crossed — no-op rewrites would churn the audit log.
            ...(tierChanged
              ? { tier: resolved.tier, tierUpgradedAt: new Date() }
              : {}),
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
        return { txn, nextPoints: result.next, tierChanged, newTier: resolved.tier }
      })

      if (!updated) {
        // Lost the CAS — another writer modified the row between our
        // read and update. Retry.
        continue
      }

      // Phase 2c notification — emit ONLY on tier-change (notable, low-volume).
      // NOT emitted on every points-earn (that would be high-volume spam).
      // Org-wide in-app only (no specific recipient userId available here).
      // Best-effort: .catch() so it never blocks the earn response.
      if (updated.tierChanged) {
        createNotification({
          organizationId: orgId,
          type: "success",
          title: "Loyalty tier changed",
          message: `Account promoted to ${updated.newTier ?? "new tier"}`,
          entityType: "loyalty",
          entityId: account.id,
          kind: "loyalty.tier_changed",
        }).catch(() => {})
      }

      return NextResponse.json({
        ok: true,
        accountId: account.id,
        transactionId: updated.txn.id,
        delta: result.delta,
        lifetimeDelta: result.lifetimeDelta,
        next: updated.nextPoints,
        // Phase C: surface tier transition to the UI so it can flash a
        // "promoted to {tier}" toast. previousTier = null is the most
        // useful flag for first-time tier earners.
        tier: updated.newTier,
        previousTier: account.tier,
        tierChanged: updated.tierChanged,
      })
    } catch (err) {
      console.error("[loyalty-accounts/earn] write error:", err)
      return NextResponse.json(
        { error: "Failed to credit points" },
        { status: 500 },
      )
    }
  }

  return NextResponse.json(
    { error: "Concurrent modification — try again" },
    { status: 409 },
  )
})
