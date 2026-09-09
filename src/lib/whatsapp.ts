import { prisma } from "@/lib/prisma"

// ═══════════════════════════════════════════════════════════════════════
// WhatsApp Cloud API — multi-tenant send library
//
// Per-tenant credentials live in ChannelConfig (accessToken, phoneNumberId,
// businessAccountId, verifyToken, appSecret). The env-var fallback that used
// to route every tenant through LeadDrive's WABA has been removed — if a
// tenant has no whatsapp ChannelConfig row, sending returns null and the
// caller handles the "not configured" case explicitly.
//
// Templates come from the whatsapp_templates table, which is populated by
// syncTemplatesFromMeta(). There are no hardcoded template names anywhere.
// ═══════════════════════════════════════════════════════════════════════

const GRAPH_API_VERSION = "v21.0"
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const CALLING_GRAPH_API_VERSION = process.env.WHATSAPP_CALLING_GRAPH_API_VERSION || "v25.0"
const CALLING_GRAPH_API_BASE = `https://graph.facebook.com/${CALLING_GRAPH_API_VERSION}`

// 24h customer service window in WhatsApp policy. We use 23h to stay safely
// inside the window even with slight clock skew between us and Meta.
const SESSION_WINDOW_HOURS = 23

export interface WhatsAppConfig {
  id: string
  organizationId: string
  accessToken: string
  phoneNumberId: string
  businessAccountId: string | null
  verifyToken: string | null
  appSecret: string | null
  displayName: string | null
}

export type WhatsAppTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION"

export interface CreateWhatsAppTemplateInput {
  name: string
  language: string
  category: WhatsAppTemplateCategory
  bodyText: string
  footerText?: string | null
  sampleValues?: string[]
}

/**
 * Resolve per-tenant WhatsApp config from ChannelConfig. Reads new columns
 * first with legacy aliases as fallback for the transition period. Returns
 * null when the tenant has no whatsapp row or the essential creds are
 * missing — callers must treat null as "not configured".
 */
export async function resolveWhatsAppConfig(
  organizationId: string,
  opts: { channelConfigId?: string | null } = {},
): Promise<WhatsAppConfig | null> {
  if (!organizationId) return null

  const row = await prisma.channelConfig.findFirst({
    where: opts.channelConfigId
      ? { id: opts.channelConfigId, organizationId, channelType: "whatsapp", isActive: true }
      : { organizationId, channelType: "whatsapp", isActive: true },
  })
  if (!row) return null

  // New columns first; fall back to legacy names for un-migrated rows.
  const accessToken   = row.accessToken   || row.apiKey      || null
  const phoneNumberId = row.phoneNumberId || row.phoneNumber || null
  const businessAccountId = row.businessAccountId || row.webhookUrl || null

  if (!accessToken || !phoneNumberId) return null

  return {
    id: row.id,
    organizationId,
    accessToken,
    phoneNumberId,
    businessAccountId,
    verifyToken: row.verifyToken || null,
    appSecret: row.appSecret || null,
    displayName: row.displayName || null,
  }
}

export type WhatsAppCallAction = "pre_accept" | "accept" | "reject" | "terminate"

