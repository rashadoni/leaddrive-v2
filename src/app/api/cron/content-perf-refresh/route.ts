import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { computeContentScore } from "@/lib/content-perf/score-compute"
import type { ContentEntityType } from "@/lib/content-perf/types"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * M10 Content Performance AI — slice-2 refresh cron.
 *
 * Walks every active org and computes a ContentScore for each
 * Campaign / CampaignVariant / EmailTemplate. Mirrors the T9 refresh
 * cron's auth + pagination + batched-transaction shape exactly.
 *
 *   - Campaign + CampaignVariant: DIRECTLY read the `total*` aggregation
 *     columns (Campaign.totalSent / totalOpened / totalClicked /
 *     totalBounced / totalUnsubscribed / totalSpam). No EmailLog
 *     scan needed.
 *
 *   - EmailTemplate: aggregate EmailLog rows via `groupBy({by:
 *     templateId, _count, _max: createdAt})` per page of templates.
 *     EmailLog has no "unsubscribed"/"spam" status (those come at the
 *     campaign level only), so those penalties are always 0 for
 *     templates. Acceptable — templates that ride bad campaigns get
 *     surfaced via the Campaign row directly.
 *
 * Auth: x-cron-secret / Bearer against CRON_SECRET. Mirrors
 * `engagement-decay/route.ts`.
 *
 * Cadence: external scheduler. Recommended daily. Idempotent — upsert
 * keyed on `(orgId, entityType, entityId)`.
 */

const BATCH_SIZE = 500

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const startedAt = Date.now()
  const summary = {
    organizationsScanned: 0,
    campaignsScored: 0,
    variantsScored: 0,
    templatesScored: 0,
    skipped: 0,
    errors: [] as string[],
  }

  try {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    for (const org of orgs) {
      summary.organizationsScanned++

      // ── Campaigns ──────────────────────────────────────────────
      await processCampaigns(org.id, summary)

      // ── CampaignVariants ───────────────────────────────────────
      await processVariants(org.id, summary)

      // ── EmailTemplates ─────────────────────────────────────────
      await processTemplates(org.id, summary)
    }

    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startedAt,
      summary: { ...summary, errors: summary.errors.slice(0, 10) },
    })
  } catch (e) {
    console.error("[content-perf-refresh] cron error:", e)
    return NextResponse.json(
      { error: "Internal server error", message: (e as Error).message },
      { status: 500 },
    )
  }
  })
}

type Summary = {
  organizationsScanned: number
  campaignsScored: number
  variantsScored: number
  templatesScored: number
  skipped: number
  errors: string[]
}

async function processCampaigns(orgId: string, summary: Summary) {
  const now = new Date()
  let cursorId: string | undefined = undefined
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const campaigns: {
      id: string
      sentAt: Date | null
      totalSent: number
      totalOpened: number
      totalClicked: number
      totalBounced: number
      totalUnsubscribed: number
      totalSpam: number
    }[] = await prisma.campaign.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        sentAt: true,
        totalSent: true,
        totalOpened: true,
        totalClicked: true,
        totalBounced: true,
        totalUnsubscribed: true,
        totalSpam: true,
      },
      take: BATCH_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    })
    if (campaigns.length === 0) break

    const upserts = campaigns.map((c) => {
      const result = computeContentScore({
        totalSent: c.totalSent,
        totalOpened: c.totalOpened,
        totalClicked: c.totalClicked,
        totalBounced: c.totalBounced,
        totalUnsubscribed: c.totalUnsubscribed,
        totalSpam: c.totalSpam,
        lastSentAt: c.sentAt,
        now,
      })
      const entityType: ContentEntityType = "campaign"
      return prisma.contentScore.upsert({
        where: {
          organizationId_entityType_entityId: {
            organizationId: orgId,
            entityType,
            entityId: c.id,
          },
        },
        create: {
          organizationId: orgId,
          entityType,
          entityId: c.id,
          score: result.score,
          factors: result.factors,
          lastComputedAt: now,
        },
        update: {
          score: result.score,
          factors: result.factors,
          lastComputedAt: now,
        },
      })
    })
    try {
      await prisma.$transaction(upserts)
      summary.campaignsScored += campaigns.length
    } catch (e) {
      summary.skipped += campaigns.length
      summary.errors.push(`campaign batch org:${orgId} cursor:${cursorId ?? "<head>"} — ${(e as Error).message ?? "unknown"}`)
    }

    if (campaigns.length < BATCH_SIZE) break
    cursorId = campaigns[campaigns.length - 1].id
  }
}

