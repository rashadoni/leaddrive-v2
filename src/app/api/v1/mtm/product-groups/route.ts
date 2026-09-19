import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { expandVisibleProductGroupIds } from "@/lib/mtm/product-group-access"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

const CreateGroupSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).nullish(),
  parentId: z.string().trim().min(1).max(128).nullish(),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
}).strict()

async function actorAndVisibleGroups(auth: {
  orgId: string
  userId: string
  role: string
  agentId?: string | null
}) {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return null

  const groups = await prisma.mtmProductGroup.findMany({
    where: { organizationId: auth.orgId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      parentId: true,
      name: true,
      description: true,
      sortOrder: true,
      isActive: true,
      members: {
        select: {
          id: true,
          agentId: true,
          role: true,
          agent: { select: { id: true, name: true, role: true, status: true } },
        },
      },
      products: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, isActive: true, documentId: true },
      },
    },
  })

  const unrestricted = actor.role === "ADMIN"
  const visibleIds = unrestricted
    ? new Set(groups.map((group) => group.id))
    : expandVisibleProductGroupIds(groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      hasDirectMembership: group.members.some((member) => member.agentId === actor.agentId),
    })))
  const managedIds = unrestricted
    ? visibleIds
    : expandVisibleProductGroupIds(groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      hasDirectMembership: group.members.some(
        (member) => member.agentId === actor.agentId && member.role === "MANAGER",
      ),
    })))

  return { actor, groups, visibleIds, managedIds }
}

export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  const access = await actorAndVisibleGroups(auth)
  if (!access) {
    return NextResponse.json({ error: "MTM access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }

  return NextResponse.json({
    success: true,
    data: {
      groups: access.groups
        .filter((group) => access.visibleIds.has(group.id))
        .map((group) => ({ ...group, canManage: access.managedIds.has(group.id) })),
    },
  })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const parsed = CreateGroupSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid product group", details: parsed.error.flatten() }, { status: 400 })
  }

  const access = await actorAndVisibleGroups(auth)
  if (!access || !["ADMIN", "MANAGER", "SUPERVISOR"].includes(access.actor.role)) {
    return NextResponse.json({ error: "Manager access required", code: "MTM_PRODUCT_GROUP_FORBIDDEN" }, { status: 403 })
  }
  if (
    parsed.data.parentId &&
    access.actor.role !== "ADMIN" &&
    !access.managedIds.has(parsed.data.parentId)
  ) {
    return NextResponse.json({ error: "Parent group is outside your scope", code: "MTM_PRODUCT_GROUP_FORBIDDEN" }, { status: 403 })
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const group = await tx.mtmProductGroup.create({
        data: {
          organizationId: auth.orgId,
          parentId: parsed.data.parentId ?? null,
          name: parsed.data.name,
          description: parsed.data.description || null,
          sortOrder: parsed.data.sortOrder,
        },
      })
      if (access.actor.role !== "ADMIN" && access.actor.agentId) {
        await tx.mtmProductGroupMember.create({
          data: {
            organizationId: auth.orgId,
            groupId: group.id,
            agentId: access.actor.agentId,
            role: "MANAGER",
            assignedBy: auth.userId,
          },
        })
      }
      return group
    })
    return NextResponse.json({ success: true, data: created }, { status: 201 })
  } catch (error) {
    console.error("[MTM/product-groups POST]", error)
    return NextResponse.json({ error: "Failed to create product group", code: "MTM_PRODUCT_GROUP_CREATE_FAILED" }, { status: 500 })
  }
})
