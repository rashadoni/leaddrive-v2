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
import { buildLifecycleView } from "@/lib/contract-lifecycle/lifecycle-view"

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

    const view = buildLifecycleView(
      renewalAlerts.map((a) => ({
        ...a,
        contract: a.contract ? { ...a.contract, valueAmount: decimalToNumberNullable(a.contract.valueAmount) } : null,
      })),
      pendingApprovals.map((s) => ({
        ...s,
        contract: s.contract ? { ...s.contract, valueAmount: decimalToNumberNullable(s.contract.valueAmount) } : null,
      })),
      now,
    )

    return NextResponse.json({
      renewals: { ...view.renewals, truncated: renewalsTruncated },
      approvals: { ...view.approvals, truncated: approvalsTruncated },
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
