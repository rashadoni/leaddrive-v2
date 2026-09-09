/**
 * D8 Loyalty — LoyaltyReward CRUD (list + create). The tenant-defined redeem
 * catalog: a member spends `pointsCost` redeemable points to claim a reward.
 *
 * GET  /api/v1/loyalty-rewards — list (optional ?active=true|false), cheapest first.
 * POST /api/v1/loyalty-rewards — create one reward.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const MAX_NAME = 100
const MAX_DESC = 500
const MAX_POINTS = 100_000_000

export const GET = withRlsAuth("loyalty", "read", async (req, auth) => {
  const { searchParams } = new URL(req.url)
  const activeParam = searchParams.get("active")
  const where: { organizationId: string; isActive?: boolean } = { organizationId: auth.orgId }
  if (activeParam === "true") where.isActive = true
  if (activeParam === "false") where.isActive = false
  try {
    const rewards = await prisma.loyaltyReward.findMany({
      where,
      orderBy: [{ pointsCost: "asc" }, { createdAt: "asc" }],
    })
    return NextResponse.json({ rewards, total: rewards.length })
  } catch (err) {
    console.error("[loyalty-rewards] GET error:", err)
    return NextResponse.json({ error: "Failed to load rewards" }, { status: 500 })
  }
})

interface CreateBody {
  name?: unknown
  description?: unknown
  pointsCost?: unknown
  stockLimit?: unknown
  isActive?: unknown
}

export const POST = withRlsAuth("loyalty", "write", async (req, auth) => {
  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > MAX_NAME) {
    return NextResponse.json({ error: "Invalid `name` — required, up to 100 chars" }, { status: 400 })
  }
  if (
    typeof body.pointsCost !== "number" ||
    !Number.isInteger(body.pointsCost) ||
    body.pointsCost <= 0 ||
    body.pointsCost > MAX_POINTS
  ) {
    return NextResponse.json({ error: "Invalid `pointsCost` — positive integer" }, { status: 400 })
  }

  let description: string | null = null
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== "string" || body.description.length > MAX_DESC) {
      return NextResponse.json({ error: "Invalid `description`" }, { status: 400 })
    }
    description = body.description.trim() || null
  }

  let stockLimit: number | null = null
  if (body.stockLimit !== undefined && body.stockLimit !== null) {
    if (typeof body.stockLimit !== "number" || !Number.isInteger(body.stockLimit) || body.stockLimit < 0) {
      return NextResponse.json({ error: "Invalid `stockLimit` — non-negative integer or null" }, { status: 400 })
    }
    stockLimit = body.stockLimit
  }

  const isActive = typeof body.isActive === "boolean" ? body.isActive : true

  try {
    const reward = await prisma.loyaltyReward.create({
      data: {
        organizationId: auth.orgId,
        name: body.name.trim(),
        description,
        pointsCost: body.pointsCost,
        stockLimit,
        isActive,
        createdBy: auth.userId,
      },
    })
    return NextResponse.json({ reward }, { status: 201 })
  } catch (err) {
    console.error("[loyalty-rewards] POST error:", err)
    return NextResponse.json({ error: "Failed to create reward" }, { status: 500 })
  }
})
