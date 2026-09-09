import { prisma } from "@/lib/prisma"
import { runConversationFlow, type FlowRunResult } from "@/lib/inbox/flow-runner"
import { featureFlagsToArray } from "@/lib/modules"

export const CONVERSATION_FLOW_EVENTS_FLAG = "conversationFlowEvents"
const ACCEPTED_FLAGS = new Set([CONVERSATION_FLOW_EVENTS_FLAG, "conversationAutomation"])

export type ConversationEventType =
  | "conversation_opened"
  | "message_inbound"
  | "conversation_idle"
  | "ai_escalated"
  | "conversation.opened"
  | "message.inbound"
  | "conversation.idle"
  | "ai.escalated"

export interface EmitConversationEventParams {
  organizationId: string
  conversationId: string
  eventType: ConversationEventType
  actorUserId?: string | null
}

export interface EmitConversationEventResult {
  ok: boolean
  /** A flow reached a delivery-unknown terminal action. No later flow or reply pipeline may send. */
  terminal: boolean
  skipped?: "flag_off" | "conversation_not_found" | "delivery_unconfirmed" | "no_flows" | "unsupported_event"
  eventType: "conversation_opened" | "message_inbound" | "conversation_idle" | "ai_escalated"
  flowsRun: number
  results: Array<{ flowId: string; ok: boolean; status: FlowRunResult["status"]; error?: string; terminal: boolean }>
}

function normalizeEventType(
  eventType: ConversationEventType,
): "conversation_opened" | "message_inbound" | "conversation_idle" | "ai_escalated" | null {
  if (eventType === "conversation.opened") return "conversation_opened"
  if (eventType === "message.inbound") return "message_inbound"
  if (eventType === "conversation.idle") return "conversation_idle"
  if (eventType === "ai.escalated") return "ai_escalated"
  if (
    eventType === "conversation_opened"
    || eventType === "message_inbound"
    || eventType === "conversation_idle"
    || eventType === "ai_escalated"
  ) {
    return eventType
  }
  return null
}

function conversationFlowEventsEnabled(features: unknown): boolean {
  return featureFlagsToArray(features).some((flag) => ACCEPTED_FLAGS.has(flag))
}

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function effectiveConversationChannel(conversation: { platform: string; metadata?: unknown }): string {
  const inboxChannel = conversation.platform === "inbox" ? metadataString(conversation.metadata, "channel") : null
  return inboxChannel || conversation.platform
}

async function hasUnconfirmedOutboundDelivery(params: {
  organizationId: string
  conversationId: string
}): Promise<boolean> {
  const row = await prisma.channelMessage.findFirst({
    where: {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      direction: "outbound",
      OR: [
        {
          status: "pending",
          metadata: { path: ["deliveryAttempted"], equals: true },
        },
        {
          status: "failed",
          metadata: { path: ["deliveryUnknown"], equals: true },
        },
      ],
    },
    select: { id: true },
  })
  return row !== null
}

/** Match active ConversationFlow rows for one inbound conversation event and run them.
 * Flag-gated OFF by default: no org runs live flows until `conversationFlowEvents`
 * (or the temporary alias `conversationAutomation`) is present in Organization.features.
 */
