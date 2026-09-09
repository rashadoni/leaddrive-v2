import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }) => {
  const groups = await prisma.pricingGroup.findMany({
    where: { organizationId: orgId },
    orderBy: { sortOrder: "asc" },
    include: {
      _count: { select: { profiles: true } },
    },
  })

  return NextResponse.json({ success: true, data: groups })
})

export const POST = withRls(async (req, { orgId }) => {
  try {
    const body = await req.json()
    const { name } = body

    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

    const maxOrder = await prisma.pricingGroup.aggregate({
      where: { organizationId: orgId },
      _max: { sortOrder: true },
    })

    const group = await prisma.pricingGroup.create({
      data: {
        organizationId: orgId,
        name,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      },
    })

    return NextResponse.json({ success: true, data: group }, { status: 201 })
  } catch (e: any) {
    if (e.code === "P2002") {
      return NextResponse.json({ error: "Group with this name already exists" }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
