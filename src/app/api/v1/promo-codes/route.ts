/**
 * D8 Loyalty — PromoCode CRUD (list + create). Phase D-2.
 *
 * GET /api/v1/promo-codes  — list tenant's promo codes, ordered by
 *   createdAt DESC. Optional `?active=true` filter.
 * POST /api/v1/promo-codes — create one code.
 *
 * Permissions: `loyalty` module. Read for GET, write for POST.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRlsAuth } from "@/lib/with-rls"

const CODE_RE = /^[A-Z0-9_-]+$/ // operator-typed codes are UPPER, allow digits / underscore / hyphen
const MAX_CODE_LEN = 32
const MAX_DESC_LEN = 500
const MAX_DISCOUNT_PCT = 100
const MAX_DISCOUNT_FIXED = 1_000_000 // upper sanity bound on fixed-amount discount
const MAX_MIN_ORDER = 1_000_000_000
const MAX_USAGE_LIMIT = 1_000_000_000
const MAX_PER_CUSTOMER_LIMIT = 1_000_000

const DISCOUNT_TYPES = new Set(["percentage", "fixed"])

export const GET = withRlsAuth("loyalty", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const activeParam = searchParams.get("active")

  const where: { organizationId: string; isActive?: boolean } = {
    organizationId: orgId,
  }
  if (activeParam === "true") where.isActive = true
  if (activeParam === "false") where.isActive = false

  try {
    const codes = await prisma.promoCode.findMany({
      where,
      orderBy: { createdAt: "desc" },
    })

    // Surface per-code redemption count (cheap aggregate via groupBy)
    // so the admin can see "12/100 used" without N+1 queries.
    const codeIds = codes.map((c: { id: string }) => c.id)
    const counts =
      codeIds.length === 0
        ? []
        : await prisma.promoCodeRedemption.groupBy({
            by: ["promoCodeId"],
            where: { promoCodeId: { in: codeIds } },
            _count: { _all: true },
          })
    const countMap = new Map(
      counts.map((c: { promoCodeId: string; _count: { _all: number } }) => [
        c.promoCodeId,
        c._count._all,
      ]),
    )
    const enriched = codes.map((c: any) => ({
      ...c,
      // Decimal → number (20260525210000_d8_promo_float_to_decimal migration)
      discountValue: decimalToNumber(c.discountValue),
      minOrderAmount: c.minOrderAmount !== null ? decimalToNumber(c.minOrderAmount) : null,
      redemptionCount: countMap.get(c.id) ?? 0,
    }))

    return NextResponse.json({ codes: enriched, total: enriched.length })
  } catch (err) {
    console.error("[promo-codes] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load promo codes" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  code?: unknown
  description?: unknown
  discountType?: unknown
  discountValue?: unknown
  currency?: unknown
  minOrderAmount?: unknown
  usageLimit?: unknown
  perCustomerLimit?: unknown
  validFrom?: unknown
  validUntil?: unknown
  isActive?: unknown
}

export const POST = withRlsAuth("loyalty", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // --- code (required, UPPER ASCII slug) ---
  if (
    typeof body.code !== "string" ||
    !body.code.trim() ||
    body.code.length > MAX_CODE_LEN ||
    !CODE_RE.test(body.code)
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid `code` — must be A-Z / 0-9 / underscore / hyphen, up to 32 chars",
      },
      { status: 400 },
    )
  }

  // --- discountType (required, enum) ---
  if (typeof body.discountType !== "string" || !DISCOUNT_TYPES.has(body.discountType)) {
    return NextResponse.json(
      { error: "Invalid `discountType` — must be 'percentage' or 'fixed'" },
      { status: 400 },
    )
  }

  // --- discountValue (required, > 0, type-specific bounds) ---
  if (
    typeof body.discountValue !== "number" ||
    !Number.isFinite(body.discountValue) ||
    body.discountValue <= 0
  ) {
    return NextResponse.json(
      { error: "Invalid `discountValue` — must be > 0" },
      { status: 400 },
    )
  }
  if (body.discountType === "percentage" && body.discountValue > MAX_DISCOUNT_PCT) {
    return NextResponse.json(
      { error: "Percentage discount must be 0..100" },
      { status: 400 },
    )
  }
  if (body.discountType === "fixed" && body.discountValue > MAX_DISCOUNT_FIXED) {
    return NextResponse.json(
      { error: `Fixed discount must be <= ${MAX_DISCOUNT_FIXED}` },
      { status: 400 },
    )
  }

  // --- currency (required for fixed, NULL for percentage) ---
  let currency: string | null = null
  if (body.discountType === "fixed") {
    if (typeof body.currency !== "string" || body.currency.trim().length < 3) {
      return NextResponse.json(
        { error: "Invalid `currency` — required for fixed-amount codes (ISO 4217)" },
        { status: 400 },
      )
    }
    currency = body.currency.trim().toUpperCase().slice(0, 3)
  }

  // --- description (optional) ---
  const description =
    typeof body.description === "string"
      ? body.description.slice(0, MAX_DESC_LEN)
      : null

  // --- minOrderAmount (optional, >= 0) ---
  let minOrderAmount: number | null = null
  if (body.minOrderAmount !== undefined && body.minOrderAmount !== null) {
    if (
      typeof body.minOrderAmount !== "number" ||
      !Number.isFinite(body.minOrderAmount) ||
      body.minOrderAmount < 0 ||
      body.minOrderAmount > MAX_MIN_ORDER
    ) {
      return NextResponse.json(
        { error: "Invalid `minOrderAmount`" },
        { status: 400 },
      )
    }
    minOrderAmount = body.minOrderAmount
  }

  // --- usageLimit (optional, non-negative integer) ---
  let usageLimit: number | null = null
  if (body.usageLimit !== undefined && body.usageLimit !== null) {
    if (
      typeof body.usageLimit !== "number" ||
      !Number.isInteger(body.usageLimit) ||
      body.usageLimit < 0 ||
      body.usageLimit > MAX_USAGE_LIMIT
    ) {
      return NextResponse.json(
        { error: "Invalid `usageLimit` — non-negative integer" },
        { status: 400 },
      )
    }
    usageLimit = body.usageLimit
  }

  // --- perCustomerLimit (optional, non-negative integer) ---
  let perCustomerLimit: number | null = null
  if (body.perCustomerLimit !== undefined && body.perCustomerLimit !== null) {
    if (
      typeof body.perCustomerLimit !== "number" ||
      !Number.isInteger(body.perCustomerLimit) ||
      body.perCustomerLimit < 0 ||
      body.perCustomerLimit > MAX_PER_CUSTOMER_LIMIT
    ) {
      return NextResponse.json(
        { error: "Invalid `perCustomerLimit` — non-negative integer" },
        { status: 400 },
      )
    }
    perCustomerLimit = body.perCustomerLimit
  }

  // --- validity window (optional) ---
  let validFrom: Date | null = null
  let validUntil: Date | null = null
  if (body.validFrom !== undefined && body.validFrom !== null) {
    if (typeof body.validFrom !== "string") {
      return NextResponse.json({ error: "Invalid `validFrom`" }, { status: 400 })
    }
    const d = new Date(body.validFrom)
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid `validFrom`" }, { status: 400 })
    }
    validFrom = d
  }
  if (body.validUntil !== undefined && body.validUntil !== null) {
    if (typeof body.validUntil !== "string") {
      return NextResponse.json({ error: "Invalid `validUntil`" }, { status: 400 })
    }
    const d = new Date(body.validUntil)
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid `validUntil`" }, { status: 400 })
    }
    validUntil = d
  }
  if (validFrom && validUntil && validFrom > validUntil) {
    return NextResponse.json(
      { error: "`validFrom` must be <= `validUntil`" },
      { status: 400 },
    )
  }

  const isActive = typeof body.isActive === "boolean" ? body.isActive : true

  try {
    const created = await prisma.promoCode.create({
      data: {
        organizationId: orgId,
        code: body.code,
        description,
        discountType: body.discountType,
        discountValue: body.discountValue,
        currency,
        minOrderAmount,
        usageLimit,
        perCustomerLimit,
        validFrom,
        validUntil,
        isActive,
        createdBy: auth.userId,
      },
    })
    // Normalize Decimal → number for JSON response
    const code = {
      ...created,
      discountValue: decimalToNumber(created.discountValue),
      minOrderAmount: created.minOrderAmount !== null ? decimalToNumber(created.minOrderAmount) : null,
    }
    return NextResponse.json({ code }, { status: 201 })
  } catch (err) {
    // P2002 = Prisma unique-constraint violation. Locale/version-stable
    // check (matches project idiom in donors/storefronts/programs routes).
    // The unique constraint here is (organizationId, code) on promo_codes.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A promo code with this `code` already exists for your tenant" },
        { status: 409 },
      )
    }
    console.error("[promo-codes] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create promo code" },
      { status: 500 },
    )
  }
})
