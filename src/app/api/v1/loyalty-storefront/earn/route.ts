/**
 * D8 Loyalty — storefront earn endpoint (Phase D).
 *
 * POST /api/v1/loyalty-storefront/earn
 *
 * Body:
 *   {
 *     contactId: string,         // member to credit (required)
 *     trigger: EarnRuleTrigger,  // purchase|signup|referral|birthday|review|survey|custom
 *     orderAmount?: number,      // required for pointsRate rules; 0 for flat-only
 *     currency?: string,         // for audit; defaults to org primary / DEFAULT_CURRENCY
 *     productCategory?: string,  // optional category filter
 *     referenceId?: string,      // app-level FK (orderId / invoiceId) — makes the earn idempotent
 *     reason?: string,           // audit-row reason
 *   }
 *
 * This route is the EXPLICIT earn entry (admin / API-key integration), so it
 * does NOT gate on `settings.loyaltyAutoEarn` — that switch only governs the
 * automatic CRM-event hooks. All the rule-eval / tier-recalc / CAS / audit
 * logic lives in the shared `applyAutoEarn` helper (src/lib/loyalty/auto-earn.ts),
 * which the automatic hooks (invoice-paid, deal-won, …) also call. Admin manual
 * earn lives at /api/v1/loyalty-accounts/[id]/earn (applies points AS-GIVEN).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { applyAutoEarn } from "@/lib/loyalty/auto-earn"
import {
  isValidEarnRuleTrigger,
  EARN_RULE_TRIGGERS,
  type EarnRuleTrigger,
} from "@/lib/loyalty/limits"

interface PostBody {
  contactId?: unknown
  trigger?: unknown
  orderAmount?: unknown
  currency?: unknown
  productCategory?: unknown
  referenceId?: unknown
  reason?: unknown
}

const MAX_ORDER_AMOUNT = 1_000_000_000 // matches MAX_MIN_ORDER_AMOUNT bound

export const POST = withRlsAuth("loyalty", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId
  const actorUserId = auth.userId

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // --- contactId (required) ---------------------------------------
  if (typeof body.contactId !== "string" || !body.contactId.trim()) {
    return NextResponse.json(
      { error: "Invalid `contactId` — required for storefront earn" },
      { status: 400 },
    )
  }
  const contactId = body.contactId.trim()

  // --- trigger (required) -----------------------------------------
  if (typeof body.trigger !== "string" || !isValidEarnRuleTrigger(body.trigger)) {
    return NextResponse.json(
      { error: `Invalid \`trigger\` — must be one of ${EARN_RULE_TRIGGERS.join(", ")}` },
      { status: 400 },
    )
  }
  const trigger: EarnRuleTrigger = body.trigger

  // --- orderAmount (optional, default 0) --------------------------
  let orderAmount = 0
  if (body.orderAmount !== undefined && body.orderAmount !== null) {
    if (
      typeof body.orderAmount !== "number" ||
      !Number.isFinite(body.orderAmount) ||
      body.orderAmount < 0 ||
      body.orderAmount > MAX_ORDER_AMOUNT
    ) {
      return NextResponse.json(
        { error: "Invalid `orderAmount` — must be 0..1e9" },
        { status: 400 },
      )
    }
    orderAmount = body.orderAmount
  }

  // --- optional fields (currency resolution is the helper's job) ---
  const currency =
    typeof body.currency === "string" && body.currency.trim() ? body.currency.trim() : undefined
  const productCategory =
    typeof body.productCategory === "string" && body.productCategory.trim()
      ? body.productCategory.trim()
      : null
  const referenceId =
    typeof body.referenceId === "string" && body.referenceId.trim()
      ? body.referenceId.trim()
      : null
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null

  const result = await applyAutoEarn(prisma, {
    orgId,
    contactId,
    trigger,
    orderAmount,
    currency,
    productCategory,
    referenceId,
    reason,
    actorUserId,
    // explicit storefront call → not gated by the auto-earn master switch
  })

  switch (result.status) {
    case "earned":
      return NextResponse.json({
        ok: true,
        accountId: result.accountId,
        earned: result.earned,
        base: result.base,
        appliedMultiplier: result.appliedMultiplier,
        source: result.source,
        rule: result.rule,
        tier: result.tier,
        previousTier: result.previousTier,
        tierChanged: result.tierChanged,
        transactionId: result.transactionId,
      })
    case "no_op":
      if (result.reason === "contact_not_found") {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 })
      }
      return NextResponse.json({
        ok: true,
        accountId: result.accountId,
        earned: 0,
        rule: null,
        reason: result.reason,
        ...(result.transactionId ? { transactionId: result.transactionId } : {}),
      })
    case "error":
      return NextResponse.json(
        { error: result.error },
        { status: result.conflict ? 409 : 500 },
      )
  }
})
