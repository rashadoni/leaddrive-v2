import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  isAgentInRouteScope,
  resolveMtmRouteActor,
} from "@/lib/mtm/route-permissions"
import { FieldAssignmentUpsertSchema, parseBody } from "@/lib/mtm-validators"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import {
  activeFieldAssignmentWindow,
  canManageFieldMasterData,
  contactScopeForActor,
  customerScopeForActor,
} from "@/lib/mtm/field-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

async function actorContext(auth: { orgId: string; userId: string; role: string; agentId: string | null }) {
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const todayKey = currentDateKey(new Date(), timezone)
  return { actor, timezone, todayKey, today: utcDate(todayKey) }
}

function visibleAgentFilter(actor: NonNullable<Awaited<ReturnType<typeof actorContext>>["actor"]>) {
  if (actor.role === "ADMIN" || actor.scopedAgentIds === null) return undefined
  if (actor.role === "AGENT") return actor.agentId ? { equals: actor.agentId } : { equals: "__no_agent__" }
  return { in: [...actor.scopedAgentIds] }
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const { actor, timezone, today } = await actorContext(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const params = new URL(req.url).searchParams
  const subjectType = params.get("subjectType")
  const subjectId = params.get("subjectId")
  const requestedAgentId = params.get("agentId")
  const activeOnly = params.get("active") !== "0"
  const allowedAgent = visibleAgentFilter(actor)
  if (requestedAgentId && allowedAgent && actor.role === "AGENT" && requestedAgentId !== actor.agentId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (requestedAgentId && actor.role !== "ADMIN" && !isAgentInRouteScope(actor, requestedAgentId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const agentId = requestedAgentId ? { equals: requestedAgentId } : allowedAgent
  const activeWhere = activeOnly
    ? { effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: today } }] }
    : {}
  const base = {
    organizationId: auth.orgId,
    deletedAt: null,
    ...(agentId ? { agentId } : {}),
    ...activeWhere,
  }

  const [organizationAssignments, contactAssignments] = await Promise.all([
    subjectType === "CONTACT"
      ? Promise.resolve([])
      : prisma.mtmCustomerAgentAssignment.findMany({
          where: { ...base, ...(subjectId ? { customerId: subjectId } : {}) },
          include: {
            customer: { select: { id: true, code: true, name: true, objectType: true, category: true, status: true } },
            agent: { select: { id: true, name: true, role: true, status: true } },
          },
          orderBy: [{ effectiveTo: "asc" }, { effectiveFrom: "desc" }],
          take: 1000,
        }),
    subjectType === "ORGANIZATION"
      ? Promise.resolve([])
      : prisma.mtmContactAgentAssignment.findMany({
          where: { ...base, ...(subjectId ? { contactId: subjectId } : {}) },
          include: {
            contact: { select: { id: true, displayName: true, type: true, specialtyName: true, category: true, status: true } },
            agent: { select: { id: true, name: true, role: true, status: true } },
          },
          orderBy: [{ effectiveTo: "asc" }, { effectiveFrom: "desc" }],
          take: 1000,
        }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      organizationAssignments,
      contactAssignments,
      asOf: today.toISOString().slice(0, 10),
      timezone,
      capabilities: { canManage: canManageFieldMasterData(actor) },
    },
  })
})

