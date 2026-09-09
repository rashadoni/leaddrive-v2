/**
 * B10 Entitlement Process.
 *
 * GET  /api/v1/entitlements — list customer support terms + form options.
 * POST /api/v1/entitlements — create a draft customer support term.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  canUseEntitlementPermission,
  entitlementPermissionError,
  entitlementPermissionsForRole,
  type EntitlementPermissionScope,
} from "@/lib/entitlement-process/access"
import {
  MILESTONE_SEVERITY_SCOPES,
  type MilestoneSeverityScope,
} from "@/lib/entitlement-process/milestone-definitions"
import { MILESTONE_TYPES, type MilestoneType } from "@/lib/entitlement-process/types"
import { ensureEntitlementTemplates } from "@/lib/entitlement-process/template-settings"

interface MilestoneDefinitionRow {
  id: string
  entitlementId: string
  type: string
  name: string
  severityTier: string | null
  dueWithinSeconds: number
  isRequired: boolean
  createdAt: Date
  updatedAt: Date
}

interface EntitlementRow {
  id: string
  companyId: string
  slaPolicyId: string
  supportLevel: string
  validFrom: Date
  validTo: Date | null
  status: string
  expiredAt: Date | null
  cancelledAt: Date | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
  company: { name: string } | null
  slaPolicy: { name: string } | null
  _count: { milestoneDefinitions: number }
  milestoneDefinitions: MilestoneDefinitionRow[]
}

interface CompanyOptionRow {
  id: string
  name: string
  status: string
  category: string
  entitlements: Array<{ id: string }>
}

interface SlaPolicyOptionRow {
  id: string
  name: string
  priority: string
  firstResponseHours: number
  resolutionHours: number
  isDefault: boolean
}

type EntitlementsResponse = Awaited<ReturnType<typeof loadEntitlements>>

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  draft: 1,
  suspended: 2,
  expired: 3,
  cancelled: 4,
}

const EXPIRING_SOON_DAYS = 30

function sortMilestoneDefinitions(a: MilestoneDefinitionRow, b: MilestoneDefinitionRow) {
  const typeOrder =
    MILESTONE_TYPES.indexOf(a.type as MilestoneType) -
    MILESTONE_TYPES.indexOf(b.type as MilestoneType)
  if (typeOrder !== 0) return typeOrder
  const severityA = a.severityTier ?? "all"
  const severityB = b.severityTier ?? "all"
  return MILESTONE_SEVERITY_SCOPES.indexOf(severityA as MilestoneSeverityScope) -
    MILESTONE_SEVERITY_SCOPES.indexOf(severityB as MilestoneSeverityScope)
}

const createEntitlementSchema = z.object({
  companyId: z.string().min(1, "Company is required."),
  slaPolicyId: z.string().min(1, "SLA policy is required."),
  supportLevel: z.enum(["basic", "standard", "premium", "enterprise"]).default("standard"),
  validFrom: z.string().min(1).optional(),
  validTo: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

function parseDateInput(value: string | null | undefined, fieldName: string): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} is invalid.`)
  }
  return date
}

function forbidden(permission: EntitlementPermissionScope) {
  return NextResponse.json(
    { error: "Forbidden", message: entitlementPermissionError(permission) },
    { status: 403 },
  )
}

async function loadEntitlements(orgId: string) {
  const [entitlements, companies, slaPolicies, templates] = await Promise.all([
    prisma.entitlement.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        companyId: true,
        slaPolicyId: true,
        supportLevel: true,
        validFrom: true,
        validTo: true,
        status: true,
        expiredAt: true,
        cancelledAt: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        company: { select: { name: true } },
        slaPolicy: { select: { name: true } },
        _count: { select: { milestoneDefinitions: true } },
        milestoneDefinitions: {
          select: {
            id: true,
            entitlementId: true,
            type: true,
            name: true,
            severityTier: true,
            dueWithinSeconds: true,
            isRequired: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }) as Promise<EntitlementRow[]>,
    prisma.company.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        status: true,
        category: true,
        entitlements: {
          where: { status: "active" },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
      take: 250,
    }) as Promise<CompanyOptionRow[]>,
    prisma.slaPolicy.findMany({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        name: true,
        priority: true,
        firstResponseHours: true,
        resolutionHours: true,
        isDefault: true,
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      take: 100,
    }) as Promise<SlaPolicyOptionRow[]>,
    ensureEntitlementTemplates(orgId),
  ])

  const entitlementIds = entitlements.map((e) => e.id)

  const now = new Date()
  const inDay = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const defs = entitlements.flatMap((entitlement) => entitlement.milestoneDefinitions)
  const defToEntitlement = new Map<string, string>()
  for (const d of defs) defToEntitlement.set(d.id, d.entitlementId)
  const definitionIds = defs.map((d) => d.id)

  interface MilestoneRow {
    definitionId: string
    status: string
    dueAt: Date
    missedAt: Date | null
    completedAt: Date | null
  }
  const milestones = definitionIds.length
    ? ((await prisma.entitlementTicketMilestone.findMany({
        where: {
          organizationId: orgId,
          definitionId: { in: definitionIds },
          OR: [
            { status: { in: ["in_progress", "pending"] } },
            { missedAt: { gte: thirtyDaysAgo } },
            { completedAt: { gte: sevenDaysAgo } },
          ],
        },
        select: {
          definitionId: true,
          status: true,
          dueAt: true,
          missedAt: true,
          completedAt: true,
        },
      })) as MilestoneRow[])
    : []

  interface Counts {
    overdue: number
    atRisk: number
    missed30d: number
    met7d: number
  }
  const countsByEnt = new Map<string, Counts>()
  for (const id of entitlementIds) {
    countsByEnt.set(id, { overdue: 0, atRisk: 0, missed30d: 0, met7d: 0 })
  }
  for (const m of milestones) {
    const entId = defToEntitlement.get(m.definitionId)
    if (!entId) continue
    const c = countsByEnt.get(entId)
    if (!c) continue
    if (m.status === "in_progress" || m.status === "pending") {
      if (m.dueAt < now && m.dueAt >= thirtyDaysAgo) c.overdue++
      else if (m.dueAt >= now && m.dueAt < inDay) c.atRisk++
    }
    if (m.status === "missed" && m.missedAt && m.missedAt >= thirtyDaysAgo) {
      c.missed30d++
    }
    if (m.status === "met" && m.completedAt && m.completedAt >= sevenDaysAgo) {
      c.met7d++
    }
  }

  const ACTIVE_STATUSES = new Set(["active", "suspended"])
  for (const e of entitlements) {
    if (!ACTIVE_STATUSES.has(e.status)) {
      countsByEnt.set(e.id, { overdue: 0, atRisk: 0, missed30d: 0, met7d: 0 })
    }
  }

  const enriched = entitlements.map((e) => {
    const counts = countsByEnt.get(e.id)!
    const daysUntilExpiry =
      e.validTo !== null
        ? Math.floor((e.validTo.getTime() - now.getTime()) / 86_400_000)
        : null
    const isExpiringSoon =
      e.status === "active" &&
      daysUntilExpiry !== null &&
      daysUntilExpiry >= 0 &&
      daysUntilExpiry <= EXPIRING_SOON_DAYS
    return {
      id: e.id,
      companyId: e.companyId,
      companyName: e.company?.name ?? "",
      slaPolicyId: e.slaPolicyId,
      slaPolicyName: e.slaPolicy?.name ?? "—",
      supportLevel: e.supportLevel,
      validFrom: e.validFrom,
      validTo: e.validTo,
      status: e.status,
      expiredAt: e.expiredAt,
      cancelledAt: e.cancelledAt,
      notes: e.notes,
      definitionCount: e._count.milestoneDefinitions,
      definitions: [...e.milestoneDefinitions].sort(sortMilestoneDefinitions).map((definition) => ({
        id: definition.id,
        type: definition.type,
        name: definition.name,
        severityTier: definition.severityTier,
        dueWithinSeconds: definition.dueWithinSeconds,
        isRequired: definition.isRequired,
        createdAt: definition.createdAt,
        updatedAt: definition.updatedAt,
      })),
      daysUntilExpiry,
      isExpiringSoon,
      updatedAt: e.updatedAt,
      milestones: counts,
    }
  })

  enriched.sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 9
    const sb = STATUS_ORDER[b.status] ?? 9
    if (sa !== sb) return sa - sb
    const ra = a.milestones.overdue * 2 + a.milestones.atRisk
    const rb = b.milestones.overdue * 2 + b.milestones.atRisk
    if (ra !== rb) return rb - ra
    if (a.isExpiringSoon !== b.isExpiringSoon) {
      return a.isExpiringSoon ? -1 : 1
    }
    return b.updatedAt.getTime() - a.updatedAt.getTime()
  })

  const totals = enriched.reduce(
    (acc, e) => {
      if (e.status === "active") acc.activeCount++
      if (e.isExpiringSoon) acc.expiringSoonCount++
      acc.overdueMilestones += e.milestones.overdue
      acc.atRiskMilestones += e.milestones.atRisk
      acc.missed30d += e.milestones.missed30d
      return acc
    },
    {
      activeCount: 0,
      expiringSoonCount: 0,
      overdueMilestones: 0,
      atRiskMilestones: 0,
      missed30d: 0,
    },
  )

  return {
    entitlements: enriched,
    totalEntitlements: enriched.length,
    companies: companies.map((company) => ({
      id: company.id,
      name: company.name,
      status: company.status,
      category: company.category,
      hasActiveEntitlement: company.entitlements.length > 0,
    })),
    slaPolicies,
    templates,
    ...totals,
  }
}

export const GET = withRlsAuth("tickets", "read", async (_req, { orgId, role }) => {
  if (!canUseEntitlementPermission(role, "entitlements.read")) {
    return forbidden("entitlements.read")
  }
  try {
    return NextResponse.json({
      ...(await loadEntitlements(orgId)),
      permissions: entitlementPermissionsForRole(role),
    })
  } catch (err) {
    console.error("[entitlements] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load support terms" },
      { status: 500 },
    )
  }
})

export const POST = withRlsAuth("tickets", "write", async (req, { orgId, userId, role }) => {
  if (!canUseEntitlementPermission(role, "entitlements.write")) {
    return forbidden("entitlements.write")
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const parsed = createEntitlementSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    )
  }

  let validFrom: Date
  try {
    validFrom = parseDateInput(parsed.data.validFrom, "validFrom") ?? new Date()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "validFrom is invalid." },
      { status: 400 },
    )
  }

  let validTo: Date | null
  try {
    validTo = parseDateInput(parsed.data.validTo, "validTo")
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "validTo is invalid." },
      { status: 400 },
    )
  }
  if (validTo && validTo <= validFrom) {
    return NextResponse.json(
      { error: "validTo must be after validFrom." },
      { status: 400 },
    )
  }

  const [company, slaPolicy] = await Promise.all([
    prisma.company.findFirst({
      where: { id: parsed.data.companyId, organizationId: orgId },
      select: { id: true },
    }),
    prisma.slaPolicy.findFirst({
      where: { id: parsed.data.slaPolicyId, organizationId: orgId, isActive: true },
      select: { id: true },
    }),
  ])
  if (!company) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 })
  }
  if (!slaPolicy) {
    return NextResponse.json({ error: "Active SLA policy not found." }, { status: 404 })
  }

  try {
    const createdEntitlement = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const entitlement = await tx.entitlement.create({
        data: {
          organizationId: orgId,
          companyId: parsed.data.companyId,
          slaPolicyId: parsed.data.slaPolicyId,
          supportLevel: parsed.data.supportLevel,
          validFrom,
          validTo,
          status: "draft",
          notes: parsed.data.notes?.trim() || null,
          createdBy: userId,
        },
        select: { id: true },
      })

      await tx.entitlementAuditEvent.create({
        data: {
          organizationId: orgId,
          entitlementId: entitlement.id,
          eventType: "entitlement_created",
          actorUserId: userId,
          payload: {
            supportLevel: parsed.data.supportLevel,
            companyId: parsed.data.companyId,
            slaPolicyId: parsed.data.slaPolicyId,
          },
        },
      })

      return entitlement
    })

    const response: EntitlementsResponse = await loadEntitlements(orgId)
    return NextResponse.json({
      success: true,
      createdEntitlementId: createdEntitlement.id,
      ...response,
      permissions: entitlementPermissionsForRole(role),
    }, { status: 201 })
  } catch (err) {
    console.error("[entitlements] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create support term." },
      { status: 500 },
    )
  }
})
