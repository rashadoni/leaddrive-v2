// E1.1a — Conversation Automation Engine: the ACTION EXECUTOR.
//
// A small, tenant-guarded dispatcher that performs one automation action on a
// conversation. It is the action layer the flow runner (E1.1b) will call once per
// node; here it is independently unit-tested and has ZERO prod wiring yet (no inbox
// ingest calls it), so landing it changes no live behavior.
//
import { createHash, randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { createTicketWithAssignment } from "@/lib/ticket-factory"
import { sendConversationReply, type ConversationReplyChannel } from "@/lib/inbox/send-conversation-reply"
import { claimConversationAiReply, generateChannelAiReply, releaseConversationAiReplyClaim } from "@/lib/social/ai-autoreply"
import { readAiReplyPolicy, decideAiReplyAction } from "@/lib/inbox/ai-reply-gate"
import { saveConversationAiDraft } from "@/lib/inbox/ai-draft"
import { routeConversation } from "@/lib/inbox/conversation-routing"
import { getBusinessHoursDecision } from "@/lib/inbox/business-hours"
import {
  maybeCreateQualifiedLeadTask,
  type InboxQualificationResult,
} from "@/lib/inbox/lead-qualification"

export type ConversationActionType =
  | "assign" // set assignedTo (a user id, or null to unassign)
  | "categorize" // set metadata.category (merged, doesn't clobber other metadata)
  | "close" // status = resolved
  | "create_ticket" // open a ticket from the conversation (reuses ticket factory)
  | "update_field" // allow-listed contact write-back (category/source/lifecycle/tags)
  | "notify" // createNotification to a user (or the whole org)
  | "add_participant" // add an internal collaborator to the conversation
  | "handoff_agent" // AI→human transfer: assign to a target user + record a handoff marker
  | "send_reply" // send configured text on the conversation's channel
  | "menu" // send/resolve an IVR-style option menu; branches as option:<id>
  | "ai_reply" // generate a budget-guarded reply, then send on the conversation's channel
  | "assign_to_queue" // E1.2 auto-route to a TeamQueue
  | "reroute_if_unanswered" // E1.2 mitigation: after no outbound ack, route away from the current assignee
  | "business_hours_gate" // N2: branch success=in-hours, failure=away/off-hours

export const CONVERSATION_ACTION_TYPES: ConversationActionType[] = [
  "assign",
  "categorize",
  "close",
  "create_ticket",
  "update_field",
  "notify",
  "add_participant",
  "handoff_agent",
  "send_reply",
  "menu",
  "ai_reply",
  "assign_to_queue",
  "reroute_if_unanswered",
  "business_hours_gate",
]

const AI_REPLY_CHANNELS = new Set(["facebook", "instagram", "telegram", "vkontakte", "tiktok"])
const REPLY_CHANNELS = new Set(["email", "telegram", "sms", "whatsapp", "tiktok", "facebook", "instagram", "vkontakte"])

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function effectiveConversationChannel(conversation: Pick<ConversationSnapshot, "platform" | "metadata">): string {
  const inboxChannel = conversation.platform === "inbox" ? metadataString(conversation.metadata, "channel") : null
  return inboxChannel || conversation.platform
}

function stripAddressPrefix(channel: string, externalId: string): string {
  if (channel === "email" && externalId.startsWith("e:")) return externalId.slice(2)
  if (channel === "sms" && externalId.startsWith("p:")) return externalId.slice(2)
  return externalId
}

async function resolveReplyTarget(ctx: ConversationActionContext, channel: ConversationReplyChannel): Promise<string | null> {
  const externalTarget = stripAddressPrefix(channel, ctx.conversation.externalId).trim()

  if (channel === "email") {
    const target =
      metadataString(ctx.conversation.metadata, "contactEmail")
      || (externalTarget.includes("@") ? externalTarget : null)
      || (ctx.conversation.contactId
        ? (await prisma.contact.findFirst({
            where: { id: ctx.conversation.contactId, organizationId: ctx.organizationId },
            select: { email: true },
          }))?.email
        : null)
    return target?.trim() || null
  }

  if (channel === "sms") {
    const target =
      metadataString(ctx.conversation.metadata, "contactPhone")
      || (!externalTarget.startsWith("c:") && !externalTarget.startsWith("w:") ? externalTarget : null)
      || (ctx.conversation.contactId
        ? (await prisma.contact.findFirst({
            where: { id: ctx.conversation.contactId, organizationId: ctx.organizationId },
            select: { phone: true },
          }))?.phone
        : null)
    return target?.trim() || null
  }

  return externalTarget || null
}

/** Multi-tenant guard for assignment targets. `SocialConversation.assignedTo` is a loose string
 *  (no FK), so a flow graph config could otherwise assign a conversation to a user from ANOTHER
 *  org. Verify the target user actually belongs to this org before writing it. */
async function userInOrg(userId: string, orgId: string): Promise<boolean> {
  const u = await prisma.user.findFirst({ where: { id: userId, organizationId: orgId }, select: { id: true } })
  return !!u
}

/** Operation-length hold for the flow `ai_reply` claim — covers LLM generate + channel send so a
 *  concurrent flow run can't reclaim mid-flight and double-send (Codex review #1). Auto-recovers. */
const AI_FLOW_CLAIM_MS = 120_000
const DEFAULT_REROUTE_AFTER_MINUTES = 5
const MAX_REROUTE_AFTER_MINUTES = 24 * 60
const CONTACT_STRING_FIELDS = new Set(["contact.category", "contact.source", "category", "source"])
const CONTACT_LIFECYCLE_FIELDS = new Set(["contact.lifecycleStage", "lifecycleStage"])
const CONTACT_TAG_FIELDS = new Set(["contact.tags", "tags"])
const CONTACT_LIFECYCLE_STAGES = new Set(["lead", "engaged", "mql", "sql", "opportunity", "customer", "churned"])

function configNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) ? n : fallback
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function routingAssignedAt(metadata: unknown, fallback: Date): Date {
  const routing = objectRecord(objectRecord(metadata).routing)
  const raw = routing.assignedAt
  if (typeof raw !== "string") return fallback
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

function rerouteAfterMinutes(config: Record<string, unknown>): number {
  const raw = config.afterMinutes ?? config.timeoutMinutes ?? config.waitMinutes
  return Math.max(1, Math.min(MAX_REROUTE_AFTER_MINUTES, Math.floor(configNumber(raw, DEFAULT_REROUTE_AFTER_MINUTES))))
}

function normalizeFieldValue(value: unknown): string {
  return String(value ?? "").trim().slice(0, 120)
}

function normalizeTagsValue(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",")
  return Array.from(new Set(raw.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))).slice(0, 25)
}

