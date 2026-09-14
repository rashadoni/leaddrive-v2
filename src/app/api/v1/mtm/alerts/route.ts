import { NextResponse } from "next/server"
import type { MtmAlertType, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { fieldScopeAgentIdWhere, mtmFieldScopeRequiredResponse, resolveMtmFieldScope } from "@/lib/mtm/field-access"

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const { orgId } = auth
  // Alerts are about people. A manager sees the alerts of their own agents, an
  // agent's token only their own; before, both saw the whole organization.
  const scope = await resolveMtmFieldScope(prisma, {
    organizationId: orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (scope.kind === "none") return mtmFieldScopeRequiredResponse()

  const { searchParams } = new URL(req.url)
  const resolved = searchParams.get("resolved")
  const type = searchParams.get("type") || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const where: Prisma.MtmAlertWhereInput = { organizationId: orgId, ...fieldScopeAgentIdWhere(scope) }
    if (resolved !== null && resolved !== "") where.isResolved = resolved === "true"
    if (type) where.type = type as MtmAlertType

    const [alerts, total] = await Promise.all([
      prisma.mtmAlert.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { agent: { select: { id: true, name: true } } },
      }),
      prisma.mtmAlert.count({ where }),
    ])

    return NextResponse.json({ success: true, data: { alerts, total, page, limit } })
  } catch (e) {
    console.error("[MTM/alerts GET]", e)
    return NextResponse.json({ error: "Failed to load alerts" }, { status: 500 })
  }
})