export async function emitConversationEvent(params: EmitConversationEventParams): Promise<EmitConversationEventResult> {
  const eventType = normalizeEventType(params.eventType)
  if (!eventType) {
    return { ok: false, terminal: false, skipped: "unsupported_event", eventType: "message_inbound", flowsRun: 0, results: [] }
  }

  // This safety gate is intentionally independent of the flow feature flag:
  // Chatwoot consumes the terminal result to suppress its keyword/AI reply tail
  // even for tenants that have conversation flows disabled.
  const unconfirmedDelivery = await hasUnconfirmedOutboundDelivery(params)
  if (unconfirmedDelivery) {
    return {
      ok: false,
      terminal: true,
      skipped: "delivery_unconfirmed",
      eventType,
      flowsRun: 0,
      results: [],
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: params.organizationId },
    select: { features: true },
  })
  if (!conversationFlowEventsEnabled(org?.features)) {
    return { ok: true, terminal: false, skipped: "flag_off", eventType, flowsRun: 0, results: [] }
  }

  const conversation = await prisma.socialConversation.findFirst({
    where: { id: params.conversationId, organizationId: params.organizationId },
    select: { platform: true, metadata: true },
  })
  if (!conversation) {
    return { ok: false, terminal: false, skipped: "conversation_not_found", eventType, flowsRun: 0, results: [] }
  }

  const channel = effectiveConversationChannel(conversation)
  const channelMatchers =
    channel === conversation.platform
      ? [{ channelTypes: { has: channel } }]
      : [{ channelTypes: { has: channel } }, { channelTypes: { has: conversation.platform } }]

  const flows = await prisma.conversationFlow.findMany({
    where: {
      organizationId: params.organizationId,
      status: "active",
      trigger: eventType,
      OR: [{ channelTypes: { isEmpty: true } }, ...channelMatchers],
    },
    orderBy: [{ updatedAt: "desc" }],
  })
  if (flows.length === 0) {
    return { ok: true, terminal: false, skipped: "no_flows", eventType, flowsRun: 0, results: [] }
  }

  const results: EmitConversationEventResult["results"] = []
  for (const flow of flows) {
    try {
      const result = await runConversationFlow({
        flow,
        conversationId: params.conversationId,
        organizationId: params.organizationId,
        actorUserId: params.actorUserId ?? null,
      })
      const terminal = result.terminal === true
      results.push({ flowId: flow.id, ok: result.ok, status: result.status, error: result.error, terminal })
      // Delivery-unknown is terminal across the whole event, not merely this graph:
      // a second matching flow could otherwise send another reply to the same inbound.
      if (terminal) break
    } catch (error) {
      // The action may have reached the provider and persisted its attempt marker
      // before a later flow-run audit write threw. Re-read the durable state so an
      // exception cannot erase terminal delivery semantics.
      const terminal = await hasUnconfirmedOutboundDelivery(params)
      results.push({
        flowId: flow.id,
        ok: false,
        status: "failed",
        error: error instanceof Error ? error.message : "exception",
        terminal,
      })
      if (terminal) break
    }
  }

  const terminal = results.some((result) => result.terminal)
  return { ok: results.every((r) => r.ok), terminal, eventType, flowsRun: results.length, results }
}

export async function emitConversationIngestEvents(params: {
  organizationId: string
  conversationId: string
  wasCreated?: boolean
  actorUserId?: string | null
  /**
   * E2 — actual sender address for EMAIL-derived messages: lets the cadence
   * auto-exit tell the enrolled person's reply from a third party jumping
   * into the thread. Other channels omit it (the sender IS the account).
   */
  senderEmail?: string | null
}): Promise<{
  opened?: EmitConversationEventResult
  inbound?: EmitConversationEventResult
  terminal: boolean
}> {
  const opened = params.wasCreated
    ? await emitConversationEvent({
        organizationId: params.organizationId,
        conversationId: params.conversationId,
        eventType: "conversation_opened",
        actorUserId: params.actorUserId ?? null,
      })
    : undefined
  // A newly opened conversation can match a send flow before message_inbound is
  // dispatched. If that send is delivery-unknown, the second event must not run a
  // second flow against the same inbound turn.
  const inbound = opened?.terminal
    ? undefined
    : await emitConversationEvent({
        organizationId: params.organizationId,
        conversationId: params.conversationId,
        eventType: "message_inbound",
        actorUserId: params.actorUserId ?? null,
      })

  // Cadence omnichannel auto-exit: an inbound customer message on ANY channel
  // means they responded — stop their active sequence enrollments. This is the
  // single point every inbound channel (whatsapp/telegram/sms/instagram/facebook/
  // chatwoot/vk/web-chat/email) already funnels through, so one hook covers all.
  // Runs regardless of the conversation-flow flag (that only gates emitConversationEvent).
  // Only enrolled Contacts matter, and they always carry a conversation.contactId.
  // Best-effort: autoExitSequenceEnrollments never throws; callers run this inside
  // their tenant RLS scope.
  try {
    const conv = await prisma.socialConversation.findFirst({
      where: { id: params.conversationId, organizationId: params.organizationId },
      select: { contactId: true },
    })
    if (conv?.contactId) {
      // Dynamic import: keeps sequence-auto-exit (and its notifications/auth deps)
      // out of this module's static graph — matches the survey-trigger pattern.
      const { autoExitSequenceEnrollments } = await import("@/lib/sequence-auto-exit")
      await autoExitSequenceEnrollments({
        organizationId: params.organizationId,
        trigger: "replied",
        contactId: conv.contactId,
        fromEmail: params.senderEmail ?? null,
      })
    }
  } catch (err) {
    console.error("[conversation-events] cadence auto-exit failed (non-fatal):", err)
  }

  return { opened, inbound, terminal: opened?.terminal === true || inbound?.terminal === true }
}