export const PUT = withRouteFieldRlsAuth("write", async (req, auth) => {
  const { actor, todayKey } = await actorContext(auth)
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = parseBody(FieldAssignmentUpsertSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (!isAgentInRouteScope(actor, body.agentId)) {
    return NextResponse.json({ error: "Agent is outside your scope", code: "MTM_ASSIGNMENT_SCOPE_DENIED" }, { status: 403 })
  }
  const effectiveFromKey = body.effectiveFrom ?? todayKey
  const effectiveFrom = utcDate(effectiveFromKey)
  const effectiveTo = body.effectiveTo ? utcDate(body.effectiveTo) : null
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    return NextResponse.json({
      error: "Assignment end must be later than its start",
      code: "MTM_ASSIGNMENT_DATE_INVALID",
    }, { status: 400 })
  }
  const overlapWindow = {
    ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
  }
  const [agent, subject] = await Promise.all([
    prisma.mtmAgent.findFirst({
      where: { id: body.agentId, organizationId: auth.orgId, status: "ACTIVE" },
      select: { id: true, name: true },
    }),
    body.subjectType === "ORGANIZATION"
      ? prisma.mtmCustomer.findFirst({
          where: {
            id: body.subjectId,
            organizationId: auth.orgId,
            deletedAt: null,
            ...(actor.role === "ADMIN" ? {} : {
              AND: [{
                OR: [
                  customerScopeForActor(actor, effectiveFrom),
                  { agentAssignments: { none: activeFieldAssignmentWindow(effectiveFrom) } },
                ],
              }],
            }),
          },
          select: { id: true, name: true },
        })
      : prisma.mtmContact.findFirst({
          where: {
            id: body.subjectId,
            organizationId: auth.orgId,
            deletedAt: null,
            ...(actor.role === "ADMIN" ? {} : {
              AND: [{
                OR: [
                  contactScopeForActor(actor, effectiveFrom),
                  { agentAssignments: { none: activeFieldAssignmentWindow(effectiveFrom) } },
                ],
              }],
            }),
          },
          select: { id: true, displayName: true },
        }),
  ])
  if (!agent || !subject) {
    return NextResponse.json({ error: "Assignment reference is invalid", code: "MTM_ASSIGNMENT_REFERENCE_INVALID" }, { status: 400 })
  }

  try {
    const assignment = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (body.subjectType === "ORGANIZATION") {
        if (body.requireUnassigned) {
          const activeAssignment = await tx.mtmCustomerAgentAssignment.findFirst({
            where: {
              organizationId: auth.orgId,
              customerId: body.subjectId,
              ...activeFieldAssignmentWindow(effectiveFrom),
            },
            select: { id: true },
          })
          if (activeAssignment) throw new Error("ASSIGNMENT_NOT_UNASSIGNED")
        }
        const existing = await tx.mtmCustomerAgentAssignment.findFirst({
          where: {
            organizationId: auth.orgId,
            customerId: body.subjectId,
            agentId: body.agentId,
            deletedAt: null,
            ...overlapWindow,
          },
          orderBy: { effectiveFrom: "desc" },
        })
        if (existing?.effectiveTo) throw new Error("ASSIGNMENT_OVERLAP")
        if (existing && existing.effectiveFrom > effectiveFrom) throw new Error("FUTURE_PRIMARY_CONFLICT")
        if ((body.role ?? "PRIMARY") === "PRIMARY") {
          const currentPrimary = await tx.mtmCustomerAgentAssignment.findFirst({
            where: {
              organizationId: auth.orgId,
              customerId: body.subjectId,
              role: "PRIMARY",
              deletedAt: null,
              ...(existing ? { id: { not: existing.id } } : {}),
              ...overlapWindow,
            },
            orderBy: { effectiveFrom: "desc" },
          })
          if (currentPrimary?.effectiveTo) throw new Error("ASSIGNMENT_OVERLAP")
          if (currentPrimary && currentPrimary.effectiveFrom > effectiveFrom) {
            throw new Error("FUTURE_PRIMARY_CONFLICT")
          }
          if (currentPrimary) {
            await tx.mtmCustomerAgentAssignment.update({
              where: { id: currentPrimary.id },
              data: { effectiveTo: effectiveFrom, reason: body.reason ?? currentPrimary.reason },
            })
          }
        }
        return existing
          ? tx.mtmCustomerAgentAssignment.update({
              where: { id: existing.id },
              data: {
                role: body.role ?? existing.role,
                effectiveFrom,
                effectiveTo,
                assignedBy: auth.userId || null,
                reason: body.reason ?? null,
              },
            })
          : tx.mtmCustomerAgentAssignment.create({
              data: {
                organizationId: auth.orgId,
                customerId: body.subjectId,
                agentId: body.agentId,
                role: body.role ?? "PRIMARY",
                effectiveFrom,
                effectiveTo,
                source: "ADMIN",
                assignedBy: auth.userId || null,
                reason: body.reason ?? null,
              },
            })
      }

      const existing = await tx.mtmContactAgentAssignment.findFirst({
        where: {
          organizationId: auth.orgId,
          contactId: body.subjectId,
          agentId: body.agentId,
          deletedAt: null,
          ...overlapWindow,
        },
        orderBy: { effectiveFrom: "desc" },
      })
      if (existing?.effectiveTo) throw new Error("ASSIGNMENT_OVERLAP")
      if (existing && existing.effectiveFrom > effectiveFrom) throw new Error("FUTURE_PRIMARY_CONFLICT")
      if ((body.role ?? "PRIMARY") === "PRIMARY") {
        const currentPrimary = await tx.mtmContactAgentAssignment.findFirst({
          where: {
            organizationId: auth.orgId,
            contactId: body.subjectId,
            role: "PRIMARY",
            deletedAt: null,
            ...(existing ? { id: { not: existing.id } } : {}),
            ...overlapWindow,
          },
          orderBy: { effectiveFrom: "desc" },
        })
        if (currentPrimary?.effectiveTo) throw new Error("ASSIGNMENT_OVERLAP")
        if (currentPrimary && currentPrimary.effectiveFrom > effectiveFrom) {
          throw new Error("FUTURE_PRIMARY_CONFLICT")
        }
        if (currentPrimary) {
          await tx.mtmContactAgentAssignment.update({
            where: { id: currentPrimary.id },
            data: { effectiveTo: effectiveFrom, reason: body.reason ?? currentPrimary.reason },
          })
        }
      }
      return existing
        ? tx.mtmContactAgentAssignment.update({
            where: { id: existing.id },
            data: {
              role: body.role ?? existing.role,
              effectiveFrom,
              effectiveTo,
              assignedBy: auth.userId || null,
              reason: body.reason ?? null,
            },
          })
        : tx.mtmContactAgentAssignment.create({
            data: {
              organizationId: auth.orgId,
              contactId: body.subjectId,
              agentId: body.agentId,
              role: body.role ?? "PRIMARY",
              effectiveFrom,
              effectiveTo,
              source: "ADMIN",
              assignedBy: auth.userId || null,
              reason: body.reason ?? null,
            },
          })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: "FIELD_ASSIGNMENT_UPSERT",
      entity: body.subjectType === "ORGANIZATION" ? "customer_assignment" : "contact_assignment",
      entityId: assignment.id,
      metadataKind: "field_assignment",
      newData: assignment,
      req,
    }).catch((error) => console.warn("[MTM/field-assignments PUT] audit failed", error))

    return NextResponse.json({ success: true, data: assignment })
  } catch (error) {
    if (error instanceof Error && error.message === "ASSIGNMENT_NOT_UNASSIGNED") {
      return NextResponse.json({
        error: "The organization is already assigned on the selected date",
        code: "MTM_ASSIGNMENT_NOT_UNASSIGNED",
      }, { status: 409 })
    }
    if (error instanceof Error && error.message === "ASSIGNMENT_OVERLAP") {
      return NextResponse.json({
        error: "The assignment period overlaps an existing assignment",
        code: "MTM_ASSIGNMENT_PERIOD_OVERLAP",
      }, { status: 409 })
    }
    if (error instanceof Error && error.message === "FUTURE_PRIMARY_CONFLICT") {
      return NextResponse.json({
        error: "A later primary assignment already exists",
        code: "MTM_ASSIGNMENT_FUTURE_PRIMARY_CONFLICT",
      }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return NextResponse.json({ error: "An overlapping active assignment already exists", code: "MTM_ASSIGNMENT_CONFLICT" }, { status: 409 })
    }
    throw error
  }
})
