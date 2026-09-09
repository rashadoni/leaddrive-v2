/**
 * D8 Loyalty — LoyaltyReward update + delete.
 *
 * PATCH  /api/v1/loyalty-rewards/[id] — partial update (name/description/
 *        pointsCost/stockLimit/isActive). Tenant-scoped.
 * DELETE /api/v1/loyalty-rewards/[id] — remove a reward (its redemption rows
 *        cascade-delete via the FK).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const MAX_NAME = 100
const MAX_DESC = 500
const MAX_POINTS = 100_000_000

interface PatchBody {
  name?: unknown
  description?: unknown
  pointsCost?: unknown
  stockLimit?: unknown
  isActive?: unknown
}

export const PATCH = withRlsAuth(
  "loyalty",
  "write",
  async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    let body: PatchBody
    try {
      body = (await req.json()) as PatchBody
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const data: {
      name?: string
      description?: string | null
      pointsCost?: number
      stockLimit?: number | null
      isActive?: boolean
    } = {}

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.length > MAX_NAME) {
        return NextResponse.json({ error: "Invalid `name`" }, { status: 400 })
      }
      data.name = body.name.trim()
    }
    if (body.description !== undefined) {
      if (body.description !== null && (typeof body.description !== "string" || body.description.length > MAX_DESC)) {
        return NextResponse.json({ error: "Invalid `description`" }, { status: 400 })
      }
      data.description = body.description === null ? null : (body.description as string).trim() || null
    }
    if (body.pointsCost !== undefined) {
      if (
        typeof body.pointsCost !== "number" ||
        !Number.isInteger(body.pointsCost) ||
        body.pointsCost <= 0 ||
        body.pointsCost > MAX_POINTS
      ) {
        return NextResponse.json({ error: "Invalid `pointsCost` — positive integer" }, { status: 400 })
      }
      data.pointsCost = body.pointsCost
    }
    if (body.stockLimit !== undefined) {
      if (body.stockLimit !== null && (typeof body.stockLimit !== "number" || !Number.isInteger(body.stockLimit) || body.stockLimit < 0)) {
        return NextResponse.json({ error: "Invalid `stockLimit`" }, { status: 400 })
      }
      data.stockLimit = body.stockLimit as number | null
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        return NextResponse.json({ error: "Invalid `isActive`" }, { status: 400 })
      }
      data.isActive = body.isActive
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 })
    }

    try {
      const res = await prisma.loyaltyReward.updateMany({
        where: { id, organizationId: auth.orgId },
        data,
      })
      if (res.count === 0) return NextResponse.json({ error: "Reward not found" }, { status: 404 })
      const reward = await prisma.loyaltyReward.findFirst({ where: { id, organizationId: auth.orgId } })
      return NextResponse.json({ reward })
    } catch (err) {
      console.error("[loyalty-rewards] PATCH error:", err)
      return NextResponse.json({ error: "Failed to update reward" }, { status: 500 })
    }
  },
)

export const DELETE = withRlsAuth(
  "loyalty",
  "delete",
  async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    try {
      const res = await prisma.loyaltyReward.deleteMany({
        where: { id, organizationId: auth.orgId },
      })
      if (res.count === 0) return NextResponse.json({ error: "Reward not found" }, { status: 404 })
      return NextResponse.json({ success: true })
    } catch (err) {
      console.error("[loyalty-rewards] DELETE error:", err)
      return NextResponse.json({ error: "Failed to delete reward" }, { status: 500 })
    }
  },
)
