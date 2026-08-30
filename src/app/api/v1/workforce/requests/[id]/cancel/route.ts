import { NextRequest, NextResponse } from "next/server"
import { clientIp } from "@/lib/request-ip"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { cancelWorkforceSelfRequest } from "@/lib/workforce/self-request"

type RouteContext = { params: Promise<{ id: string }> }

function workforceScopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, { status: 403 })
}

function requestAuditContext(req: NextRequest) {
  const ipAddress = clientIp(req)
  return {
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}

export const POST = withWorkforceSessionAuth<RouteContext>("write", async (req: NextRequest, auth, { params }) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor || actor.role !== "AGENT" || !actor.agentId) return workforceScopeDenied()

  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(id)) {
    return NextResponse.json({ error: "Invalid Workforce request id", code: "WORKFORCE_SELF_REQUEST_ID_INVALID" }, { status: 400 })
  }

  try {
    const result = await cancelWorkforceSelfRequest({
      organizationId: auth.orgId,
      actor,
      requestId: id,
      audit: requestAuditContext(req),
    })
    if (result.kind === "forbidden") return workforceScopeDenied()
    if (result.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (result.kind === "conflict") {
      return NextResponse.json({
        error: result.message,
        code: result.code,
        ...(result.request ? { request: result.request } : {}),
      }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      data: result.data,
      idempotent: result.idempotent,
    })
  } catch (error) {
    console.error("[workforce/requests cancel POST]", error)
    return NextResponse.json({ error: "Failed to cancel Workforce request" }, { status: 500 })
  }
})
