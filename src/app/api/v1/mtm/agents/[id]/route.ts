import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, type RlsAuth } from "@/lib/with-rls"
import { getMobileAuth } from "@/lib/mobile-auth"
import bcrypt from "bcryptjs"
import { AgentUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { resolveAgentScope, isValidMtmAgentRole } from "@/lib/mtm/territory-scope"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { checkPermission } from "@/lib/permissions"
import { passwordPolicyError } from "@/lib/password-policy"

const AGENT_RESPONSE_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  name: true,
  email: true,
  phone: true,
  externalCode: true,
  role: true,
  status: true,
  canPlanOwnRoutes: true,
  canSelfPublishRoutes: true,
  avatar: true,
  teamId: true,
  managerId: true,
  isOnline: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
  manager: { select: { id: true, name: true } },
  team: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
} satisfies Prisma.MtmAgentSelect

async function canManageAgents({ orgId, session }: RlsAuth): Promise<boolean> {
  if (!session) return false
  if (checkPermission(session.role, "mtm", "admin")) return true
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: orgId,
    userId: session.userId,
    webRole: session.role,
  })
  return actor?.role === "ADMIN"
}

function agentAdministrationDenied() {
  return NextResponse.json(
    { error: "Web administrator access required", code: "MTM_AGENT_ADMIN_REQUIRED" },
    { status: 403 },
  )
}

function workforceRetentionBlocked() {
  return NextResponse.json({
    error: "This employee has Workforce time history and must be archived instead of permanently deleted.",
    code: "WORKFORCE_RETENTION_BLOCKED",
  }, { status: 409 })
}

async function mobileVisibleAgentIds(req: Parameters<typeof getMobileAuth>[0], orgId: string) {
  const mobileAuth = getMobileAuth(req)
  if (!mobileAuth?.agentId) return null

  const caller = await prisma.mtmAgent.findFirst({
    where: { id: mobileAuth.agentId, organizationId: orgId, status: "ACTIVE" },
    select: { id: true, role: true },
  })
  if (!caller || !isValidMtmAgentRole(caller.role)) return []

  const scope = await resolveAgentScope(prisma, {
    agentId: caller.id,
    organizationId: orgId,
    role: caller.role,
  })
  return scope.agentIds
}

export const GET = withRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, session } = auth
  const { id } = await params

  try {
    if (session && !checkPermission(session.role, "mtm", "read")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const visibleAgentIds = await mobileVisibleAgentIds(req, orgId)
    const agent = await prisma.mtmAgent.findFirst({
      where: {
        id: visibleAgentIds === null ? id : { equals: id, in: [...visibleAgentIds] },
        organizationId: orgId,
      },
      select: AGENT_RESPONSE_SELECT,
    })
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: agent })
  } catch (e) {
    console.error("[MTM/agents/[id] GET]", e)
    return NextResponse.json({ error: "Failed to fetch agent" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id } = await params

  try {
    if (!await canManageAgents(auth)) return agentAdministrationDenied()

    const raw = await req.json()
    const parsed = parseBody(AgentUpdateSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    if (body.userId) {
      const linkedUser = await prisma.user.findFirst({
        where: { id: body.userId, organizationId: orgId, isActive: true },
        select: { id: true },
      })
      if (!linkedUser) {
        return NextResponse.json({ error: "Linked user not found in this organization" }, { status: 400 })
      }
    }
    if (body.managerId) {
      const manager = await prisma.mtmAgent.findFirst({
        where: { id: body.managerId, organizationId: orgId },
        select: { id: true },
      })
      if (!manager) {
        return NextResponse.json({ error: "Manager not found in this organization" }, { status: 400 })
      }
    }

    const before = await prisma.mtmAgent.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        canPlanOwnRoutes: true,
        canSelfPublishRoutes: true,
        managerId: true,
      },
    })
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const data: Prisma.MtmAgentUncheckedUpdateManyInput = {}
    if (body.name !== undefined) data.name = body.name
    if (body.externalCode !== undefined) data.externalCode = body.externalCode ?? null
    if (body.email !== undefined) data.email = body.email ?? null
    if (body.phone !== undefined) data.phone = body.phone ?? null
    if (body.role !== undefined) data.role = body.role
    if (body.status !== undefined) data.status = body.status
    if (body.canPlanOwnRoutes !== undefined) data.canPlanOwnRoutes = body.canPlanOwnRoutes
    if (body.canSelfPublishRoutes !== undefined) data.canSelfPublishRoutes = body.canSelfPublishRoutes
    if (body.managerId !== undefined) data.managerId = body.managerId ?? null
    if (body.userId !== undefined) data.userId = body.userId ?? null
    if (body.password) {
      const passwordError = passwordPolicyError(body.password)
      if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })
      data.passwordHash = await bcrypt.hash(body.password, 12)
    }

    const agent = await prisma.mtmAgent.updateMany({
      where: { id, organizationId: orgId },
      data,
    })
    if (agent.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await writeMtmAudit({
      organizationId: orgId,
      agentId: id,
      action: "AGENT_UPDATE",
      entity: "agent",
      entityId: id,
      metadataKind: "agent_update",
      oldData: before,
      newData: { ...data, passwordHash: data.passwordHash ? "[redacted]" : undefined },
      req,
    }).catch((e) => console.warn("[MTM/agents/[id] PUT] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update" }, { status: 400 })
  }
})

