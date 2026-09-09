import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { buildWidgetCorsHeaders, isOriginAllowed } from "@/lib/widget-cors"
import { setTyping, getTyping } from "@/lib/web-chat-typing"

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: await buildWidgetCorsHeaders(req, req.headers.get("origin")) })
}

const postSchema = z.object({
  sessionId: z.string().min(1),
  role: z.enum(["visitor", "agent"]),
})

// Visitor → POST { sessionId, role: "visitor" }  (widget client)
// Agent   → uses the authenticated endpoint below
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const headers = await buildWidgetCorsHeaders(req, origin)
  const body = await req.json().catch(() => null)
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400, headers })

  // RLS phase 1 — org resolution: visitor sessionId, bypass-scoped lookup only.
  const s = await runWithRlsBypass(() =>
    prisma.webChatSession.findUnique({
      where: { id: parsed.data.sessionId },
      select: { id: true, organizationId: true, status: true },
    })
  )
  if (!s) return NextResponse.json({ error: "Session not found" }, { status: 404, headers })
  if (s.status === "closed") {
    return NextResponse.json({ error: "Session is closed" }, { status: 410, headers })
  }

  // Only visitor may self-report via the public endpoint
  if (parsed.data.role !== "visitor") {
    return NextResponse.json({ error: "Forbidden role" }, { status: 403, headers })
  }

  // RLS phase 2 — widget check runs tenant-scoped (setTyping is in-memory).
  // Enforce allowedOrigins on the session's widget
  const widget = await runWithTenant(s.organizationId, () =>
    prisma.webChatWidget.findUnique({
      where: { organizationId: s.organizationId },
      select: { allowedOrigins: true, enabled: true },
    })
  )
  if (!widget?.enabled) return NextResponse.json({ error: "Widget disabled" }, { status: 403, headers })
  if (!isOriginAllowed(origin, widget.allowedOrigins)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers })
  }

  setTyping(s.id, "visitor")
  return NextResponse.json({ success: true }, { headers })
}

// Visitor polls for agent typing (via session messages endpoint would be better batched,
// but a dedicated endpoint keeps roles clean for the widget).
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  const headers = await buildWidgetCorsHeaders(req, origin)
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get("sessionId")
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400, headers })
  const state = getTyping(sessionId)
  return NextResponse.json(
    { success: true, data: state && state.role === "agent" ? { typing: true } : { typing: false } },
    { headers },
  )
}
