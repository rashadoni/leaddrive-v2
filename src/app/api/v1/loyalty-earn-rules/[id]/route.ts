/**
 * D8 Loyalty — LoyaltyEarnRule per-id (PATCH / DELETE).
 *
 * PATCH /api/v1/loyalty-earn-rules/[id] — partial update. All
 *   fields except `trigger` are mutable (trigger is the primary
 *   taxonomy bucket; changing it would invalidate any operator
 *   dashboards filtered on it — recreate as a new rule instead).
 *
 * DELETE /api/v1/loyalty-earn-rules/[id] — hard delete. Live
 *   transactions already credited via this rule keep their points
 *   (LoyaltyTransaction has no FK back to the rule, by design).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  MAX_NAME_LEN,
  MAX_CATEGORY_LEN,
  MAX_POINTS_RATE as MAX_RATE,
  MAX_POINTS_FLAT as MAX_FLAT,
  MAX_MIN_ORDER_AMOUNT as MAX_MIN_ORDER,
} from "@/lib/loyalty/limits"
import { normalizeEarnRuleRow } from "@/lib/prisma-decimal"

interface PatchBody {
  name?: unknown
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

export const PATCH = withRlsAuth("loyalty", "write", async (req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing rule id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const data: {
    name?: string
    pointsRate?: number | null
    pointsFlat?: number | null
    minOrderAmount?: number | null
    productCategory?: string | null
    priority?: number
    applyTierMultiplier?: boolean
    isActive?: boolean
    validFrom?: Date | null
    validUntil?: Date | null
    metadata?: unknown
  } = {}

  if (body.name !== undefined) {
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.length > MAX_NAME_LEN
    ) {
      return NextResponse.json({ error: "Invalid `name`" }, { status: 400 })
    }
    data.name = body.name.trim()
  }
  if (body.pointsRate !== undefined) {
    if (body.pointsRate === null) {
      data.pointsRate = null
    } else if (
      typeof body.pointsRate === "number" &&
      Number.isFinite(body.pointsRate) &&
      body.pointsRate >= 0 &&
      body.pointsRate <= MAX_RATE
    ) {
      data.pointsRate = body.pointsRate
    } else {
      return NextResponse.json(
        { error: `Invalid \`pointsRate\` — must be >= 0 and ≤ ${MAX_RATE}` },
        { status: 400 },
      )
    }
  }
  if (body.pointsFlat !== undefined) {
    if (body.pointsFlat === null) {
      data.pointsFlat = null
    } else if (
      typeof body.pointsFlat === "number" &&
      Number.isInteger(body.pointsFlat) &&
      body.pointsFlat >= 0 &&
      body.pointsFlat <= MAX_FLAT
    ) {
      data.pointsFlat = body.pointsFlat
    } else {
      return NextResponse.json(
        { error: `Invalid \`pointsFlat\` — non-negative integer ≤ ${MAX_FLAT}` },
        { status: 400 },
      )
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
      return NextResponse.json(
        { error: "Invalid `minOrderAmount`" },
        { status: 400 },
      )
    }
  }
  if (body.productCategory !== undefined) {
    if (body.productCategory === null) {
      data.productCategory = null
    } else if (
      typeof body.productCategory === "string" &&
      body.productCategory.length <= MAX_CATEGORY_LEN
    ) {
      data.productCategory = body.productCategory.trim() || null
    } else {
      return NextResponse.json(
        { error: "Invalid `productCategory`" },
        { status: 400 },
      )
    }
  }
  if (body.priority !== undefined) {
    if (typeof body.priority !== "number" || !Number.isInteger(body.priority)) {
      return NextResponse.json({ error: "Invalid `priority`" }, { status: 400 })
    }
    data.priority = body.priority
  }
  if (body.applyTierMultiplier !== undefined) {
    if (typeof body.applyTierMultiplier !== "boolean") {
      return NextResponse.json(
        { error: "Invalid `applyTierMultiplier`" },
        { status: 400 },
      )
    }
    data.applyTierMultiplier = body.applyTierMultiplier
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "Invalid `isActive`" }, { status: 400 })
    }
    data.isActive = body.isActive
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
  if (body.metadata !== undefined) {
    if (body.metadata !== null && (typeof body.metadata !== "object" || Array.isArray(body.metadata))) {
      return NextResponse.json(
        { error: "Invalid `metadata` — must be plain object or null" },
        { status: 400 },
      )
    }
    // Normalize null → {} (column is NOT NULL JSONB with default '{}'; explicit
    // null from caller = "clear the metadata"). Document the squash explicitly
    // — passing `null` lands as `{}` server-side, not a no-op.
    data.metadata = body.metadata ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const existing = await prisma.loyaltyEarnRule.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        validFrom: true,
        validUntil: true,
        pointsRate: true,
        pointsFlat: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ error: "Earn rule not found" }, { status: 404 })
    }

    // Validity coherence: cross-check the resolved window after merge.
    const finalFrom = data.validFrom !== undefined ? data.validFrom : existing.validFrom
    const finalUntil = data.validUntil !== undefined ? data.validUntil : existing.validUntil
    if (finalFrom && finalUntil && finalFrom > finalUntil) {
      return NextResponse.json(
        { error: "`validFrom` must be ≤ `validUntil`" },
        { status: 400 },
      )
    }

    // Award coherence: mirror DB CHECK `loyalty_earn_rules_award_present_check`.
    // PATCH allows independently nulling pointsRate or pointsFlat; if the
    // merged row would have BOTH null we'd violate the constraint and get
    // a generic 500. Reject up front with a clear 400.
    const finalRate = data.pointsRate !== undefined ? data.pointsRate : existing.pointsRate
    const finalFlat = data.pointsFlat !== undefined ? data.pointsFlat : existing.pointsFlat
    if (finalRate === null && finalFlat === null) {
      return NextResponse.json(
        { error: "At least one of `pointsRate` / `pointsFlat` is required" },
        { status: 400 },
      )
    }

    const rule = await prisma.loyaltyEarnRule.update({
      where: { id },
      data,
    })
    return NextResponse.json({ rule: normalizeEarnRuleRow(rule) })
  } catch (err) {
    console.error("[loyalty-earn-rules/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update earn rule" },
      { status: 500 },
    )
  }
})

export const DELETE = withRlsAuth("loyalty", "delete", async (_req: NextRequest, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing rule id" }, { status: 400 })
  }

  try {
    const existing = await prisma.loyaltyEarnRule.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Earn rule not found" }, { status: 404 })
    }
    await prisma.loyaltyEarnRule.delete({ where: { id } })
    return NextResponse.json({ ok: true, name: existing.name })
  } catch (err) {
    console.error("[loyalty-earn-rules/:id] DELETE error:", err)
    return NextResponse.json(
      { error: "Failed to delete earn rule" },
      { status: 500 },
    )
  }
})
