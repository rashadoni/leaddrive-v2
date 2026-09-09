/**
 * D8 Loyalty — shared auto-earn pipeline.
 *
 * ONE code path for crediting loyalty points from a rule-driven event,
 * used by BOTH the storefront earn route (`/api/v1/loyalty-storefront/earn`,
 * an explicit admin/API-key call) AND the automatic CRM-event hooks
 * (invoice-paid, deal-won, signup, birthday-cron). Lifted out of the
 * storefront route so the rule evaluation + tier-recalc + CAS write +
 * expiry stamping + audit row live in exactly one place.
 *
 * Adds three things the inline route lacked:
 *   1. `requireAutoEarnEnabled` — auto-earn hooks pass true so the credit
 *      no-ops unless the tenant opted in via `settings.loyaltyAutoEarn`
 *      (default OFF — a single observable kill-switch; mirrors the existing
 *      `settings.loyaltyPointsExpiryDays` per-tenant JSON convention). The
 *      explicit storefront route omits it (an explicit call always runs).
 *   2. Idempotency — when `referenceId` is set (e.g. invoiceId), an existing
 *      `earn` row for (orgId, 'earn', referenceId) makes the call a no-op.
 *      Backed by a partial unique index (migration
 *      20260620xxxxxx_loyalty_txn_referenceid_unique) as the hard backstop.
 *   3. Writes `referenceId` into the txn COLUMN (the inline route only put it
 *      in the human-readable `reason` text → no machine-readable earn↔source
 *      link, no idempotency anchor). This was a latent bug.
 *
 * Currency resolution (fixes the inline route's hardcoded "USD"):
 *   caller → settings.primaryCurrency → DEFAULT_CURRENCY (env) → "AZN".
 *
 * Takes `orgId` as a parameter and never reads ambient context, so it works
 * both in-request (under withRls' runWithTenant — RLS inherited for free) and
 * under a cron's runWithRlsBypass (every query is explicitly org-scoped).
 */
import { Prisma } from "@prisma/client"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { earnPoints } from "./points-engine"
import { evaluateEarn, type EarnRuleRow } from "./earn-pipeline"
import { newTierCache, resolveTier } from "./tier-resolver"
import type { EarnRuleTrigger } from "./limits"
import { normalizeEarnRuleRow } from "@/lib/prisma-decimal"
import { sendEarnNotification } from "./loyalty-push"

/** The app's RLS-extended Prisma client — typed exactly as the global
 *  `@/lib/prisma` export (loosely, so it satisfies the loyalty helpers'
 *  structural client types, the same way the storefront route passed it).
 *  applyAutoEarn runs its OWN `$transaction`, so it needs the full client,
 *  never a tx-bound one. */
type LoyaltyEarnPrismaClient = (typeof import("@/lib/prisma"))["prisma"]

export interface ApplyAutoEarnInput {
  /** Org scope — ALWAYS explicit; never read from ambient context. */
  orgId: string
  /** Member to credit. */
  contactId: string
  trigger: EarnRuleTrigger
  /** For pointsRate rules; 0 for flat-only triggers. */
  orderAmount?: number
  /** Audit + rule-eval currency. Falls back to org/DEFAULT_CURRENCY. */
  currency?: string | null
  productCategory?: string | null
  /** App-level FK (invoiceId / dealId / contactId / `birthday:<id>:<year>`).
   *  When set, makes the credit idempotent. */
  referenceId?: string | null
  reason?: string | null
  actorUserId?: string | null
  /** Injectable clock for tests / deterministic expiry. */
  now?: Date
  /** Auto-earn hooks pass true → no-op unless settings.loyaltyAutoEarn. */
  requireAutoEarnEnabled?: boolean
}

export type ApplyAutoEarnResult =
  | {
      status: "earned"
      accountId: string
      earned: number
      base: number
      appliedMultiplier: number
      source: string
      rule: { id: string; name: string }
      tier: string | null
      previousTier: string | null
      tierChanged: boolean
      transactionId: string
    }
  | {
      status: "no_op"
      accountId: string | null
      earned: 0
      reason:
        | "no_matching_rule"
        | "rounded_to_zero"
        | "auto_earn_disabled"
        | "already_awarded"
        | "contact_not_found"
      transactionId?: string
    }
  | { status: "error"; error: string; conflict?: boolean }

