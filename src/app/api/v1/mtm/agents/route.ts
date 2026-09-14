import { MtmAgentRole, MtmAgentStatus, Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMobileAuth } from "@/lib/mobile-auth"
import { withRls } from "@/lib/with-rls"
import bcrypt from "bcryptjs"
import { AgentCreateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { resolveAgentScope, isValidMtmAgentRole } from "@/lib/mtm/territory-scope"
import { mtmFieldScopeRequiredResponse, resolveMtmFieldScope } from "@/lib/mtm/field-access"
import {
  MTM_SCOPED_MANAGEABLE_AGENT_ROLES,
  mtmScopedAgentLinkForbidden,
  mtmScopedAgentRoleForbidden,
  mtmScopedAgentTerritoryForbidden,
  resolveMtmAgentAdministration,
} from "@/lib/mtm/agent-administration"
import { mtmAgentPresence, type MtmAgentPresence } from "@/lib/mtm/agent-day-state"
import { mtmWorkdayPauses, serializeMtmWorkdayPauses } from "@/lib/mtm/workday-pauses"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import type { RlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { passwordPolicyError } from "@/lib/password-policy"
import {
  mtmAgentActivityWindowStart,
  mtmAgentAppActivity,
  mtmAgentCardActivity,
} from "@/lib/mtm/agent-card-activity"

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

/**
 * Момент ухода на перерыв и момент закрытия дня — это данные о персонале.
 *
 * Те же колонки через штатный эндпоинт «Персонал/сегодня» роль без права
 * `workforce` не получает вовсе (403), а при выключенном платном модуле
 * `workforce-hrm` остальные экраны рабочий день прячут. Здесь они уезжали мимо
 * обеих проверок: у списка агентов был единственный гейт — чтение MTM.
 *
 * Грубое состояние (работает / на перерыве / день закрыт) остаётся всем, у
 * кого есть доступ к MTM: ради него A7 и делался — человек на обеде не должен
 * выглядеть пропавшим. Уходят только моменты времени и разбивка перерывов.
 */
async function mayReadWorkdayTimes(auth: RlsAuth): Promise<boolean> {
  const { orgId, session } = auth
  // Мобильные токены и ключи интеграций приходят без сессии. Права «Персонала»
  // у них нет, а значит нет и времён — по всей их территории разом.
  if (!session) return false
  if (!checkPermission(session.role, "workforce", "read")) return false
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { plan: true, addons: true, features: true, modules: true },
    })
    return !!organization && isTenantCapabilityEnabled("workforce-hrm", organization)
  } catch (error) {
    // Fail closed: не смогли подтвердить возможность — времена не отдаём.
    console.error("[MTM/agents GET] workforce capability lookup failed", error)
    return false
  }
}

