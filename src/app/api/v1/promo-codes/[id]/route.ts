/**
 * D8 Loyalty — PromoCode per-id (PATCH / DELETE). Phase D-2.
 *
 * PATCH /api/v1/promo-codes/[id] — partial update. `code` is immutable
 *   post-create (it's the slug used by storefront integrations and any
 *   marketing material in circulation; renaming would orphan in-flight
 *   redemptions). `discountType` is also immutable — switching from
 *   percentage to fixed would change the meaning of `discountValue`.
 * DELETE /api/v1/promo-codes/[id] — soft-delete by clearing isActive,
 *   actually. Hard delete is blocked by the FK from PromoCodeRedemption
 *   (onDelete: Restrict). For a true hard delete, archive the
 *   redemptions first — out of scope for slice-2.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { decimalToNumber } from "@/lib/prisma-decimal"

const MAX_DESC_LEN = 500
const MAX_DISCOUNT_PCT = 100
const MAX_DISCOUNT_FIXED = 1_000_000
const MAX_MIN_ORDER = 1_000_000_000
const MAX_USAGE_LIMIT = 1_000_000_000
const MAX_PER_CUSTOMER_LIMIT = 1_000_000

interface PatchBody {
  description?: unknown
  discountValue?: unknown
  currency?: unknown
  minOrderAmount?: unknown
  usageLimit?: unknown
  perCustomerLimit?: unknown
  validFrom?: unknown
  validUntil?: unknown
  isActive?: unknown
}

export const PATCH = withRlsAuth("loyalty", "write", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing code id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const data: {
    description?: string | null
    discountValue?: number
    currency?: string | null
    minOrderAmount?: number | null
    usageLimit?: number | null
    perCustomerLimit?: number | null
    validFrom?: Date | null
    validUntil?: Date | null
    isActive?: boolean
  } = {}

  if (body.description !== undefined) {
    if (body.description === null) {
      data.description = null
    } else if (typeof body.description === "string") {
      data.description = body.description.slice(0, MAX_DESC_LEN)
    } else {
      return NextResponse.json({ error: "Invalid `description`" }, { status: 400 })
    }
  }
  if (body.discountValue !== undefined) {
    if (
      typeof body.discountValue !== "number" ||
      !Number.isFinite(body.discountValue) ||
      body.discountValue <= 0 ||
      body.discountValue > MAX_DISCOUNT_FIXED
    ) {
      return NextResponse.json({ error: "Invalid `discountValue`" }, { status: 400 })
    }
    data.discountValue = body.discountValue
  }
  if (body.currency !== undefined) {
    if (body.currency === null) {
      data.currency = null
    } else if (typeof body.currency === "string" && body.currency.length >= 3) {
      data.currency = body.currency.trim().toUpperCase().slice(0, 3)
    } else {
      return NextResponse.json({ error: "Invalid `currency`" }, { status: 400 })
    }
  }
  if (body.minOrderAmount !== undefined) {
    if (body.minOrderAmount === null) {
      data.minOrderAmount = null
    } else if (
      typeof body.minOrderAmount === "number" &&
      Number.isFinite(body.minOrderAmount) &&
      body.minOrderAmount >= 0 &&
      body.minOrderAmount <= MAX_MIN_ORDER
    ) {
      data.minOrderAmount = body.minOrderAmount
    } else {
      return NextResponse.json({ error: "Invalid `minOrderAmount`" }, { status: 400 })
    }
  }
  if (body.usageLimit !== undefined) {
    if (body.usageLimit === null) {
      data.usageLimit = null
    } else if (
      typeof body.usageLimit === "number" &&
      Number.isInteger(body.usageLimit) &&
      body.usageLimit >= 0 &&
      body.usageLimit <= MAX_USAGE_LIMIT
    ) {
      data.usageLimit = body.usageLimit
    } else {
      return NextResponse.json({ error: "Invalid `usageLimit`" }, { status: 400 })
    }
  }
  if (body.perCustomerLimit !== undefined) {
    if (body.perCustomerLimit === null) {
      data.perCustomerLimit = null
    } else if (
      typeof body.perCustomerLimit === "number" &&
      Number.isInteger(body.perCustomerLimit) &&
      body.perCustomerLimit >= 0 &&
      body.perCustomerLimit <= MAX_PER_CUSTOMER_LIMIT
    ) {
      data.perCustomerLimit = body.perCustomerLimit
    } else {
      return NextResponse.json({ error: "Invalid `perCustomerLimit`" }, { status: 400 })
    }
  }
  if (body.validFrom !== undefined) {
    if (body.validFrom === null) {
      data.validFrom = null
    } else if (typeof body.validFrom === "string") {
      const d = new Date(body.validFrom)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid `validFrom`" }, { status: 400 })
      }
      data.validFrom = d
    } else {
      return NextResponse.json({ error: "Invalid `validFrom`" }, { status: 400 })
    }
  }
  if (body.validUntil !== undefined) {
    if (body.validUntil === null) {
      data.validUntil = null
    } else if (typeof body.validUntil === "string") {
      const d = new Date(body.validUntil)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid `validUntil`" }, { status: 400 })
      }
      data.validUntil = d
    } else {
      return NextResponse.json({ error: "Invalid `validUntil`" }, { status: 400 })
    }
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "Invalid `isActive`" }, { status: 400 })
    }
    data.isActive = body.isActive
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const existing = await prisma.promoCode.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        discountType: true,
        discountValue: true,
        currency: true,
        validFrom: true,
        validUntil: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ error: "Promo code not found" }, { status: 404 })
    }

    // Type-bound: percentage must be <= 100.
    // existing.discountValue is Decimal after migration — convert to number for comparison.
    const finalDiscountValue =
      data.discountValue !== undefined ? data.discountValue : decimalToNumber(existing.discountValue)
    if (existing.discountType === "percentage" && finalDiscountValue > MAX_DISCOUNT_PCT) {
      return NextResponse.json(
        { error: "Percentage discount must be 0..100" },
        { status: 400 },
      )
    }

    // Fixed-amount must have a currency; percentage must not.
    const finalCurrency =
      data.currency !== undefined ? data.currency : existing.currency
    if (existing.discountType === "fixed" && !finalCurrency) {
      return NextResponse.json(
        { error: "Fixed-amount codes require `currency`" },
        { status: 400 },
      )
    }
    if (existing.discountType === "percentage" && finalCurrency !== null) {
      return NextResponse.json(
        { error: "Percentage codes must not have `currency` (set null)" },
        { status: 400 },
      )
    }

    // Validity window coherence after merge.
    const finalFrom =
      data.validFrom !== undefined ? data.validFrom : existing.validFrom
    const finalUntil =
      data.validUntil !== undefined ? data.validUntil : existing.validUntil
    if (finalFrom && finalUntil && finalFrom > finalUntil) {
      return NextResponse.json(
        { error: "`validFrom` must be <= `validUntil`" },
        { status: 400 },
      )
    }

    const updated = await prisma.promoCode.update({
      where: { id },
      data,
    })
    // Normalize Decimal → number for JSON response
    const code = {
      ...updated,
      discountValue: decimalToNumber(updated.discountValue),
      minOrderAmount: updated.minOrderAmount !== null ? decimalToNumber(updated.minOrderAmount) : null,
    }
    return NextResponse.json({ code })
  } catch (err) {
    console.error("[promo-codes/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update promo code" },
      { status: 500 },
    )
  }
})

export const DELETE = withRlsAuth("loyalty", "delete", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing code id" }, { status: 400 })
  }

  try {
    const existing = await prisma.promoCode.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, code: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Promo code not found" }, { status: 404 })
    }

    // Check for existing redemptions — onDelete: Restrict means a hard
    // delete would 500. Surface a friendly error instead. Soft-delete
    // workaround: PATCH isActive:false (codes with redemptions stay
    // visible in audit but are no longer usable).
    const redemptionCount = await prisma.promoCodeRedemption.count({
      where: { promoCodeId: id },
    })
    if (redemptionCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot hard-delete a code with ${redemptionCount} redemption(s). Deactivate instead (PATCH isActive:false).`,
        },
        { status: 409 },
      )
    }

    await prisma.promoCode.delete({ where: { id } })
    return NextResponse.json({ ok: true, code: existing.code })
  } catch (err) {
    console.error("[promo-codes/:id] DELETE error:", err)
    return NextResponse.json(
      { error: "Failed to delete promo code" },
      { status: 500 },
    )
  }
})