// 5 retries: the first-touch LoyaltyAccount create race may burn 1-2 before
// the points-CAS loop (matches the storefront route's headroom).
const MAX_RETRIES = 5

/**
 * Credit rule-driven loyalty points to a member. Never throws on the expected
 * paths — returns a discriminated result the caller maps to HTTP / logs.
 */
export async function applyAutoEarn(
  prisma: LoyaltyEarnPrismaClient,
  input: ApplyAutoEarnInput,
): Promise<ApplyAutoEarnResult> {
  const {
    orgId,
    contactId,
    trigger,
    orderAmount = 0,
    productCategory = null,
    referenceId = null,
    reason: reasonExplicit = null,
    actorUserId = null,
    requireAutoEarnEnabled = false,
  } = input
  const now = input.now ?? new Date()

  // --- org settings: master switch + currency + expiry (one read) -----
  const org = await prisma.organization.findFirst({
    where: { id: orgId },
    select: { settings: true },
  })
  const settings = (org?.settings ?? {}) as Record<string, unknown>

  if (requireAutoEarnEnabled && settings.loyaltyAutoEarn !== true) {
    return { status: "no_op", accountId: null, earned: 0, reason: "auto_earn_disabled" }
  }

  // currency: caller → settings.primaryCurrency → DEFAULT_CURRENCY → "AZN"
  const currency =
    (typeof input.currency === "string" && input.currency.trim()) ||
    (typeof settings.primaryCurrency === "string" && settings.primaryCurrency.trim()) ||
    DEFAULT_CURRENCY ||
    "AZN"

  // expiry window (Phase E): earn rows get expiresAt only if the tenant set it
  let expiresAt: Date | null = null
  const days = settings.loyaltyPointsExpiryDays
  if (typeof days === "number" && days > 0) {
    expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  }

  // --- idempotency pre-check (cheap; the partial unique index is the
  //     hard backstop against a racing double-fire) ---------------------
  if (referenceId) {
    const existing = await prisma.loyaltyTransaction.findFirst({
      where: { organizationId: orgId, type: "earn", referenceId },
      select: { id: true, loyaltyAccountId: true },
    })
    if (existing) {
      return {
        status: "no_op",
        accountId: existing.loyaltyAccountId,
        earned: 0,
        reason: "already_awarded",
        transactionId: existing.id,
      }
    }
  }

  // --- contact must exist in this org --------------------------------
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: orgId },
    select: { id: true },
  })
  if (!contact) {
    return { status: "no_op", accountId: null, earned: 0, reason: "contact_not_found" }
  }

  // --- active EarnRules for this trigger (Decimal → number at boundary) ---
  const rawRules = await prisma.loyaltyEarnRule.findMany({
    where: { organizationId: orgId, isActive: true, trigger },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      trigger: true,
      pointsRate: true,
      pointsFlat: true,
      minOrderAmount: true,
      productCategory: true,
      priority: true,
      applyTierMultiplier: true,
      isActive: true,
      validFrom: true,
      validUntil: true,
      createdAt: true,
    },
  })
  const rules: EarnRuleRow[] = rawRules.map((r: (typeof rawRules)[number]) =>
    normalizeEarnRuleRow(r),
  )

  const tierCache = newTierCache()

  // --- CAS retry loop -------------------------------------------------
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const existing = await prisma.loyaltyAccount.findFirst({
      where: { organizationId: orgId, contactId },
      select: { id: true, organizationId: true, contactId: true, points: true, lifetimePoints: true, tier: true },
    })

    // Evaluate the award BEFORE touching the account, so a non-awarding event
    // (no matching rule, or it rounds to zero) never auto-enrols the contact
    // with an empty 0-point account — e.g. the signup hook firing on every
    // contact create when the tenant has no, or a non-matching, signup rule.
    const currentResolved = await resolveTier(
      tierCache,
      prisma,
      orgId,
      existing?.lifetimePoints ?? 0,
    )
    const evalRes = evaluateEarn(
      rules,
      { trigger, orderAmount, currency, productCategory },
      currentResolved.multiplier,
    )

    if (!evalRes.rule || evalRes.award <= 0) {
      return {
        status: "no_op",
        accountId: existing?.id ?? null,
        earned: 0,
        reason: evalRes.rule ? "rounded_to_zero" : "no_matching_rule",
      }
    }

    // We WILL award → ensure the account exists (create only now, never for a
    // no-op event).
    let account = existing
    if (!account) {
      try {
        account = await prisma.loyaltyAccount.create({
          data: { organizationId: orgId, contactId, points: 0, lifetimePoints: 0, tier: null },
          select: { id: true, organizationId: true, contactId: true, points: true, lifetimePoints: true, tier: true },
        })
      } catch (err) {
        // P2002 — a concurrent first-touch won the create race; re-read.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue
        console.error("[loyalty/auto-earn] account create error:", err)
        return { status: "error", error: "Failed to create loyalty account" }
      }
    }

    const earnRes = earnPoints({
      current: { points: account.points, lifetimePoints: account.lifetimePoints },
      points: evalRes.award,
    })
    if (!earnRes.ok) return { status: "error", error: earnRes.error }

    const nextLifetime = earnRes.next.lifetimePoints
    const nextResolved = await resolveTier(tierCache, prisma, orgId, nextLifetime)
    const tierChanged = nextResolved.tier !== account.tier

    try {
      const writeRes = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const cas = await tx.loyaltyAccount.updateMany({
          where: {
            id: account!.id,
            organizationId: orgId,
            points: account!.points,
            lifetimePoints: account!.lifetimePoints,
            tier: account!.tier,
          },
          data: {
            points: { increment: earnRes.delta },
            lifetimePoints: { increment: earnRes.lifetimeDelta },
            ...(tierChanged ? { tier: nextResolved.tier, tierUpgradedAt: now } : {}),
          },
        })
        if (cas.count === 0) return null

        // ASCII-only audit text (some log parsers choke on the Unicode × glyph).
        const auditReason =
          reasonExplicit ??
          `${evalRes.rule!.name} (${trigger}, ${evalRes.source}, base=${evalRes.base}, x${evalRes.appliedMultiplier})${
            referenceId ? ` ref=${referenceId}` : ""
          }`

        const txn = await tx.loyaltyTransaction.create({
          data: {
            organizationId: orgId,
            loyaltyAccountId: account!.id,
            type: earnRes.type,
            delta: earnRes.delta,
            lifetimeDelta: earnRes.lifetimeDelta,
            reason: auditReason.slice(0, 500),
            // BUG FIX: actually persist the referenceId COLUMN (idempotency anchor).
            ...(referenceId ? { referenceId } : {}),
            createdBy: actorUserId,
            ...(expiresAt !== null ? { expiresAt } : {}),
          },
          select: { id: true },
        })
        return { txn }
      })

      if (!writeRes) continue // lost CAS — retry

      // Fire-and-forget native-app push (no-op when the member has no registered
      // device — the common case until the app ships). A push failure must NEVER
      // affect the earn, so it's .catch-wrapped and never awaited.
      sendEarnNotification(prisma, orgId, contactId, evalRes.award, tierChanged ? nextResolved.tier : null).catch(
        (e) => console.error("[loyalty/auto-earn] push:", e),
      )

      return {
        status: "earned",
        accountId: account.id,
        earned: evalRes.award,
        base: evalRes.base,
        appliedMultiplier: evalRes.appliedMultiplier,
        source: evalRes.source,
        rule: { id: evalRes.rule.id, name: evalRes.rule.name },
        tier: nextResolved.tier,
        previousTier: account.tier,
        tierChanged,
        transactionId: writeRes.txn.id,
      }
    } catch (err) {
      // A P2002 here = the partial unique index caught a racing double-fire on
      // the same referenceId — treat as already-awarded (idempotent success).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && referenceId) {
        const existing = await prisma.loyaltyTransaction.findFirst({
          where: { organizationId: orgId, type: "earn", referenceId },
          select: { id: true, loyaltyAccountId: true },
        })
        if (existing) {
          return { status: "no_op", accountId: existing.loyaltyAccountId, earned: 0, reason: "already_awarded", transactionId: existing.id }
        }
      }
      console.error("[loyalty/auto-earn] write error:", err)
      return { status: "error", error: "Failed to credit loyalty points" }
    }
  }

  return { status: "error", error: "Concurrent modification — try again", conflict: true }
}

