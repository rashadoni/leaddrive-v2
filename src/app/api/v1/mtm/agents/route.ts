import { MtmAgentRole, MtmAgentStatus, Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMobileAuth } from "@/lib/mobile-auth"
import { withRls } from "@/lib/with-rls"
import bcrypt from "bcryptjs"
import { AgentCreateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { resolveAgentScope, isValidMtmAgentRole } from "@/lib/mtm/territory-scope"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mtmAgentPresence } from "@/lib/mtm/agent-day-state"
import { mtmWorkdayPauses, serializeMtmWorkdayPauses } from "@/lib/mtm/workday-pauses"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import type { RlsAuth } from "@/lib/with-rls"
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
  // Agent credentials and authorization links are privileged web operations.
  // Mobile JWTs and API keys reach withRls without a browser session and fail.
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

export const GET = withRls(async (req, auth) => {
  const { orgId, session } = auth
  if (session && !checkPermission(session.role, "mtm", "read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") || ""
  const role = searchParams.get("role") || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const where: Prisma.MtmAgentWhereInput = { organizationId: orgId }
    if (Object.values(MtmAgentStatus).includes(status as MtmAgentStatus)) where.status = status as MtmAgentStatus
    if (Object.values(MtmAgentRole).includes(role as MtmAgentRole)) where.role = role as MtmAgentRole

    // M4-5: territory-scope enforcement for mobile callers.
    // Web admin panel (cookie auth, no mobile JWT) sees all agents in the org.
    // Mobile callers (MANAGER/SUPERVISOR) are scoped to their team/region.
    // AGENT callers see only themselves.
    const mobileAuth = getMobileAuth(req)
    if (mobileAuth?.agentId) {
      const callerAgent = await prisma.mtmAgent.findFirst({
        where: { id: mobileAuth.agentId, organizationId: orgId },
        select: { id: true, role: true },
      })
      if (callerAgent) {
        const role = isValidMtmAgentRole(callerAgent.role)
          ? callerAgent.role
          // Unrecognised DB role → fail-safe: restrict to self-only (AGENT semantics).
          // Widening to org-wide on a malformed role claim would invert least-privilege.
          : "AGENT"

        const scope = await resolveAgentScope(prisma, {
          agentId: callerAgent.id,
          organizationId: orgId,
          role,
        })
        // null = ADMIN → no extra filter; string[] → restrict to those agents
        if (scope.agentIds !== null) {
          where.id = { in: scope.agentIds }
        }
      } else {
        // The mobile principal disappeared between the wrapper's revocation
        // check and this query. Do not widen that race to organization-wide.
        where.id = { in: [] }
      }
    }

    const [agents, total] = await Promise.all([
      prisma.mtmAgent.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: "asc" },
        select: AGENT_RESPONSE_SELECT,
      }),
      prisma.mtmAgent.count({ where }),
    ])

    // A break stops GPS by design (A7), so the list's «last seen» dot fades on
    // someone who is simply at lunch. One query for the page's agents — not per
    // row — puts the workday's own state next to them.
    // Presence is an enrichment, not the point of this endpoint: if settings or
    // the workday query fail, the manager still needs the list of people. A
    // missing row already means "not started", so degrading costs one label,
    // while a 500 costs the whole screen.
    const breaksByAgent = new Map<string, Array<{ from: string; to: string | null }>>()
    const dayByAgent = new Map<string, { id: string; status: "STARTED" | "PAUSED" | "COMPLETED"; startedAt: Date; pausedAt: Date | null; completedAt: Date | null }>()
    if (agents.length) {
      try {
        const settings = await getMtmSettings(orgId)
        const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
        const workDate = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)
        const days = await prisma.mtmAgentWorkday.findMany({
          where: { organizationId: orgId, workDate, agentId: { in: agents.map((agent) => agent.id) } },
          select: { id: true, agentId: true, status: true, startedAt: true, pausedAt: true, completedAt: true },
        })
        for (const day of days) dayByAgent.set(day.agentId, day)

        // The segments themselves (A7 tail): "on a break" answers what, "two
        // breaks, 45 minutes" answers how the day actually went. The server
        // already reconstructs them for the phone's GPS history; the web had
        // no way to ask. One query for the page's workdays, not per row.
        if (days.length) {
          const events = await prisma.mtmAgentWorkdayEvent.findMany({
            where: {
              organizationId: orgId,
              workdayId: { in: days.map((day) => day.id) },
              type: { in: ["PAUSE", "RESUME", "FINISH"] },
            },
            orderBy: { occurredAt: "asc" },
            select: { workdayId: true, type: true, occurredAt: true },
          })
          const byWorkday = new Map<string, Array<{ type: string; occurredAt: Date }>>()
          for (const event of events) {
            const list = byWorkday.get(event.workdayId) ?? []
            list.push({ type: event.type, occurredAt: event.occurredAt })
            byWorkday.set(event.workdayId, list)
          }
          for (const day of days) {
            breaksByAgent.set(day.agentId, serializeMtmWorkdayPauses(mtmWorkdayPauses(byWorkday.get(day.id) ?? [])))
          }
        }
      } catch (presenceError) {
        console.error("[MTM/agents GET] presence unavailable", presenceError)
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        agents: agents.map((agent) => ({
          ...agent,
          presence: mtmAgentPresence(dayByAgent.get(agent.id)),
          breaks: breaksByAgent.get(agent.id) ?? [],
        })),
        total,
        page,
        limit,
      },
    })
  } catch (e) {
    console.error("[MTM/agents GET]", e)
    return NextResponse.json({ error: "Failed to load agents" }, { status: 500 })
  }
})

export const POST = withRls(async (req, auth) => {
  const { orgId } = auth
  try {
    if (!await canManageAgents(auth)) return agentAdministrationDenied()

    const raw = await req.json()
    const parsed = parseBody(AgentCreateSchema, raw)
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

    // Hash password if provided (for mobile app login)
    let passwordHash: string | null = null
    if (body.password) {
      const passwordError = passwordPolicyError(body.password)
      if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })
      passwordHash = await bcrypt.hash(body.password, 12)
    }

    const agent = await prisma.mtmAgent.create({
      data: {
        organizationId: orgId,
        name: body.name,
        externalCode: body.externalCode ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        passwordHash,
        role: body.role ?? "AGENT",
        canPlanOwnRoutes: body.canPlanOwnRoutes ?? true,
        canSelfPublishRoutes: body.canSelfPublishRoutes ?? false,
        managerId: body.managerId ?? null,
        userId: body.userId ?? null,
      },
      select: AGENT_RESPONSE_SELECT,
    })

    await writeMtmAudit({
      organizationId: orgId,
      agentId: agent.id,
      action: "AGENT_CREATE",
      entity: "agent",
      entityId: agent.id,
      metadataKind: "agent_create",
      newData: {
        name: agent.name,
        email: agent.email,
        role: agent.role,
        canPlanOwnRoutes: agent.canPlanOwnRoutes,
        canSelfPublishRoutes: agent.canSelfPublishRoutes,
      },
      req,
    }).catch((e) => console.warn("[MTM/agents POST] audit failed", e))

    return NextResponse.json({ success: true, data: agent }, { status: 201 })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to create agent" }, { status: 400 })
  }
})
