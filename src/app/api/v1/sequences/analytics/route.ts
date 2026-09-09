import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

interface CountGroup {
  sequenceId: string
  _count: { _all: number }
}
interface RepliedGroup extends CountGroup {
  _avg: { currentStep: number | null }
}
interface StepDistGroup {
  sequenceId: string
  currentStep: number
  _count: { _all: number }
}
interface OwnerGroup {
  ownerId: string | null
  _count: { _all: number }
}

/**
 * GET /api/v1/sequences/analytics — cadence effectiveness.
 *
 * Per sequence and org-wide: total enrollments, replies (repliedAt), meetings
 * (meetingBookedAt), reply rate, average touches until the reply landed
 * (currentStep at exit — how many steps the manager actually executed).
 *
 * Also:
 *  - funnel: per sequence, per step — how many enrollments executed that step
 *    (currentStep tracks steps already executed, so an enrollment at currentStep=k
 *    has executed steps 0..k-1; step i is "executed" ⟺ currentStep > i). Monotonic
 *    decreasing curve → shows where prospects drop off.
 *  - leaderboard: per owner (ownerId) — enrollments / replies / meetings / reply rate,
 *    so a manager can see which rep's cadences convert.
 */
export const GET = withRls(async (_req, { orgId }) => {
  const [totals, replied, meetings, activeTotal, stepDist, activeStepDist, ownerTotals, ownerReplied, ownerMeetings, sequenceRows]: [
    CountGroup[],
    RepliedGroup[],
    CountGroup[],
    number,
    StepDistGroup[],
    StepDistGroup[],
    OwnerGroup[],
    OwnerGroup[],
    OwnerGroup[],
    { id: string; name: string; steps: { stepOrder: number; type: string; subject: string | null }[] }[],
  ] = await Promise.all([
    prisma.sequenceEnrollment.groupBy({
      by: ["sequenceId"],
      where: { organizationId: orgId as string },
      _count: { _all: true },
    }),
    prisma.sequenceEnrollment.groupBy({
      by: ["sequenceId"],
      where: { organizationId: orgId as string, repliedAt: { not: null } },
      _count: { _all: true },
      _avg: { currentStep: true },
    }),
    prisma.sequenceEnrollment.groupBy({
      by: ["sequenceId"],
      where: { organizationId: orgId as string, meetingBookedAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.sequenceEnrollment.count({
      where: { organizationId: orgId as string, status: "active" },
    }),
    prisma.sequenceEnrollment.groupBy({
      by: ["sequenceId", "currentStep"],
      where: { organizationId: orgId as string },
      _count: { _all: true },
    }),
    // E5 — ACTIVE enrollments by their current step: who is sitting at each step
    // right now (the "live" view — distinct from `reached`, which is cumulative
    // over all statuses/history).
    prisma.sequenceEnrollment.groupBy({
      by: ["sequenceId", "currentStep"],
      where: { organizationId: orgId as string, status: "active" },
      _count: { _all: true },
    }),
    prisma.sequenceEnrollment.groupBy({
      by: ["ownerId"],
      where: { organizationId: orgId as string },
      _count: { _all: true },
    }),
    prisma.sequenceEnrollment.groupBy({
      by: ["ownerId"],
      where: { organizationId: orgId as string, repliedAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.sequenceEnrollment.groupBy({
      by: ["ownerId"],
      where: { organizationId: orgId as string, meetingBookedAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.salesSequence.findMany({
      where: { organizationId: orgId as string },
      select: {
        id: true,
        name: true,
        steps: {
          where: { isActive: true },
          orderBy: { stepOrder: "asc" },
          select: { stepOrder: true, type: true, subject: true },
        },
      },
    }),
  ])

  const repliedBySeq = new Map(replied.map((g) => [g.sequenceId, g]))
  const meetingsBySeq = new Map(meetings.map((g) => [g.sequenceId, g._count._all]))

  const sequences = totals.map((g) => {
    const rep = repliedBySeq.get(g.sequenceId)
    const total = g._count._all
    const repliedCount = rep?._count._all ?? 0
    return {
      sequenceId: g.sequenceId,
      total,
      replied: repliedCount,
      replyRate: total > 0 ? Math.round((repliedCount / total) * 100) : 0,
      meetings: meetingsBySeq.get(g.sequenceId) ?? 0,
      avgTouchesToReply: rep?._avg.currentStep != null ? Math.round(rep._avg.currentStep * 10) / 10 : null,
    }
  })

  const orgTotal = sequences.reduce((n, s) => n + s.total, 0)
  const orgReplied = sequences.reduce((n, s) => n + s.replied, 0)
  const orgMeetings = sequences.reduce((n, s) => n + s.meetings, 0)
  // Weight from the RAW per-sequence averages — weighting the rounded display
  // values compounds up to ±0.05 error per sequence.
  const weightedAvgNumerator = replied.reduce(
    (n, g) => n + (g._avg.currentStep != null ? g._avg.currentStep * g._count._all : 0),
    0
  )

  // ── Funnel ────────────────────────────────────────────────────────────────
  // For each sequence, currentStep=k means k executed steps. So the # of
  // enrollments that executed step i (0-indexed) = Σ counts where currentStep > i.
  // Build a per-sequence {currentStep -> count} map once, then sweep the steps.
  const distBySeq = new Map<string, Map<number, number>>()
  for (const g of stepDist) {
    let m = distBySeq.get(g.sequenceId)
    if (!m) { m = new Map(); distBySeq.set(g.sequenceId, m) }
    m.set(g.currentStep, (m.get(g.currentStep) ?? 0) + g._count._all)
  }
  // E5 — ACTIVE enrollments currently sitting at each step (currentStep == i).
  const activeBySeq = new Map<string, Map<number, number>>()
  for (const g of activeStepDist) {
    let m = activeBySeq.get(g.sequenceId)
    if (!m) { m = new Map(); activeBySeq.set(g.sequenceId, m) }
    m.set(g.currentStep, (m.get(g.currentStep) ?? 0) + g._count._all)
  }
  const totalBySeq = new Map(totals.map((g) => [g.sequenceId, g._count._all]))

  const funnel = sequenceRows
    // Only sequences that both have steps AND at least one enrollment — an empty
    // all-zero funnel is noise.
    .filter((seq) => seq.steps.length > 0 && (totalBySeq.get(seq.id) ?? 0) > 0)
    .map((seq) => {
      const dist = distBySeq.get(seq.id)
      const active = activeBySeq.get(seq.id)
      const steps = seq.steps.map((step, i) => {
        // executed step i ⟺ currentStep > i
        let reached = 0
        if (dist) {
          for (const [cs, count] of dist) {
            if (cs > i) reached += count
          }
        }
        // E5 — active enrollments waiting AT this step right now (currentStep == i).
        const activeHere = active?.get(i) ?? 0
        return {
          stepOrder: step.stepOrder,
          type: step.type,
          subject: step.subject ?? null,
          reached,
          activeHere,
        }
      })
      // Baseline = ALL enrolled (incl. those still at step 0, not yet actioned),
      // so bar 0 honestly shows the "started the first touch" rate rather than a
      // hard-coded 100%.
      const entered = totalBySeq.get(seq.id) ?? 0
      return { sequenceId: seq.id, name: seq.name, entered, steps }
    })

  // ── Leaderboard ─────────────────────────────────────────────────────────────
  const repliedByOwner = new Map(ownerReplied.map((g) => [g.ownerId, g._count._all]))
  const meetingsByOwner = new Map(ownerMeetings.map((g) => [g.ownerId, g._count._all]))
  const ownerIds = ownerTotals.map((g) => g.ownerId).filter((v): v is string => !!v)
  const owners: { id: string; name: string | null }[] = ownerIds.length
    ? await prisma.user.findMany({
        where: { organizationId: orgId as string, id: { in: ownerIds } },
        select: { id: true, name: true },
      })
    : []
  const ownerNameById = new Map(owners.map((u) => [u.id, u.name]))

  const leaderboard = ownerTotals
    .map((g) => {
      const total = g._count._all
      const repliedCount = repliedByOwner.get(g.ownerId) ?? 0
      return {
        ownerId: g.ownerId,
        ownerName: g.ownerId ? ownerNameById.get(g.ownerId) ?? null : null,
        total,
        replied: repliedCount,
        meetings: meetingsByOwner.get(g.ownerId) ?? 0,
        replyRate: total > 0 ? Math.round((repliedCount / total) * 100) : 0,
      }
    })
    // Busiest reps first; the "unassigned" bucket (ownerId=null) sinks to the end.
    .sort((a, b) => b.total - a.total)

  return NextResponse.json({
    success: true,
    data: {
      org: {
        activeEnrollments: activeTotal,
        total: orgTotal,
        replied: orgReplied,
        replyRate: orgTotal > 0 ? Math.round((orgReplied / orgTotal) * 100) : 0,
        meetings: orgMeetings,
        avgTouchesToReply: orgReplied > 0 ? Math.round((weightedAvgNumerator / orgReplied) * 10) / 10 : null,
      },
      sequences,
      funnel,
      leaderboard,
    },
  })
})