interface MenuOption {
  id: string
  label: string
  match: string[]
}

function normalizeMenuInput(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

function slugOptionId(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_а-яёəöüğıçş]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
  return slug || fallback
}

function normalizeMenuOptions(value: unknown): MenuOption[] {
  const rawOptions = Array.isArray(value) ? value : []
  return rawOptions
    .map((raw, index): MenuOption | null => {
      if (!raw || typeof raw !== "object") return null
      const option = raw as Record<string, unknown>
      const label = String(option.label ?? option.text ?? option.title ?? "").trim()
      if (!label) return null
      const fallbackId = `option_${index + 1}`
      const id = slugOptionId(String(option.id ?? option.value ?? label), fallbackId)
      const rawMatch = Array.isArray(option.match)
        ? option.match
        : Array.isArray(option.matches)
          ? option.matches
          : option.match != null
            ? [option.match]
            : []
      const match = Array.from(new Set([
        String(index + 1),
        id,
        label,
        ...rawMatch.map((item) => String(item ?? "")),
      ].map((item) => item.trim()).filter(Boolean)))
      return { id, label, match }
    })
    .filter((option): option is MenuOption => Boolean(option))
    .slice(0, 12)
}

function findSelectedMenuOption(options: MenuOption[], message: string): MenuOption | null {
  const normalized = normalizeMenuInput(message)
  if (!normalized) return null
  return options.find((option) =>
    option.match.some((matcher) => normalizeMenuInput(matcher) === normalized),
  ) ?? null
}

