import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (req, { orgId }) => {

  const url = new URL(req.url)
  const page = Number(url.searchParams.get("page") || "1")
  const limit = Number(url.searchParams.get("limit") || "50")
  const search = url.searchParams.get("search") || ""
  const status = url.searchParams.get("status") || ""
  const direction = url.searchParams.get("direction") || ""

  const where: any = { organizationId: orgId }
  if (status) where.status = status
  if (direction) where.direction = direction
  if (search) {
    where.OR = [
      { subject: { contains: search, mode: "insensitive" } },
      { toEmail: { contains: search, mode: "insensitive" } },
      { fromEmail: { contains: search, mode: "insensitive" } },
    ]
  }

  const [logs, total] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.emailLog.count({ where }),
  ])

  // Stats
  const statsWhere = { organizationId: orgId }
  const [totalCount, outbound, inbound, sent, failed, bounced] = await Promise.all([
    prisma.emailLog.count({ where: statsWhere }),
    prisma.emailLog.count({ where: { ...statsWhere, direction: "outbound" } }),
    prisma.emailLog.count({ where: { ...statsWhere, direction: "inbound" } }),
    prisma.emailLog.count({ where: { ...statsWhere, status: "sent" } }),
    prisma.emailLog.count({ where: { ...statsWhere, status: "failed" } }),
    prisma.emailLog.count({ where: { ...statsWhere, status: "bounced" } }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      logs,
      total,
      page,
      limit,
      stats: { total: totalCount, outbound, inbound, sent, failed, bounced },
    },
  })
})
