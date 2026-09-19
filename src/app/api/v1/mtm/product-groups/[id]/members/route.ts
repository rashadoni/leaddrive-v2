import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { expandVisibleProductGroupIds } from "@/lib/mtm/product-group-access"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

const ReplaceMembersSchema = z.object({
  members: z.array(z.object({
    agentId: z.string().trim().min(1).max(128),
    role: z.enum(["MANAGER", "AGENT"]),
  }).strict()).max(1_000),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>()
  value.members.forEach((member, index) => {
    if (seen.has(member.agentId)) {
      context.addIssue({ code: "custom", path: ["members", index, "agentId"], message: "Duplicate agent" })
    }
    seen.add(member.agentId)
  })
})

export const PUT = withRouteFieldRlsAuth("write", async (
  req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const parsed = ReplaceMembersSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid group members", details: parsed.error.flatten() }, { status: 400 })
  }
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !["ADMIN", "MANAGER", "SUPERVISOR"].includes(actor.role)) {
    return NextResponse.json({ error: "Manager access required", code: "MTM_PRODUCT_GROUP_FORBIDDEN" }, { status: 403 })
  }

  const groups = await prisma.mtmProductGroup.findMany({
    where: { organizationId: auth.orgId },
    select: {
      id: true,
      parentId: true,
      members: {
        where: { agentId: actor.agentId ?? "__no_agent__", role: "MANAGER" },
        select: { id: true },
      },
    },
  })
  const groupExists = groups.some((group) => group.id === id)
  if (!groupExists) {
    return NextResponse.json({ error: "Product group not found", code: "MTM_PRODUCT_GROUP_NOT_FOUND" }, { status: 404 })
  }

  const managedIds = actor.role === "ADMIN"
    ? new Set(groups.map((group) => group.id))
    : expandVisibleProductGroupIds(groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      hasDirectMembership: group.members.length > 0,
    })))
  if (!managedIds.has(id)) {
    return NextResponse.json({ error: "Group is outside your scope", code: "MTM_PRODUCT_GROUP_FORBIDDEN" }, { status: 403 })
  }
  if (
    actor.role !== "ADMIN" &&
    actor.agentId &&
    !parsed.data.members.some((member) => member.agentId === actor.agentId && member.role === "MANAGER")
  ) {
    return NextResponse.json({
      error: "A manager cannot remove their own management access",
      code: "MTM_PRODUCT_GROUP_SELF_REMOVAL",
    }, { status: 422 })
  }

  const agents = await prisma.mtmAgent.findMany({
    where: {
      organizationId: auth.orgId,
      id: { in: parsed.data.members.map((member) => member.agentId) },
      status: "ACTIVE",
    },
    select: { id: true, role: true },
  })
  if (agents.length !== parsed.data.members.length) {
    return NextResponse.json({ error: "One or more agents are invalid", code: "MTM_PRODUCT_GROUP_AGENT_INVALID" }, { status: 422 })
  }
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const invalidManager = parsed.data.members.find(
    (member) => member.role === "MANAGER" && agentById.get(member.agentId)?.role === "AGENT",
  )
  if (invalidManager) {
    return NextResponse.json({
      error: "An agent cannot be assigned as a product group manager",
      code: "MTM_PRODUCT_GROUP_MANAGER_INVALID",
    }, { status: 422 })
  }

  try {
    const members = await prisma.$transaction(async (tx) => {
      await tx.mtmProductGroupMember.deleteMany({
        where: { organizationId: auth.orgId, groupId: id },
      })
      if (parsed.data.members.length > 0) {
        await tx.mtmProductGroupMember.createMany({
          data: parsed.data.members.map((member) => ({
            organizationId: auth.orgId,
            groupId: id,
            agentId: member.agentId,
            role: member.role,
            assignedBy: auth.userId,
          })),
        })
      }
      return tx.mtmProductGroupMember.findMany({
        where: { organizationId: auth.orgId, groupId: id },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        include: { agent: { select: { id: true, name: true, role: true } } },
      })
    })
    return NextResponse.json({ success: true, data: { members } })
  } catch (error) {
    console.error("[MTM/product-groups/[id]/members PUT]", error)
    return NextResponse.json({ error: "Failed to update group members", code: "MTM_PRODUCT_GROUP_MEMBERS_FAILED" }, { status: 500 })
  }
})
