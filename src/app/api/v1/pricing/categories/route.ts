import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }) => {
  const categories = await prisma.pricingCategory.findMany({
    where: { organizationId: orgId },
    orderBy: { sortOrder: "asc" },
  })

  return NextResponse.json({ success: true, data: categories })
})

export const POST = withRls(async (req, { orgId }) => {
  try {
    const body = await req.json()
    const { name, boardCategory } = body

    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

    const maxOrder = await prisma.pricingCategory.aggregate({
      where: { organizationId: orgId },
      _max: { sortOrder: true },
    })

    const category = await prisma.pricingCategory.create({
      data: {
        organizationId: orgId,
        name,
        boardCategory: boardCategory || null,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      },
    })

    return NextResponse.json({ success: true, data: category }, { status: 201 })
  } catch (e: any) {
    if (e.code === "P2002") {
      return NextResponse.json({ error: "Category with this name already exists" }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
