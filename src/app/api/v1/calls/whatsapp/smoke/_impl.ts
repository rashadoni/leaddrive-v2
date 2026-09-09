import { NextRequest, NextResponse } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { storeWhatsAppCallSession } from "@/lib/whatsapp-call-sessions"
import {
  appendWhatsAppCallAuditNote,
  formatWhatsAppCallAuditLine,
} from "@/lib/whatsapp-call-audit"

const CONFIRM = "create-whatsapp-calling-smoke"
const DEFAULT_CUSTOMER_PHONE = "15550001001"
const DEFAULT_BUSINESS_PHONE = "whatsapp-business"
const OUTBOUND_PERMISSION_ACTIONS = [
  { actionName: "start_call", canPerformAction: true, limits: [] },
  { actionName: "send_call_permission_request", canPerformAction: false, limits: [] },
]

const SMOKE_SDP_OFFER = [
  "v=0",
  "o=- 461173260123 2 IN IP4 127.0.0.1",
  "s=LeadDrive WhatsApp Calling smoke",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=msid-semantic: WMS *",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=rtcp:9 IN IP4 0.0.0.0",
  "a=ice-ufrag:smok",
  "a=ice-pwd:smoketestpassword1234567890",
  "a=ice-options:trickle",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=setup:actpass",
  "a=mid:0",
  "a=sendrecv",
  "a=rtcp-mux",
  "a=rtpmap:111 opus/48000/2",
  "",
].join("\r\n")

function cleanPhone(value: unknown, fallback: string): string {
  if (typeof value !== "string" && typeof value !== "number") return fallback
  const clean = String(value).replace(/[^\d]/g, "")
  return clean.length >= 7 && clean.length <= 20 ? clean : fallback
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "WhatsApp Smoke Caller"
  const trimmed = value.trim().replace(/\s+/g, " ")
  return trimmed ? trimmed.slice(0, 80) : "WhatsApp Smoke Caller"
}

