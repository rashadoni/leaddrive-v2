import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { checkPermission } from "@/lib/permissions"
import { isManagerOrAbove } from "@/lib/constants"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { withRlsAuth } from "@/lib/with-rls"
import { getVoipProvider } from "@/lib/voip"
import {
  isOutboundVoiceDispatchPaused,
  OUTBOUND_VOICE_DISPATCH_PAUSED_CODE,
} from "@/lib/voip/outbound-dispatch-gate"
import {
  assertOutboundVoiceDispatchAllowed,
  OutboundVoiceDispatchPausedError,
} from "@/lib/voip/outbound-dispatch-lock"
import {
  evaluateManualLeadAiCallPolicy,
  normalizeManualLeadPhone,
  type ManualLeadAiBlocker,
  type ManualLeadAiCallPreflight,
} from "@/lib/voice-agent/manual-lead-call"
import {
  lockVoiceContactPermission,
  lockVoiceLeadRow,
} from "@/lib/voice-agent/voice-permission-lock"

export const dynamic = "force-dynamic"

const postBodySchema = z.object({
  idempotencyKey: z.string().uuid(),
  consentConfirmed: z.literal(true),
}).strict()

const DISPATCH_LEASE_MS = 10 * 60 * 1_000

type RouteContext = { params: Promise<{ id: string }> }

type ExistingSession = {
  id: string
  leadId: string
  requestedByUserId: string
  callLogId: string | null
  status: string
}

type ReplaySession = Omit<ExistingSession, "callLogId"> & { callLogId: string }

type PreparedCall = {
  sessionId: string
  callLogId: string
  providerCallId: string
  targetDialNumber: string
  fromNumber: string
  providerSettings: Parameters<typeof getVoipProvider>[0]
  startedAt: Date
}

class InaccessibleLeadError extends Error {}

class PolicyBlockedError extends Error {
  constructor(readonly preflight: ManualLeadAiCallPreflight) {
    super("manual AI call policy blocked")
  }
}

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

function isUniqueOrSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2002" || error.code === "P2034")
}

