import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { buildWidgetCorsHeaders } from "@/lib/widget-cors"

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: await buildWidgetCorsHeaders(req, req.headers.get("origin")) })
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  const headers = await buildWidgetCorsHeaders(req, origin)

  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get("sessionId")
  const after = searchParams.get("after")
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400, headers })

  // RLS phase 1 — org resolution: the visitor's sessionId is a cross-tenant
  // external identifier, so the session→org lookup runs bypass-scoped.
  // Unknown session keeps the pre-RLS behavior of an empty message list
  // (the widget poller treats it as "nothing new"), not a 404.
  const session = await runWithRlsBypass(() =>
    prisma.webChatSession.findUnique({
      where: { id: sessionId },
      select: { organizationId: true },
    })
  )
  if (!session) {
    return NextResponse.json({ success: true, data: { messages: [] } }, { headers })
  }

  const afterDate = after ? new Date(Number(after)) : new Date(0)
  // RLS phase 2 — message poll runs tenant-scoped.
  const messages = await runWithTenant(session.organizationId, () =>
    prisma.webChatMessage.findMany({
      where: {
        sessionId,
        createdAt: { gt: afterDate },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    })
  )

  return NextResponse.json(
    {
      success: true,
      data: {
        messages: messages.map((m: any) => ({
          id: m.id,
          fromRole: m.fromRole,
          text: m.text,
          createdAt: m.createdAt.getTime(),
          attachmentUrl: m.attachmentUrl,
          attachmentName: m.attachmentName,
          attachmentType: m.attachmentType,
          attachmentSize: m.attachmentSize,
        })),
      },
    },
    { headers },
  )
}
