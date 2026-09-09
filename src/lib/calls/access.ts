import type { Prisma } from "@prisma/client"
import { isManagerOrAbove } from "@/lib/constants"
import { checkPermission, type Role } from "@/lib/permissions"

export type CallAccessScope = "voip" | "inbox" | "tickets" | "deals" | "leads" | "companies" | "contacts"

export type CallAccessRow = {
  conversationId?: string | null
  ticketId?: string | null
  dealId?: string | null
  leadId?: string | null
  companyId?: string | null
  contactId?: string | null
  callMode?: string | null
  userId?: string | null
}

export function callAccessScope(call: CallAccessRow): CallAccessScope {
  if (call.ticketId) return "tickets"
  if (call.conversationId) return "inbox"
  if (call.dealId) return "deals"
  if (call.leadId) return "leads"
  if (call.companyId) return "companies"
  if (call.contactId) return "contacts"
  return "voip"
}

export function canReadCall(role: Role, call: CallAccessRow, actorUserId?: string | null): boolean {
  if (role === "admin" || role === "superadmin") return true
  const scope = callAccessScope(call)
  if (!checkPermission(role, scope, "read")) return false
  if (call.callMode === "ai" && !isManagerOrAbove(role)) {
    return Boolean(actorUserId && call.userId === actorUserId)
  }
  return true
}

export function aiCallOwnershipWhere(
  role: Role,
  actorUserId?: string | null,
): Prisma.CallLogWhereInput {
  if (isManagerOrAbove(role)) return {}
  return {
    OR: [
      { callMode: { not: "ai" } },
      { callMode: "ai", userId: actorUserId || "__no_user__" },
    ],
  }
}

export function accessibleCallWhere(role: Role, actorUserId?: string | null): Prisma.CallLogWhereInput {
  if (role === "admin" || role === "superadmin") return {}

  const OR: Prisma.CallLogWhereInput[] = []
  if (checkPermission(role, "tickets", "read")) OR.push({ ticketId: { not: null } })
  if (checkPermission(role, "inbox", "read")) OR.push({ conversationId: { not: null }, ticketId: null })
  if (checkPermission(role, "deals", "read")) OR.push({ dealId: { not: null }, ticketId: null, conversationId: null })
  if (checkPermission(role, "leads", "read")) OR.push({ leadId: { not: null }, ticketId: null, conversationId: null, dealId: null })
  if (checkPermission(role, "companies", "read")) OR.push({ companyId: { not: null }, ticketId: null, conversationId: null, dealId: null, leadId: null })
  if (checkPermission(role, "contacts", "read")) OR.push({ contactId: { not: null }, ticketId: null, conversationId: null, dealId: null, leadId: null, companyId: null })
  if (checkPermission(role, "voip", "read")) {
    OR.push({
      ticketId: null,
      conversationId: null,
      dealId: null,
      leadId: null,
      companyId: null,
      contactId: null,
    })
  }

  if (OR.length === 0) return { id: "__no_access__" }
  const scopeWhere: Prisma.CallLogWhereInput = { OR }
  if (isManagerOrAbove(role)) return scopeWhere
  return {
    AND: [
      scopeWhere,
      aiCallOwnershipWhere(role, actorUserId),
    ],
  }
}

export function callPlaybackPath(callId: string): string {
  return `/api/v1/calls/${encodeURIComponent(callId)}/recording`
}

export function exposeCallForClient<T extends {
  id: string
  recordingUrl?: string | null
  leadCallClaimToken?: string | null
  browserAnswerClaimToken?: string | null
}>(
  call: T,
): Omit<T, "recordingUrl" | "leadCallClaimToken" | "browserAnswerClaimToken"> & { hasRecording: boolean; recordingPlaybackUrl: string | null } {
  const recordingUrl = call.recordingUrl
  const rest = { ...call }
  delete rest.recordingUrl
  delete rest.leadCallClaimToken
  delete rest.browserAnswerClaimToken
  return {
    ...rest,
    hasRecording: Boolean(recordingUrl),
    recordingPlaybackUrl: recordingUrl ? callPlaybackPath(call.id) : null,
  }
}
