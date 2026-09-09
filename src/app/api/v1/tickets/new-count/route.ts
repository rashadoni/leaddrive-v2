import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const since = searchParams.get("since")

  if (!since) {
    return NextResponse.json({ error: "Missing 'since' parameter" }, { status: 400 })
  }

  const sinceDate = new Date(since)
  if (isNaN(sinceDate.getTime())) {
    return NextResponse.json({ error: "Invalid 'since' date" }, { status: 400 })
  }

  try {
    const [count, latest] = await Promise.all([
      prisma.ticket.count({
        where: {
          organizationId: orgId,
          createdAt: { gt: sinceDate },
        },
      }),
      prisma.ticket.findFirst({
        where: {
          organizationId: orgId,
          createdAt: { gt: sinceDate },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          priority: true,
          createdAt: true,
        },
      }),
    ])

    return NextResponse.json({ count, latest })
  } catch {
    return NextResponse.json({ error: "Failed to fetch new ticket count" }, { status: 500 })
  }
})
