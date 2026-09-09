import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parsePreChatForm } from "@/lib/web-chat-prechat"
import { runWithRlsBypass } from "@/lib/rls-context"
import { buildWidgetCorsHeaders, isOriginAllowed } from "@/lib/widget-cors"
import { isWidgetOnline } from "@/lib/widget-hours"

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: await buildWidgetCorsHeaders(req, req.headers.get("origin")) })
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  const headers = await buildWidgetCorsHeaders(req, origin)

  const { searchParams } = new URL(req.url)
  const key = searchParams.get("key")
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400, headers })
  }

  // RLS phase 1 — org resolution: publicKey is a cross-tenant external
  // identifier, so the lookup runs bypass-scoped. Only DB access in this route.
  const widget = await runWithRlsBypass(() =>
    prisma.webChatWidget.findUnique({
      where: { publicKey: key },
      include: { organization: { select: { id: true, name: true, branding: true } } },
    })
  )

  if (!widget || !widget.enabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers })
  }

  if (!isOriginAllowed(origin, widget.allowedOrigins)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers })
  }

  const online = isWidgetOnline(widget.workingHours)

  return NextResponse.json(
    {
      success: true,
      data: {
        key: widget.publicKey,
        title: widget.title,
        greeting: widget.greeting,
        primaryColor: widget.primaryColor,
        position: widget.position,
        showLauncher: widget.showLauncher,
        aiEnabled: widget.aiEnabled && online,  // no AI replies when offline
        offlineMessage: widget.offlineMessage,
        online,
        organizationName: widget.organization.name,
        preChatForm: parsePreChatForm(widget.preChatForm),
        uiOptions: widget.uiOptions ?? null, // onboarding/history options; null = defaults (both on)
      },
    },
    { headers },
  )
}
