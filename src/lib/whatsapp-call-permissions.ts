import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  fetchWhatsAppCallPermissionState,
  resolveWhatsAppConfig,
  type WhatsAppCallPermissionActionState,
  type WhatsAppCallPermissionState,
  type WhatsAppCallPermissionStatus,
} from "@/lib/whatsapp"

export interface WhatsAppCallTarget {
  organizationId: string
  channelConfigId: string
  conversationId: string
  contactId: string | null
  userWaId: string | null
  recipient: string | null
  recipientKey: string
  displayName: string
  businessNumber: string
}

export interface SerializedWhatsAppCallPermission {
  id: string
  status: string
  canRequest: boolean
  canStartCall: boolean
  requestMessageId: string | null
  responseSource: string | null
  isPermanent: boolean
  requestedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  expiresAt: string | null
  lastCheckedAt: string | null
  lastProviderStatus: string | null
  lastError: string | null
  actions: unknown
}

type PermissionRow = {
  id: string
  status: string
  canRequest: boolean
  canStartCall: boolean
  requestMessageId: string | null
  responseSource: string | null
  isPermanent: boolean
  requestedAt: Date | null
  approvedAt: Date | null
  rejectedAt: Date | null
  expiresAt: Date | null
  lastCheckedAt: Date | null
  lastProviderStatus: string | null
  lastError: string | null
  actions: Prisma.JsonValue
}

export function cleanWhatsAppUserWaId(value: string | null | undefined): string | null {
  const cleaned = String(value || "").replace(/[\s\-\(\)]/g, "").replace(/^\+/, "")
  return cleaned ? cleaned : null
}

export function whatsAppCallRecipientKey(input: {
  userWaId?: string | null
  recipient?: string | null
}): string | null {
  const phone = cleanWhatsAppUserWaId(input.userWaId)
  if (phone) return `wa:${phone}`
  const recipient = input.recipient?.trim()
  return recipient ? `bsuid:${recipient}` : null
}

export function serializeWhatsAppCallPermission(row: PermissionRow | null): SerializedWhatsAppCallPermission | null {
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    canRequest: row.canRequest,
    canStartCall: row.canStartCall,
    requestMessageId: row.requestMessageId,
    responseSource: row.responseSource,
    isPermanent: row.isPermanent,
    requestedAt: row.requestedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastProviderStatus: row.lastProviderStatus,
    lastError: row.lastError,
    actions: row.actions,
  }
}

export async function resolveWhatsAppCallTarget(
  organizationId: string,
  conversationId: string,
): Promise<{ target: WhatsAppCallTarget | null; error?: string; status?: number }> {
  const conversation = await prisma.socialConversation.findFirst({
    where: { id: conversationId, organizationId, platform: "whatsapp" },
    select: {
      id: true,
      channelConfigId: true,
      externalId: true,
      contactId: true,
      contactName: true,
    },
  })
  if (!conversation) return { target: null, error: "WhatsApp conversation not found", status: 404 }

  const contact = conversation.contactId
    ? await prisma.contact.findFirst({
        where: { id: conversation.contactId, organizationId },
        select: { phone: true, fullName: true },
      }).catch(() => null)
    : null
  const userWaId = cleanWhatsAppUserWaId(conversation.externalId) || cleanWhatsAppUserWaId(contact?.phone)
  const recipientKey = whatsAppCallRecipientKey({ userWaId })
  if (!recipientKey || !userWaId) {
    return { target: null, error: "WhatsApp user phone is missing for this conversation", status: 400 }
  }

  const config = await resolveWhatsAppConfig(organizationId, { channelConfigId: conversation.channelConfigId })
  if (!config) return { target: null, error: "WhatsApp not configured for this tenant", status: 400 }

  return {
    target: {
      organizationId,
      channelConfigId: config.id,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      userWaId,
      recipient: null,
      recipientKey,
      displayName: contact?.fullName || conversation.contactName || `WhatsApp +${userWaId}`,
      businessNumber: config.displayName || config.phoneNumberId,
    },
  }
}