export interface WhatsAppCallActionResult {
  success: boolean
  status?: number
  data?: Record<string, unknown>
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

async function readJsonObject(res: Response): Promise<Record<string, unknown>> {
  try {
    const value = await res.json()
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function graphErrorMessage(data: Record<string, unknown>, fallback: string): string {
  const err = isRecord(data.error) ? data.error : null
  return typeof err?.message === "string" && err.message.trim() ? err.message : fallback
}

function cleanWhatsAppPhone(value: string): string {
  return value.replace(/[\s\-\(\)]/g, "").replace(/^\+/, "")
}

export type WhatsAppCallPermissionStatus =
  | "unknown"
  | "no_permission"
  | "pending"
  | "temporary"
  | "permanent"
  | "rejected"
  | "expired"

export interface WhatsAppCallPermissionLimit {
  timePeriod: string | null
  currentUsage: number | null
  maxAllowed: number | null
  limitExpirationTime: number | null
}

export interface WhatsAppCallPermissionActionState {
  actionName: "start_call" | "send_call_permission_request" | string
  canPerformAction: boolean
  limits: WhatsAppCallPermissionLimit[]
}

export interface WhatsAppCallPermissionState {
  success: boolean
  status?: number
  permissionStatus: WhatsAppCallPermissionStatus
  expirationTime?: number | null
  canRequest: boolean
  canStartCall: boolean
  actions: WhatsAppCallPermissionActionState[]
  data?: Record<string, unknown>
  error?: string
}

export interface WhatsAppCallPermissionRequestResult {
  success: boolean
  status?: number
  messageId?: string
  data?: Record<string, unknown>
  error?: string
}

export interface WhatsAppOutboundCallResult {
  success: boolean
  status?: number
  callId?: string
  data?: Record<string, unknown>
  error?: string
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizePermissionStatus(value: unknown, expirationTime: number | null): WhatsAppCallPermissionStatus {
  const raw = String(value || "").trim().toLowerCase()
  if (raw === "temporary" || raw === "permanent" || raw === "pending" || raw === "expired" || raw === "no_permission") return raw
  if (raw === "denied" || raw === "reject" || raw === "rejected") return "rejected"
  if (raw === "granted") return expirationTime ? "temporary" : "permanent"
  return "unknown"
}

function normalizePermissionLimits(value: unknown): WhatsAppCallPermissionLimit[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      timePeriod: typeof item.time_period === "string" ? item.time_period : null,
      currentUsage: toNumberOrNull(item.current_usage),
      maxAllowed: toNumberOrNull(item.max_allowed),
      limitExpirationTime: toNumberOrNull(item.limit_expiration_time),
    }))
}

function normalizePermissionActions(value: unknown): WhatsAppCallPermissionActionState[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      actionName: typeof item.action_name === "string" ? item.action_name : "unknown",
      canPerformAction: item.can_perform_action === true,
      limits: normalizePermissionLimits(item.limits),
    }))
}

function permissionAction(
  actions: WhatsAppCallPermissionActionState[],
  name: "start_call" | "send_call_permission_request",
): WhatsAppCallPermissionActionState | null {
  return actions.find((action) => action.actionName === name) ?? null
}

export function parseWhatsAppCallPermissionState(
  data: Record<string, unknown>,
  status?: number,
): WhatsAppCallPermissionState {
  const permission = isRecord(data.permission) ? data.permission : {}
  const expirationTime = toNumberOrNull(permission.expiration_time ?? permission.expiration)
  const actions = normalizePermissionActions(data.actions)
  const startAction = permissionAction(actions, "start_call")
  const requestAction = permissionAction(actions, "send_call_permission_request")
  return {
    success: true,
    status,
    permissionStatus: normalizePermissionStatus(permission.status, expirationTime),
    expirationTime,
    canRequest: requestAction?.canPerformAction === true,
    canStartCall: startAction?.canPerformAction === true,
    actions,
    data,
  }
}