function buildMenuBody(prompt: string, options: MenuOption[]): string {
  const lines = options.map((option, index) => `${index + 1}. ${option.label}`)
  return [prompt.trim(), lines.join("\n")].filter(Boolean).join("\n\n")
}

/** On escalate, the AI just told the customer a human is coming — notify the inbox team so the
 *  promise isn't dead (Codex review #3; mirrors the webhook path `maybeAiAutoReply`). Best-effort. */
async function notifyEscalationTeam(orgId: string, platform: string, conversationId: string): Promise<void> {
  try {
    const team = await prisma.user.findMany({
      where: { organizationId: orgId, role: { in: ["admin", "manager", "support"] }, isActive: true },
      select: { id: true },
    })
    await Promise.all(
      team.map((u: { id: string }) =>
        createNotification({
          organizationId: orgId,
          userId: u.id,
          type: "warning",
          title: "Бот эскалировал диалог",
          message: `AI-ассистент передал диалог (${platform}) оператору — нужен ответ человека`,
          entityType: "inbox_message",
          entityId: conversationId,
          kind: "inbox.message",
          push: true,
        }).catch(() => {}),
      ),
    )
  } catch {
    /* notification failure must not affect the reply */
  }
}

/** Snapshot of the conversation the actions operate on — the caller (runner) fetches
 *  it once and passes it in, so each action avoids a redundant re-query. */
export interface ConversationSnapshot {
  id: string
  contactId: string | null
  contactName: string
  platform: string
  externalId: string
  channelConfigId: string | null
  lastMessage: string
  status: string
  assignedTo: string | null
  metadata: Record<string, unknown> | null
}

export interface ConversationActionContext {
  organizationId: string
  conversationId: string
  conversation: ConversationSnapshot
  /** Who/what triggered the action (for addedBy/createdBy). null = system. */
  actorUserId?: string | null
  /** Server-owned flow run/node identity. Absent for callers (such as bulk)
   *  that already own an outer durable operation ledger. */
  deliveryOperationId?: string
}

function actionDeliveryIdempotency(
  ctx: ConversationActionContext,
  action: "send_reply" | "menu" | "ai_reply",
): NonNullable<Parameters<typeof sendConversationReply>[0]["deliveryIdempotency"]> {
  if (ctx.deliveryOperationId) {
    return {
      source: "flow",
      key: createHash("sha256")
        .update(`flow:${ctx.organizationId}:${ctx.conversationId}:${ctx.deliveryOperationId}:${action}`)
        .digest("hex"),
    }
  }
  // Non-run callers must already own their replay boundary (the bulk close
  // route does). This bounded server UUID still gives the transport ledger a
  // valid, source-scoped identity for the one invocation.
  return { source: "action", key: randomUUID() }
}

export interface ConversationAction {
  type: ConversationActionType
  config?: Record<string, unknown>
}

export type ConversationActionResult =
  | { ok: true; action: ConversationActionType; detail?: Record<string, unknown>; branch?: string }
  | { ok: false; action: ConversationActionType; error: string; detail?: Record<string, unknown>; terminal?: boolean }