export const DELETE = withRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id } = await params

  try {
    if (!await canManageAgents(auth)) return agentAdministrationDenied()

    const deletion = await prisma.$transaction(async (tx) => {
      // Child HRM/GPS inserts take a KEY SHARE lock on the employee. Keep the
      // parent row locked from the final retention count through deletion so
      // a new retained fact cannot slip into a cascading delete.
      await tx.$executeRaw`
        SELECT 1 FROM "mtm_agents"
        WHERE "id" = ${id} AND "organizationId" = ${orgId}
        FOR UPDATE
      `
      const before = await tx.mtmAgent.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, name: true, email: true, role: true },
      })
      if (!before) return { kind: "not_found" as const }

      // Time history is governed by a separate retention contract. Check it
      // before the FK cascade reaches the database fact guard, so admins
      // receive a clear archive/deactivate action rather than an opaque error.
      const retentionCounts = await Promise.all([
        tx.mtmAgentWorkday.count({ where: { organizationId: orgId, agentId: id } }),
        tx.mtmAgentWorkdayEvent.count({ where: { organizationId: orgId, agentId: id } }),
        tx.mtmAgentLocation.count({ where: { organizationId: orgId, agentId: id } }),
        tx.mtmHrmRequest.count({ where: { organizationId: orgId, agentId: id } }),
        tx.mtmWorkCalendarDay.count({
          where: {
            organizationId: orgId,
            agentId: id,
            source: { in: ["HRM", "WORKFORCE_LEAVE", "WORKFORCE_ABSENCE"] },
          },
        }),
        tx.mtmAuditLog.count({
          where: {
            organizationId: orgId,
            agentId: id,
            OR: [
              { metadataKind: { in: ["workday_transition", "hrm_request_decision", "workforce_time_correction"] } },
              { action: { in: [
                "WORKDAY_START",
                "WORKDAY_PAUSE",
                "WORKDAY_RESUME",
                "WORKDAY_FINISH",
                "HRM_REQUEST_DECISION",
                "WORKFORCE_TIME_CORRECTION_APPLIED",
              ] } },
            ],
          },
        }),
        tx.workforceShiftAssignment.count({ where: { organizationId: orgId, agentId: id } }),
        tx.workforcePolicySnapshot.count({ where: { organizationId: orgId, agentId: id } }),
        tx.workforceShiftSnapshot.count({ where: { organizationId: orgId, agentId: id } }),
        tx.workforceWorkdayScheduleSnapshot.count({ where: { organizationId: orgId, agentId: id } }),
        tx.workforceAttendanceException.count({ where: { organizationId: orgId, agentId: id } }),
        tx.workforceTimeCorrection.count({ where: { organizationId: orgId, agentId: id } }),
        tx.workforceTimesheetApproval.count({ where: { organizationId: orgId, agentId: id } }),
      ])
      if (retentionCounts.some((count) => count > 0)) {
        return { kind: "retention_blocked" as const }
      }

      const deleted = await tx.mtmAgent.deleteMany({
        where: { id, organizationId: orgId },
      })
      if (deleted.count === 0) return { kind: "not_found" as const }
      return { kind: "deleted" as const, before }
    })
    if (deletion.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (deletion.kind === "retention_blocked") return workforceRetentionBlocked()

    await writeMtmAudit({
      organizationId: orgId,
      agentId: id,
      action: "AGENT_DELETE",
      entity: "agent",
      entityId: id,
      metadataKind: "agent_delete",
      oldData: deletion.before,
      req,
    }).catch((e) => console.warn("[MTM/agents/[id] DELETE] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    if (e instanceof Error && /Workforce workday facts cannot be deleted/i.test(e.message)) {
      return workforceRetentionBlocked()
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to delete" }, { status: 400 })
  }
})
