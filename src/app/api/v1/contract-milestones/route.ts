/**
 * CLM Slice 5d — Org-wide Contract Milestones list
 *
 * GET /api/v1/contract-milestones
 *   Returns all ContractMilestones across ALL contracts in the org (org-scoped,
 *   read-only). Each row is joined with the parent contract (contractNumber,
 *   title) and the owner user (name).
 *
 * Query params:
 *   status=pending|in_progress|completed|cancelled  — filter by milestone status
 *   overdue=true                                    — dueAt < now AND status NOT IN (completed, cancelled)
 *   upcoming=N                                      — dueAt within N days AND status NOT IN (completed, cancelled)
 *   page=1                                          — 1-based page index (default 1)
 *   pageSize=50                                     — rows per page (default 50, max 200)
 *
 * requireAuth("contracts", "read"). Org-scoped; no cross-tenant leak possible.
 * Read-only: per-contract create/update/delete stays on /contracts/[id]/milestones.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

type MilestoneRow = Prisma.ContractMilestoneGetPayload<{
  select: {
    id:          true
    contractId:  true
    label:       true
    description: true
    dueAt:       true
    completedAt: true
    status:      true
    ownerUserId: true
    createdAt:   true
    updatedAt:   true
    contract: { select: { id: true; contractNumber: true; title: true } }
  }
}>

const VALID_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const
type MilestoneStatus = (typeof VALID_STATUSES)[number]
const TERMINAL_STATUSES: MilestoneStatus[] = ["completed", "cancelled"]

const PAGE_SIZE_MAX = 200
const PAGE_SIZE_DEFAULT = 50

export const GET = withRlsAuth("contracts", "read", async (req, auth) => {
  const orgId = auth.orgId

  const sp = req.nextUrl.searchParams

  // --- Filter params ---
  const statusParam = sp.get("status")
  const overdue = sp.get("overdue") === "true"
  const upcomingRaw = sp.get("upcoming")
  const upcomingDays = upcomingRaw ? parseInt(upcomingRaw, 10) : null

  // --- Pagination ---
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1)
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(sp.get("pageSize") ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT),
  )

  // --- Build where clause ---
  const now = new Date()

  // Status filter (validate against enum, ignore unknown values)
  const statusFilter: MilestoneStatus | undefined =
    statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as MilestoneStatus)
      : undefined

  // Overdue = dueAt < now AND status NOT in (completed, cancelled)
  // Upcoming = dueAt in [now, now + N days] AND status NOT in (completed, cancelled)
  // These are mutually exclusive; overdue wins if both params set.
  //
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { organizationId: orgId }
  const upcomingActive = !overdue && upcomingDays !== null && !isNaN(upcomingDays) && upcomingDays > 0

  // Overdue and upcoming stay mutually exclusive — that part is deliberate and
  // documented above. The STATUS filter is different: it used to be dropped
  // whenever either of those was on, so a user picking "overdue" and "in
  // progress" silently got every overdue milestone. The screen showed a
  // selected status and ignored it, which is worse than refusing the
  // combination, because nothing said so.
  //
  // Status now NARROWS the date window instead of competing with it. Choosing a
  // terminal status together with overdue yields nothing — correct, since a
  // completed milestone is not overdue — and an empty list is an honest answer
  // where a full one was a lie.
  if (overdue) {
    where.dueAt = { lt: now }
  } else if (upcomingActive) {
    where.dueAt = { gte: now, lte: new Date(now.getTime() + (upcomingDays as number) * 24 * 60 * 60 * 1000) }
  }

  if (overdue || upcomingActive) {
    where.AND = [
      { status: { notIn: TERMINAL_STATUSES } },
      ...(statusFilter ? [{ status: statusFilter }] : []),
    ]
  } else if (statusFilter) {
    where.status = statusFilter
  }

  try {
    const total = await prisma.contractMilestone.count({ where })
    const rows: MilestoneRow[] = await prisma.contractMilestone.findMany({
      where,
      orderBy: { dueAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id:          true,
        contractId:  true,
        label:       true,
        description: true,
        dueAt:       true,
        completedAt: true,
        status:      true,
        ownerUserId: true,
        createdAt:   true,
        updatedAt:   true,
        contract: {
          select: {
            id:             true,
            contractNumber: true,
            title:          true,
          },
        },
      },
    })

    // Attach owner name (optional; ownerUserId may be null). We batch-load in
    // a single extra query to avoid N+1.
    const ownerIds: string[] = [...new Set(
      rows.map((r) => r.ownerUserId).filter((id): id is string => id !== null)
    )]
    const ownerMap = new Map<string, string | null>()
    if (ownerIds.length > 0) {
      const owners = await prisma.user.findMany({
        where: { id: { in: ownerIds }, organizationId: orgId },
        select: { id: true, name: true },
      })
      for (const o of owners) ownerMap.set(o.id, o.name)
    }

    const data = rows.map((m) => ({
      id: m.id,
      contractId: m.contractId,
      contractNumber: m.contract.contractNumber,
      contractTitle: m.contract.title,
      label: m.label,
      description: m.description,
      dueAt: m.dueAt,
      completedAt: m.completedAt,
      status: m.status,
      isOverdue:
        !TERMINAL_STATUSES.includes(m.status as MilestoneStatus) && m.dueAt < now,
      ownerUserId: m.ownerUserId,
      ownerName: m.ownerUserId ? (ownerMap.get(m.ownerUserId) ?? null) : null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }))

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (e) {
    console.error("[contract-milestones GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
