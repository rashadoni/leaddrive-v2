/**
 * D8 Loyalty — LoyaltyTier per-id (PATCH / DELETE).
 *
 * PATCH /api/v1/loyalty-tiers/[id] — partial update. Mutable fields:
 *   name, description, minLifetimePoints, multiplier, isActive, benefits.
 *   `code` is immutable post-create (referenced by LoyaltyAccount.tier
 *   as a slug; renaming would orphan members). To rename a tier:
 *   delete + recreate after re-tagging members.
 *
 * DELETE /api/v1/loyalty-tiers/[id] — hard delete. Phase C: in the
 *   same transaction we null out `LoyaltyAccount.tier` + `tierUpgradedAt`
 *   for members on this tier so the next earn-pipeline recalc starts
 *   from a clean slate (no dangling slugs).
 */
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  MAX_TIER_MULTIPLIER as MAX_MULTIPLIER,
  MAX_NAME_LEN,
  MAX_DESC_LEN,
} from "@/lib/loyalty/limits"
import { normalizeTierRow } from "@/lib/prisma-decimal"

interface PatchBody {
  name?: unknown
  description?: unknown
  minLifetimePoints?: unknown
  multiplier?: unknown
  benefits?: unknown
  isActive?: unknown
}

export const PATCH = withRlsAuth("loyalty", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing tier id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Build data object from validated fields only.
  const data: {
    name?: string
    description?: string | null
    minLifetimePoints?: number
    multiplier?: number
    isActive?: boolean
    benefits?: unknown
  } = {}

  if (body.name !== undefined) {
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.length > MAX_NAME_LEN
    ) {
      return NextResponse.json(
        { error: "Invalid `name`" },
        { status: 400 },
      )
    }
    data.name = body.name.trim()
  }
  if (body.description !== undefined) {
    if (body.description === null) {
      data.description = null
    } else if (typeof body.description === "string") {
      data.description = body.description.slice(0, MAX_DESC_LEN)
    } else {
      return NextResponse.json(
        { error: "Invalid `description`" },
        { status: 400 },
      )
    }
  }
  if (body.minLifetimePoints !== undefined) {
    if (
      typeof body.minLifetimePoints !== "number" ||
      !Number.isInteger(body.minLifetimePoints) ||
      body.minLifetimePoints < 0
    ) {
      return NextResponse.json(
        { error: "Invalid `minLifetimePoints` — non-negative integer required" },
        { status: 400 },
      )
    }
    data.minLifetimePoints = body.minLifetimePoints
  }
  if (body.multiplier !== undefined) {
    if (
      typeof body.multiplier !== "number" ||
      !Number.isFinite(body.multiplier) ||
      body.multiplier <= 0 ||
      body.multiplier > MAX_MULTIPLIER
    ) {
      return NextResponse.json(
        { error: `Invalid \`multiplier\` — must be > 0 and ≤ ${MAX_MULTIPLIER}` },
        { status: 400 },
      )
    }
    data.multiplier = body.multiplier
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json(
        { error: "Invalid `isActive`" },
        { status: 400 },
      )
    }
    data.isActive = body.isActive
  }
  if (body.benefits !== undefined) {
    if (body.benefits !== null && typeof body.benefits !== "object") {
      return NextResponse.json(
        { error: "Invalid `benefits` — must be object or null" },
        { status: 400 },
      )
    }
    // Normalize null → {} (column is NOT NULL JSONB with default '{}'; explicit
    // null from caller = "clear the perks"). Document loud rather than leave
    // implicit: a future operator passing `null` gets an empty object, not a no-op.
    data.benefits = body.benefits ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const existing = await prisma.loyaltyTier.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Tier not found" }, { status: 404 })
    }
    const tier = await prisma.loyaltyTier.update({
      where: { id },
      data,
    })
    return NextResponse.json({ tier: normalizeTierRow(tier) })
  } catch (err) {
    console.error("[loyalty-tiers/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update tier" },
      { status: 500 },
    )
  }
})

export const DELETE = withRlsAuth("loyalty", "delete", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing tier id" }, { status: 400 })
  }

  try {
    const existing = await prisma.loyaltyTier.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, code: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Tier not found" }, { status: 404 })
    }
    // Phase C: orphan-tier cleanup. LoyaltyAccount.tier is a loose
    // slug (no FK), so deleting a LoyaltyTier row leaves accounts
    // referencing a dangling code. We null those out atomically so
    // the next earn-pipeline tier-recalc starts from a clean slate
    // (architect-flagged in Phase B review: "orphan slugs survive
    // between earns without this hook").
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const orphans = await tx.loyaltyAccount.updateMany({
        where: {
          organizationId: orgId,
          tier: existing.code,
        },
        data: {
          tier: null,
          tierUpgradedAt: null,
        },
      })
      await tx.loyaltyTier.delete({ where: { id } })
      return { orphans: orphans.count }
    })
    return NextResponse.json({
      ok: true,
      code: existing.code,
      orphansCleared: result.orphans,
    })
  } catch (err) {
    console.error("[loyalty-tiers/:id] DELETE error:", err)
    return NextResponse.json(
      { error: "Failed to delete tier" },
      { status: 500 },
    )
  }
})
