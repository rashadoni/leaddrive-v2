/**
 * D8 Loyalty — PromoCode redeem endpoint. Phase D-2.
 *
 * POST /api/v1/promo-codes/[id]/redeem
 *
 * Body:
 *   {
 *     orderAmount: number,       // gross order amount BEFORE discount
 *     currency: string,          // ISO 4217 (e.g. "USD")
 *     contactId?: string | null, // null = anonymous (gated by perCustomerLimit)
 *     referenceId?: string,      // app-level FK (orderId / invoiceId / cartId) for audit
 *     referenceType?: "invoice" | "order" | "cart",
 *                                // discriminator for referenceId; required
 *                                // whenever referenceId is provided. D8 slice-2
 *                                // soft #7 — needed so slice-3 reporting can
 *                                // join the opaque referenceId to the right
 *                                // table (memory/project_loyalty_slice2_design.md).
 *   }
 *
 * Pipeline:
 *   1. requireAuth(loyalty, write) — admin / API-key.
 *   2. Pre-lock cheap reject path:
 *      a. codePeek — single indexed lookup for tenant scope (404 fast)
 *         + perCustomerLimit (so gateAnonymousRedemption can decide).
 *      b. gateAnonymousRedemption(code, contactId) — pure helper, no DB.
 *      Rationale for the double-read: holding a $transaction open while
 *      we 404 / 403 on bad input is worse than one extra index lookup.
 *      The second read INSIDE the lock is the one that matters for
 *      race-safety; this peek is purely for fast error paths.
 *   3. prisma.$transaction:
 *      a. acquirePromoCodeLock(tx, id) — SELECT FOR UPDATE (Phase D primitive).
 *      b. Re-read code + redemption counts under the lock — anything
 *         that landed between codePeek and the lock is now visible.
 *      c. validatePromoApplication(code, order, counts) — pure validator.
 *      d. calculateDiscount(code, subtotal) — pure 2dp helper.
 *      e. Create PromoCodeRedemption audit row.
 *   4. Return { ok, codeId, code, discount, capped, redemptionId }.
 *
 * Race-safety: the FOR UPDATE lock at step 3a serializes concurrent
 * redemptions of the same code (architect / design-doc P0 item 3).
 * Two simultaneous attempts on a single-use code: second one waits at
 * the lock, then validatePromoApplication sees the first's
 * redemption row and rejects with "usage_limit_exceeded".
 */
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { validatePromoApplication } from "@/lib/loyalty/promo-validator"
import { calculateDiscount } from "@/lib/loyalty/discount-calculator"
import {
  acquirePromoCodeLock,
  gateAnonymousRedemption,
} from "@/lib/loyalty/redemption-helpers"
import type {
  PromoCodeRow,
  DiscountType,
  PromoRejectionReason,
} from "@/lib/loyalty/types"

const MAX_ORDER_AMOUNT = 1_000_000_000
const MAX_REFERENCE_LEN = 100

interface PostBody {
  orderAmount?: unknown
  currency?: unknown
  contactId?: unknown
  referenceId?: unknown
  referenceType?: unknown
}

// D8 soft #7 taxonomy — must match the DB CHECK constraint added in
// migration 20260529000000_add_promo_redemption_reference_type. Adding
// a new entity type requires touching this list + the migration.
const VALID_REFERENCE_TYPES = ["invoice", "order", "cart"] as const
type ReferenceType = (typeof VALID_REFERENCE_TYPES)[number]

// Type guard — narrows `unknown` to the literal union without callers
// having to re-cast (architect P2 cleanup: drop the redundant `as
// ReferenceType` on the assignment line).
function isReferenceType(v: unknown): v is ReferenceType {
  return (
    typeof v === "string" &&
    (VALID_REFERENCE_TYPES as readonly string[]).includes(v)
  )
}

// HTTP status mapping for the validator's tagged rejection reasons.
function statusForReject(reason: PromoRejectionReason): number {
  switch (reason) {
    case "inactive":
    case "not_yet_valid":
    case "expired":
    case "malformed_code":
      return 410 // Gone — code itself is the problem
    case "currency_mismatch":
    case "min_order_not_met":
      return 422 // Unprocessable — order doesn't fit
    case "usage_limit_exceeded":
    case "per_customer_limit_exceeded":
      return 429 // Too many — cap exhausted
    default:
      return 400
  }
}

