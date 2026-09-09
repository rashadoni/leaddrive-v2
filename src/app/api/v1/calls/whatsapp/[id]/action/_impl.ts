import { NextRequest, NextResponse } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import {
  sendWhatsAppCallAction,
  type WhatsAppCallAction,
  type WhatsAppCallActionResult,
} from "@/lib/whatsapp"
import { deleteWhatsAppCallSession } from "@/lib/whatsapp-call-sessions"
import {
  appendWhatsAppCallAuditNote,
  formatWhatsAppCallAuditLine,
} from "@/lib/whatsapp-call-audit"

const ACTIONS = new Set<WhatsAppCallAction>(["pre_accept", "accept", "reject", "terminate"])
const ACTION_STATUS: Record<WhatsAppCallAction, string> = {
  pre_accept: "ringing",
  accept: "in-progress",
  reject: "rejected",
  terminate: "completed",
}
const ANSWERABLE_STATUSES = new Set(["initiated", "ringing"])
const ACTIVE_STATUSES = new Set(["initiated", "ringing", "in-progress"])
const TERMINAL_STATUSES = new Set(["completed", "failed", "busy", "no-answer", "canceled", "rejected"])
const ANSWER_ACTIONS = new Set<WhatsAppCallAction>(["pre_accept", "accept"])

export type WhatsAppCallActionSender = (params: {
  organizationId: string
  channelConfigId?: string | null
  callId: string
  action: WhatsAppCallAction
  sdp?: string
  sdpType?: "offer" | "answer"
}) => Promise<WhatsAppCallActionResult>

type RouteCtx = { params: Promise<{ id: string }> }

function parseAction(value: unknown): WhatsAppCallAction | null {
  return typeof value === "string" && ACTIONS.has(value as WhatsAppCallAction)
    ? value as WhatsAppCallAction
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function actionStateError(
  action: WhatsAppCallAction,
  call: { direction: string | null; status: string | null },
): string | null {
  const direction = String(call.direction || "").toLowerCase()
  const status = String(call.status || "").toLowerCase()

  if (TERMINAL_STATUSES.has(status)) return "WhatsApp call is already closed"

  if (action === "pre_accept" || action === "accept") {
    if (direction !== "inbound") return "Only inbound WhatsApp calls can be answered"
    if (!ANSWERABLE_STATUSES.has(status)) return "WhatsApp call is not waiting for an answer"
  }

  if (action === "reject") {
    if (direction !== "inbound") return "Only inbound WhatsApp calls can be rejected"
    if (!ACTIVE_STATUSES.has(status) || status === "in-progress") return "WhatsApp call can no longer be rejected"
  }

  if (action === "terminate" && !ACTIVE_STATUSES.has(status)) {
    return "WhatsApp call is not active"
  }

  return null
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json()
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

export async function postWhatsAppCallAction(
  req: NextRequest,
  auth: AuthResult,
  ctx: RouteCtx,
  sender: WhatsAppCallActionSender = sendWhatsAppCallAction,
) {
  const { id } = await ctx.params
  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

  const action = parseAction(body.action)
  if (!action) {
    return NextResponse.json({ error: "action must be pre_accept, accept, reject or terminate" }, { status: 400 })
  }

  const sdp = typeof body.sdp === "string" ? body.sdp.trim() : undefined
  const sdpType = body.sdpType === "offer" ? "offer" : "answer"
  if ((action === "pre_accept" || action === "accept") && !sdp) {
    return NextResponse.json({ error: `${action} requires a browser-generated SDP answer` }, { status: 400 })
  }
  if (sdp && sdp.length > 200_000) {
    return NextResponse.json({ error: "sdp is too large" }, { status: 413 })
  }

  const call = await prisma.callLog.findFirst({
    where: { id, organizationId: auth.orgId },
    select: {
      id: true,
      callSid: true,
      channelConfigId: true,
      provider: true,
      direction: true,
      status: true,
      notes: true,
      conversation: { select: { channelConfigId: true } },
    },
  })
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 })
  if (call.provider !== "whatsapp" || !call.callSid) {
    return NextResponse.json({ error: "This action is only available for WhatsApp calls" }, { status: 409 })
  }
  const stateError = actionStateError(action, call)
  if (stateError) {
    return NextResponse.json({ error: stateError }, { status: 409 })
  }
  if (ANSWER_ACTIONS.has(action)) {
    const claimed = await prisma.callLog.updateMany({
      where: {
        id: call.id,
        organizationId: auth.orgId,
        provider: "whatsapp",
        status: { in: ["initiated", "ringing"] },
        OR: [
          { claimedByUserId: null },
          { claimedByUserId: auth.userId },
        ],
      },
      data: {
        claimedByUserId: auth.userId,
        claimedAt: new Date(),
      },
    })
    if (claimed.count !== 1) {
      return NextResponse.json({ error: "WhatsApp call is already claimed by another operator" }, { status: 409 })
    }
  }

  const result = await sender({
    organizationId: auth.orgId,
    channelConfigId: call.channelConfigId ?? call.conversation?.channelConfigId ?? null,
    callId: call.callSid,
    action,
    sdp,
    sdpType,
  })
  if (!result.success) {
    await prisma.callLog.update({
      where: { id: call.id },
      data: {
        ...(ANSWER_ACTIONS.has(action) ? { claimedByUserId: null, claimedAt: null } : {}),
        notes: appendWhatsAppCallAuditNote(call.notes, formatWhatsAppCallAuditLine("action failed", {
          action,
          providerStatus: result.status ?? null,
          error: result.error || "unknown",
        })),
      },
    }).catch(() => null)
    return NextResponse.json(
      { error: result.error || "WhatsApp call action failed", providerStatus: result.status },
      { status: 502 },
    )
  }

  const terminal = action === "reject" || action === "terminate"
  await prisma.callLog.update({
    where: { id: call.id },
    data: {
      status: ACTION_STATUS[action],
      ...(ANSWER_ACTIONS.has(action) ? { claimedByUserId: auth.userId, claimedAt: new Date() } : {}),
      ...(terminal ? { endedAt: new Date() } : {}),
      notes: appendWhatsAppCallAuditNote(call.notes, formatWhatsAppCallAuditLine("action sent", {
        action,
        status: ACTION_STATUS[action],
        providerStatus: result.status ?? null,
      })),
    },
  })
  if (terminal) {
    await deleteWhatsAppCallSession(auth.orgId, call.callSid)
  }

  return NextResponse.json({
    success: true,
    data: {
      callLogId: call.id,
      callSid: call.callSid,
      action,
      status: ACTION_STATUS[action],
    },
  })
}
