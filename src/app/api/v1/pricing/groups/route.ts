import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }) => {
  const groups = await prisma.pricingGroup.findMany({
    where: { organizationId: orgId },
    orderBy: { sortOrder: "asc" },
  })

  return NextResponse.json({ success: true, data: groups.map((g: any) => g.name) })
})