async function processVariants(orgId: string, summary: Summary) {
  const now = new Date()
  let cursorId: string | undefined = undefined
  // CampaignVariant FK to Campaign already in place; we read total*
  // columns directly off the variant row.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const variants: {
      id: string
      totalSent: number
      totalOpened: number
      totalClicked: number
      totalBounced: number
      campaign: { sentAt: Date | null; totalUnsubscribed: number; totalSpam: number } | null
    }[] = await prisma.campaignVariant.findMany({
      where: { campaign: { organizationId: orgId } },
      select: {
        id: true,
        totalSent: true,
        totalOpened: true,
        totalClicked: true,
        totalBounced: true,
        campaign: { select: { sentAt: true, totalUnsubscribed: true, totalSpam: true } },
      },
      take: BATCH_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    })
    if (variants.length === 0) break

    const upserts = variants.map((v) => {
      // CampaignVariant carries its OWN totalBounced (schema:1795) —
      // critical for A/B testing where two variants on the same list
      // could surface materially different deliverability (image-heavy
      // vs text-only HTML, e.g.). Unsubscribe/spam are NOT split per
      // variant — those are campaign-level recipient bookkeeping —
      // inherit from parent campaign for the variant's deliverability
      // ceiling.
      const result = computeContentScore({
        totalSent: v.totalSent,
        totalOpened: v.totalOpened,
        totalClicked: v.totalClicked,
        totalBounced: v.totalBounced,
        totalUnsubscribed: v.campaign?.totalUnsubscribed ?? 0,
        totalSpam: v.campaign?.totalSpam ?? 0,
        lastSentAt: v.campaign?.sentAt ?? null,
        now,
      })
      const entityType: ContentEntityType = "campaign_variant"
      return prisma.contentScore.upsert({
        where: {
          organizationId_entityType_entityId: {
            organizationId: orgId,
            entityType,
            entityId: v.id,
          },
        },
        create: {
          organizationId: orgId,
          entityType,
          entityId: v.id,
          score: result.score,
          factors: result.factors,
          lastComputedAt: now,
        },
        update: {
          score: result.score,
          factors: result.factors,
          lastComputedAt: now,
        },
      })
    })
    try {
      await prisma.$transaction(upserts)
      summary.variantsScored += variants.length
    } catch (e) {
      summary.skipped += variants.length
      summary.errors.push(`variant batch org:${orgId} cursor:${cursorId ?? "<head>"} — ${(e as Error).message ?? "unknown"}`)
    }

    if (variants.length < BATCH_SIZE) break
    cursorId = variants[variants.length - 1].id
  }
}

async function processTemplates(orgId: string, summary: Summary) {
  const now = new Date()
  let cursorId: string | undefined = undefined
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const templates: { id: string }[] = await prisma.emailTemplate.findMany({
      where: { organizationId: orgId },
      select: { id: true },
      take: BATCH_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    })
    if (templates.length === 0) break

    // Aggregate EmailLog per template — four parallel groupBy queries.
    //
    // ⚠️ PERF TODO (slice-3 prerequisite): `EmailLog.templateId` is NOT
    // indexed (schema model EmailLog only carries `organizationId`,
    // `(org,status)`, `(org,contactId)`, `variantId` indices). For orgs
    // with >100k email_logs rows, these 4 groupBy queries become seq
    // scans. Before this cron runs in production for a heavy tenant,
    // add a composite `@@index([organizationId, templateId])` on
    // EmailLog in a one-line migration. The route layer doesn't need
    // changes — Prisma picks up the index automatically.
    const templateIds = templates.map((t) => t.id)
    const logAggregates = await prisma.emailLog.groupBy({
      by: ["templateId"],
      where: {
        organizationId: orgId,
        templateId: { in: templateIds },
      },
      _count: { _all: true },
      _max: { createdAt: true },
    })

    // Separate counts for openedAt / clickedAt / bounced. groupBy can't
    // mix counts with NOT NULL filters, so we run 3 small parallel queries.
    const [openCounts, clickCounts, bounceCounts] = await Promise.all([
      prisma.emailLog.groupBy({
        by: ["templateId"],
        where: { organizationId: orgId, templateId: { in: templateIds }, openedAt: { not: null } },
        _count: { _all: true },
      }),
      prisma.emailLog.groupBy({
        by: ["templateId"],
        where: { organizationId: orgId, templateId: { in: templateIds }, clickedAt: { not: null } },
        _count: { _all: true },
      }),
      prisma.emailLog.groupBy({
        by: ["templateId"],
        where: { organizationId: orgId, templateId: { in: templateIds }, status: "bounced" },
        _count: { _all: true },
      }),
    ])

    const sentMap = new Map<string, { count: number; lastSent: Date | null }>()
    for (const r of logAggregates) {
      if (r.templateId) sentMap.set(r.templateId, { count: r._count._all, lastSent: r._max.createdAt })
    }
    const openMap = new Map<string, number>()
    for (const r of openCounts) if (r.templateId) openMap.set(r.templateId, r._count._all)
    const clickMap = new Map<string, number>()
    for (const r of clickCounts) if (r.templateId) clickMap.set(r.templateId, r._count._all)
    const bounceMap = new Map<string, number>()
    for (const r of bounceCounts) if (r.templateId) bounceMap.set(r.templateId, r._count._all)

    const upserts = templates.map((t) => {
      const sent = sentMap.get(t.id) ?? { count: 0, lastSent: null }
      const result = computeContentScore({
        totalSent: sent.count,
        totalOpened: openMap.get(t.id) ?? 0,
        totalClicked: clickMap.get(t.id) ?? 0,
        totalBounced: bounceMap.get(t.id) ?? 0,
        // EmailLog doesn't carry per-row unsubscribe/spam (those are
        // campaign-level recipient bookkeeping). Templates that ride
        // bad campaigns get surfaced via the campaign row directly.
        totalUnsubscribed: 0,
        totalSpam: 0,
        lastSentAt: sent.lastSent,
        now,
      })
      const entityType: ContentEntityType = "email_template"
      return prisma.contentScore.upsert({
        where: {
          organizationId_entityType_entityId: {
            organizationId: orgId,
            entityType,
            entityId: t.id,
          },
        },
        create: {
          organizationId: orgId,
          entityType,
          entityId: t.id,
          score: result.score,
          factors: result.factors,
          lastComputedAt: now,
        },
        update: {
          score: result.score,
          factors: result.factors,
          lastComputedAt: now,
        },
      })
    })
    try {
      await prisma.$transaction(upserts)
      summary.templatesScored += templates.length
    } catch (e) {
      summary.skipped += templates.length
      summary.errors.push(`template batch org:${orgId} cursor:${cursorId ?? "<head>"} — ${(e as Error).message ?? "unknown"}`)
    }

    if (templates.length < BATCH_SIZE) break
    cursorId = templates[templates.length - 1].id
  }
}