export async function executeConversationAction(
  action: ConversationAction,
  ctx: ConversationActionContext,
): Promise<ConversationActionResult> {
  const orgId = ctx.organizationId
  const cid = ctx.conversationId
  const config = action.config ?? {}

  try {
    switch (action.type) {
      case "assign": {
        const assignee = (config.assignTo ?? config.userId ?? null) as string | null
        // null = unassign (no target to validate). A non-null target must be in THIS org.
        if (assignee && !(await userInOrg(assignee, orgId))) {
          return { ok: false, action: action.type, error: "target_not_in_org" }
        }
        const r = await prisma.socialConversation.updateMany({
          where: { id: cid, organizationId: orgId },
          data: { assignedTo: assignee },
        })
        if (r.count === 0) return { ok: false, action: action.type, error: "not_found" }
        return { ok: true, action: action.type, detail: { assignedTo: assignee } }
      }

      case "categorize": {
        const category = String(config.category ?? "").trim()
        if (!category) return { ok: false, action: action.type, error: "no_category" }
        // Merge into the caller's metadata snapshot to keep sibling keys. NOTE: last-write-
        // wins on the whole JSON from a snapshot — a concurrent metadata write could lose
        // keys. Fine while headless (E1.1a); E1.1b switches to a race-safe jsonb merge when
        // the runner wires this live (recorded in deferred_findings).
        const merged = { ...(ctx.conversation.metadata ?? {}), category }
        const r = await prisma.socialConversation.updateMany({
          where: { id: cid, organizationId: orgId },
          data: { metadata: merged },
        })
        if (r.count === 0) return { ok: false, action: action.type, error: "not_found" }
        return { ok: true, action: action.type, detail: { category } }
      }

      case "close": {
        // Outcome is validated by the caller (normalizeCloseOutcome). Re-closing
        // keeps the first closedAt but lets the operator overwrite the outcome
        // when they deliberately submit a new one.
        const outcome = typeof config.closeOutcome === "string" ? config.closeOutcome : null
        const outcomeReason = typeof config.closeOutcomeReason === "string" ? config.closeOutcomeReason : null
        const r = await prisma.socialConversation.updateMany({
          where: { id: cid, organizationId: orgId },
          data: {
            status: "resolved",
            closedAt: ctx.conversation.status === "resolved" ? undefined : new Date(),
            ...(outcome !== null ? { closeOutcome: outcome } : {}),
            ...(outcomeReason !== null ? { closeOutcomeReason: outcomeReason } : {}),
          },
        })
        if (r.count === 0) return { ok: false, action: action.type, error: "not_found" }
        // A conversation that ends because the customer handed over their phone
        // number has to leave a lead behind, and closing is exactly where that
        // was being lost. Lead qualification hung off the two autoreply paths
        // only, so an automation that closed the chat -- the normal way a bot
        // finishes "thanks, we have your number" -- produced a resolved thread
        // with no contact and no lead. The customer was told they would be
        // called back and nobody could call them.
        //
        // The qualifier finds the number in the recent inbound messages itself
        // and is idempotent, so passing the last message is enough and a second
        // close cannot create a duplicate.
        let qualification: InboxQualificationResult | null = null
        try {
          qualification = await maybeCreateQualifiedLeadTask({
            orgId,
            conversationId: cid,
            contactId: ctx.conversation.contactId,
            channelType: effectiveConversationChannel(ctx.conversation),
            inboundText: ctx.conversation.lastMessage ?? "",
            senderName: ctx.conversation.contactName,
          })
        } catch (error) {
          // Never fail the close over this: the operator asked to close the
          // conversation, and a lead that could not be built is a smaller loss
          // than a thread that will not close.
          console.error("[conversation-actions] lead qualification on close failed", {
            conversationId: cid,
            errorType: error instanceof Error ? error.name : "unknown",
          })
        }
        return {
          ok: true,
          action: action.type,
          detail: {
            closeOutcome: outcome,
            ...(qualification?.created ? { leadCreated: true } : {}),
          },
        }
      }

      case "create_ticket": {
        const t = await createTicketWithAssignment({
          organizationId: orgId,
          subject: String(config.subject ?? `Conversation with ${ctx.conversation.contactName || "customer"}`),
          description: config.description ? String(config.description) : undefined,
          priority: config.priority as "low" | "medium" | "high" | "critical" | undefined,
          category: config.category as "general" | "technical" | "billing" | "feature_request" | undefined,
          contactId: ctx.conversation.contactId,
          createdBy: ctx.actorUserId ?? null,
          source: ctx.conversation.platform,
        })
        return { ok: true, action: action.type, detail: { ticketId: t.id, ticketNumber: t.ticketNumber } }
      }

      case "update_field": {
        if (!ctx.conversation.contactId) return { ok: false, action: action.type, error: "no_contact" }
        const field = String(config.field ?? config.path ?? "").trim()
        if (!field) return { ok: false, action: action.type, error: "no_field" }

        let data: Record<string, string | string[]>
        let detailValue: string | string[]
        if (CONTACT_STRING_FIELDS.has(field)) {
          const value = normalizeFieldValue(config.value)
          if (!value) return { ok: false, action: action.type, error: "no_value" }
          const target = field.endsWith("source") ? "source" : "category"
          data = { [target]: value }
          detailValue = value
        } else if (CONTACT_LIFECYCLE_FIELDS.has(field)) {
          const value = normalizeFieldValue(config.value).toLowerCase()
          if (!CONTACT_LIFECYCLE_STAGES.has(value)) {
            return { ok: false, action: action.type, error: "invalid_lifecycle" }
          }
          data = { lifecycleStage: value }
          detailValue = value
        } else if (CONTACT_TAG_FIELDS.has(field)) {
          const tags = normalizeTagsValue(config.value)
          data = { tags }
          detailValue = tags
        } else {
          return { ok: false, action: action.type, error: "field_not_allowed" }
        }

        const r = await prisma.contact.updateMany({
          where: { id: ctx.conversation.contactId, organizationId: orgId },
          data,
        })
        if (r.count === 0) return { ok: false, action: action.type, error: "not_found" }
        return { ok: true, action: action.type, detail: { field, value: detailValue } }
      }

      case "notify": {
        // Recipient precedence: explicit config.userId → the assignee → "" (ORG-WIDE).
        // "" is not an orphan: notifications are read with OR[{userId}, {userId:""}]
        // (notifications/route.ts:53), so "" is visible to every user in the org — the
        // same broadcast convention workflow-engine uses (workflow-engine.ts:208).
        await createNotification({
          organizationId: orgId,
          userId: (config.userId as string | undefined) ?? ctx.conversation.assignedTo ?? "",
          type: (config.type as "info" | "warning" | "error" | "success" | undefined) ?? "info",
          title: String(config.title ?? "Conversation automation"),
          message: String(config.message ?? `Update on conversation with ${ctx.conversation.contactName || "customer"}`),
          entityType: "conversation",
          entityId: cid,
        })
        return { ok: true, action: action.type }
      }

      case "add_participant": {
        const userId = config.userId as string | undefined
        if (!userId) return { ok: false, action: action.type, error: "no_user" }
        await prisma.conversationParticipant.upsert({
          where: { socialConversationId_userId: { socialConversationId: cid, userId } },
          create: { organizationId: orgId, socialConversationId: cid, userId, addedBy: ctx.actorUserId ?? null },
          update: {},
        })
        return { ok: true, action: action.type, detail: { userId } }
      }

      case "send_reply": {
        const text = String(config.text ?? "").trim()
        if (!text) return { ok: false, action: action.type, error: "no_text" }
        const channel = effectiveConversationChannel(ctx.conversation)
        if (!REPLY_CHANNELS.has(channel)) {
          return { ok: false, action: action.type, error: "unsupported_channel" }
        }
        const to = await resolveReplyTarget(ctx, channel as ConversationReplyChannel)
        if (!to) return { ok: false, action: action.type, error: "no_recipient" }
        const sent = await sendConversationReply({
          organizationId: orgId,
          channel: channel as ConversationReplyChannel,
          to,
          body: text,
          contactId: ctx.conversation.contactId,
          conversationId: cid,
          channelConfigId: ctx.conversation.channelConfigId,
          telegramParseMode: null,
          deliveryIdempotency: actionDeliveryIdempotency(ctx, "send_reply"),
        })
        if (!sent.success) {
          return sent.deliveryUnknown
            ? { ok: false, action: action.type, error: "delivery_unknown", detail: { deliveryUnknown: true }, terminal: true }
            : { ok: false, action: action.type, error: sent.error }
        }
        return { ok: true, action: action.type, detail: { messageId: sent.data.id, status: sent.data.status } }
      }

      case "menu": {
        const prompt = String(config.prompt ?? config.text ?? "").trim()
        const options = normalizeMenuOptions(config.options)
        if (!prompt) return { ok: false, action: action.type, error: "no_prompt" }
        if (options.length === 0) return { ok: false, action: action.type, error: "no_options" }

        const selected = findSelectedMenuOption(options, String(config.userMessage ?? ctx.conversation.lastMessage ?? ""))
        if (selected) {
          return {
            ok: true,
            action: action.type,
            branch: `option:${selected.id}`,
            detail: { selectedOptionId: selected.id, selectedLabel: selected.label },
          }
        }

        const channel = effectiveConversationChannel(ctx.conversation)
        if (!REPLY_CHANNELS.has(channel)) {
          return { ok: false, action: action.type, error: "unsupported_channel" }
        }
        const to = await resolveReplyTarget(ctx, channel as ConversationReplyChannel)
        if (!to) return { ok: false, action: action.type, error: "no_recipient" }
        const sent = await sendConversationReply({
          organizationId: orgId,
          channel: channel as ConversationReplyChannel,
          to,
          body: buildMenuBody(prompt, options),
          contactId: ctx.conversation.contactId,
          conversationId: cid,
          channelConfigId: ctx.conversation.channelConfigId,
          telegramParseMode: null,
          deliveryIdempotency: actionDeliveryIdempotency(ctx, "menu"),
        })
        if (!sent.success) {
          return sent.deliveryUnknown
            ? { ok: false, action: action.type, error: "delivery_unknown", detail: { deliveryUnknown: true }, terminal: true }
            : { ok: false, action: action.type, error: sent.error }
        }
        return {
          ok: false,
          action: action.type,
          error: "awaiting_menu_reply",
          detail: { messageId: sent.data.id, status: sent.data.status, optionCount: options.length },
        }
      }

      case "ai_reply": {
        const channel = effectiveConversationChannel(ctx.conversation)
        if (!AI_REPLY_CHANNELS.has(channel)) {
          return { ok: false, action: action.type, error: "unsupported_channel" }
        }
        const owner = await prisma.socialConversation.findFirst({
          where: { id: cid, organizationId: orgId },
          select: { assignedTo: true },
        })
        if (owner?.assignedTo) {
          return { ok: false, action: action.type, error: "assigned_to_human" }
        }
        // Hold an OWNED lease for the WHOLE operation (generate+send can exceed the 8s webhook
        // tight-loop window). `claim.token` is used for compare-and-set release so a failed
        // flow send cannot clear a newer webhook/flow claim.
        const claim = await claimConversationAiReply({ organizationId: orgId, conversationId: cid, holdMs: AI_FLOW_CLAIM_MS })
        if (!claim.claimed) return { ok: false, action: action.type, error: "cooldown" }
        // #4: defer persisting the assistant turn until AFTER a confirmed send.
        const generated = await generateChannelAiReply({
          orgId,
          channel,
          externalId: ctx.conversation.externalId,
          userMessage: String(config.userMessage ?? ctx.conversation.lastMessage).trim(),
          senderName: ctx.conversation.contactName,
          contactId: ctx.conversation.contactId,
          persistAssistant: false,
        })
        if (!generated.reply) {
          // #4: nothing sent → free the claim so a retry isn't blocked by the long hold.
          await releaseConversationAiReplyClaim({ organizationId: orgId, conversationId: cid, token: claim.token })
          return { ok: false, action: action.type, error: generated.skipped || "no_reply" }
        }
        const ownerAfterGeneration = await prisma.socialConversation.findFirst({
          where: { id: cid, organizationId: orgId },
          select: { assignedTo: true },
        })
        if (ownerAfterGeneration?.assignedTo) {
          await releaseConversationAiReplyClaim({ organizationId: orgId, conversationId: cid, token: claim.token })
          return { ok: false, action: action.type, error: "assigned_to_human" }
        }
        // A2 — send-or-draft gate over the channel's policy (same rules as webhook auto-reply).
        {
          const gateCfg = ctx.conversation.channelConfigId
            ? await prisma.channelConfig
                .findFirst({ where: { id: ctx.conversation.channelConfigId, organizationId: orgId }, select: { settings: true } })
                .catch(() => null)
            : null
          const decision = decideAiReplyAction(readAiReplyPolicy(gateCfg?.settings), generated.quality, {
            escalate: generated.escalate,
          })
          if (decision.action === "draft") {
            await saveConversationAiDraft({
              organizationId: orgId,
              conversationId: cid,
              draft: {
                text: generated.reply,
                reason: decision.reason,
                quality: generated.quality,
                channel,
                to: ctx.conversation.externalId,
                sessionId: generated.sessionId,
                createdAt: new Date().toISOString(),
                inboundPreview: String(config.userMessage ?? ctx.conversation.lastMessage).slice(0, 300),
              },
            })
            // Drafted ≠ delivered: release the claim (an operator send isn't bound by it) and
            // surface as a non-ok result so flow branches treat it like "no reply sent".
            await releaseConversationAiReplyClaim({ organizationId: orgId, conversationId: cid, token: claim.token })
            return { ok: false, action: action.type, error: "drafted" }
          }
        }
        const sent = await sendConversationReply({
          organizationId: orgId,
          channel: channel as ConversationReplyChannel,
          to: ctx.conversation.externalId,
          body: generated.reply,
          contactId: ctx.conversation.contactId,
          conversationId: cid,
          channelConfigId: ctx.conversation.channelConfigId,
          telegramParseMode: null,
          deliveryIdempotency: actionDeliveryIdempotency(ctx, "ai_reply"),
          // A1 — mark the flow-sent AI reply and persist its judge score with the message.
          extraMetadata: {
            autoReply: true,
            aiAutoReply: true,
            ...(generated.quality ? { aiQuality: generated.quality } : {}),
          },
        })
        if (!sent.success) {
          if (sent.deliveryUnknown) {
            // The broad deliveryUnknown ChannelMessage written by the sender
            // is a durable no-retry marker. Keep the owned claim until its
            // lease expires and stop this flow before a failure branch can
            // send a second customer message.
            return {
              ok: false,
              action: action.type,
              error: "delivery_unknown",
              detail: { deliveryUnknown: true },
              terminal: true,
            }
          }
          // #4: failed delivery → release the claim (retryable) AND skip the history persist, so we
          // never record a reply the customer never received.
          await releaseConversationAiReplyClaim({ organizationId: orgId, conversationId: cid, token: claim.token })
          return { ok: false, action: action.type, error: sent.error }
        }
        // #4: the customer has it → now persist the assistant turn to AI history.
        if (generated.sessionId) {
          await prisma.aiChatMessage
            .create({ data: { sessionId: generated.sessionId, role: "assistant", content: generated.reply } })
            .catch(() => {})
        }
        // #3: the AI may have promised a human — actually alert the team so the promise isn't dead.
        if (generated.escalate) {
          await notifyEscalationTeam(orgId, channel, cid)
          await import("@/lib/inbox/conversation-events")
            .then(({ emitConversationEvent }) =>
              emitConversationEvent({
                organizationId: orgId,
                conversationId: cid,
                eventType: "ai_escalated",
                actorUserId: ctx.actorUserId ?? null,
              }),
            )
            .catch(() => undefined)
        }
        return {
          ok: true,
          action: action.type,
          detail: { messageId: sent.data.id, status: sent.data.status, escalated: generated.escalate },
        }
      }

      case "handoff_agent": {
        // AI→human transfer: move the conversation to a human and record WHY. The assignedTo
        // move is the real effect; metadata.handoff stores the reason on the conversation row.
        // NOTE: no consumer reads metadata.handoff yet — the handoff surface (inbox side panel)
        // + possible consolidation into the existing AgentHandoff model is a follow-up slice
        // (declared in deferred_findings, E1.3). Not a silent dangling write.
        const toUserId = (config.toUserId ?? config.assignTo ?? null) as string | null
        if (!toUserId) return { ok: false, action: action.type, error: "no_target" }
        // Multi-tenant guard: the human we hand off to must belong to THIS org.
        if (!(await userInOrg(toUserId, orgId))) {
          return { ok: false, action: action.type, error: "target_not_in_org" }
        }
        const reason = config.reason != null ? String(config.reason) : null
        // Same snapshot last-write caveat as `categorize` — fine while headless; the live
        // wiring slice switches both to a race-safe jsonb merge (deferred_findings).
        const merged = { ...(ctx.conversation.metadata ?? {}), handoff: { reason } }
        const r = await prisma.socialConversation.updateMany({
          where: { id: cid, organizationId: orgId },
          data: { assignedTo: toUserId, metadata: merged },
        })
        if (r.count === 0) return { ok: false, action: action.type, error: "not_found" }
        return { ok: true, action: action.type, detail: { assignedTo: toUserId, reason } }
      }

      case "assign_to_queue": {
        const queueId = String(config.queueId ?? config.teamQueueId ?? "").trim()
        if (!queueId) return { ok: false, action: action.type, error: "no_queue" }
        const routed = await routeConversation({ organizationId: orgId, conversationId: cid, queueId })
        if (!routed.routed) return { ok: false, action: action.type, error: routed.reason }
        return {
          ok: true,
          action: action.type,
          detail: {
            queueId: routed.queueId,
            queueName: routed.queueName,
            strategy: routed.strategy,
            assignedTo: routed.assignedTo,
            agentName: routed.agentName,
            load: routed.load,
          },
        }
      }

      case "reroute_if_unanswered": {
        const queueId = String(config.queueId ?? config.teamQueueId ?? "").trim()
        if (!queueId) return { ok: false, action: action.type, error: "no_queue" }

        const conversation = await prisma.socialConversation.findFirst({
          where: { id: cid, organizationId: orgId },
          select: { assignedTo: true, status: true, updatedAt: true, metadata: true },
        }) as { assignedTo: string | null; status: string; updatedAt: Date; metadata: unknown } | null
        if (!conversation) return { ok: false, action: action.type, error: "not_found" }
        if (conversation.status !== "open") return { ok: false, action: action.type, error: "not_open" }

        const minutes = rerouteAfterMinutes(config)
        const assignedAt = routingAssignedAt(conversation.metadata, conversation.updatedAt)
        if (conversation.assignedTo) {
          const dueAt = assignedAt.getTime() + minutes * 60_000
          if (Date.now() < dueAt) return { ok: false, action: action.type, error: "not_due" }

          const outbound = await prisma.channelMessage.findFirst({
            where: {
              organizationId: orgId,
              conversationId: cid,
              direction: "outbound",
              createdAt: { gte: assignedAt },
            },
            select: { id: true },
          })
          if (outbound) return { ok: false, action: action.type, error: "already_answered" }
        }

        const excludeCurrent = config.excludeCurrentAssignee !== false
        const routed = await routeConversation({
          organizationId: orgId,
          conversationId: cid,
          queueId,
          excludeUserIds: excludeCurrent && conversation.assignedTo ? [conversation.assignedTo] : [],
        })
        if (!routed.routed) return { ok: false, action: action.type, error: routed.reason }
        return {
          ok: true,
          action: action.type,
          detail: {
            queueId: routed.queueId,
            queueName: routed.queueName,
            strategy: routed.strategy,
            assignedTo: routed.assignedTo,
            agentName: routed.agentName,
            load: routed.load,
            previousAssignedTo: conversation.assignedTo,
            reason: conversation.assignedTo ? "unanswered" : "unassigned",
          },
        }
      }

      case "business_hours_gate": {
        const channelType = String(config.channelType ?? effectiveConversationChannel(ctx.conversation)).trim()
        const decision = await getBusinessHoursDecision({
          organizationId: orgId,
          channelType,
        })
        const detail = {
          reason: decision.reason,
          channelType: decision.channelType,
          matchedChannelType: decision.matchedChannelType,
          configId: decision.configId,
          timezone: decision.timezone,
          localDate: decision.localDate,
          localTime: decision.localTime,
          weekday: decision.weekday,
          replyMessage: decision.replyMessage,
        }
        if (decision.open) {
          return { ok: true, action: action.type, detail }
        }
        return { ok: false, action: action.type, error: "outside_business_hours", detail }
      }

      default: {
        // Untyped JSON from a flow graph can carry an unknown action type.
        return { ok: false, action: (action as ConversationAction).type, error: "unknown_action" }
      }
    }
  } catch (e) {
    console.error(`[conversation-action] ${action.type} failed:`, e)
    return { ok: false, action: action.type, error: "exception" }
  }
}
