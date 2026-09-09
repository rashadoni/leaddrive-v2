import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get("page") || "1", 10)
  const limit = parseInt(searchParams.get("limit") || "50", 10)
  const [changes, total] = await Promise.all([
    prisma.priceChange.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.priceChange.count({ where: { organizationId: orgId } }),
  ])
  return NextResponse.json({ success: true, data: { changes, total, page, limit } })
})
