import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

// GET — list interaction logs with pagination
export const GET = withRls(async (req, { orgId }) => {
  const url = new URL(req.url)
  const page = parseInt(url.searchParams.get("page") || "1")
  const limit = parseInt(url.searchParams.get("limit") || "20")
  const skip = (page - 1) * limit

  const [logs, total] = await Promise.all([
    prisma.aiInteractionLog.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.aiInteractionLog.count({ where: { organizationId: orgId } }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    },
  })
})
