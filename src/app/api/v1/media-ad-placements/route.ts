/**
 * R11 Media — ad placement roster / create (slice-2-mini).
 *
 * Nineteenth route-layer consumer. Placements are nested under
 * campaigns; carry funnel telemetry (impression / click / conversion
 * counts) under strict DB CHECK ordering invariants.
 *
 * Status lifecycle (slice-1 `transitionPlacement` helper):
 *   pending → live → paused → live (resume) | completed
 *   pending/live/paused → cancelled (terminal)
 *
 * Funnel invariants (DB CHECK, NOT deferrable):
 *   • clickCount ≤ impressionCount
 *   • conversionCount ≤ clickCount
 *
 * bidAmount is Decimal(18,4) — finer precision than the budget
 * columns (CPM rates carry 4 decimals for sub-cent precision).
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  PLACEMENT_SLOT_KINDS,
  PRICING_MODELS,
} from "@/lib/media/types"

const TABLE = "media_ad_placements"
const MAX_PAGE_SIZE = 200

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseBidDecimal(
  v: unknown,
): Prisma.Decimal | null | "invalid" {
  if (v === undefined || v === null) return null
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
  // bidAmount is Decimal(18,4) — up to 4 decimal places.
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

function parseBigInt(v: unknown): bigint | null | "invalid" {
  if (v === undefined || v === null) return null
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

export const GET = withRlsAuth("media", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const campaignId = searchParams.get("campaignId")
  const contentId = searchParams.get("contentId")
  const status = searchParams.get("status")
  const slotKind = searchParams.get("slotKind")
  const pricingModel = searchParams.get("pricingModel")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    campaignId?: string
    contentId?: string
    status?: string
    slotKind?: string
    pricingModel?: string
  } = { organizationId: orgId }
  if (campaignId) where.campaignId = campaignId
  if (contentId) where.contentId = contentId
  if (status) where.status = status
  if (slotKind) where.slotKind = slotKind
  if (pricingModel) where.pricingModel = pricingModel

  try {
    const placements = await prisma.mediaAdPlacement.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
        createdAt: true,
      },
    })
    const hasMore = placements.length > limit
    const rows = hasMore ? placements.slice(0, limit) : placements
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        campaignId: campaignId ?? null,
        contentId: contentId ?? null,
        status: status ?? null,
        slotKind: slotKind ?? null,
        pricingModel: pricingModel ?? null,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({
      placements: rows.map(
        (p: {
          impressionCount: bigint
          clickCount: bigint
          conversionCount: bigint
        } & Record<string, unknown>) => ({
          ...p,
          impressionCount: p.impressionCount.toString(),
          clickCount: p.clickCount.toString(),
          conversionCount: p.conversionCount.toString(),
        }),
      ),
      hasMore,
      nextCursor,
    })
  } catch (err) {
    console.error("[media-ad-placements] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load placements" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  campaignId?: unknown
  contentId?: unknown
  slotKind?: unknown
  pricingModel?: unknown
  bidAmount?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("media", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const campaignId = trimOrNull(body.campaignId, 64)
  if (!campaignId) {
    return NextResponse.json(
      { error: "`campaignId` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.slotKind !== "string" ||
    !(PLACEMENT_SLOT_KINDS as readonly string[]).includes(body.slotKind)
  ) {
    return NextResponse.json(
      {
        error: `\`slotKind\` is required and must be one of: ${PLACEMENT_SLOT_KINDS.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const slotKind = body.slotKind

  let pricingModel: string = "cpm"
  if (body.pricingModel !== undefined && body.pricingModel !== null) {
    if (
      typeof body.pricingModel !== "string" ||
      !(PRICING_MODELS as readonly string[]).includes(body.pricingModel)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`pricingModel\` — must be one of: ${PRICING_MODELS.join(", ")}`,
        },
        { status: 400 },
      )
    }
    pricingModel = body.pricingModel
  }

  const bidAmount = parseBidDecimal(body.bidAmount ?? 0)
  if (bidAmount === "invalid") {
    return NextResponse.json(
      { error: "Invalid `bidAmount` (non-negative, ≤ 4dp)" },
      { status: 400 },
    )
  }

  const contentId = trimOrNull(body.contentId, 64)

  // Tenant pre-check on campaign + optional content.
  const [campaignCheck, contentCheck] = await Promise.all([
    prisma.mediaAdCampaign.findFirst({
      where: { id: campaignId, organizationId: orgId },
      select: { id: true },
    }),
    contentId
      ? prisma.mediaContentInventory.findFirst({
          where: { id: contentId, organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])
  if (!campaignCheck) {
    return NextResponse.json(
      { error: "Campaign not found for this tenant" },
      { status: 404 },
    )
  }
  if (contentId && !contentCheck) {
    return NextResponse.json(
      { error: "Content not found for this tenant" },
      { status: 404 },
    )
  }

  if (
    body.metadata !== undefined &&
    body.metadata !== null &&
    (typeof body.metadata !== "object" || Array.isArray(body.metadata))
  ) {
    return NextResponse.json(
      { error: "Invalid `metadata` — must be plain object" },
      { status: 400 },
    )
  }

  try {
    const placement = await prisma.mediaAdPlacement.create({
      data: {
        organizationId: orgId,
        campaignId,
        contentId,
        slotKind,
        pricingModel,
        bidAmount: bidAmount ?? new Prisma.Decimal(0),
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        campaignId: true,
        contentId: true,
        slotKind: true,
        status: true,
        pricingModel: true,
        bidAmount: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: placement.id,
      action: "write",
      metadata: {
        campaignId: placement.campaignId,
        contentId: placement.contentId,
        slotKind: placement.slotKind,
        pricingModel: placement.pricingModel,
      },
    })

    return NextResponse.json({ placement }, { status: 201 })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "Invalid foreign key (`campaignId` / `contentId`)" },
        { status: 400 },
      )
    }
    console.error("[media-ad-placements] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create placement" },
      { status: 500 },
    )
  }
})