export async function getLocalWhatsAppCallPermission(target: {
  organizationId: string
  channelConfigId: string
  recipientKey: string
}): Promise<SerializedWhatsAppCallPermission | null> {
  const row = await prisma.whatsAppCallPermission.findUnique({
    where: {
      organizationId_channelConfigId_recipientKey: {
        organizationId: target.organizationId,
        channelConfigId: target.channelConfigId,
        recipientKey: target.recipientKey,
      },
    },
    select: {
      id: true,
      status: true,
      canRequest: true,
      canStartCall: true,
      requestMessageId: true,
      responseSource: true,
      isPermanent: true,
      requestedAt: true,
      approvedAt: true,
      rejectedAt: true,
      expiresAt: true,
      lastCheckedAt: true,
      lastProviderStatus: true,
      lastError: true,
      actions: true,
    },
  })
  return serializeWhatsAppCallPermission(row)
}

function providerExpiresAt(expirationTime: number | null | undefined): Date | null {
  return typeof expirationTime === "number" && Number.isFinite(expirationTime)
    ? new Date(expirationTime * 1000)
    : null
}

function actionsJson(actions: WhatsAppCallPermissionActionState[]): Prisma.InputJsonValue {
  return actions.map((action) => ({
    actionName: action.actionName,
    canPerformAction: action.canPerformAction,
    limits: action.limits,
  })) as unknown as Prisma.InputJsonValue
}

export async function upsertWhatsAppCallPermissionFromProvider(
  target: WhatsAppCallTarget,
  state: WhatsAppCallPermissionState,
): Promise<SerializedWhatsAppCallPermission> {
  const now = new Date()
  const expiresAt = providerExpiresAt(state.expirationTime)
  const data = {
    contactId: target.contactId,
    conversationId: target.conversationId,
    userWaId: target.userWaId,
    recipient: target.recipient,
    status: state.permissionStatus,
    canRequest: state.canRequest,
    canStartCall: state.canStartCall,
    isPermanent: state.permissionStatus === "permanent",
    expiresAt,
    lastCheckedAt: now,
    lastProviderStatus: state.status ? String(state.status) : null,
    lastError: state.success ? null : state.error || "unknown",
    actions: actionsJson(state.actions),
    providerPayload: (state.data || {}) as Prisma.InputJsonValue,
  }
  const row = await prisma.whatsAppCallPermission.upsert({
    where: {
      organizationId_channelConfigId_recipientKey: {
        organizationId: target.organizationId,
        channelConfigId: target.channelConfigId,
        recipientKey: target.recipientKey,
      },
    },
    update: data,
    create: {
      organizationId: target.organizationId,
      channelConfigId: target.channelConfigId,
      recipientKey: target.recipientKey,
      ...data,
    },
    select: {
      id: true,
      status: true,
      canRequest: true,
      canStartCall: true,
      requestMessageId: true,
      responseSource: true,
      isPermanent: true,
      requestedAt: true,
      approvedAt: true,
      rejectedAt: true,
      expiresAt: true,
      lastCheckedAt: true,
      lastProviderStatus: true,
      lastError: true,
      actions: true,
    },
  })
  return serializeWhatsAppCallPermission(row) as SerializedWhatsAppCallPermission
}

export async function refreshWhatsAppCallPermissionForTarget(
  target: WhatsAppCallTarget,
): Promise<{ state: WhatsAppCallPermissionState; permission: SerializedWhatsAppCallPermission }> {
  const state = await fetchWhatsAppCallPermissionState({
    organizationId: target.organizationId,
    channelConfigId: target.channelConfigId,
    userWaId: target.userWaId,
    recipient: target.recipient,
  })
  const permission = await upsertWhatsAppCallPermissionFromProvider(target, state)
  return { state, permission }
}

