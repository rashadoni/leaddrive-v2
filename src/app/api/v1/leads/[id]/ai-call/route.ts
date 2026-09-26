import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { checkPermission } from "@/lib/permissions"
import { isManagerOrAbove } from "@/lib/constants"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { withRlsAuth } from "@/lib/with-rls"
import {
  isOutboundVoiceDispatchPaused,
  OUTBOUND_VOICE_DISPATCH_PAUSED_CODE,
} from "@/lib/voip/outbound-dispatch-gate"
import {
  evaluateManualLeadAiCallPolicy,
  type ManualLeadAiBlocker,
} from "@/lib/voice-agent/manual-lead-call"
import {
  dispatchManualLeadAiCall,
  type ManualLeadAiCallReplay as ReplaySession,
} from "@/lib/voice-agent/dispatch-manual-lead-call"

export const dynamic = "force-dynamic"

const postBodySchema = z.object({
  idempotencyKey: z.string().uuid(),
  consentConfirmed: z.literal(true),
}).strict()

type RouteContext = { params: Promise<{ id: string }> }

function apiCredentialRejected(request: NextRequest): NextResponse | null {
  // This is an intentional human action from an authenticated CRM page. Do not
  // let API keys or other bearer principals turn it into an automation endpoint.
  return request.headers.has("authorization")
    ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
    : null
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}

function pausedResponse(): NextResponse {
  return NextResponse.json(
    { success: false, code: OUTBOUND_VOICE_DISPATCH_PAUSED_CODE },
    { status: 503, headers: { "Retry-After": "60" } },
  )
}

function isPilotVoiceOrganization(organizationId: string): boolean {
  const configured = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim()
  return Boolean(configured && configured === organizationId)
}

function blockedResponse(blockers: ManualLeadAiBlocker[], status = 409): NextResponse {
  const code = blockers[0] ?? "provider_unavailable"
  return NextResponse.json(
    { success: false, code, blockers: blockers.length > 0 ? blockers : [code] },
    { status },
  )
}

function successResponse(session: ReplaySession, replayed: boolean): NextResponse {
  return NextResponse.json({
    success: true,
    data: {
      sessionId: session.id,
      callLogId: session.callLogId,
      status: session.status,
      replayed,
    },
  })
}

function terminalReplayFailure(params: {
  code: "dispatch_uncertain" | "provider_failed" | "call_blocked" | "call_cancelled"
  status: 409 | 502 | 503
  blocker?: ManualLeadAiBlocker
}): NextResponse {
  return NextResponse.json({
    success: false,
    code: params.code,
    blockers: [params.blocker ?? params.code],
    replayed: true,
  }, { status: params.status })
}

function replayResponse(session: ReplaySession): NextResponse {
  // An ambiguous dispatch is intentionally sticky: the provider may have
  // accepted the call even though CRM did not receive its response. A retry
  // with the same key must never look accepted and must never redial.
  switch (session.status) {
    case "dispatch_uncertain":
      return terminalReplayFailure({
        code: "dispatch_uncertain",
        status: 503,
        blocker: "provider_unavailable",
      })
    case "failed":
      return terminalReplayFailure({
        code: "provider_failed",
        status: 502,
        blocker: "provider_unavailable",
      })
    case "blocked":
      return terminalReplayFailure({ code: "call_blocked", status: 409 })
    case "cancelled":
      return terminalReplayFailure({ code: "call_cancelled", status: 409 })
    default:
      return successResponse(session, true)
  }
}

async function leadIsAccessible(params: {
  organizationId: string
  leadId: string
  userId: string
  role: string
}): Promise<boolean> {
  const lead = await prisma.lead.findFirst({
    where: {
      id: params.leadId,
      organizationId: params.organizationId,
      ...(!isManagerOrAbove(params.role) ? { assignedTo: params.userId } : {}),
    },
    select: { id: true },
  })
  return Boolean(lead)
}

const getWithAuth = withRlsAuth(
  "voip",
  "write",
  async (_request, auth, { params }: RouteContext) => {
    if (!checkPermission(auth.role, "leads", "write")) return forbidden()
    if (!isPilotVoiceOrganization(auth.orgId)) return notFound()
    const { id } = await params
    const evaluation = await evaluateManualLeadAiCallPolicy({
      db: prisma,
      auth,
      leadId: id,
    })
    if (evaluation.inaccessible) return notFound()
    return NextResponse.json({ success: true, data: evaluation.preflight })
  },
)

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const rejection = apiCredentialRejected(request)
  return rejection ?? getWithAuth(request, context)
}

const postWithAuth = withRlsAuth(
  "voip",
  "write",
  async (request, auth, { params }: RouteContext) => {
    if (!checkPermission(auth.role, "leads", "write")) return forbidden()
    if (!isPilotVoiceOrganization(auth.orgId)) return notFound()
    if (isOutboundVoiceDispatchPaused(auth.orgId)) return pausedResponse()
    const { id: leadId } = await params
    const body = await request.json().catch(() => null)
    const parsed = postBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }
    if (!await leadIsAccessible({
      organizationId: auth.orgId,
      leadId,
      userId: auth.userId,
      role: auth.role,
    })) {
      return notFound()
    }

    const result = await dispatchManualLeadAiCall({
      auth,
      leadId,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    switch (result.kind) {
      case "dispatched":
        return NextResponse.json({
          success: true,
          data: {
            sessionId: result.sessionId,
            callLogId: result.callLogId,
            status: "dispatching",
            replayed: false,
          },
        })
      case "replay":
        return replayResponse(result.session)
      case "blocked":
        return blockedResponse(result.blockers, result.status)
      case "paused":
        return pausedResponse()
      case "not_found":
        return notFound()
      case "error":
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const rejection = guardInteractiveJsonMutation(request) ?? apiCredentialRejected(request)
  return rejection ?? postWithAuth(request, context)
}