export type ReverseAutoEarnResult =
  | { status: "reversed"; removed: number; transactionId: string; accountId: string }
  | {
      status: "no_op"
      reason: "nothing_earned" | "already_reversed" | "no_account" | "nothing_redeemable"
    }
  | { status: "error"; error: string; conflict?: boolean }

/**
 * Reverse an auto-earn for a referenceId — e.g. when an invoice's payment is
 * deleted/refunded so the purchase no longer stands.
 *
 * Debits the REDEEMABLE points that were earned, FLOORED at the member's current
 * balance (never negative — if they already spent the points, we claw back only
 * what's left). Per the system invariant, `lifetimePoints` / tier are MONOTONIC
 * and are NOT reduced — the member keeps the tier progress (the standard
 * spend-based-retail behaviour: status doesn't yo-yo on refunds; see
 * deferred_findings). Writes an `adjustment_debit` (lifetimeDelta 0).
 *
 * Idempotent: a reversal marker txn (referenceId = `reverse:<ref>`) blocks a
 * second reversal. Takes `orgId` as a param (never ambient) so it is safe as a
 * fire-and-forget hook under runWithTenant.
 */
export async function reverseAutoEarn(
  prisma: LoyaltyEarnPrismaClient,
  input: { orgId: string; referenceId: string; reason?: string; actorUserId?: string | null },
): Promise<ReverseAutoEarnResult> {
  const { orgId, referenceId, reason, actorUserId = null } = input
  const reverseRef = `reverse:${referenceId}`

  // 1. The original earn for this reference (nothing earned → nothing to do).
  const earn = await prisma.loyaltyTransaction.findFirst({
    where: { organizationId: orgId, type: "earn", referenceId },
    select: { id: true, loyaltyAccountId: true, delta: true },
  })
  if (!earn) return { status: "no_op", reason: "nothing_earned" }

  // 2. Idempotency — already reversed?
  const already = await prisma.loyaltyTransaction.findFirst({
    where: { organizationId: orgId, referenceId: reverseRef },
    select: { id: true },
  })
  if (already) return { status: "no_op", reason: "already_reversed" }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const account = await prisma.loyaltyAccount.findFirst({
      where: { id: earn.loyaltyAccountId, organizationId: orgId },
      select: { id: true, points: true },
    })
    if (!account) return { status: "no_op", reason: "no_account" }

    // Claw back what was earned, but never more than the member currently holds
    // (floor at 0 — no negative balances). Tier/lifetime are left untouched.
    const toRemove = Math.min(earn.delta, account.points)
    if (toRemove <= 0) return { status: "no_op", reason: "nothing_redeemable" }

    try {
      const writeRes = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const cas = await tx.loyaltyAccount.updateMany({
          where: { id: account.id, organizationId: orgId, points: account.points },
          data: { points: { decrement: toRemove } },
        })
        if (cas.count === 0) return null // lost CAS → retry
        const txn = await tx.loyaltyTransaction.create({
          data: {
            organizationId: orgId,
            loyaltyAccountId: account.id,
            type: "adjustment_debit",
            delta: -toRemove,
            lifetimeDelta: 0,
            reason: (reason ?? `Reversed auto-earn (ref ${referenceId})`).slice(0, 500),
            referenceId: reverseRef,
            createdBy: actorUserId,
          },
          select: { id: true },
        })
        return { txn }
      })
      if (!writeRes) continue // lost CAS — retry
      return { status: "reversed", removed: toRemove, transactionId: writeRes.txn.id, accountId: account.id }
    } catch (err) {
      // A P2002 = the partial unique index (org, type, referenceId) caught a
      // racing double-reverse on `reverse:<ref>` — the txn rolled back (so no
      // double-debit), treat as already-reversed (idempotent success). Mirrors
      // the earn path's P2002 handling.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return { status: "no_op", reason: "already_reversed" }
      }
      console.error("[loyalty/auto-earn] reverse write error:", err)
      return { status: "error", error: "Failed to reverse loyalty points" }
    }
  }
  return { status: "error", error: "Concurrent modification — try again", conflict: true }
}