async function findReplay(params: {
  organizationId: string
  leadId: string
  requestedByUserId: string
  idempotencyKey: string
}): Promise<ReplaySession | null> {
  const session = await prisma.voiceCallSession.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: params.organizationId,
        idempotencyKey: params.idempotencyKey,
      },
    },
    select: {
      id: true,
      leadId: true,
      requestedByUserId: true,
      callLogId: true,
      status: true,
    },
  })
  if (!session) return null
  if (
    session.leadId !== params.leadId
    || session.requestedByUserId !== params.requestedByUserId
    || !session.callLogId
  ) {
    return null
  }
  return { ...session, callLogId: session.callLogId }
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
    if (isOutboundVoiceDispatchPaused(auth.orgId)) {
      return NextResponse.json(
        { success: false, code: OUTBOUND_VOICE_DISPATCH_PAUSED_CODE },
        { status: 503, headers: { "Retry-After": "60" } },
      )
    }
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

    const replayParams = {
      organizationId: auth.orgId,
      leadId,
      requestedByUserId: auth.userId,
      idempotencyKey: parsed.data.idempotencyKey,
    }
    const replay = await findReplay(replayParams)
    if (replay) return replayResponse(replay)

    let prepared: PreparedCall
    try {
      prepared = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await assertOutboundVoiceDispatchAllowed({
          tx,
          organizationId: auth.orgId,
        })
        await lockVoiceLeadRow(tx, auth.orgId, leadId)
        const lockLead = await tx.lead.findFirst({
          where: {
            id: leadId,
            organizationId: auth.orgId,
            ...(!isManagerOrAbove(auth.role) ? { assignedTo: auth.userId } : {}),
          },
          select: { phone: true },
        })
        if (!lockLead) throw new InaccessibleLeadError()
        const lockPhone = normalizeManualLeadPhone(lockLead.phone)
        if (!lockPhone) {
          throw new PolicyBlockedError({
            eligible: false,
            blockers: ["no_phone"],
            requiresConsentConfirmation: false,
            limits: { userRemaining: 0, organizationRemaining: 0 },
          })
        }
        await lockVoiceContactPermission(tx, auth.orgId, lockPhone.e164)

        const evaluation = await evaluateManualLeadAiCallPolicy({
          db: tx,
          auth,
          leadId,
        })
        if (evaluation.inaccessible) throw new InaccessibleLeadError()
        if (evaluation.targetPhoneE164 !== lockPhone.e164) {
          throw new PolicyBlockedError({
            ...evaluation.preflight,
            eligible: false,
            blockers: ["phone_changed"],
          })
        }
        if (!evaluation.preflight.eligible) throw new PolicyBlockedError(evaluation.preflight)
        if (
          !evaluation.lead
          || !evaluation.targetPhoneE164
          || !evaluation.targetDialNumber
          || !evaluation.provider
        ) {
          throw new PolicyBlockedError({
            ...evaluation.preflight,
            eligible: false,
            blockers: ["provider_unavailable"],
          })
        }

        const now = new Date()
        const leaseUntil = new Date(now.getTime() + DISPATCH_LEASE_MS)
        const providerCallId = randomUUID()
        const consentAudit: Prisma.InputJsonObject = {
          scope: "sales",
          consentConfirmed: true,
          basis: evaluation.consentBasis,
          attestedByUserId: auth.userId,
          attestedAt: now.toISOString(),
        }
        const callLog = await tx.callLog.create({
          data: {
            organizationId: auth.orgId,
            direction: "outbound",
            fromNumber: evaluation.provider.fromNumber,
            toNumber: evaluation.targetPhoneE164,
            targetPhoneE164: evaluation.targetPhoneE164,
            status: "dispatching",
            provider: "asterisk",
            providerCallId,
            callSid: providerCallId,
            callMode: "ai",
            wasAnswered: false,
            channelConfigId: evaluation.provider.channelConfigId,
            leadId: evaluation.lead.id,
            userId: auth.userId,
            idempotencyKey: parsed.data.idempotencyKey,
            consentAudit,
            startedAt: now,
          },
          select: { id: true },
        })
        const session = await tx.voiceCallSession.create({
          data: {
            organizationId: auth.orgId,
            activeOrganizationKey: auth.orgId,
            leadId: evaluation.lead.id,
            requestedByUserId: auth.userId,
            assignedToSnapshot: evaluation.lead.assignedTo,
            idempotencyKey: parsed.data.idempotencyKey,
            activeLeadKey: evaluation.lead.id,
            activePhoneKey: evaluation.targetPhoneE164,
            targetPhoneE164: evaluation.targetPhoneE164,
            channelConfigId: evaluation.provider.channelConfigId,
            provider: "asterisk",
            providerCallId,
            callLogId: callLog.id,
            status: "dispatching",
            policySnapshot: evaluation.policySnapshot as Prisma.InputJsonValue,
            startedAt: now,
            leaseUntil,
          },
          select: { id: true },
        })
        return {
          sessionId: session.id,
          callLogId: callLog.id,
          providerCallId,
          targetDialNumber: evaluation.targetDialNumber,
          fromNumber: evaluation.provider.fromNumber,
          providerSettings: evaluation.provider.settings,
          startedAt: now,
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
    } catch (error) {
      if (error instanceof OutboundVoiceDispatchPausedError) {
        return NextResponse.json(
          { success: false, code: OUTBOUND_VOICE_DISPATCH_PAUSED_CODE },
          { status: 503, headers: { "Retry-After": "60" } },
        )
      }
      if (error instanceof InaccessibleLeadError) return notFound()
      if (error instanceof PolicyBlockedError) {
        return blockedResponse(error.preflight.blockers)
      }
      if (isUniqueOrSerializationConflict(error)) {
        const racedReplay = await findReplay(replayParams)
        if (racedReplay) return replayResponse(racedReplay)
        return blockedResponse(["active_call_exists"])
      }
      console.error("[manual-lead-ai-call] preparation failed", {
        errorType: error instanceof Error ? error.name : "unknown",
      })
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    const startedAt = prepared.startedAt

    let providerAccepted = false
    let definiteProviderRejection = false
    try {
      const result = await getVoipProvider(prepared.providerSettings).initiateCall({
        toNumber: prepared.targetDialNumber,
        fromNumber: prepared.fromNumber,
        voiceAgent: true,
        correlationId: prepared.providerCallId,
      })
      providerAccepted = result.success === true && result.callSid === prepared.providerCallId
      definiteProviderRejection = result.success === false
        && result.failureCertainty === "definite_rejection"
    } catch (error) {
      console.error("[manual-lead-ai-call] dispatch threw", {
        errorType: error instanceof Error ? error.name : "unknown",
      })
    }

    if (!providerAccepted) {
      if (definiteProviderRejection) {
        const endedAt = new Date()
        await prisma.$transaction([
          prisma.voiceCallSession.updateMany({
            where: {
              id: prepared.sessionId,
              organizationId: auth.orgId,
              status: "dispatching",
            },
            data: {
              status: "failed",
              outcome: "failed",
              endedAt,
              leaseUntil: null,
              activeOrganizationKey: null,
              activeLeadKey: null,
              activePhoneKey: null,
            },
          }),
          prisma.callLog.updateMany({
            where: {
              id: prepared.callLogId,
              organizationId: auth.orgId,
              providerOutcome: null,
            },
            data: {
              status: "failed",
              providerOutcome: "failed",
              wasAnswered: false,
              conversationOutcome: "failed",
              startedAt,
              endedAt,
            },
          }),
        ])
        return blockedResponse(["provider_unavailable"], 502)
      }

      // A timeout, transport error, or mismatched acceptance response cannot
      // prove that ARI rejected the UUID. Preserve both active fences and the
      // lease for explicit reconciliation; never auto-redial.
      await prisma.$transaction([
        prisma.voiceCallSession.updateMany({
          where: {
            id: prepared.sessionId,
            organizationId: auth.orgId,
            status: "dispatching",
          },
          data: { status: "dispatch_uncertain" },
        }),
        prisma.callLog.updateMany({
          where: {
            id: prepared.callLogId,
            organizationId: auth.orgId,
            providerOutcome: null,
          },
          data: { status: "dispatch-uncertain", startedAt },
        }),
      ])
      return blockedResponse(["provider_unavailable"], 503)
    }

    await prisma.callLog.updateMany({
      where: {
        id: prepared.callLogId,
        organizationId: auth.orgId,
        providerOutcome: null,
      },
      data: { status: "initiated", startedAt },
    })

    return NextResponse.json({
      success: true,
      data: {
        sessionId: prepared.sessionId,
        callLogId: prepared.callLogId,
        status: "dispatching",
        replayed: false,
      },
    })
  },
)

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const rejection = guardInteractiveJsonMutation(request) ?? apiCredentialRejected(request)
  return rejection ?? postWithAuth(request, context)
}
