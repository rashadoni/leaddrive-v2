import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { sendWhatsAppCallPermissionRequest } from "@/lib/whatsapp"
import {
  getLocalWhatsAppCallPermission,
  recordWhatsAppCallPermissionRequest,
  refreshWhatsAppCallPermissionForTarget,
  resolveWhatsAppCallTarget,
} from "@/lib/whatsapp-call-permissions"

const DEFAULT_PERMISSION_MESSAGE = "We would like to call you on WhatsApp to help with your request."

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const value = await req.json()
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function providerPermissionResponse(
  state: Awaited<ReturnType<typeof refreshWhatsAppCallPermissionForTarget>>["state"],
  permission: Awaited<ReturnType<typeof refreshWhatsAppCallPermissionForTarget>>["permission"],
) {
  return {
    permission,
    provider: {
      success: state.success,
      status: state.status ?? null,
      permissionStatus: state.permissionStatus,
      canRequest: state.canRequest,
      canStartCall: state.canStartCall,
      actions: state.actions,
      error: state.error ?? null,
    },
  }
}

export const GET = withRlsAuth("inbox", "read", async (req, auth) => {
  const conversationId = req.nextUrl.searchParams.get("conversationId")
  if (!conversationId) return NextResponse.json({ error: "conversationId is required" }, { status: 400 })

  const resolved = await resolveWhatsAppCallTarget(auth.orgId, conversationId)
  if (!resolved.target) {
    return NextResponse.json({ error: resolved.error || "WhatsApp call target not found" }, { status: resolved.status || 400 })
  }

  const refresh = req.nextUrl.searchParams.get("refresh") !== "0"
  if (!refresh) {
    const permission = await getLocalWhatsAppCallPermission(resolved.target)
    return NextResponse.json({ success: true, data: { target: resolved.target, permission, provider: null } })
  }

  const { state, permission } = await refreshWhatsAppCallPermissionForTarget(resolved.target)
  return NextResponse.json({
    success: state.success,
    data: {
      target: resolved.target,
      ...providerPermissionResponse(state, permission),
    },
  }, { status: state.success ? 200 : 502 })
})

export const POST = withRlsAuth("inbox", "write", async (req, auth) => {
  const body = await readBody(req)
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : ""
  if (!conversationId) return NextResponse.json({ error: "conversationId is required" }, { status: 400 })

  const resolved = await resolveWhatsAppCallTarget(auth.orgId, conversationId)
  if (!resolved.target) {
    return NextResponse.json({ error: resolved.error || "WhatsApp call target not found" }, { status: resolved.status || 400 })
  }
  const target = resolved.target
  const message = typeof body.message === "string" && body.message.trim()
    ? body.message.trim().slice(0, 1024)
    : DEFAULT_PERMISSION_MESSAGE

  const { state, permission } = await refreshWhatsAppCallPermissionForTarget(target)
  if (!state.success) {
    return NextResponse.json({
      error: state.error || "Could not check WhatsApp call permission",
      data: providerPermissionResponse(state, permission),
    }, { status: 502 })
  }
  if (state.canStartCall) {
    return NextResponse.json({
      success: true,
      alreadyAllowed: true,
      data: providerPermissionResponse(state, permission),
    })
  }
  if (!state.canRequest) {
    return NextResponse.json({
      error: "Meta does not allow sending a call permission request right now",
      data: providerPermissionResponse(state, permission),
    }, { status: 409 })
  }

  const result = await sendWhatsAppCallPermissionRequest({
    organizationId: auth.orgId,
    channelConfigId: target.channelConfigId,
    to: target.userWaId,
    recipient: target.recipient,
    body: message,
  })
  if (!result.success) {
    return NextResponse.json({
      error: result.error || "WhatsApp call permission request failed",
      providerStatus: result.status ?? null,
      provider: result.data ?? null,
    }, { status: 502 })
  }

  const updated = await recordWhatsAppCallPermissionRequest(target, {
    requestMessageId: result.messageId,
    requestedByUserId: auth.userId,
    providerPayload: result.data || null,
  })

  await prisma.channelMessage.create({
    data: {
      organizationId: auth.orgId,
      channelConfigId: target.channelConfigId,
      direction: "outbound",
      channelType: "whatsapp",
      contactId: target.contactId,
      conversationId: target.conversationId,
      from: target.businessNumber,
      to: target.userWaId || target.recipient || target.recipientKey,
      body: message,
      status: "delivered",
      externalId: result.messageId,
      messageType: "call_permission_request",
      metadata: {
        waMessageId: result.messageId,
        waMessageType: "call_permission_request",
        callPermissionRequest: true,
      },
    },
  }).catch(() => null)

  await prisma.socialConversation.updateMany({
    where: { id: target.conversationId, organizationId: auth.orgId },
    data: {
      channelConfigId: target.channelConfigId,
      lastMessage: "WhatsApp call permission request sent",
      lastMessageAt: new Date(),
    },
  }).catch(() => null)

  return NextResponse.json({
    success: true,
    data: {
      target,
      permission: updated,
      provider: {
        status: result.status ?? null,
        messageId: result.messageId ?? null,
      },
    },
  }, { status: 201 })
})