export async function fetchWhatsAppCallPermissionState({
  organizationId,
  channelConfigId,
  userWaId,
  recipient,
}: {
  organizationId: string
  channelConfigId?: string | null
  userWaId?: string | null
  recipient?: string | null
}): Promise<WhatsAppCallPermissionState> {
  const config = await resolveWhatsAppConfig(organizationId, { channelConfigId })
  if (!config) {
    return {
      success: false,
      permissionStatus: "unknown",
      canRequest: false,
      canStartCall: false,
      actions: [],
      error: "WhatsApp not configured for this tenant",
    }
  }

  const params = new URLSearchParams()
  if (userWaId?.trim()) params.set("user_wa_id", cleanWhatsAppPhone(userWaId))
  else if (recipient?.trim()) params.set("recipient", recipient.trim())
  else {
    return {
      success: false,
      permissionStatus: "unknown",
      canRequest: false,
      canStartCall: false,
      actions: [],
      error: "user_wa_id or recipient is required",
    }
  }

  try {
    const res = await fetch(`${CALLING_GRAPH_API_BASE}/${config.phoneNumberId}/call_permissions?${params}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    })
    const data = await readJsonObject(res)
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        permissionStatus: "unknown",
        canRequest: false,
        canStartCall: false,
        actions: [],
        data,
        error: graphErrorMessage(data, `Graph HTTP ${res.status}`),
      }
    }
    return parseWhatsAppCallPermissionState(data, res.status)
  } catch (err: unknown) {
    return {
      success: false,
      permissionStatus: "unknown",
      canRequest: false,
      canStartCall: false,
      actions: [],
      error: err instanceof Error ? err.message : "network error",
    }
  }
}

export async function sendWhatsAppCallPermissionRequest({
  organizationId,
  channelConfigId,
  to,
  recipient,
  body,
}: {
  organizationId: string
  channelConfigId?: string | null
  to?: string | null
  recipient?: string | null
  body?: string | null
}): Promise<WhatsAppCallPermissionRequestResult> {
  const config = await resolveWhatsAppConfig(organizationId, { channelConfigId })
  if (!config) return { success: false, error: "WhatsApp not configured for this tenant" }
  const cleanPhone = to?.trim() ? cleanWhatsAppPhone(to) : null
  if (!cleanPhone && !recipient?.trim()) return { success: false, error: "to or recipient is required" }

  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    type: "interactive",
    interactive: {
      type: "call_permission_request",
      action: { name: "call_permission_request" },
      ...(body?.trim() ? { body: { text: body.trim() } } : {}),
    },
  }
  if (cleanPhone) payload.to = cleanPhone
  if (recipient?.trim()) payload.recipient = recipient.trim()

  try {
    const res = await fetch(`${CALLING_GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await readJsonObject(res)
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        data,
        error: graphErrorMessage(data, `Graph HTTP ${res.status}`),
      }
    }
    const messages = Array.isArray(data.messages) ? data.messages : []
    const first = isRecord(messages[0]) ? messages[0] : null
    return {
      success: true,
      status: res.status,
      messageId: typeof first?.id === "string" ? first.id : undefined,
      data,
    }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "network error" }
  }
}

export async function startWhatsAppOutboundCall({
  organizationId,
  channelConfigId,
  to,
  recipient,
  sdp,
  bizOpaqueCallbackData,
}: {
  organizationId: string
  channelConfigId?: string | null
  to?: string | null
  recipient?: string | null
  sdp: string
  bizOpaqueCallbackData?: string | null
}): Promise<WhatsAppOutboundCallResult> {
  const config = await resolveWhatsAppConfig(organizationId, { channelConfigId })
  if (!config) return { success: false, error: "WhatsApp not configured for this tenant" }
  const cleanPhone = to?.trim() ? cleanWhatsAppPhone(to) : null
  if (!cleanPhone && !recipient?.trim()) return { success: false, error: "to or recipient is required" }

  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    action: "connect",
    session: {
      sdp_type: "offer",
      sdp,
    },
  }
  if (cleanPhone) payload.to = cleanPhone
  if (recipient?.trim()) payload.recipient = recipient.trim()
  if (bizOpaqueCallbackData?.trim()) payload.biz_opaque_callback_data = bizOpaqueCallbackData.trim().slice(0, 512)

  try {
    const res = await fetch(`${CALLING_GRAPH_API_BASE}/${config.phoneNumberId}/calls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await readJsonObject(res)
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        data,
        error: graphErrorMessage(data, `Graph HTTP ${res.status}`),
      }
    }
    const calls = Array.isArray(data.calls) ? data.calls : []
    const first = isRecord(calls[0]) ? calls[0] : null
    return {
      success: true,
      status: res.status,
      callId: typeof first?.id === "string" ? first.id : undefined,
      data,
    }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "network error" }
  }
}

/**
 * Send a WhatsApp Calling control action to Meta for an existing call id.
 * The browser/media layer owns SDP generation; this helper only forwards the
 * short-lived SDP answer and never persists it.
 */
export async function sendWhatsAppCallAction({
  organizationId,
  channelConfigId,
  callId,
  action,
  sdp,
  sdpType = "answer",
}: {
  organizationId: string
  channelConfigId?: string | null
  callId: string
  action: WhatsAppCallAction
  sdp?: string
  sdpType?: "offer" | "answer"
}): Promise<WhatsAppCallActionResult> {
  const config = await resolveWhatsAppConfig(organizationId, { channelConfigId })
  if (!config) {
    return { success: false, error: "WhatsApp not configured for this tenant" }
  }

  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    call_id: callId,
    action,
  }
  if (sdp?.trim()) {
    body.session = { sdp_type: sdpType, sdp }
  }

  try {
    const res = await fetch(`${CALLING_GRAPH_API_BASE}/${config.phoneNumberId}/calls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await readJsonObject(res)
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        data,
        error: graphErrorMessage(data, `Graph HTTP ${res.status}`),
      }
    }
    return { success: true, status: res.status, data }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "network error" }
  }
}

