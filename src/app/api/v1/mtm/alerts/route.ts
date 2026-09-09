import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

export const GET = withRouteFieldRlsAuth("read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const resolved = searchParams.get("resolved")
  const type = searchParams.get("type") || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const where: any = { organizationId: orgId }
    if (resolved !== null && resolved !== "") where.isResolved = resolved === "true"
    if (type) where.type = type

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
