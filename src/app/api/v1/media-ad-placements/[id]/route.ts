/**
 * R11 Media — ad placement per-id (slice-2-mini).
 *
 * GET — single read + 404 audit.
 * PATCH — three-way handling + transitionPlacement slice-1 helper.
 *   Auto-stamps startedAt / completedAt / cancelledAt.
 *
 *   Funnel-count updates pre-validate DB CHECK invariants:
 *     • clickCount ≤ impressionCount (clicks_bound_check)
 *     • conversionCount ≤ clickCount (conversions_bound_check)
 *   Counts can only go up — slice-2 telemetry contract is monotonic
 *   ingestion; route returns 400 if caller tries to decrement.
 *
 *   placementSpentAmount mutable; never below 0 (DB CHECK).
 *
 * Immutable on PATCH:
 *   • campaignId — re-parenting forges spend attribution
 *   • slotKind   — affects ad-server placement matching
 *   • pricingModel — changes revenue calculation method mid-flight
 *
 * DELETE NOT exposed — placements are financial+telemetry rows.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionPlacement } from "@/lib/media/state-machine"
import { type PlacementStatus } from "@/lib/media/types"
import { withRlsAuth } from "@/lib/with-rls"

const TABLE = "media_ad_placements"

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseBidDecimal(
  v: unknown,
): Prisma.Decimal | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
  let raw: string
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "invalid"
    raw = String(v)
  } else if (typeof v === "string") {
    raw = v.trim()
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return "invalid"
  } else {
    return "invalid"
  }
  const dot = raw.indexOf(".")
  if (dot !== -1 && raw.length - dot - 1 > 4) return "invalid"
  try {
    const d = new Prisma.Decimal(raw)
    if (d.isNegative()) return "invalid"
    return d
  } catch {
    return "invalid"
  }
}

function parseSpentDecimal(
  v: unknown,
): Prisma.Decimal | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
  let raw: string
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "invalid"
    raw = String(v)
  } else if (typeof v === "string") {
    raw = v.trim()
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return "invalid"
  } else {
    return "invalid"
  }
  const dot = raw.indexOf(".")
  if (dot !== -1 && raw.length - dot - 1 > 2) return "invalid"
  try {
    const d = new Prisma.Decimal(raw)
    if (d.isNegative()) return "invalid"
    return d
  } catch {
    return "invalid"
  }
}

function parseBigInt(v: unknown): bigint | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v === "number") {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) return "invalid"
    return BigInt(v)
  }
  if (typeof v === "string") {
    if (!/^\d+$/.test(v.trim())) return "invalid"
    try {
      return BigInt(v.trim())
    } catch {
      return "invalid"
    }
  }
  return "invalid"
}

export const GET = withRlsAuth("media", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing placement id" },
      { status: 400 },
    )
  }

  try {
    const placement = await prisma.mediaAdPlacement.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!placement) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Placement not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: placement.id,
      action: "read",
      metadata: {
        campaignId: placement.campaignId,
        contentId: placement.contentId,
        slotKind: placement.slotKind,
        status: placement.status,
      },
    })

    return NextResponse.json({
      placement: {
        ...placement,
        impressionCount: placement.impressionCount.toString(),
        clickCount: placement.clickCount.toString(),
        conversionCount: placement.conversionCount.toString(),
      },
    })
  } catch (err) {
    console.error("[media-ad-placements/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load placement" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  bidAmount?: unknown
  impressionCount?: unknown
  clickCount?: unknown
  conversionCount?: unknown
  placementSpentAmount?: unknown
  status?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("media", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing placement id" },
      { status: 400 },
    )
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.mediaAdPlacement.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      impressionCount: true,
      clickCount: true,
      conversionCount: true,
      placementSpentAmount: true,
      startedAt: true,
      completedAt: true,
      cancelledAt: true,
    },
  })
  if (!existing) {
    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json(
      { error: "Placement not found" },
      { status: 404 },
    )
  }

  const data: {
    bidAmount?: Prisma.Decimal
    impressionCount?: bigint
    clickCount?: bigint
    conversionCount?: bigint
    placementSpentAmount?: Prisma.Decimal
    status?: string
    startedAt?: Date
    completedAt?: Date
    cancelledAt?: Date
    metadata?: unknown
  } = {}

  if (body.bidAmount !== undefined) {
    const v = parseBidDecimal(body.bidAmount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `bidAmount` (non-negative, ≤ 4dp)" },
        { status: 400 },
      )
    }
    if (v === null) {
      return NextResponse.json(
        { error: "`bidAmount` cannot be cleared" },
        { status: 400 },
      )
    }
    if (v !== undefined) data.bidAmount = v
  }

  // Funnel counts — monotonic ingestion contract.
  let nextImpressionCount = existing.impressionCount
  let nextClickCount = existing.clickCount
  let nextConversionCount = existing.conversionCount

  if (body.impressionCount !== undefined) {
    const v = parseBigInt(body.impressionCount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `impressionCount` (non-negative integer)" },
        { status: 400 },
      )
    }
    if (v === null) {
      return NextResponse.json(
        { error: "`impressionCount` cannot be cleared" },
        { status: 400 },
      )
    }
    if (v !== undefined) {
      if (v < existing.impressionCount) {
        return NextResponse.json(
          {
            error:
              "`impressionCount` is monotonic — cannot decrease below current value",
          },
          { status: 400 },
        )
      }
      data.impressionCount = v
      nextImpressionCount = v
    }
  }
  if (body.clickCount !== undefined) {
    const v = parseBigInt(body.clickCount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `clickCount` (non-negative integer)" },
        { status: 400 },
      )
    }
    if (v === null) {
      return NextResponse.json(
        { error: "`clickCount` cannot be cleared" },
        { status: 400 },
      )
    }
    if (v !== undefined) {
      if (v < existing.clickCount) {
        return NextResponse.json(
          {
            error:
              "`clickCount` is monotonic — cannot decrease below current value",
          },
          { status: 400 },
        )
      }
      data.clickCount = v
      nextClickCount = v
    }
  }
  if (body.conversionCount !== undefined) {
    const v = parseBigInt(body.conversionCount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `conversionCount` (non-negative integer)" },
        { status: 400 },
      )
    }
    if (v === null) {
      return NextResponse.json(
        { error: "`conversionCount` cannot be cleared" },
        { status: 400 },
      )
    }
    if (v !== undefined) {
      if (v < existing.conversionCount) {
        return NextResponse.json(
          {
            error:
              "`conversionCount` is monotonic — cannot decrease below current value",
          },
          { status: 400 },
        )
      }
      data.conversionCount = v
      nextConversionCount = v
    }
  }

  // Funnel invariants: clicks ≤ impressions, conversions ≤ clicks.
  if (nextClickCount > nextImpressionCount) {
    return NextResponse.json(
      { error: "`clickCount` cannot exceed `impressionCount`" },
      { status: 400 },
    )
  }
  if (nextConversionCount > nextClickCount) {
    return NextResponse.json(
      { error: "`conversionCount` cannot exceed `clickCount`" },
      { status: 400 },
    )
  }

  if (body.placementSpentAmount !== undefined) {
    const v = parseSpentDecimal(body.placementSpentAmount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `placementSpentAmount` (non-negative, ≤ 2dp)" },
        { status: 400 },
      )
    }
    if (v === null) {
      return NextResponse.json(
        { error: "`placementSpentAmount` cannot be cleared" },
        { status: 400 },
      )
    }
    if (v !== undefined) {
      if (v.lessThan(existing.placementSpentAmount)) {
        return NextResponse.json(
          {
            error:
              "`placementSpentAmount` is monotonic — cannot decrease below current value",
          },
          { status: 400 },
        )
      }
      data.placementSpentAmount = v
    }
  }

  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionPlacement(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }

    data.status = body.status
    const now = new Date()
    const target = body.status as PlacementStatus

    // live/paused/completed all require startedAt (live_coherence).
    if (
      (target === "live" ||
        target === "paused" ||
        target === "completed") &&
      !existing.startedAt
    ) {
      data.startedAt = now
    }
    if (target === "completed" && !existing.completedAt) {
      data.completedAt = now
    }
    if (target === "cancelled" && !existing.cancelledAt) {
      data.cancelledAt = now
    }
  }

  if (body.metadata !== undefined) {
    if (
      body.metadata !== null &&
      (typeof body.metadata !== "object" || Array.isArray(body.metadata))
    ) {
      return NextResponse.json(
        { error: "Invalid `metadata` — must be plain object or null" },
        { status: 400 },
      )
    }
    data.metadata = body.metadata ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const placement = await prisma.mediaAdPlacement.update({
      where: { id },
      data,
      select: {
        id: true,
        campaignId: true,
        contentId: true,
        slotKind: true,
        status: true,
        pricingModel: true,
        bidAmount: true,
        impressionCount: true,
        clickCount: true,
        conversionCount: true,
        placementSpentAmount: true,
        startedAt: true,
        completedAt: true,
        cancelledAt: true,
        updatedAt: true,
      },
    })

    const AUTO_STAMP_KEYS = new Set([
      "startedAt",
      "completedAt",
      "cancelledAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter((k) => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter((k) => AUTO_STAMP_KEYS.has(k))

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: placement.id,
      action: "write",
      metadata: {
        bodyFields,
        autoStampedFields:
          autoStampedFields.length > 0 ? autoStampedFields : undefined,
        statusChange:
          body.status !== undefined
            ? `${existing.status}→${body.status}`
            : undefined,
      },
    })

    return NextResponse.json({
      placement: {
        ...placement,
        impressionCount: placement.impressionCount.toString(),
        clickCount: placement.clickCount.toString(),
        conversionCount: placement.conversionCount.toString(),
      },
    })
  } catch (err) {
    console.error("[media-ad-placements/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update placement" },
      { status: 500 },
    )
  }
})