/**
 * Approved templates for a tenant. Use in UI pickers and send endpoints.
 */
export async function listApprovedTemplates(
  organizationId: string,
  opts: { language?: string; category?: string } = {},
) {
  return prisma.whatsAppTemplate.findMany({
    where: {
      organizationId,
      status: "APPROVED",
      ...(opts.language ? { language: opts.language } : {}),
      ...(opts.category ? { category: opts.category } : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  })
}

/**
 * Helper to check whether we're inside the 24h customer service window.
 * Looks for the most recent inbound WhatsApp message from the same phone.
 */
async function insideSessionWindow(
  organizationId: string,
  toPhone: string,
): Promise<boolean> {
  const clean = toPhone.replace(/[^0-9]/g, "").slice(-10)
  const inbound = await prisma.channelMessage
    .findFirst({
      where: {
        organizationId,
        direction: "inbound",
        channelType: "whatsapp",
        OR: [
          { from: { contains: clean } },
          { metadata: { path: ["waPhone"], string_contains: clean } as any },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
    .catch(() => null)

  if (!inbound) return false
  const hours = (Date.now() - inbound.createdAt.getTime()) / (1000 * 60 * 60)
  return hours < SESSION_WINDOW_HOURS
}

// ─── Free-form text send ─────────────────────────────────────────────
//
// Allowed ONLY when the tenant is inside the 24h customer service window
// with the recipient. Outside that window Meta requires a pre-approved
// template — see sendWhatsAppTemplate.
export async function sendWhatsAppText({
  to,
  body,
  organizationId,
  contactId,
  leadId,
  skipLog,
}: {
  to: string
  body: string
  organizationId: string
  contactId?: string
  leadId?: string
  /** Caller persists its own canonical conversation-linked ChannelMessage. */
  skipLog?: boolean
}): Promise<{ success: boolean; messageId?: string; error?: string; hint?: string }> {
  const config = await resolveWhatsAppConfig(organizationId)
  if (!config) {
    return { success: false, error: "WhatsApp not configured for this tenant" }
  }

  const cleanPhone = to.replace(/[\s\-\(\)]/g, "").replace(/^\+/, "")
  const windowOk = await insideSessionWindow(organizationId, cleanPhone)
  if (!windowOk) {
    return {
      success: false,
      error: "outside_window_no_template",
      hint: "This recipient hasn't messaged you in 23h. Use sendWhatsAppTemplate with an approved template.",
    }
  }

  try {
    const res = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: "text",
        text: { body },
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      const err = data?.error?.message || `HTTP ${res.status}`
      if (!skipLog) await logMessage(organizationId, config, cleanPhone, body, "failed", contactId, { error: err }, leadId)
      return { success: false, error: err }
    }

    const messageId = data?.messages?.[0]?.id
    if (!skipLog) await logMessage(organizationId, config, cleanPhone, body, "delivered", contactId, { waMessageId: messageId }, leadId)
    return { success: true, messageId }
  } catch (err: any) {
    const msg = err?.message || "network error"
    if (!skipLog) await logMessage(organizationId, config, cleanPhone, body, "failed", contactId, { error: msg }, leadId)
    return { success: false, error: msg }
  }
}

// ─── Template send ───────────────────────────────────────────────────
//
// Required for outbound messages outside the 24h window AND for any first-
// contact outreach. Template must be APPROVED in Meta Business Manager and
// present in the whatsapp_templates table (populated via syncTemplatesFromMeta).
export async function sendWhatsAppTemplate({
  to,
  templateName,
  languageCode,
  variables,
  organizationId,
  contactId,
  leadId,
}: {
  to: string
  templateName: string
  languageCode?: string  // if omitted we resolve from the stored template
  variables?: Record<string, string> | string[]
  organizationId: string
  contactId?: string
  leadId?: string
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const config = await resolveWhatsAppConfig(organizationId)
  if (!config) {
    return { success: false, error: "WhatsApp not configured for this tenant" }
  }

  // Resolve template spec from DB. If languageCode is given we match on it,
  // otherwise we take the first APPROVED match by name. When the template
  // isn't in our DB we still try to send — Meta will reject if the tenant's
  // WABA doesn't actually have it approved. This way the built-in
  // `hello_world` sample works before the first templates-sync, and we
  // avoid a chicken-and-egg problem on first-time credential validation.
  const template = await prisma.whatsAppTemplate.findFirst({
    where: {
      organizationId,
      name: templateName,
      status: "APPROVED",
      ...(languageCode ? { language: languageCode } : {}),
    },
  })

  const lang = languageCode || template?.language || "en_US"
  const cleanPhone = to.replace(/[\s\-\(\)]/g, "").replace(/^\+/, "")

  // Build components from stored variables + caller-supplied values.
  // Stored variables are either named parameters (if Meta returned them) or
  // positional {{1}}..{{N}}. We support both shapes of `variables` input.
  const bodyParams: any[] = []
  if (variables) {
    if (Array.isArray(variables)) {
      for (const val of variables) bodyParams.push({ type: "text", text: String(val) })
    } else if (template) {
      for (const key of template.variables) {
        const val = variables[key] ?? ""
        const isPositional = /^\d+$/.test(key)
        bodyParams.push(
          isPositional
            ? { type: "text", text: String(val) }
            : { type: "text", parameter_name: key, text: String(val) },
        )
      }
    }
  }

  const components = bodyParams.length > 0
    ? [{ type: "body", parameters: bodyParams }]
    : []

  try {
    const res = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: templateName,
          language: { code: lang },
          ...(components.length ? { components } : {}),
        },
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      const err = data?.error?.message || `HTTP ${res.status}`
      await logMessage(organizationId, config, cleanPhone, `[template:${templateName}]`, "failed", contactId, { error: err, template: templateName }, leadId)
      return { success: false, error: err }
    }

    const messageId = data?.messages?.[0]?.id
    await logMessage(organizationId, config, cleanPhone, `[template:${templateName}]`, "delivered", contactId, {
      waMessageId: messageId, template: templateName, language: lang,
    }, leadId)
    return { success: true, messageId }
  } catch (err: any) {
    const msg = err?.message || "network error"
    await logMessage(organizationId, config, cleanPhone, `[template:${templateName}]`, "failed", contactId, { error: msg, template: templateName }, leadId)
    return { success: false, error: msg }
  }
}

// ─── Facade for existing callsites ───────────────────────────────────
//
// Kept for backward compatibility with the 8 callsites documented in the
// phase-1 audit. If `templateName` is passed we send via template. Otherwise
// we try free-form; outside the session window we return a structured error
// (no more hardcoded "invoice_payment_reminder" fallback).
export async function sendWhatsAppMessage({
  to,
  message,
  organizationId,
  contactId,
  leadId,
  templateName,
  templateLanguage,
  templateVariables,
  forceText,
  skipLog,
  extraMetadata,
}: {
  to: string
  message: string
  organizationId?: string
  contactId?: string
  leadId?: string
  sentBy?: string
  templateName?: string
  templateLanguage?: string
  templateVariables?: Record<string, string> | string[]
  forceText?: boolean
  // Suppress the internal outbound ChannelMessage log. For callers
  // that record their OWN canonical row — e.g. chatbot auto-reply, which logs a single
  // conversation-linked row with autoReply metadata. Default false → logs as before.
  skipLog?: boolean
  // A4 — extra keys merged into the logged ChannelMessage.metadata (e.g. aiAutoReply/aiQuality
  // from the Da Vinci auto-reply, so the inbox thread can badge AI-generated messages).
  extraMetadata?: Record<string, unknown>
}) {
  if (!organizationId) {
    return { success: false, error: "organizationId required" }
  }

  if (templateName) {
    return sendWhatsAppTemplate({
      to,
      templateName,
      languageCode: templateLanguage,
      variables: templateVariables,
      organizationId,
      contactId,
      leadId,
    })
  }

  // forceText=true callers bypass the window check (they already know).
  if (forceText) {
    const config = await resolveWhatsAppConfig(organizationId)
    if (!config) return { success: false, error: "WhatsApp not configured for this tenant" }
    const cleanPhone = to.replace(/[\s\-\(\)]/g, "").replace(/^\+/, "")
    try {
      const res = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanPhone,
          type: "text",
          text: { body: message },
        }),
        // A hung Graph API must not stall an awaiting caller (e.g. the webhook ingest
        // path that now awaits an auto-reply send). 10s is generous for a send.
        signal: AbortSignal.timeout(10_000),
      })
      const data = await res.json()
      if (!res.ok) {
        const err = data?.error?.message || `HTTP ${res.status}`
        if (!skipLog) await logMessage(organizationId, config, cleanPhone, message, "failed", contactId, { error: err, ...(extraMetadata ?? {}) }, leadId)
        return { success: false, error: err }
      }
      const messageId = data?.messages?.[0]?.id
      if (!skipLog) await logMessage(organizationId, config, cleanPhone, message, "delivered", contactId, { waMessageId: messageId, ...(extraMetadata ?? {}) }, leadId)
      return { success: true, messageId }
    } catch (err: any) {
      const msg = err?.message || "network error"
      if (!skipLog) await logMessage(organizationId, config, cleanPhone, message, "failed", contactId, { error: msg, ...(extraMetadata ?? {}) }, leadId)
      return { success: false, error: msg }
    }
  }

  return sendWhatsAppText({ to, body: message, organizationId, contactId, leadId, skipLog })
}

