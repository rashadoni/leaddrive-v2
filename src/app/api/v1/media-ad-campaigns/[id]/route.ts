/**
 * R11 Media — ad campaign per-id (slice-2-mini).
 *
 * GET — single read + 404 audit.
 * PATCH — three-way handling + transitionCampaign slice-1 helper.
 *   Auto-stamps startedAt / pausedAt / completedAt / cancelledAt;
 *   cancellation requires `cancellationReason`.
 *   spentAmount mutable (slice-2 service may bump as ad-server reports
 *   in); pre-validates spent ≤ totalBudget per DB CHECK
 *   `spent_bound_check`.
 *
 * Immutable on PATCH:
 *   • campaignNumber — institutional id
 *   • advertiserCompanyId — re-parenting forges spend attribution
 *
 * DELETE NOT exposed — campaigns are financial records.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionCampaign } from "@/lib/media/state-machine"
import {
  CAMPAIGN_GOALS,
  type CampaignStatus,
} from "@/lib/media/types"

const TABLE = "media_ad_campaigns"
const MAX_NAME_LEN = 200

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseDecimal(
  v: unknown,
  allowNegative = false,
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
): string[] | "invalid" | undefined {
  if (v === undefined) return undefined
  if (v === null) return []
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

export const GET = withRlsAuth("media", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing campaign id" }, { status: 400 })
  }

  try {
    const campaign = await prisma.mediaAdCampaign.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!campaign) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: campaign.id,
      action: "read",
      metadata: {
        campaignNumber: campaign.campaignNumber,
        status: campaign.status,
        campaignGoal: campaign.campaignGoal,
        advertiserCompanyId: campaign.advertiserCompanyId,
      },
    })

    return NextResponse.json({ campaign })
  } catch (err) {
    console.error("[media-ad-campaigns/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load campaign" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  name?: unknown
  campaignGoal?: unknown
  totalBudget?: unknown
  dailyBudgetCap?: unknown
  spentAmount?: unknown
  currency?: unknown
  flightStartAt?: unknown
  flightEndAt?: unknown
  targetingCriteria?: unknown
  creativeAssetRefs?: unknown
  status?: unknown
  cancellationReason?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("media", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing campaign id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.mediaAdCampaign.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      totalBudget: true,
      spentAmount: true,
      flightStartAt: true,
      flightEndAt: true,
      startedAt: true,
      pausedAt: true,
      completedAt: true,
      cancelledAt: true,
      cancellationReason: true,
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
      { error: "Campaign not found" },
      { status: 404 },
    )
  }

  const data: {
    name?: string
    campaignGoal?: string
    totalBudget?: Prisma.Decimal
    dailyBudgetCap?: Prisma.Decimal | null
    spentAmount?: Prisma.Decimal
    currency?: string
    flightStartAt?: Date | null
    flightEndAt?: Date | null
    targetingCriteria?: Prisma.InputJsonValue
    creativeAssetRefs?: string[]
    status?: string
    cancellationReason?: string | null
    startedAt?: Date
    pausedAt?: Date
    completedAt?: Date
    cancelledAt?: Date
    metadata?: unknown
  } = {}

  if (body.name !== undefined) {
    const v = strField(body.name, MAX_NAME_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`name` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.name = v
  }
  if (body.campaignGoal !== undefined) {
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
    data.campaignGoal = body.campaignGoal
  }
  if (body.currency !== undefined) {
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
    data.currency = upper
  }

  // Decimal money fields.
  let nextTotalBudget = existing.totalBudget
  let nextSpentAmount = existing.spentAmount
  if (body.totalBudget !== undefined) {
    const v = parseDecimal(body.totalBudget)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `totalBudget` (non-negative, ≤ 2dp)" },
        { status: 400 },
      )
    }
    if (v === null) {
      return NextResponse.json(
        { error: "`totalBudget` cannot be cleared" },
        { status: 400 },
      )
    }
    if (v !== undefined) {
      data.totalBudget = v
      nextTotalBudget = v
    }
  }
  if (body.dailyBudgetCap !== undefined) {
    const v = parseDecimal(body.dailyBudgetCap)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `dailyBudgetCap` (non-negative, ≤ 2dp)" },
        { status: 400 },
      )
    }
    if (v !== undefined) data.dailyBudgetCap = v
  }
  if (body.spentAmount !== undefined) {
    const v = parseDecimal(body.spentAmount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `spentAmount` (non-negative, ≤ 2dp)" },
        { status: 400 },
      )
    }
    if (v === null) {
      return NextResponse.json(
        { error: "`spentAmount` cannot be cleared" },
        { status: 400 },
      )
    }
    if (v !== undefined) {
      data.spentAmount = v
      nextSpentAmount = v
    }
  }
  // Pre-validate DB CHECK `spent_bound_check`: spentAmount ≤ totalBudget.
  if (nextSpentAmount.greaterThan(nextTotalBudget)) {
    return NextResponse.json(
      { error: "`spentAmount` cannot exceed `totalBudget`" },
      { status: 400 },
    )
  }

  // Flight window — three-way handling.
  let nextFlightStart: Date | null = existing.flightStartAt
  let nextFlightEnd: Date | null = existing.flightEndAt
  if (body.flightStartAt !== undefined) {
    if (body.flightStartAt === null) {
      data.flightStartAt = null
      nextFlightStart = null
    } else if (typeof body.flightStartAt === "string") {
      const d = new Date(body.flightStartAt)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `flightStartAt`" },
          { status: 400 },
        )
      }
      data.flightStartAt = d
      nextFlightStart = d
    } else {
      return NextResponse.json(
        { error: "Invalid `flightStartAt`" },
        { status: 400 },
      )
    }
  }
  if (body.flightEndAt !== undefined) {
    if (body.flightEndAt === null) {
      data.flightEndAt = null
      nextFlightEnd = null
    } else if (typeof body.flightEndAt === "string") {
      const d = new Date(body.flightEndAt)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `flightEndAt`" },
          { status: 400 },
        )
      }
      data.flightEndAt = d
      nextFlightEnd = d
    } else {
      return NextResponse.json(
        { error: "Invalid `flightEndAt`" },
        { status: 400 },
      )
    }
  }
  if (
    nextFlightStart &&
    nextFlightEnd &&
    nextFlightEnd.getTime() <= nextFlightStart.getTime()
  ) {
    return NextResponse.json(
      { error: "`flightEndAt` must be after `flightStartAt`" },
      { status: 400 },
    )
  }

  if (body.targetingCriteria !== undefined) {
    if (
      body.targetingCriteria !== null &&
      (typeof body.targetingCriteria !== "object" ||
        Array.isArray(body.targetingCriteria))
    ) {
      return NextResponse.json(
        {
          error: "Invalid `targetingCriteria` — must be plain object or null",
        },
        { status: 400 },
      )
    }
    data.targetingCriteria = (body.targetingCriteria ??
      {}) as Prisma.InputJsonValue
  }

  if (body.creativeAssetRefs !== undefined) {
    const arr = parseStringArray(body.creativeAssetRefs, 64, 200)
    if (arr === "invalid") {
      return NextResponse.json(
        {
          error:
            "`creativeAssetRefs` must be an array of strings (max 64 items, max 200 chars each)",
        },
        { status: 400 },
      )
    }
    if (arr !== undefined) data.creativeAssetRefs = arr
  }

  // Status transition + stamping + cancellation reason.
  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionCampaign(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }

    if (body.status === "cancelled") {
      const reason =
        strField(body.cancellationReason, 1000) ?? existing.cancellationReason
      if (!reason) {
        return NextResponse.json(
          {
            error:
              "`cancellationReason` (non-empty string) is required when transitioning to `cancelled`",
          },
          { status: 400 },
        )
      }
      const supplied = strField(body.cancellationReason, 1000)
      if (supplied) data.cancellationReason = supplied
    }

    data.status = body.status
    const now = new Date()
    const target = body.status as CampaignStatus

    // running/paused/completed all require startedAt — backfill on
    // any forward transition (e.g. straight scheduled→running stamps
    // startedAt; running→completed needs startedAt already set from
    // earlier; paused→completed similarly).
    if (
      (target === "running" ||
        target === "paused" ||
        target === "completed") &&
      !existing.startedAt
    ) {
      data.startedAt = now
    }
    if (target === "paused" && !existing.pausedAt) data.pausedAt = now
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
    const campaign = await prisma.mediaAdCampaign.update({
      where: { id },
      data,
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
        pausedAt: true,
        completedAt: true,
        cancelledAt: true,
        cancellationReason: true,
        updatedAt: true,
      },
    })

    const AUTO_STAMP_KEYS = new Set([
      "startedAt",
      "pausedAt",
      "completedAt",
      "cancelledAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter((k) => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter((k) =>
      AUTO_STAMP_KEYS.has(k),
    )

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: campaign.id,
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

    return NextResponse.json({ campaign })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A campaign with this identifier already exists" },
        { status: 409 },
      )
    }
    console.error("[media-ad-campaigns/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update campaign" },
      { status: 500 },
    )
  }
})
