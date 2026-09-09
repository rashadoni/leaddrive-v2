import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { startWhatsAppOutboundCall } from "@/lib/whatsapp"
import {
  refreshWhatsAppCallPermissionForTarget,
  resolveWhatsAppCallTarget,
} from "@/lib/whatsapp-call-permissions"
import {
  appendWhatsAppCallAuditNote,
  formatWhatsAppCallAuditLine,
} from "@/lib/whatsapp-call-audit"

const ACTIVE_OUTBOUND_STATUSES = ["initiated", "ringing", "in-progress"] as const

const CALL_RESPONSE_SELECT = {
  id: true,
  callSid: true,
  providerCallId: true,
  direction: true,
  fromNumber: true,
  toNumber: true,
  status: true,
  provider: true,
  conversationId: true,
  contactId: true,
  claimedByUserId: true,
  claimedAt: true,
  createdAt: true,
} as const

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json()
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function isPrismaUniqueError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "P2002"
}

export const POST = withRlsAuth("inbox", "write", async (req, auth) => {
  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

  const conversationId = typeof body.conversationId === "string" ? body.conversationId : ""
  const sdp = typeof body.sdp === "string" ? body.sdp.trim() : ""
  if (!conversationId) return NextResponse.json({ error: "conversationId is required" }, { status: 400 })
  if (!sdp) return NextResponse.json({ error: "sdp offer is required" }, { status: 400 })
  if (sdp.length > 200_000) return NextResponse.json({ error: "sdp is too large" }, { status: 413 })

  const resolved = await resolveWhatsAppCallTarget(auth.orgId, conversationId)
  if (!resolved.target) {
    return NextResponse.json({ error: resolved.error || "WhatsApp call target not found" }, { status: resolved.status || 400 })
  }
  const target = resolved.target

  const { state, permission } = await refreshWhatsAppCallPermissionForTarget(target)
  if (!state.success) {
    return NextResponse.json({
      error: state.error || "Could not check WhatsApp call permission",
      permission,
    }, { status: 502 })
  }
  if (!state.canStartCall) {
    return NextResponse.json({
      error: "WhatsApp user has not granted call permission or the start_call limit is exhausted",
      permission,
      provider: {
        status: state.status ?? null,
        permissionStatus: state.permissionStatus,
        actions: state.actions,
      },
    }, { status: 409 })
  }

  const activeCall = await prisma.callLog.findFirst({
    where: {
      organizationId: auth.orgId,
      provider: "whatsapp",
      direction: "outbound",
      conversationId: target.conversationId,
      status: { in: [...ACTIVE_OUTBOUND_STATUSES] },
    },
    select: CALL_RESPONSE_SELECT,
  })
  if (activeCall) {
    return NextResponse.json({
      error: "A WhatsApp outbound call is already active for this conversation",
      data: { call: activeCall, permission },
    }, { status: 409 })
  }

  const now = new Date()
  const initialNote = formatWhatsAppCallAuditLine("outbound connect requested", {
    permission: state.permissionStatus,
    canStartCall: state.canStartCall,
  }, now)
  const callLog = await prisma.callLog.create({
    data: {
      organizationId: auth.orgId,
      channelConfigId: target.channelConfigId,
      direction: "outbound",
      fromNumber: target.businessNumber,
      toNumber: target.userWaId ? `+${target.userWaId}` : target.recipientKey,
      status: "initiated",
      provider: "whatsapp",
      contactId: target.contactId,
      conversationId: target.conversationId,
      userId: auth.userId,
      claimedByUserId: auth.userId,
      claimedAt: now,
      startedAt: now,
      notes: initialNote,
    },
    select: { id: true, notes: true },
  })

  const result = await startWhatsAppOutboundCall({
    organizationId: auth.orgId,
    channelConfigId: target.channelConfigId,
    to: target.userWaId,
    recipient: target.recipient,
    sdp,
    bizOpaqueCallbackData: `ld_call:${callLog.id}`,
  })

  if (!result.success || !result.callId) {
    const failureNote = formatWhatsAppCallAuditLine("outbound connect failed", {
      providerStatus: result.status ?? null,
      error: result.error || "missing provider call id",
    })
    await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        status: "failed",
        endedAt: new Date(),
        notes: appendWhatsAppCallAuditNote(callLog.notes, failureNote),
      },
    }).catch(() => null)
    return NextResponse.json({
      error: result.error || "WhatsApp outbound call failed",
      providerStatus: result.status ?? null,
      provider: result.data ?? null,
    }, { status: 502 })
  }

  let updated
  const connectedNote = formatWhatsAppCallAuditLine("outbound connect sent", {
    providerStatus: result.status ?? null,
    callId: result.callId,
  })
  try {
    updated = await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        callSid: result.callId,
        providerCallId: result.callId,
        status: "ringing",
        notes: appendWhatsAppCallAuditNote(callLog.notes, connectedNote),
      },
      select: CALL_RESPONSE_SELECT,
    })
  } catch (error) {
    if (!isPrismaUniqueError(error)) throw error
    const raced = await prisma.callLog.findFirst({
      where: {
        organizationId: auth.orgId,
        provider: "whatsapp",
        providerCallId: result.callId,
      },
      select: { id: true, notes: true },
    })
    if (!raced) throw error
    await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        status: "failed",
        endedAt: new Date(),
        notes: appendWhatsAppCallAuditNote(callLog.notes, formatWhatsAppCallAuditLine("outbound connect superseded", {
          callId: result.callId,
          reason: "provider webhook created call log first",
        })),
      },
    }).catch(() => null)
    updated = await prisma.callLog.update({
      where: { id: raced.id },
      data: {
        channelConfigId: target.channelConfigId,
        direction: "outbound",
        fromNumber: target.businessNumber,
        toNumber: target.userWaId ? `+${target.userWaId}` : target.recipientKey,
        status: "ringing",
        contactId: target.contactId,
        conversationId: target.conversationId,
        userId: auth.userId,
        claimedByUserId: auth.userId,
        claimedAt: now,
        notes: appendWhatsAppCallAuditNote(raced.notes, connectedNote),
      },
      select: CALL_RESPONSE_SELECT,
    })
  }

  await prisma.socialConversation.updateMany({
    where: { id: target.conversationId, organizationId: auth.orgId },
    data: {
      channelConfigId: target.channelConfigId,
      lastMessage: "WhatsApp outbound call started",
      lastMessageAt: new Date(),
    },
  }).catch(() => null)

  return NextResponse.json({
    success: true,
    data: {
      call: updated,
      permission,
      provider: {
        status: result.status ?? null,
        callId: result.callId,
      },
    },
  }, { status: 201 })
})
