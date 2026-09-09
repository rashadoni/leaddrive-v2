/**
 * G2 Identity Resolution — slice-2 API.
 *
 * GET /api/v1/identity-merge-queue
 *
 * Lists `profile_merge_candidates` with status='pending', joined to
 * both UnifiedProfile sides for side-by-side rendering. Sort by score
 * DESC (highest-confidence matches surface first).
 *
 * Read-only — slice-2-full adds the approve/reject mutation routes.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { DEFAULT_MERGE_THRESHOLDS } from "@/lib/identity-resolution/types"

interface ProfileSide {
  id: string
  displayName: string | null
  displayEmail: string | null
  displayPhone: string | null
  emailNormalized: string | null
  phoneNormalized: string | null
  nameNormalized: string | null
  totalSpent: number
  lifetimeOrderCount: number
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  channelsActive: string[]
}

interface CandidateRow {
  id: string
  primaryProfileId: string
  secondaryProfileId: string
  score: number
  matchBreakdown: unknown
  reason: string | null
  status: string
  createdAt: Date
  primaryProfile: ProfileSide | null
  secondaryProfile: ProfileSide | null
}

const FETCH_CAP = 200

// Thresholds come from slice-1 single source of truth so the UI badge
// and the resolver classification can't drift. Architect caught this:
// hardcoded 0.9 mis-labeled scores 0.90–0.94 as auto-tier when the
// resolver actually classified them as manual.
const AUTO_THRESHOLD = DEFAULT_MERGE_THRESHOLDS.autoMerge
const MANUAL_THRESHOLD = DEFAULT_MERGE_THRESHOLDS.manualReview

export const GET = withRls(async (_req, { orgId }) => {

  try {
    const candidates = (await prisma.profileMergeCandidate.findMany({
      where: { organizationId: orgId, status: "pending" },
      select: {
        id: true,
        primaryProfileId: true,
        secondaryProfileId: true,
        score: true,
        matchBreakdown: true,
        reason: true,
        status: true,
        createdAt: true,
        primaryProfile: {
          select: {
            id: true,
            displayName: true,
            displayEmail: true,
            displayPhone: true,
            emailNormalized: true,
            phoneNormalized: true,
            nameNormalized: true,
            totalSpent: true,
            lifetimeOrderCount: true,
            firstSeenAt: true,
            lastSeenAt: true,
            channelsActive: true,
          },
        },
        secondaryProfile: {
          select: {
            id: true,
            displayName: true,
            displayEmail: true,
            displayPhone: true,
            emailNormalized: true,
            phoneNormalized: true,
            nameNormalized: true,
            totalSpent: true,
            lifetimeOrderCount: true,
            firstSeenAt: true,
            lastSeenAt: true,
            channelsActive: true,
          },
        },
      },
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
      take: FETCH_CAP + 1,
    })) as CandidateRow[]
    const truncated = candidates.length > FETCH_CAP
    if (truncated) candidates.length = FETCH_CAP

    // Also fetch terminal-state aggregate counts for context.
    const statusCounts = await prisma.profileMergeCandidate.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: { _all: true },
    })
    const counts: Record<string, number> = {
      pending: 0,
      auto_merged: 0,
      manually_merged: 0,
      rejected: 0,
    }
    for (const row of statusCounts) {
      if (row.status in counts) counts[row.status] = row._count._all
    }

    const items = candidates.map((c) => {
      const breakdown = (
        c.matchBreakdown && typeof c.matchBreakdown === "object"
          ? c.matchBreakdown
          : {}
      ) as Record<string, unknown>
      const tier =
        c.score >= AUTO_THRESHOLD
          ? "auto"
          : c.score >= MANUAL_THRESHOLD
            ? "manual"
            : "weak"
      return {
        id: c.id,
        score: c.score,
        tier,
        reason: c.reason,
        breakdown: {
          email: typeof breakdown.email === "number" ? breakdown.email : null,
          phone: typeof breakdown.phone === "number" ? breakdown.phone : null,
          name: typeof breakdown.name === "number" ? breakdown.name : null,
          emailWeight:
            typeof breakdown.emailWeight === "number"
              ? breakdown.emailWeight
              : null,
          phoneWeight:
            typeof breakdown.phoneWeight === "number"
              ? breakdown.phoneWeight
              : null,
          nameWeight:
            typeof breakdown.nameWeight === "number"
              ? breakdown.nameWeight
              : null,
        },
        createdAt: c.createdAt,
        primary: c.primaryProfile,
        secondary: c.secondaryProfile,
      }
    })

    return NextResponse.json({
      items,
      totalPending: items.length,
      statusCounts: counts,
      truncated,
      fetchCap: FETCH_CAP,
      thresholds: {
        auto: AUTO_THRESHOLD,
        manual: MANUAL_THRESHOLD,
      },
    })
  } catch (err) {
    console.error("[identity-merge-queue] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load merge queue" },
      { status: 500 },
    )
  }
})