export async function recordWhatsAppCallPermissionRequest(
  target: WhatsAppCallTarget,
  input: {
    requestMessageId?: string | null
    requestedByUserId?: string | null
    providerPayload?: Record<string, unknown> | null
  },
): Promise<SerializedWhatsAppCallPermission> {
  const now = new Date()
  const row = await prisma.whatsAppCallPermission.upsert({
    where: {
      organizationId_channelConfigId_recipientKey: {
        organizationId: target.organizationId,
        channelConfigId: target.channelConfigId,
        recipientKey: target.recipientKey,
      },
    },
    update: {
      contactId: target.contactId,
      conversationId: target.conversationId,
      userWaId: target.userWaId,
      recipient: target.recipient,
      status: "pending",
      canRequest: false,
      canStartCall: false,
      requestMessageId: input.requestMessageId || null,
      requestedByUserId: input.requestedByUserId || null,
      requestedAt: now,
      lastError: null,
      providerPayload: (input.providerPayload || {}) as Prisma.InputJsonValue,
    },
    create: {
      organizationId: target.organizationId,
      channelConfigId: target.channelConfigId,
      recipientKey: target.recipientKey,
      contactId: target.contactId,
      conversationId: target.conversationId,
      userWaId: target.userWaId,
      recipient: target.recipient,
      status: "pending",
      canRequest: false,
      canStartCall: false,
      requestMessageId: input.requestMessageId || null,
      requestedByUserId: input.requestedByUserId || null,
      requestedAt: now,
      providerPayload: (input.providerPayload || {}) as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      status: true,
      canRequest: true,
      canStartCall: true,
      requestMessageId: true,
      responseSource: true,
      isPermanent: true,
      requestedAt: true,
      approvedAt: true,
      rejectedAt: true,
      expiresAt: true,
      lastCheckedAt: true,
      lastProviderStatus: true,
      lastError: true,
      actions: true,
    },
  })
  return serializeWhatsAppCallPermission(row) as SerializedWhatsAppCallPermission
}

export async function recordWhatsAppCallPermissionReply(input: {
  organizationId: string
  channelConfigId: string
  contactId?: string | null
  conversationId?: string | null
  userWaId?: string | null
  recipient?: string | null
  contextId?: string | null
  response: "accept" | "reject"
  isPermanent?: boolean
  expirationTimestamp?: number | null
  responseSource?: string | null
  payload?: Record<string, unknown>
}): Promise<SerializedWhatsAppCallPermission | null> {
  const recipientKey = whatsAppCallRecipientKey({ userWaId: input.userWaId, recipient: input.recipient })
  if (!recipientKey) return null
  const accepted = input.response === "accept"
  const status: WhatsAppCallPermissionStatus = accepted
    ? (input.isPermanent ? "permanent" : "temporary")
    : "rejected"
  const now = new Date()
  const expiresAt = accepted && !input.isPermanent && input.expirationTimestamp
    ? new Date(input.expirationTimestamp * 1000)
    : null

  const row = await prisma.whatsAppCallPermission.upsert({
    where: {
      organizationId_channelConfigId_recipientKey: {
        organizationId: input.organizationId,
        channelConfigId: input.channelConfigId,
        recipientKey,
      },
    },
    update: {
      contactId: input.contactId || undefined,
      conversationId: input.conversationId || undefined,
      userWaId: cleanWhatsAppUserWaId(input.userWaId),
      recipient: input.recipient || null,
      status,
      canStartCall: accepted,
      canRequest: !accepted,
      contextId: input.contextId || null,
      responseSource: input.responseSource || null,
      isPermanent: Boolean(input.isPermanent),
      approvedAt: accepted ? now : null,
      rejectedAt: accepted ? null : now,
      expiresAt,
      lastError: null,
      providerPayload: (input.payload || {}) as Prisma.InputJsonValue,
    },
    create: {
      organizationId: input.organizationId,
      channelConfigId: input.channelConfigId,
      recipientKey,
      contactId: input.contactId || null,
      conversationId: input.conversationId || null,
      userWaId: cleanWhatsAppUserWaId(input.userWaId),
      recipient: input.recipient || null,
      status,
      canStartCall: accepted,
      canRequest: !accepted,
      contextId: input.contextId || null,
      responseSource: input.responseSource || null,
      isPermanent: Boolean(input.isPermanent),
      approvedAt: accepted ? now : null,
      rejectedAt: accepted ? null : now,
      expiresAt,
      providerPayload: (input.payload || {}) as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      status: true,
      canRequest: true,
      canStartCall: true,
      requestMessageId: true,
      responseSource: true,
      isPermanent: true,
      requestedAt: true,
      approvedAt: true,
      rejectedAt: true,
      expiresAt: true,
      lastCheckedAt: true,
      lastProviderStatus: true,
      lastError: true,
      actions: true,
    },
  })
  return serializeWhatsAppCallPermission(row)
}
