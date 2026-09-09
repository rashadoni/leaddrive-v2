import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

/** Open legal cases not yet bundled into a report (the "pool" for the next report). */
export const GET = withRlsAuth("social-legal", "read", async (req: NextRequest, auth) => {
  const status = req.nextUrl.searchParams.get("status") === "dismissed" ? "dismissed" : "open"
  const cases = await prisma.socialLegalCase.findMany({
    where: {
      organizationId: auth.orgId,
      status,
      ...(status === "open" ? { reportId: null } : {}),
    },
    include: {
      mention: {
        select: {
          id: true,
          platform: true,
          sourceType: true,
          text: true,
          url: true,
          authorName: true,
          authorHandle: true,
          sentiment: true,
          publishedAt: true,
          createdAt: true,
        },
      },
      subject: { select: { id: true, name: true, type: true } },
      evidences: { orderBy: { capturedAt: "desc" }, take: 10 },
      actions: { orderBy: { createdAt: "desc" }, take: 10 },
      events: { orderBy: { createdAt: "desc" }, take: 20 },
      approvals: { orderBy: { createdAt: "desc" }, take: 10 },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  return NextResponse.json({ success: true, data: cases })
})