/**
 * Send an OUTBOUND media message (media SEND, Slice 3b). Two-step Cloud API flow that keeps our
 * /uploads private: (1) upload the bytes to WhatsApp `POST /{phone-id}/media` → media_id, (2) send
 * the message referencing that id. Does NOT log a ChannelMessage — the POST /api/v1/inbox caller
 * persists the outbound row with mediaUrl pointing at our own /uploads copy.
 */
export async function sendWhatsAppMedia({
  to,
  buffer,
  mime,
  filename,
  caption,
  organizationId,
}: {
  to: string
  buffer: Buffer
  mime: string
  filename: string
  caption?: string
  organizationId: string
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const config = await resolveWhatsAppConfig(organizationId)
  if (!config) return { success: false, error: "WhatsApp not configured for this tenant" }
  const cleanPhone = to.replace(/[\s\-\(\)]/g, "").replace(/^\+/, "")
  const waType = mime.startsWith("image/") ? "image"
    : mime.startsWith("video/") ? "video"
    : mime.startsWith("audio/") ? "audio"
    : "document"
  try {
    // 1. Upload the media to WhatsApp (multipart) → media_id.
    const fd = new FormData()
    fd.append("messaging_product", "whatsapp")
    fd.append("type", mime)
    fd.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename)
    const upRes = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}` },
      body: fd,
      signal: AbortSignal.timeout(25_000),
    })
    const upData = await upRes.json()
    if (!upRes.ok || !upData?.id) {
      return { success: false, error: upData?.error?.message || `media upload HTTP ${upRes.status}` }
    }

    // 2. Send the message referencing the uploaded media id.
    const mediaObj: Record<string, unknown> = { id: upData.id }
    if (caption && waType !== "audio") mediaObj.caption = caption
    if (waType === "document") mediaObj.filename = filename
    const sendRes = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: waType,
        [waType]: mediaObj,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const sendData = await sendRes.json()
    if (!sendRes.ok) {
      return { success: false, error: sendData?.error?.message || `send HTTP ${sendRes.status}` }
    }
    return { success: true, messageId: sendData?.messages?.[0]?.id }
  } catch (err: any) {
    return { success: false, error: err?.message || "network error" }
  }
}

// ─── Template sync with Meta ────────────────────────────────────────
//
// Fetches approved templates from Graph API and upserts them into the
// whatsapp_templates table. Called from the admin UI "Sync" button.
export async function syncTemplatesFromMeta(organizationId: string): Promise<{
  success: boolean
  synced: number
  error?: string
}> {
  const config = await resolveWhatsAppConfig(organizationId)
  if (!config) {
    return { success: false, synced: 0, error: "WhatsApp not configured" }
  }
  if (!config.businessAccountId) {
    return { success: false, synced: 0, error: "businessAccountId missing — configure it in /settings/channels/whatsapp" }
  }

  let totalSynced = 0
  let nextUrl: string | null = `${GRAPH_API_BASE}/${config.businessAccountId}/message_templates?fields=name,language,status,category,components&limit=100`

  try {
    while (nextUrl) {
      const res: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      })
      const data: any = await res.json()
      if (!res.ok) {
        return { success: false, synced: totalSynced, error: data?.error?.message || `HTTP ${res.status}` }
      }

      for (const t of (data.data || []) as any[]) {
        const { variables, bodyText, headerType, headerText, footerText, buttons } = extractTemplateParts(t.components || [])

        await prisma.whatsAppTemplate.upsert({
          where: {
            organizationId_name_language: {
              organizationId,
              name: t.name,
              language: t.language,
            },
          },
          update: {
            channelConfigId: config.id,
            status: t.status || "PENDING",
            category: t.category || "UTILITY",
            bodyText, headerType, headerText, footerText,
            buttons, variables,
            rawMeta: t,
            lastSyncAt: new Date(),
          },
          create: {
            organizationId,
            channelConfigId: config.id,
            metaTemplateId: t.id?.toString() || null,
            name: t.name,
            language: t.language,
            status: t.status || "PENDING",
            category: t.category || "UTILITY",
            bodyText, headerType, headerText, footerText,
            buttons, variables,
            rawMeta: t,
          },
        })
        totalSynced++
      }

      nextUrl = data.paging?.next || null
    }

    await prisma.channelConfig.update({
      where: { id: config.id },
      data: { lastTemplateSyncAt: new Date() },
    })

    return { success: true, synced: totalSynced }
  } catch (err: any) {
    return { success: false, synced: totalSynced, error: err?.message || "network error" }
  }
}

export function normalizeWhatsAppTemplateName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function extractPositionalTemplateVariables(bodyText: string): string[] {
  const matches = bodyText.match(/\{\{\d+\}\}/g) || []
  return Array.from(new Set(matches.map((match) => match.replace(/[{}]/g, ""))))
}

export async function createWhatsAppTemplateInMeta(
  organizationId: string,
  input: CreateWhatsAppTemplateInput,
): Promise<{
  success: boolean
  status?: number
  template?: {
    id: string
    name: string
    language: string
    category: string
    status: string
    metaTemplateId: string | null
  }
  error?: string
  data?: Record<string, unknown>
}> {
  const config = await resolveWhatsAppConfig(organizationId)
  if (!config) {
    return { success: false, error: "WhatsApp not configured" }
  }
  if (!config.businessAccountId) {
    return { success: false, error: "businessAccountId missing — configure it in /settings/channels/whatsapp" }
  }

  const name = normalizeWhatsAppTemplateName(input.name)
  const language = input.language.trim()
  const category = input.category
  const bodyText = input.bodyText.trim()
  const footerText = input.footerText?.trim() || null

  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    return { success: false, error: "Template name must contain only lowercase letters, numbers, and underscores" }
  }
  if (!language || language.length > 20) {
    return { success: false, error: "Template language is required" }
  }
  if (!bodyText) {
    return { success: false, error: "Template body is required" }
  }

  const variables = extractPositionalTemplateVariables(bodyText)
  const sampleValues = input.sampleValues || []
  const bodyComponent: Record<string, unknown> = {
    type: "BODY",
    text: bodyText,
  }
  if (variables.length > 0) {
    bodyComponent.example = {
      body_text: [variables.map((variable, index) => sampleValues[index]?.trim() || `Sample ${variable}`)],
    }
  }

  const components: Record<string, unknown>[] = [bodyComponent]
  if (footerText) {
    components.push({ type: "FOOTER", text: footerText })
  }

  try {
    const res = await fetch(`${GRAPH_API_BASE}/${config.businessAccountId}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        language,
        category,
        components,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const data = await readJsonObject(res)
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        error: graphErrorMessage(data, `Graph HTTP ${res.status}`),
        data,
      }
    }

    const status = typeof data.status === "string" ? data.status : "PENDING"
    const metaTemplateId = typeof data.id === "string" || typeof data.id === "number"
      ? String(data.id)
      : null

    const template = await prisma.whatsAppTemplate.upsert({
      where: {
        organizationId_name_language: {
          organizationId,
          name,
          language,
        },
      },
      update: {
        channelConfigId: config.id,
        metaTemplateId,
        status,
        category,
        bodyText,
        headerType: null,
        headerText: null,
        footerText,
        buttons: null,
        variables,
        rawMeta: { ...data, components },
        lastSyncAt: new Date(),
      },
      create: {
        organizationId,
        channelConfigId: config.id,
        metaTemplateId,
        name,
        language,
        status,
        category,
        bodyText,
        headerType: null,
        headerText: null,
        footerText,
        buttons: null,
        variables,
        rawMeta: { ...data, components },
      },
    })

    await prisma.channelConfig.update({
      where: { id: config.id },
      data: { lastTemplateSyncAt: new Date() },
    })

    return {
      success: true,
      status: res.status,
      template: {
        id: template.id,
        name: template.name,
        language: template.language,
        category: template.category,
        status: template.status,
        metaTemplateId: template.metaTemplateId,
      },
      data,
    }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "network error" }
  }
}