function smokeDirection(value: unknown): "inbound" | "outbound" {
  return value === "outbound" ? "outbound" : "inbound"
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export async function createWhatsAppCallingSmokeScenario(req: NextRequest, auth: AuthResult) {
  const body = await readBody(req)
  if (body.confirm !== CONFIRM) {
    return NextResponse.json(
      { error: `confirm must be "${CONFIRM}"` },
      { status: 400 },
    )
  }
  const direction = smokeDirection(body.direction)

  const channel = await prisma.channelConfig.findFirst({
    where: { organizationId: auth.orgId, channelType: "whatsapp", isActive: true },
    select: {
      id: true,
      phoneNumberId: true,
      phoneNumber: true,
      displayName: true,
    },
  })

  const now = new Date()
  const customerPhone = cleanPhone(body.customerPhone, DEFAULT_CUSTOMER_PHONE)
  const configuredBusinessPhone = cleanPhone(channel?.phoneNumber, DEFAULT_BUSINESS_PHONE)
  const businessPhone = cleanPhone(body.businessPhone, configuredBusinessPhone)
  const contactName = cleanName(body.contactName)
  const callSid = direction === "outbound" ? `wa-smoke-outbound-${auth.orgId}` : `wa-smoke-${auth.orgId}`
  const status = direction === "outbound" ? "in-progress" : "ringing"
  const fromNumber = direction === "outbound" ? businessPhone : customerPhone
  const toNumber = direction === "outbound" ? customerPhone : businessPhone
  const lastMessage = direction === "outbound"
    ? "WhatsApp smoke outbound call active (in-progress)"
    : "WhatsApp smoke call incoming (ringing)"
  const auditLine = formatWhatsAppCallAuditLine("smoke scenario", {
    event: direction === "outbound" ? "outbound_connect" : "connect",
    status,
    direction,
    session: direction === "outbound" ? "answer" : "offer",
    note: "No external Meta call was placed",
  }, now)

  const conversation = await prisma.socialConversation.upsert({
    where: {
      organizationId_platform_externalId: {
        organizationId: auth.orgId,
        platform: "whatsapp",
        externalId: customerPhone,
      },
    },
    create: {
      organizationId: auth.orgId,
      channelConfigId: channel?.id,
      platform: "whatsapp",
      externalId: customerPhone,
      contactName,
      lastMessage,
      lastMessageAt: now,
      metadata: {
        source: "whatsapp_calling_smoke",
        createdBy: auth.userId,
      },
    },
    update: {
      channelConfigId: channel?.id,
      contactName,
      lastMessage,
      lastMessageAt: now,
      metadata: {
        source: "whatsapp_calling_smoke",
        updatedBy: auth.userId,
      },
    },
    select: { id: true },
  })

  let permissionId: string | null = null
  if (direction === "outbound" && channel?.id) {
    const permission = await prisma.whatsAppCallPermission.upsert({
      where: {
        organizationId_channelConfigId_recipientKey: {
          organizationId: auth.orgId,
          channelConfigId: channel.id,
          recipientKey: `wa:${customerPhone}`,
        },
      },
      create: {
        organizationId: auth.orgId,
        channelConfigId: channel.id,
        conversationId: conversation.id,
        recipientKey: `wa:${customerPhone}`,
        userWaId: customerPhone,
        status: "permanent",
        canRequest: false,
        canStartCall: true,
        responseSource: "crm_smoke",
        isPermanent: true,
        requestedByUserId: auth.userId,
        requestedAt: now,
        approvedAt: now,
        lastCheckedAt: now,
        lastProviderStatus: "crm_smoke",
        actions: OUTBOUND_PERMISSION_ACTIONS,
        providerPayload: {
          source: "whatsapp_calling_smoke",
          externalMetaCallPlaced: false,
        },
      },
      update: {
        conversationId: conversation.id,
        userWaId: customerPhone,
        status: "permanent",
        canRequest: false,
        canStartCall: true,
        responseSource: "crm_smoke",
        isPermanent: true,
        requestedByUserId: auth.userId,
        requestedAt: now,
        approvedAt: now,
        rejectedAt: null,
        expiresAt: null,
        lastCheckedAt: now,
        lastProviderStatus: "crm_smoke",
        lastError: null,
        actions: OUTBOUND_PERMISSION_ACTIONS,
        providerPayload: {
          source: "whatsapp_calling_smoke",
          externalMetaCallPlaced: false,
        },
      },
      select: { id: true },
    })
    permissionId = permission.id
  }

  const existing = await prisma.callLog.findFirst({
    where: { organizationId: auth.orgId, callSid },
    select: { id: true, notes: true },
  })
  const callData = {
    channelConfigId: channel?.id,
    direction,
    fromNumber,
    toNumber,
    status,
    provider: "whatsapp",
    providerCallId: callSid,
    conversationId: conversation.id,
    userId: direction === "outbound" ? auth.userId : undefined,
    claimedByUserId: direction === "outbound" ? auth.userId : undefined,
    claimedAt: direction === "outbound" ? now : undefined,
    startedAt: now,
    endedAt: null,
    duration: null,
    notes: appendWhatsAppCallAuditNote(existing?.notes, auditLine),
  }

  const call = existing
    ? await prisma.callLog.update({
      where: { id: existing.id },
      data: callData,
      select: { id: true, callSid: true, status: true },
    })
    : await prisma.callLog.create({
      data: {
        organizationId: auth.orgId,
        callSid,
        ...callData,
      },
      select: { id: true, callSid: true, status: true },
    })

  await storeWhatsAppCallSession({
    organizationId: auth.orgId,
    callId: callSid,
    sdp: SMOKE_SDP_OFFER,
    sdpType: direction === "outbound" ? "answer" : "offer",
    direction,
    fromNumber,
    toNumber,
    conversationId: conversation.id,
  })

  return NextResponse.json({
    success: true,
    data: {
      callLogId: call.id,
      callSid: call.callSid || callSid,
      status: call.status,
      direction,
      conversationId: conversation.id,
      customerPhone,
      permissionId,
      activePopupUserId: direction === "outbound" ? auth.userId : null,
      inboxUrl: `/inbox?conversation=${conversation.id}`,
      warning: "Smoke scenario only: no external Meta call was placed.",
    },
  })
}