export const POST = withRlsAuth("loyalty", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing code id" }, { status: 400 })
  }

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // --- orderAmount (required, > 0) ---
  if (
    typeof body.orderAmount !== "number" ||
    !Number.isFinite(body.orderAmount) ||
    body.orderAmount <= 0 ||
    body.orderAmount > MAX_ORDER_AMOUNT
  ) {
    return NextResponse.json(
      { error: "Invalid `orderAmount` — must be > 0" },
      { status: 400 },
    )
  }
  const orderAmount = body.orderAmount

  // --- currency (required) ---
  if (typeof body.currency !== "string" || body.currency.trim().length < 3) {
    return NextResponse.json(
      { error: "Invalid `currency` — ISO 4217 required" },
      { status: 400 },
    )
  }
  const currency = body.currency.trim().toUpperCase().slice(0, 3)

  // --- contactId (optional — null/empty = anonymous) ---
  const contactId =
    typeof body.contactId === "string" && body.contactId.trim()
      ? body.contactId.trim()
      : null

  // --- referenceId (optional, capped) ---
  const referenceId =
    typeof body.referenceId === "string" && body.referenceId.trim()
      ? body.referenceId.trim().slice(0, MAX_REFERENCE_LEN)
      : null

  // --- referenceType (optional; required iff referenceId is set) ---
  // D8 slice-2 soft #7. The DB CHECK is permissive (NULL allowed for
  // legacy + truly anonymous rows), but the route refuses an opaque
  // referenceId without a discriminator so slice-3 reporting joins stay
  // sound. An "id without type" is ambiguous; "type without id" is
  // also rejected (typo / API misuse).
  let referenceType: ReferenceType | null = null
  if (body.referenceType !== undefined && body.referenceType !== null) {
    if (!isReferenceType(body.referenceType)) {
      return NextResponse.json(
        {
          error: "Invalid `referenceType` — must be one of: invoice | order | cart",
        },
        { status: 400 },
      )
    }
    referenceType = body.referenceType
  }
  if (referenceId !== null && referenceType === null) {
    return NextResponse.json(
      {
        error: "`referenceType` is required when `referenceId` is provided",
      },
      { status: 400 },
    )
  }
  if (referenceId === null && referenceType !== null) {
    return NextResponse.json(
      {
        error: "`referenceType` requires `referenceId`",
      },
      { status: 400 },
    )
  }

  // --- Tenant scope + fraud gate (pre-lock, cheap reject path) -----
  const codePeek = await prisma.promoCode.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      perCustomerLimit: true,
      usageLimit: true,
    },
  })
  if (!codePeek) {
    return NextResponse.json({ error: "Promo code not found" }, { status: 404 })
  }

  // Anonymous-fraud gate (Phase D primitive — design-doc P0 item 4).
  // Refuses anonymous redemption when the code has a per-customer cap.
  const gate = gateAnonymousRedemption(codePeek, contactId)
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.message, reason: gate.reason },
      { status: 403 },
    )
  }

  // --- Optional FK check on contact (cross-tenant guard) ----------
  if (contactId !== null) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, organizationId: orgId },
      select: { id: true },
    })
    if (!contact) {
      return NextResponse.json(
        { error: "Contact not found in this tenant" },
        { status: 404 },
      )
    }
  }

  // --- Race-safe redemption inside $transaction ------------------
  try {
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. Lock the row (Phase D primitive — design-doc P0 item 3).
        //    Concurrent redemption attempts on the same code queue here.
        await acquirePromoCodeLock(tx, id)

        // 2. Re-read code + counts UNDER the lock — anything that
        //    landed since codePeek above will now be visible.
        const code = await tx.promoCode.findFirst({
          where: { id, organizationId: orgId },
        })
        if (!code) {
          return {
            kind: "not_found" as const,
          }
        }

        // Coerce DB row → validator's typed row.
        // discountValue + minOrderAmount are Decimal after the
        // 20260525210000_d8_promo_float_to_decimal migration — convert
        // to plain number so the pure helpers receive the expected type.
        const codeRow: PromoCodeRow = {
          id: code.id,
          code: code.code,
          discountType: code.discountType as DiscountType,
          discountValue: decimalToNumber(code.discountValue),
          currency: code.currency,
          minOrderAmount: code.minOrderAmount !== null ? decimalToNumber(code.minOrderAmount) : null,
          usageLimit: code.usageLimit,
          perCustomerLimit: code.perCustomerLimit,
          validFrom: code.validFrom,
          validUntil: code.validUntil,
          isActive: code.isActive,
        }

        // 3. Aggregate counts inside the same snapshot.
        const totalCount = await tx.promoCodeRedemption.count({
          where: { promoCodeId: id },
        })
        const byContactCount =
          contactId === null
            ? 0
            : await tx.promoCodeRedemption.count({
                where: { promoCodeId: id, contactId },
              })

        // 4. Validate.
        const validation = validatePromoApplication({
          code: codeRow,
          order: { subtotal: orderAmount, currency, contactId },
          counts: { total: totalCount, byContact: byContactCount },
        })
        if (!validation.ok) {
          return {
            kind: "rejected" as const,
            reason: validation.reason,
            message: validation.message,
          }
        }

        // 5. Compute discount.
        const discount = calculateDiscount({
          code: codeRow,
          subtotal: orderAmount,
        })
        if (discount.amount <= 0) {
          // Shouldn't happen post-validator, but defensive: don't write
          // a $0 audit row.
          return {
            kind: "rejected" as const,
            reason: "malformed_code" as const,
            message: "Computed discount is zero or negative",
          }
        }

        // 6. Audit row.
        const redemption = await tx.promoCodeRedemption.create({
          data: {
            organizationId: orgId,
            promoCodeId: id,
            contactId,
            referenceId,
            referenceType,
            discountApplied: discount.amount,
            currency,
          },
          select: { id: true, redeemedAt: true },
        })

        return {
          kind: "ok" as const,
          discount,
          redemption,
          codeText: code.code,
        }
      },
    )

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "Promo code not found" }, { status: 404 })
    }
    if (result.kind === "rejected") {
      return NextResponse.json(
        { error: result.message, reason: result.reason },
        { status: statusForReject(result.reason) },
      )
    }
    return NextResponse.json({
      ok: true,
      codeId: id,
      code: result.codeText,
      discount: result.discount.amount,
      capped: result.discount.capped,
      currency,
      redemptionId: result.redemption.id,
      redeemedAt: result.redemption.redeemedAt,
      contactId,
      referenceId,
      referenceType,
    })
  } catch (err) {
    console.error("[promo-codes/:id/redeem] write error:", err)
    return NextResponse.json(
      { error: "Failed to redeem promo code" },
      { status: 500 },
    )
  }
})
