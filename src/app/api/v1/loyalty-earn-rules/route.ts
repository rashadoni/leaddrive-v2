/**
 * D8 Loyalty — LoyaltyEarnRule CRUD (list + create).
 *
 * GET /api/v1/loyalty-earn-rules — list tenant's rules. Optional
 *   filters: ?trigger=purchase, ?active=true.
 *   Ordered by (priority DESC, createdAt ASC) — same order the
 *   slice-2-full earn pipeline uses when picking the winning rule
 *   for a triggered event.
 * POST /api/v1/loyalty-earn-rules — create one rule.
 *
 * Earn-rule semantics (mirrors DB CHECKs):
 *   - At least one of pointsRate / pointsFlat must be present.
 *   - Validity window: validFrom <= validUntil if both set.
 *   - trigger ∈ {purchase, signup, referral, birthday, review,
 *     survey, custom}.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  EARN_RULE_TRIGGERS,
  isValidEarnRuleTrigger,
  MAX_NAME_LEN,
  MAX_CATEGORY_LEN,
  MAX_POINTS_RATE as MAX_RATE,
  MAX_POINTS_FLAT as MAX_FLAT,
  MAX_MIN_ORDER_AMOUNT as MAX_MIN_ORDER,
} from "@/lib/loyalty/limits"
import { normalizeEarnRuleRow } from "@/lib/prisma-decimal"

// Used for human-readable error messages — the underlying validator is
// `isValidEarnRuleTrigger` which type-narrows.
const TRIGGERS_LABEL = EARN_RULE_TRIGGERS.join(", ")

export const GET = withRlsAuth("loyalty", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const trigger = searchParams.get("trigger")
  const activeParam = searchParams.get("active")

  const where: { organizationId: string; trigger?: string; isActive?: boolean } = {
    organizationId: orgId,
  }
  if (trigger) {
    if (!isValidEarnRuleTrigger(trigger)) {
      return NextResponse.json(
        { error: `Invalid \`trigger\` — must be one of ${TRIGGERS_LABEL}` },
        { status: 400 },
      )
    }
    where.trigger = trigger
  }
  if (activeParam === "true") where.isActive = true
  if (activeParam === "false") where.isActive = false

  try {
    const rows = await prisma.loyaltyEarnRule.findMany({
      where,
      // Same order the earn pipeline applies (higher priority wins;
      // ties broken by createdAt ASC — older rule wins).
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    })
    // Normalize Decimal columns → number so API clients receive JSON numbers.
    // Prisma.Decimal.toJSON() returns a string ("1.25"), not a number.
    const rules = rows.map((r: (typeof rows)[number]) => normalizeEarnRuleRow(r))
    return NextResponse.json({ rules, total: rules.length })
  } catch (err) {
    console.error("[loyalty-earn-rules] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load earn rules" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  name?: unknown
  trigger?: unknown
  pointsRate?: unknown
  pointsFlat?: unknown
  minOrderAmount?: unknown
  productCategory?: unknown
  priority?: unknown
  applyTierMultiplier?: unknown
  isActive?: unknown
  validFrom?: unknown
  validUntil?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("loyalty", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // --- name + trigger (required) ----------------------------------
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > MAX_NAME_LEN
  ) {
    return NextResponse.json(
      { error: "Invalid `name` — required, up to 100 chars" },
      { status: 400 },
    )
  }
  if (typeof body.trigger !== "string" || !isValidEarnRuleTrigger(body.trigger)) {
    return NextResponse.json(
      { error: `Invalid \`trigger\` — must be one of ${TRIGGERS_LABEL}` },
      { status: 400 },
    )
  }

  // --- award (pointsRate XOR/OR pointsFlat) -----------------------
  let pointsRate: number | null = null
  let pointsFlat: number | null = null
  if (body.pointsRate !== undefined && body.pointsRate !== null) {
    if (
      typeof body.pointsRate !== "number" ||
      !Number.isFinite(body.pointsRate) ||
      body.pointsRate < 0 ||
      body.pointsRate > MAX_RATE
    ) {
      return NextResponse.json(
        { error: `Invalid \`pointsRate\` — must be >= 0 and ≤ ${MAX_RATE}` },
        { status: 400 },
      )
    }
    pointsRate = body.pointsRate
  }
  if (body.pointsFlat !== undefined && body.pointsFlat !== null) {
    if (
      typeof body.pointsFlat !== "number" ||
      !Number.isInteger(body.pointsFlat) ||
      body.pointsFlat < 0 ||
      body.pointsFlat > MAX_FLAT
    ) {
      return NextResponse.json(
        { error: `Invalid \`pointsFlat\` — non-negative integer ≤ ${MAX_FLAT}` },
        { status: 400 },
      )
    }
    pointsFlat = body.pointsFlat
  }
  if (pointsRate === null && pointsFlat === null) {
    return NextResponse.json(
      { error: "At least one of `pointsRate` / `pointsFlat` is required" },
      { status: 400 },
    )
  }

  // --- minOrderAmount (optional) ----------------------------------
  let minOrderAmount: number | null = null
  if (body.minOrderAmount !== undefined && body.minOrderAmount !== null) {
    if (
      typeof body.minOrderAmount !== "number" ||
      !Number.isFinite(body.minOrderAmount) ||
      body.minOrderAmount < 0 ||
      body.minOrderAmount > MAX_MIN_ORDER
    ) {
      return NextResponse.json(
        { error: `Invalid \`minOrderAmount\` — must be >= 0 and ≤ ${MAX_MIN_ORDER}` },
        { status: 400 },
      )
    }
    minOrderAmount = body.minOrderAmount
  }

  // --- productCategory (optional) ---------------------------------
  let productCategory: string | null = null
  if (body.productCategory !== undefined && body.productCategory !== null) {
    if (
      typeof body.productCategory !== "string" ||
      body.productCategory.length > MAX_CATEGORY_LEN
    ) {
      return NextResponse.json(
        { error: "Invalid `productCategory`" },
        { status: 400 },
      )
    }
    productCategory = body.productCategory.trim() || null
  }

  // --- priority / flags -------------------------------------------
  const priority =
    typeof body.priority === "number" && Number.isInteger(body.priority)
      ? body.priority
      : 0
  const applyTierMultiplier =
    typeof body.applyTierMultiplier === "boolean" ? body.applyTierMultiplier : true
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true

  // --- validity window --------------------------------------------
  let validFrom: Date | null = null
  let validUntil: Date | null = null
  if (body.validFrom !== undefined && body.validFrom !== null) {
    if (typeof body.validFrom !== "string") {
      return NextResponse.json({ error: "Invalid `validFrom`" }, { status: 400 })
    }
    const d = new Date(body.validFrom)
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid `validFrom` — bad date" }, { status: 400 })
    }
    validFrom = d
  }
  if (body.validUntil !== undefined && body.validUntil !== null) {
    if (typeof body.validUntil !== "string") {
      return NextResponse.json({ error: "Invalid `validUntil`" }, { status: 400 })
    }
    const d = new Date(body.validUntil)
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid `validUntil` — bad date" }, { status: 400 })
    }
    validUntil = d
  }
  if (validFrom && validUntil && validFrom > validUntil) {
    return NextResponse.json(
      { error: "`validFrom` must be ≤ `validUntil`" },
      { status: 400 },
    )
  }

  // --- metadata (optional) ----------------------------------------
  let metadata: Record<string, unknown> = {}
  if (body.metadata !== undefined && body.metadata !== null) {
    if (typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      return NextResponse.json(
        { error: "Invalid `metadata` — must be plain object" },
        { status: 400 },
      )
    }
    metadata = body.metadata as Record<string, unknown>
  }

  try {
    const rule = await prisma.loyaltyEarnRule.create({
      data: {
        organizationId: orgId,
        name: body.name.trim(),
        trigger: body.trigger,
        pointsRate,
        pointsFlat,
        minOrderAmount,
        productCategory,
        priority,
        applyTierMultiplier,
        isActive,
        validFrom,
        validUntil,
        metadata,
        createdBy: auth.userId,
      },
    })
    return NextResponse.json({ rule: normalizeEarnRuleRow(rule) }, { status: 201 })
  } catch (err) {
    console.error("[loyalty-earn-rules] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create earn rule" },
      { status: 500 },
    )
  }
})
