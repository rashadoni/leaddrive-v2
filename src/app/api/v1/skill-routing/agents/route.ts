import { NextResponse } from "next/server"
import { z } from "zod"

import { checkPermission } from "@/lib/permissions"
import { logAudit, prisma } from "@/lib/prisma"
import {
  ROUTABLE_AGENT_ROLES,
  applyBulkSkillChange,
  canManageSkillRouting,
  normalizeRoutingSkills,
} from "@/lib/skill-routing/presentation"
import { withRlsSessionAuth } from "@/lib/with-rls"

const ROUTING_VIEW_HEADER = "x-skill-routing-view"

const bulkUpdateSchema = z.object({
  agentIds: z.array(z.string().min(1)).min(1).max(100),
  skills: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  mode: z.enum(["add", "remove"]),
}).strict()

async function listRoutingAgents(orgId: string) {
  return prisma.user.findMany({
    where: {
      organizationId: orgId,
      role: { in: [...ROUTABLE_AGENT_ROLES] },
    },
    select: {
      id: true,
      name: true,
      role: true,
      skills: true,
      isAvailable: true,
      isActive: true,
    },
    orderBy: { name: "asc" },
  })
}

async function listTicketAssignees(orgId: string) {
  return prisma.user.findMany({
    where: {
      organizationId: orgId,
      role: { in: [...ROUTABLE_AGENT_ROLES] },
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
    orderBy: { name: "asc" },
  })
}

export const GET = withRlsSessionAuth(async (req, auth) => {
  const routingView = req.headers.get(ROUTING_VIEW_HEADER) === "routing"
  if (!checkPermission(auth.role, "tickets", "read")) {
    return NextResponse.json(
      {
        error: "Forbidden",
        code: routingView ? "ROUTING_READ_FORBIDDEN" : "TICKET_ASSIGNEES_READ_FORBIDDEN",
      },
      { status: 403 },
    )
  }

  try {
    if (!routingView) {
      return NextResponse.json({ success: true, data: await listTicketAssignees(auth.orgId) })
    }
    return NextResponse.json({
      success: true,
      data: await listRoutingAgents(auth.orgId),
      permissions: { canWrite: canManageSkillRouting(auth.role) },
    })
  } catch (error) {
    console.error(routingView ? "[skill routing agents] GET error:" : "[ticket assignees] GET error:", error)
    return NextResponse.json(
      {
        error: routingView ? "Failed to load routing agents." : "Failed to load ticket assignees.",
        code: routingView ? "ROUTING_AGENTS_LOAD_FAILED" : "TICKET_ASSIGNEES_LOAD_FAILED",
      },
      { status: 500 },
    )
  }
})

export const PATCH = withRlsSessionAuth(async (req, auth) => {
  if (!checkPermission(auth.role, "tickets", "write") || !canManageSkillRouting(auth.role)) {
    return NextResponse.json({ error: "Forbidden", code: "ROUTING_WRITE_FORBIDDEN" }, { status: 403 })
  }

  const parsed = bulkUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request.", code: "ROUTING_BULK_INVALID" }, { status: 400 })
  }

  const uniqueIds = Array.from(new Set(parsed.data.agentIds))
  const selectedSkills = normalizeRoutingSkills(parsed.data.skills)
  try {
    const agents = await prisma.user.findMany({
      where: {
        organizationId: auth.orgId,
        id: { in: uniqueIds },
        role: { in: [...ROUTABLE_AGENT_ROLES] },
      },
      select: { id: true, name: true, skills: true },
    })
    if (agents.length !== uniqueIds.length) {
      return NextResponse.json({ error: "One or more agents were not found.", code: "ROUTING_AGENT_NOT_FOUND" }, { status: 404 })
    }

    const changes = agents.map((agent) => ({
      ...agent,
      nextSkills: applyBulkSkillChange(agent.skills, selectedSkills, parsed.data.mode),
    }))
    await prisma.$transaction(changes.map((agent) => prisma.user.update({
      where: { id: agent.id },
      data: { skills: agent.nextSkills },
    })))
    await Promise.all(changes.map((agent) => logAudit(
      auth.orgId,
      "routing_skills_updated",
      "user",
      agent.id,
      agent.name,
      {
        userId: auth.userId,
        oldValue: { skills: agent.skills },
        newValue: { skills: agent.nextSkills, mode: parsed.data.mode },
      },
    )))

    return NextResponse.json({ success: true, data: await listRoutingAgents(auth.orgId) })
  } catch (error) {
    console.error("[skill routing agents] PATCH error:", error)
    return NextResponse.json({ error: "Failed to update routing skills.", code: "ROUTING_BULK_FAILED" }, { status: 500 })
  }
})
