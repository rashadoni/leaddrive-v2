/**
 * CLM (Contract Lifecycle Management) — slice-2 API.
 *
 * GET /api/v1/contract-lifecycle
 *
 * Two streams aggregated into one response so the dashboard can render
 * without a fan-out:
 *
 *   1. Renewal alerts due soon (next 90 days) or already overdue —
 *      backed by `contract_renewal_alerts` table joined to contract.
 *   2. Contracts stuck in approval — joined to ALL pending approval
 *      stages; the dashboard groups by current stage label so
 *      sales-ops sees "3 stuck at Finance Director", "2 stuck at Legal".
 *
 * Sort: renewal alerts by dueAt asc (oldest first), approvals grouped
 * by stage label asc then contract.contractNumber asc for stability.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { decimalToNumberNullable } from "@/lib/prisma-decimal"

interface AlertRow {
  id: string
  contractId: string
  dueAt: Date
  daysBeforeExpiry: number
  status: string
  deliveredVia: string | null
  deliveredAt: Date | null
  createdAt: Date
  contract: {
    contractNumber: string
    title: string
    endDate: Date | null
    valueAmount: number | null
    currency: string
    status: string
    company: { name: string } | null
  } | null
}

interface ApprovalStageRow {
  id: string
  contractId: string
  order: number
  label: string
  status: string
  assigneeUserId: string | null
  assigneeRole: string | null
  createdAt: Date
  contract: {
    contractNumber: string
    title: string
    status: string
    valueAmount: number | null
    currency: string
    company: { name: string } | null
  } | null
}

export const GET = withRls(async (_req, { orgId }) => {

  try {
    const now = new Date()
    const ninetyDaysAhead = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    // Server-side truncation cap. If a tenant has more pending alerts /
    // approvals than this, the dashboard would silently miss the long tail.
    // We over-fetch by one and report `truncated: true` so the page can
    // surface a banner.
    const FETCH_CAP = 200

    // Renewal alerts: pending, due in next 90d OR already overdue.
    const renewalAlerts = (await prisma.contractRenewalAlert.findMany({
      where: {
        organizationId: orgId,
        status: "pending",
        dueAt: { lte: ninetyDaysAhead },
        contract: { status: { in: ["active", "renewing"] } },
      },
      select: {
        id: true,
        contractId: true,
        dueAt: true,
        daysBeforeExpiry: true,
        status: true,
        deliveredVia: true,
        deliveredAt: true,
        createdAt: true,
        contract: {
          select: {
            contractNumber: true,
            title: true,
            endDate: true,
            valueAmount: true,
            currency: true,
            status: true,
            company: { select: { name: true } },
          },
        },
      },
      orderBy: [{ dueAt: "asc" }],
      take: FETCH_CAP + 1,
    })) as AlertRow[]
    const renewalsTruncated = renewalAlerts.length > FETCH_CAP
    if (renewalsTruncated) renewalAlerts.length = FETCH_CAP

    // Approval stages: contracts where any stage is pending and the
    // overall contract is still in `pending_approval`. We list every
    // pending stage — the page bucket by stage label.
    const pendingApprovals = (await prisma.contractApprovalStage.findMany({
      where: {
        organizationId: orgId,
        status: "pending",
        contract: { status: "pending_approval" },
      },
      select: {
        id: true,
        contractId: true,
        order: true,
        label: true,
        status: true,
        assigneeUserId: true,
        assigneeRole: true,
        createdAt: true,
        contract: {
          select: {
            contractNumber: true,
            title: true,
            status: true,
            valueAmount: true,
            currency: true,
            company: { select: { name: true } },
          },
        },
      },
      orderBy: [{ contractId: "asc" }, { order: "asc" }],
      take: FETCH_CAP + 1,
    })) as ApprovalStageRow[]
    const approvalsTruncated = pendingApprovals.length > FETCH_CAP
    if (approvalsTruncated) pendingApprovals.length = FETCH_CAP

    // For each contract in approvals, keep only the lowest-order pending
    // stage — that's the current bottleneck. If a contract has stages
    // 1=approved, 2=pending, 3=pending, the current bottleneck is stage 2.
    // (Sequential CLM: stage N is gated by stage N-1.)
    const currentByContract = new Map<string, ApprovalStageRow>()
    for (const s of pendingApprovals) {
      const existing = currentByContract.get(s.contractId)
      if (!existing || s.order < existing.order) {
        currentByContract.set(s.contractId, s)
      }
    }
    const currentApprovals = Array.from(currentByContract.values())

    const renewalsOut = renewalAlerts.map((a) => {
      const daysUntilDue = Math.floor(
        (a.dueAt.getTime() - now.getTime()) / 86_400_000,
      )
      return {
        id: a.id,
        contractId: a.contractId,
        contractNumber: a.contract?.contractNumber ?? "—",
        contractTitle: a.contract?.title ?? "—",
        companyName: a.contract?.company?.name ?? null,
        contractStatus: a.contract?.status ?? "unknown",
        endDate: a.contract?.endDate ?? null,
        valueAmount: decimalToNumberNullable(a.contract?.valueAmount),
        currency: a.contract?.currency ?? "USD",
        dueAt: a.dueAt,
        daysUntilDue,
        daysBeforeExpiry: a.daysBeforeExpiry,
        isOverdue: daysUntilDue < 0,
      }
    })

    // Dedup to ONE row per contract: a contract has a renewal alert PER threshold
    // (90/60/30/14d), so without this a single expiring contract floods the list
    // with redundant rows (same endDate, different alert window). The query is
    // ordered dueAt-asc, so the first occurrence per contract is its most urgent
    // (soonest) alert — keep that one. The KPI counts below run on the deduped
    // set so "renewals due (90d)" reflects CONTRACTS, not alert records.
    const seenContract = new Set<string>()
    const renewalsDeduped = renewalsOut.filter((r) => {
      if (seenContract.has(r.contractId)) return false
      seenContract.add(r.contractId)
      return true
    })

    const approvalsOut = currentApprovals.map((s) => ({
      contractId: s.contractId,
      contractNumber: s.contract?.contractNumber ?? "—",
      contractTitle: s.contract?.title ?? "—",
      companyName: s.contract?.company?.name ?? null,
      valueAmount: decimalToNumberNullable(s.contract?.valueAmount),
      currency: s.contract?.currency ?? "USD",
      currentStageLabel: s.label,
      currentStageOrder: s.order,
      currentStageId: s.id,
      assigneeUserId: s.assigneeUserId,
      assigneeRole: s.assigneeRole,
      ageMs: now.getTime() - s.createdAt.getTime(),
    }))

    // Approvals grouped by stage label for the page's "bottleneck" view.
    const groupedApprovals: Record<string, typeof approvalsOut> = {}
    for (const a of approvalsOut) {
      const k = a.currentStageLabel
      if (!groupedApprovals[k]) groupedApprovals[k] = []
      groupedApprovals[k].push(a)
    }
    // Within a stage bucket, oldest-stalled contract first so the most
    // overdue case is at the top of each group.
    for (const contracts of Object.values(groupedApprovals)) {
      contracts.sort((a, b) => b.ageMs - a.ageMs)
    }
    // Across groups: larger queue first; label localeCompare as
    // deterministic tiebreaker so equal-count groups stay stable across
    // reloads (was non-deterministic before the architect raised it).
    const approvalGroups = Object.entries(groupedApprovals)
      .map(([label, contracts]) => ({ label, contracts }))
      .sort((a, b) => {
        if (b.contracts.length !== a.contracts.length) {
          return b.contracts.length - a.contracts.length
        }
        return a.label.localeCompare(b.label)
      })

    return NextResponse.json({
      renewals: {
        items: renewalsDeduped,
        total: renewalsDeduped.length,
        overdueCount: renewalsDeduped.filter((r) => r.isOverdue).length,
        next30dCount: renewalsDeduped.filter(
          (r) => !r.isOverdue && r.daysUntilDue <= 30,
        ).length,
        truncated: renewalsTruncated,
      },
      approvals: {
        items: approvalsOut,
        groups: approvalGroups,
        total: approvalsOut.length,
        bottleneckStage:
          approvalGroups.length > 0 ? approvalGroups[0].label : null,
        // How many contracts are stuck at the bottleneck stage — turns the KPI
        // from a bare label into "{stage} — N stuck" + a jump target.
        bottleneckCount:
          approvalGroups.length > 0 ? approvalGroups[0].contracts.length : 0,
        truncated: approvalsTruncated,
      },
      fetchCap: FETCH_CAP,
    })
  } catch (err) {
    console.error("[contract-lifecycle] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load contract lifecycle" },
      { status: 500 },
    )
  }
})
