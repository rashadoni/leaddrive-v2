/**
 * R11 Media — ad campaign roster / create (slice-2-mini).
 *
 * Eighteenth route-layer consumer. Ad campaigns drive monetization
 * spend; PII-adjacent (advertiser → CRM company link). Audit via
 * `recordPiiAccessFromRequest` for consistency with subscribers /
 * content-inventory.
 *
 * Status lifecycle (slice-1 `transitionCampaign` helper):
 *   draft → scheduled → running → completed
 *   running ⇄ paused
 *   any → cancelled (terminal; requires cancellationReason)
 *
 * Decimal-money discipline on totalBudget / dailyBudgetCap /
 * spentAmount. DB CHECK `spent_bound_check` enforces
 * spentAmount ≤ totalBudget — route pre-validates so callers get a
 * 400 instead of a check-violation 500.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { CAMPAIGN_GOALS } from "@/lib/media/types"

const TABLE = "media_ad_campaigns"
const MAX_PAGE_SIZE = 200
const MAX_NAME_LEN = 200

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseDate(v: unknown): Date | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") return "invalid"
  const d = new Date(v)
  if (isNaN(d.getTime())) return "invalid"
  return d
}

function parseDecimal(
  v: unknown,
  allowNegative = false,
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
  const dot = raw.indexOf(".")
  if (dot !== -1 && raw.length - dot - 1 > 2) return "invalid"
  try {
    const d = new Prisma.Decimal(raw)
    if (!allowNegative && d.isNegative()) return "invalid"
    return d
  } catch {
    return "invalid"
  }
}

function parseStringArray(
  v: unknown,
  maxItems: number,
  maxItemLen: number,
): string[] | "invalid" {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) return "invalid"
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== "string") return "invalid"
    const t = item.trim()
    if (!t) continue
    if (t.length > maxItemLen) return "invalid"
    out.push(t)
    if (out.length > maxItems) return "invalid"
  }
  return out
}

export const GET = withRlsAuth("media", "read", async (req: NextRequest, auth, ctx) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const campaignGoal = searchParams.get("campaignGoal")
  const advertiserCompanyId = searchParams.get("advertiserCompanyId")
  const campaignNumberSearch = searchParams.get("campaignNumberSearch")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    campaignGoal?: string
    advertiserCompanyId?: string
    campaignNumber?: { contains: string; mode: "insensitive" }
  } = { organizationId: orgId }
  if (status) where.status = status
  if (campaignGoal) where.campaignGoal = campaignGoal
  if (advertiserCompanyId) where.advertiserCompanyId = advertiserCompanyId
  if (campaignNumberSearch && campaignNumberSearch.length >= 2) {
    where.campaignNumber = {
      contains: campaignNumberSearch,
      mode: "insensitive",
    }
  }

  try {
    const campaigns = await prisma.mediaAdCampaign.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        campaignNumber: true,
        advertiserCompanyId: true,
        name: true,
        status: true,
        campaignGoal: true,
        totalBudget: true,
        dailyBudgetCap: true,
        spentAmount: true,
        currency: true,
        flightStartAt: true,
        flightEndAt: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    })
    const hasMore = campaigns.length > limit
    const rows = hasMore ? campaigns.slice(0, limit) : campaigns
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        campaignGoal: campaignGoal ?? null,
        advertiserCompanyId: advertiserCompanyId ?? null,
        searchHit:
          campaignNumberSearch !== null && campaignNumberSearch.length >= 2,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ campaigns: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[media-ad-campaigns] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load campaigns" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  campaignNumber?: unknown
  advertiserCompanyId?: unknown
  name?: unknown
  campaignGoal?: unknown
  totalBudget?: unknown
  dailyBudgetCap?: unknown
  currency?: unknown
  flightStartAt?: unknown
  flightEndAt?: unknown
  targetingCriteria?: unknown
  creativeAssetRefs?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("media", "write", async (req: NextRequest, auth, ctx) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const campaignNumber = trimOrNull(body.campaignNumber, 64)
  if (!campaignNumber) {
    return NextResponse.json(
      { error: "`campaignNumber` is required" },
      { status: 400 },
    )
  }
  const name = trimOrNull(body.name, MAX_NAME_LEN)
  if (!name) {
    return NextResponse.json(
      { error: "`name` is required" },
      { status: 400 },
    )
  }

  let campaignGoal: string = "reach"
  if (body.campaignGoal !== undefined && body.campaignGoal !== null) {
    if (
      typeof body.campaignGoal !== "string" ||
      !(CAMPAIGN_GOALS as readonly string[]).includes(body.campaignGoal)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`campaignGoal\` — must be one of: ${CAMPAIGN_GOALS.join(", ")}`,
        },
        { status: 400 },
      )
    }
    campaignGoal = body.campaignGoal
  }

  const totalBudget = parseDecimal(body.totalBudget ?? 0)
  if (totalBudget === "invalid") {
    return NextResponse.json(
      { error: "Invalid `totalBudget` (non-negative, ≤ 2dp)" },
      { status: 400 },
    )
  }
  const dailyBudgetCap = parseDecimal(body.dailyBudgetCap)
  if (dailyBudgetCap === "invalid") {
    return NextResponse.json(
      { error: "Invalid `dailyBudgetCap` (non-negative, ≤ 2dp)" },
      { status: 400 },
    )
  }

  let currency: string = "USD"
  if (body.currency !== undefined && body.currency !== null) {
    if (typeof body.currency !== "string") {
      return NextResponse.json(
        { error: "`currency` must be a 3-letter ISO 4217 code" },
        { status: 400 },
      )
    }
    const upper = body.currency.toUpperCase()
    if (!/^[A-Z]{3}$/.test(upper)) {
      return NextResponse.json(
        { error: "`currency` must be a 3-letter ISO 4217 code" },
        { status: 400 },
      )
    }
    currency = upper
  }

  const flightStartAt = parseDate(body.flightStartAt)
  if (flightStartAt === "invalid") {
    return NextResponse.json(
      { error: "Invalid `flightStartAt`" },
      { status: 400 },
    )
  }
  const flightEndAt = parseDate(body.flightEndAt)
  if (flightEndAt === "invalid") {
    return NextResponse.json(
      { error: "Invalid `flightEndAt`" },
      { status: 400 },
    )
  }
  if (
    flightStartAt &&
    flightEndAt &&
    flightEndAt.getTime() <= flightStartAt.getTime()
  ) {
    return NextResponse.json(
      { error: "`flightEndAt` must be after `flightStartAt`" },
      { status: 400 },
    )
  }

  const creativeAssetRefs = parseStringArray(body.creativeAssetRefs, 64, 200)
  if (creativeAssetRefs === "invalid") {
    return NextResponse.json(
      {
        error:
          "`creativeAssetRefs` must be an array of strings (max 64 items, max 200 chars each)",
      },
      { status: 400 },
    )
  }

  if (
    body.targetingCriteria !== undefined &&
    body.targetingCriteria !== null &&
    (typeof body.targetingCriteria !== "object" ||
      Array.isArray(body.targetingCriteria))
  ) {
    return NextResponse.json(
      { error: "Invalid `targetingCriteria` — must be plain object" },
      { status: 400 },
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

  const advertiserCompanyId = trimOrNull(body.advertiserCompanyId, 64)
  if (advertiserCompanyId) {
    const company = await prisma.company.findFirst({
      where: { id: advertiserCompanyId, organizationId: orgId },
      select: { id: true },
    })
    if (!company) {
      return NextResponse.json(
        { error: "Advertiser company not found for this tenant" },
        { status: 404 },
      )
    }
  }

  try {
    const campaign = await prisma.mediaAdCampaign.create({
      data: {
        organizationId: orgId,
        campaignNumber,
        advertiserCompanyId,
        name,
        campaignGoal,
        totalBudget: totalBudget ?? new Prisma.Decimal(0),
        dailyBudgetCap,
        currency,
        flightStartAt,
        flightEndAt,
        targetingCriteria: (body.targetingCriteria ??
          {}) as Prisma.InputJsonValue,
        creativeAssetRefs,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        campaignNumber: true,
        advertiserCompanyId: true,
        name: true,
        status: true,
        campaignGoal: true,
        totalBudget: true,
        currency: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: campaign.id,
      action: "write",
      metadata: {
        campaignNumber: campaign.campaignNumber,
        advertiserCompanyId: campaign.advertiserCompanyId,
        campaignGoal: campaign.campaignGoal,
      },
    })

    return NextResponse.json({ campaign }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return NextResponse.json(
          {
            error:
              "A campaign with this `campaignNumber` already exists",
          },
          { status: 409 },
        )
      }
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`advertiserCompanyId`)" },
          { status: 400 },
        )
      }
    }
    console.error("[media-ad-campaigns] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create campaign" },
      { status: 500 },
    )
  }
})