function extractTemplateParts(components: any[]): {
  variables: string[]
  bodyText: string | null
  headerType: string | null
  headerText: string | null
  footerText: string | null
  buttons: any
} {
  let bodyText: string | null = null
  let headerType: string | null = null
  let headerText: string | null = null
  let footerText: string | null = null
  let buttons: any = null
  const variables = new Set<string>()

  for (const c of components) {
    if (c.type === "BODY") {
      bodyText = c.text || null
      // Prefer named parameters when Meta returns them.
      const named: string[] = c.example?.body_text_named_params?.map((p: any) => p.param_name) || []
      if (named.length) {
        for (const n of named) variables.add(n)
      } else if (bodyText) {
        const matches = bodyText.match(/\{\{\d+\}\}/g) || []
        for (const m of matches) variables.add(m.replace(/[{}]/g, ""))
      }
    } else if (c.type === "HEADER") {
      headerType = c.format || null
      headerText = c.text || null
    } else if (c.type === "FOOTER") {
      footerText = c.text || null
    } else if (c.type === "BUTTONS") {
      buttons = c.buttons || c
    }
  }

  return {
    variables: Array.from(variables),
    bodyText,
    headerType,
    headerText,
    footerText,
    buttons,
  }
}

// ─── Validate credentials ────────────────────────────────────────────
export async function validateWhatsAppCredentials(
  organizationId: string,
): Promise<{ ok: boolean; verifiedName?: string; displayPhoneNumber?: string; error?: string }> {
  const config = await resolveWhatsAppConfig(organizationId)
  if (!config) return { ok: false, error: "WhatsApp not configured" }

  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${config.phoneNumberId}?fields=verified_name,display_phone_number`,
      { headers: { Authorization: `Bearer ${config.accessToken}` } },
    )
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` }

    await prisma.channelConfig.update({
      where: { id: config.id },
      data: { lastValidatedAt: new Date() },
    })

    return {
      ok: true,
      verifiedName: data.verified_name,
      displayPhoneNumber: data.display_phone_number,
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "network error" }
  }
}

// ─── internal: message log helper ────────────────────────────────────
async function logMessage(
  organizationId: string,
  config: WhatsAppConfig,
  to: string,
  body: string,
  status: "delivered" | "failed",
  contactId: string | undefined,
  extraMeta: Record<string, any>,
  leadId?: string,
) {
  try {
    await prisma.channelMessage.create({
      data: {
        organizationId,
        channelConfigId: config.id,
        direction: "outbound",
        channelType: "whatsapp",
        from: config.phoneNumberId,
        to,
        body,
        status,
        externalId: extraMeta.waMessageId,
        metadata: { channel: "whatsapp", ...extraMeta },
        contactId,
        leadId,
      },
    })
  } catch { /* logging failure must not break the send flow */ }
}