/** То же состояние, но без моментов времени. */
function withoutTimes(presence: MtmAgentPresence): MtmAgentPresence {
  switch (presence.kind) {
    case "working": return { kind: "working", since: null }
    case "paused": return { kind: "paused", since: null }
    case "finished": return { kind: "finished", at: null }
    default: return presence
  }
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
    } else if (session) {
      // Web users see the cards of their field scope. Before, every web user
      // with MTM read saw every employee's phone, email, team and manager.
      const scope = await resolveMtmFieldScope(prisma, {
        organizationId: orgId,
        userId: session.userId,
        webRole: session.role,
      })
      if (scope.kind === "none") return mtmFieldScopeRequiredResponse()
      if (scope.kind === "agents") where.id = { in: scope.agentIds }
    }

    const [agents, total] = await Promise.all([
      prisma.mtmAgent.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: "asc" },
        select: {
          ...AGENT_RESPONSE_SELECT,
          // Read only to answer two yes/no questions below; the token itself
          // and the coordinates never leave this handler.
          expoPushToken: true,
          latestLocation: { select: { receivedAt: true } },
        },
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

    // Card figures (visits and plan fulfilment over the analytics "weekly"
    // window). Like presence, an enrichment: a failure costs the figure, not
    // the list of people.
    const activityByAgent = new Map<string, { visits: number; plannedPoints: number; visitedPoints: number }>()
    let activityAvailable = false
    if (agents.length) {
      try {
        const agentIds = agents.map((agent) => agent.id)
        const since = mtmAgentActivityWindowStart(new Date())
        const [visitRows, routeRows] = await Promise.all([
          prisma.mtmVisit.groupBy({
            by: ["agentId"],
            where: { organizationId: orgId, agentId: { in: agentIds }, createdAt: { gte: since }, deletedAt: null },
            _count: { _all: true },
          }),
          prisma.mtmRoute.groupBy({
            by: ["agentId"],
            where: { organizationId: orgId, agentId: { in: agentIds }, date: { gte: since }, deletedAt: null, totalPoints: { gt: 0 } },
            _sum: { totalPoints: true, visitedPoints: true },
          }),
        ])
        for (const row of visitRows as Array<{ agentId: string; _count?: { _all?: number } }>) {
          const current = activityByAgent.get(row.agentId) ?? { visits: 0, plannedPoints: 0, visitedPoints: 0 }
          current.visits = row._count?._all ?? 0
          activityByAgent.set(row.agentId, current)
        }
        for (const row of routeRows as Array<{ agentId: string; _sum?: { totalPoints?: number | null; visitedPoints?: number | null } }>) {
          const current = activityByAgent.get(row.agentId) ?? { visits: 0, plannedPoints: 0, visitedPoints: 0 }
          current.plannedPoints = row._sum?.totalPoints ?? 0
          current.visitedPoints = row._sum?.visitedPoints ?? 0
          activityByAgent.set(row.agentId, current)
        }
        activityAvailable = true
      } catch (activityError) {
        console.error("[MTM/agents GET] activity unavailable", activityError)
      }
    }

    const showTimes = await mayReadWorkdayTimes(auth)
    const now = new Date()

    return NextResponse.json({
      success: true,
      data: {
        agents: agents.map((row) => {
          const { expoPushToken, latestLocation, ...agent } = row
          const presence = mtmAgentPresence(dayByAgent.get(agent.id))
          return {
            ...agent,
            presence: showTimes ? presence : withoutTimes(presence),
            breaks: showTimes ? (breaksByAgent.get(agent.id) ?? []) : [],
            activity: activityAvailable ? mtmAgentCardActivity(activityByAgent.get(agent.id) ?? {}) : null,
            app: mtmAgentAppActivity({
              lastLocationAt: latestLocation?.receivedAt ?? null,
              lastSeenAt: agent.lastSeenAt ?? null,
              hasPushToken: Boolean(expoPushToken),
              now,
            }),
          }
        }),
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
    const administration = await resolveMtmAgentAdministration(prisma, auth)
    if (administration.kind === "denied") return administration.response

    const raw = await req.json()
    const parsed = parseBody(AgentCreateSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    if (administration.kind === "scoped") {
      // A manager hires into their own team line: field roles only, no web
      // login link, and a manager inside their scope (themselves by default)
      // so the new card is visible to them the moment it exists.
      if (!MTM_SCOPED_MANAGEABLE_AGENT_ROLES.includes(body.role ?? "AGENT")) return mtmScopedAgentRoleForbidden()
      // A supervisor's scope is their team. A new card has no team yet, so it
      // cannot be shown to sit in the manager's territory — administrator work.
      if (body.role === "SUPERVISOR") return mtmScopedAgentTerritoryForbidden()
      if (body.userId) return mtmScopedAgentLinkForbidden()
      if (body.managerId && !administration.agentIds.includes(body.managerId)) {
        return NextResponse.json({ error: "Manager is outside your field scope", code: "MTM_AGENT_OUT_OF_SCOPE" }, { status: 403 })
      }
      body.managerId = body.managerId ?? administration.actor.agentId
    }

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
